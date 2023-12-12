import { OpenAI } from "openai";
import { OpenAIStream } from "ai";

import { AnthropicStream } from "./anthropic";
import {
  AvailableModels,
  EndpointProviderToBaseURL,
  Message,
  ModelEndpointType,
  ModelParams,
  buildAnthropicPrompt,
  defaultModelParams,
  getModelEndpointTypes,
} from "@braintrust/proxy/schema";
import { getRandomInt, parseAuthHeader } from "@braintrust/proxy";
import { lookupApiSecret } from "./login";
import { ChatCompletionTool } from "openai/resources";
import { getRedis } from "./cache";

interface RequestBody {
  prompt?: string;
  tools?: Array<ChatCompletionTool>;
  messages?: Message[];
  model: string;
  params: ModelParams;
  org_name?: string;
}

export async function completion(
  headers: Record<string, string | string[] | undefined>,
  body: RequestBody | string,
): Promise<ReadableStream> {
  const authToken = parseAuthHeader(headers);
  if (!authToken) {
    throw new Error("Missing Authentication header");
  }
  if (typeof body === "string") {
    body = JSON.parse(body) as RequestBody;
  }
  const { prompt, messages, model, params, tools, org_name } = body;
  const modelSpec = AvailableModels[model];
  if (!modelSpec) {
    throw new Error(`Unsupported model ${model}`);
  }

  const endpoints = getModelEndpointTypes(model).filter(
    (e) => e !== "azure", // TODO: Support Azure
  );

  const mergedParams: ModelParams = {
    ...defaultModelParams[modelSpec.format],
    ...params,
  };

  const { use_cache: useCacheParam, ...modelParams } = mergedParams;

  const useCache =
    useCacheParam &&
    "temperature" in modelParams &&
    modelParams.temperature === 0 &&
    org_name !== undefined;

  const cacheKey = "aiproxy:" + JSON.stringify(body);

  let redis = await getRedis();
  if (useCache && redis !== null) {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(cached);
          controller.close();
        },
      });
    }
  }

  const secrets = await lookupApiSecret(true, authToken, endpoints, org_name);
  if (secrets.length === 0) {
    throw new Error("No API key found");
  }
  const secret = secrets[getRandomInt(secrets.length)];

  let ret = null;
  if (modelSpec.format === "openai") {
    // Ask OpenAI for a streaming completion given the prompt
    const openai = new OpenAI({
      apiKey: secret.secret,
      baseURL:
        (secret.type === "azure" && secret.metadata?.api_base) ||
        EndpointProviderToBaseURL[secret.type] ||
        undefined,
    });

    let response = null;
    switch (modelSpec.flavor) {
      case "chat":
        if (messages === undefined) {
          throw new Error(`No messages provided for chat model ${model}`);
        }

        response = await openai.chat.completions.create({
          model,
          stream: true,
          messages: messages as any, // Assume roles have been validated
          functions:
            tools && tools.length > 0
              ? tools.map((t) => t.function)
              : undefined,
          ...modelParams,
          tool_choice: undefined,
          function_call:
            "tool_choice" in modelParams && modelParams.tool_choice
              ? typeof modelParams.tool_choice === "string"
                ? modelParams.tool_choice
                : modelParams.tool_choice.function
              : undefined,
        });
        break;
      case "completion":
        response = await openai.completions.create({
          model,
          stream: true,
          prompt: prompt || null,
          ...modelParams,
        });
        break;
    }

    ret = OpenAIStream(response);
  } else if (modelSpec.format === "anthropic") {
    if (messages === undefined) {
      throw new Error(`No messages provided for chat model ${model}`);
    }
    const prompt = buildAnthropicPrompt(messages);
    for (let i = 0; i < 500; i++) {
      const response = await fetch("https://api.anthropic.com/v1/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": secret.secret,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          prompt: prompt,
          model: model,
          stream: true,
          ...modelParams,
        }),
        keepalive: true,
      });
      // Check for errors
      if (!response.ok) {
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, (i % 100) * 10));
          continue;
        }
        throw new Error(`${response.status} ${await response.text()}`);
      }
      ret = AnthropicStream(response);
      break;
    }
    if (ret === null) {
      throw new Error("Hit maximum timeout (several minutes)");
    }
  } else {
    throw new Error(
      `Unsupported provider ${modelSpec.flavor} (this is likely a bug)`,
    );
  }

  if (useCache && org_name !== undefined && redis !== null) {
    const allChunks: any[] = [];
    const cacheStream = new TransformStream({
      transform(chunk, controller) {
        allChunks.push(chunk);
        controller.enqueue(chunk);
      },
      flush(controller) {
        const text = Buffer.concat(allChunks).toString("utf-8");
        if (useCache && redis !== null) {
          redis.set(cacheKey, text, {
            // Cache it for a week
            EX: 60 * 60 * 24 * 7,
          });
        }
      },
    });

    ret = ret.pipeThrough(cacheStream);
  }

  return ret;
}
