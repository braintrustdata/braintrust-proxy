import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ResponseStream,
} from "@aws-sdk/client-bedrock-runtime";
import { APISecret, BedrockMetadata } from "@schema";
import {
  anthropicCompletionToOpenAICompletion,
  anthropicEventToOpenAIEvent,
} from "./anthropic";
import {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  CompletionUsage,
} from "openai/resources";
import { writeToReadable } from "..";

const brt = new BedrockRuntimeClient({});
export async function fetchBedrockAnthropic({
  secret,
  body,
  isFunction,
}: {
  secret: APISecret;
  body: Record<string, unknown>;
  isFunction: boolean;
}) {
  if (secret.type !== "bedrock") {
    throw new Error("Bedrock: expected secret");
  }

  const { model, stream, ...rest } = body;
  if (!model || typeof model !== "string") {
    throw new Error("Bedrock: expected model");
  }

  const metadata = secret.metadata as BedrockMetadata;

  const brt = new BedrockRuntimeClient({
    region: metadata.region,
    credentials: {
      accessKeyId: metadata.access_key,
      secretAccessKey: secret.secret,
      ...(metadata.session_token
        ? { sessionToken: metadata.session_token }
        : {}),
    },
  });

  const input = {
    body: new TextEncoder().encode(
      JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        ...rest,
      }),
    ),
    contentType: "application/json",
    modelId: model,
  };

  const httpResponse = new Response(null, {
    status: 200,
  });

  let usage: Partial<CompletionUsage> = {};
  let responseStream;
  if (stream) {
    const command = new InvokeModelWithResponseStreamCommand(input);
    const response = await brt.send(command);
    if (!response.body) {
      throw new Error("Bedrock: empty response body");
    }
    const bodyStream = response.body;
    const iterator = bodyStream[Symbol.asyncIterator]();
    let idx = 0;
    responseStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) {
          // Close the stream when no more data is available
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        } else {
          // Enqueue the next piece of data into the stream
          if (value.chunk?.bytes) {
            const valueData = JSON.parse(
              new TextDecoder().decode(value.chunk.bytes),
            );
            idx += 1;
            const parsed = anthropicEventToOpenAIEvent(idx, usage, valueData);
            if (parsed.event) {
              controller.enqueue(
                new TextEncoder().encode(
                  "data: " + JSON.stringify(parsed.event) + "\n\n",
                ),
              );
            } else {
              // Cloudflare seems to freak out unless we send something
              controller.enqueue(new TextEncoder().encode(""));
            }
          }
        }
      },
      async cancel() {
        // Optional: Handle any cleanup if necessary when the stream is canceled
        if (typeof iterator.return === "function") {
          await iterator.return();
        }
      },
    });
  } else {
    const command = new InvokeModelCommand(input);
    const response = await brt.send(command);
    responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const valueData = JSON.parse(new TextDecoder().decode(response.body));
        const anthropicValue = anthropicCompletionToOpenAICompletion(
          valueData,
          isFunction,
        );
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify(anthropicValue)),
        );
        controller.close();
      },
    });
    httpResponse.headers.set("Content-Type", "application/json");
  }

  return {
    stream: responseStream,
    response: httpResponse,
  };
}

// https://docs.aws.amazon.com/nova/latest/userguide/getting-started-schema.html
export async function fetchBedrockOpenAI({
  secret,
  body,
}: {
  secret: APISecret;
  body: Record<string, unknown>;
}) {
  if (secret.type !== "bedrock") {
    throw new Error("Bedrock: expected secret");
  }

  const { model, stream, messages, ...rest } = body;
  if (!model || typeof model !== "string") {
    throw new Error("Bedrock: expected model");
  }

  const metadata = secret.metadata as BedrockMetadata;

  const brt = new BedrockRuntimeClient({
    region: metadata.region,
    credentials: {
      accessKeyId: metadata.access_key,
      secretAccessKey: secret.secret,
      ...(metadata.session_token
        ? { sessionToken: metadata.session_token }
        : {}),
    },
  });

  const messagesTransformed = normalizeBedrockMessages(
    messages as ChatCompletionMessageParam[],
  );

  // https://docs.aws.amazon.com/nova/latest/userguide/getting-started-schema.html
  const params = Object.fromEntries(
    Object.entries(rest)
      .map(([k, v]) => [k === "max_tokens" ? "max_new_tokens" : k, v])
      .filter(([k, _]) =>
        ["max_new_tokens", "temperature", "top_p", "top_k"].includes(
          k as string,
        ),
      ),
  );

  const bodyData = {
    messages: messagesTransformed,
    inferenceConfig: Object.keys(rest).length > 0 ? params : undefined,
  };

  const input = {
    body: new TextEncoder().encode(JSON.stringify(bodyData)),
    contentType: "application/json",
    modelId: model,
  };

  const httpResponse = new Response(null, {
    status: 200,
  });

  let responseStream;
  try {
    console.log("HI 1");
    if (stream) {
      const command = new InvokeModelWithResponseStreamCommand(input);
      const response = await brt.send(command);
      console.log("HI 3");
      if (!response.body) {
        throw new Error("Bedrock: empty response body");
      }
      console.log("HI 2");
      const bodyStream = response.body;
      const iterator = bodyStream[Symbol.asyncIterator]();
      console.log("HI 4");
      let next: IteratorResult<ResponseStream, any> | null =
        await iterator.next(); // So that we can throw a nice error message
      console.log("HERE?");
      responseStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          console.log("PULL?");
          if (!next) {
            try {
              next = await iterator.next();
            } catch (e) {
              console.error("Will silently fail:", e);
              return;
            }
          }
          const { value, done } = next;
          console.log("VALUE", value);
          console.log("DONE", done);
          next = null;
          if (done) {
            // Close the stream when no more data is available
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          } else {
            // Enqueue the next piece of data into the stream
            if (value.chunk?.bytes) {
              const valueData = new TextDecoder().decode(value.chunk.bytes);
              console.log("DATA", valueData);
              controller.enqueue(
                new TextEncoder().encode("data: " + valueData + "\n\n"),
              );
            }
          }
        },
        async cancel() {
          // Optional: Handle any cleanup if necessary when the stream is canceled
          if (typeof iterator.return === "function") {
            await iterator.return();
          }
        },
      });
    } else {
      const command = new InvokeModelCommand(input);
      const response = await brt.send(command);
      responseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(response.body);
          controller.close();
        },
      });
      httpResponse.headers.set("Content-Type", "application/json");
    }
  } catch (e) {
    return {
      stream: writeToReadable(`${e}`),
      response: new Response(null, {
        status: 500,
      }),
    };
  }

  return {
    stream: responseStream,
    response: httpResponse,
  };
}

function normalizeBedrockMessages(messages: ChatCompletionMessageParam[]) {
  return messages.map((m) => {
    return {
      ...m,
      content:
        typeof m.content === "string" ? [{ text: m.content }] : stripType(m),
    };
  });
}

function stripType<T>(v: { type?: string } & T): T {
  const { type, ...rest } = v;
  return rest as T;
}
