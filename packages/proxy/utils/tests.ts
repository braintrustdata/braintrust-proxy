/* eslint-disable turbo/no-undeclared-env-vars */

import { TextDecoder } from "util";
import { Buffer } from "node:buffer";
import { proxyV1 } from "../src/proxy";
import { getModelEndpointTypes } from "@schema";
import type { APISecret } from "@schema";
import { createParser, ParsedEvent, ParseEvent } from "eventsource-parser";

export function createResponseStream(): [
  WritableStream<Uint8Array>,
  Promise<Uint8Array[]>,
] {
  const chunks: Uint8Array[] = [];
  let resolveChunks: (chunks: Uint8Array[]) => void;
  let rejectChunks: (error: Error) => void;

  const chunksPromise = new Promise<Uint8Array[]>((resolve, reject) => {
    resolveChunks = resolve;
    rejectChunks = reject;
  });

  const writableStream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
    close() {
      resolveChunks(chunks);
    },
    abort(reason) {
      rejectChunks(new Error(`Stream aborted: ${reason}`));
    },
  });

  return [writableStream, chunksPromise];
}

export function createHeaderHandlers() {
  const ref = {
    headers: {} as Record<string, string>,
    statusCode: -1,
    setHeader(name: string, value: string) {
      ref.headers[name] = value;
    },
    setStatusCode(code: number) {
      ref.statusCode = code;
    },
  };
  return ref;
}

export const getKnownApiSecrets: Parameters<
  typeof proxyV1
>[0]["getApiSecrets"] = async (
  useCache: boolean,
  authToken: string,
  model: string | null,
  _org_name?: string,
) => {
  const endpointTypes = model && getModelEndpointTypes(model);
  if (!endpointTypes?.length) throw new Error(`Unknown model: ${model}`);

  return [
    {
      type: "anthropic" as const,
      secret: process.env.ANTHROPIC_API_KEY || "",
      name: "anthropic",
    },
    {
      type: "google" as const,
      secret: process.env.GEMINI_API_KEY || "",
      name: "google",
    },
    {
      type: "openai" as const,
      secret: process.env.OPENAI_API_KEY || "",
      name: "openai",
    },
    {
      type: "vertex" as const,
      secret: process.env.VERTEX_AI_API_KEY || "",
      name: "vertex",
      metadata: {
        project: process.env.GCP_PROJECT_ID || "",
        authType: "access_token" as const,
        api_base: "",
        supportsStreaming: true,
        excludeDefaultModels: false,
      },
    },
    {
      type: "bedrock" as const,
      secret: process.env.AWS_SECRET_ACCESS_KEY || "",
      name: "bedrock" as const,
      metadata: {
        region: process.env.AWS_REGION || "",
        access_key: process.env.AWS_ACCESS_KEY_ID || "",
        session_token: process.env.AWS_SESSION_TOKEN || "",
        supportsStreaming: true,
        excludeDefaultModels: false,
      },
    },
    {
      type: "azure" as const,
      secret: process.env.AZURE_OPENAI_API_KEY || "",
      name: "azure",
      metadata: {
        api_base: process.env.AZURE_OPENAI_ENDPOINT || "",
        auth_type: "api_key" as const,
        deployment: "gpt-5",
        api_version: process.env.AZURE_OPENAI_API_VERSION || "",
        customModels: {
          "gpt-5": {
            flavor: "chat",
            format: "openai",
            reasoning: true,
            multimodal: false,
            description: "",
            displayName: "",
            reasoning_budget: true,
          },
        },
        supportsStreaming: true,
        no_named_deployment: false,
        excludeDefaultModels: true,
      },
    },
  ].filter(
    (secret) => !!secret.secret && endpointTypes.includes(secret.type),
  ) as APISecret[];
};

export async function callProxyV1<Input extends object, Output extends object>({
  body,
  proxyHeaders,
  ...request
}: Partial<Omit<Parameters<typeof proxyV1>, "body" | "proxyHeaders">> & {
  body: Input;
  proxyHeaders?: Record<string, string>;
}): Promise<
  ReturnType<typeof createHeaderHandlers> & {
    chunks: Uint8Array[];
    responseText: string;
    events: () => ReturnType<typeof chucksToEvents<Output>>;
    json: () => Output;
  }
> {
  const [writableStream, chunksPromise] = createResponseStream();
  const ref = createHeaderHandlers();

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<Uint8Array[]>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out after 30s`));
    }, 30000);
  });

  try {
    const requestBody = typeof body === "string" ? body : JSON.stringify(body);

    const proxyPromise = proxyV1({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {
        "content-type": "application/json",
        authorization: `Bearer dummy-token`,
        ...proxyHeaders,
      },
      setHeader: ref.setHeader,
      setStatusCode: ref.setStatusCode,
      res: writableStream,
      getApiSecrets: getKnownApiSecrets,
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message: string) =>
        Buffer.from(message).toString("base64"),
      ...request,
      body: requestBody,
    });

    await proxyPromise;

    const chunks = await Promise.race([chunksPromise, timeoutPromise]);
    const responseText = new TextDecoder().decode(Buffer.concat(chunks));

    // TODO: avoid object reference trick
    // @ts-expect-error
    ref.chunks = chunks;
    // @ts-expect-error
    ref.responseText = responseText;
    // @ts-expect-error
    ref.events = () => chucksToEvents<Output>(chunks);
    // @ts-expect-error
    ref.json = () => {
      try {
        return JSON.parse(responseText) as Output;
      } catch (e) {
        return null;
      }
    };

    // @ts-expect-error
    return ref;
  } catch (error) {
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

const chucksToEvents = <ChunkData extends object>(chunks: Uint8Array[]) => {
  const textDecoder = new TextDecoder();
  const results: (Omit<ParsedEvent, "data"> & { data: ChunkData })[] = [];

  const parser = createParser((event) => {
    if (event.type === "event" && event.data !== "[DONE]") {
      results.push({
        ...event,
        data: JSON.parse(event.data) as ChunkData,
      });
    }
  });

  for (const chunk of chunks) {
    parser.feed(textDecoder.decode(chunk));
  }

  return results;
};
