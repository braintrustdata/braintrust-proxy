import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
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
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  CompletionUsage,
} from "openai/resources";
import { getTimestampInSeconds, writeToReadable } from "..";

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
    provider: secret.name,
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
    if (stream) {
      const command = new InvokeModelWithResponseStreamCommand(input);
      const response = await brt.send(command);
      if (!response.body) {
        throw new Error("Bedrock: empty response body");
      }
      const bodyStream = response.body;
      const iterator = bodyStream[Symbol.asyncIterator]();
      let next: IteratorResult<ResponseStream, any> | null =
        await iterator.next(); // So that we can throw a nice error message
      let state: BedrockMessageState = { role: "assistant" };
      let isDone = false;
      responseStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!next) {
            try {
              next = await iterator.next();
            } catch (e) {
              console.error("Will silently fail:", e);
              return;
            }
          }

          if (isDone) {
            return;
          }

          const { value, done } = next;
          next = null;
          if (done) {
            // Close the stream when no more data is available
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
            isDone = true;
          } else {
            // Enqueue the next piece of data into the stream
            if (value.chunk?.bytes) {
              const valueData = new TextDecoder().decode(value.chunk.bytes);
              try {
                const { event, finished } = bedrockMessageToOpenAIMessage(
                  state,
                  JSON.parse(valueData),
                );
                if (event) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      "data: " + JSON.stringify(event) + "\n\n",
                    ),
                  );
                } else if (finished) {
                  controller.enqueue(
                    new TextEncoder().encode("data: [DONE]\n\n"),
                  );
                  controller.close();
                  isDone = true;
                }
              } catch (e) {
                console.warn("Bedrock: invalid message", e);
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
    provider: secret.name,
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

const bedrockMessageStartSchema = z.object({
  messageStart: z.object({
    role: z.enum(["assistant"]),
  }),
});

const bedrockContentBlockDeltaSchema = z.object({
  contentBlockDelta: z.object({
    delta: z.object({
      text: z.string(),
    }),
    contentBlockIndex: z.number(),
  }),
});

const bedrockContentBlockStopSchema = z.object({
  contentBlockStop: z.object({
    contentBlockIndex: z.number(),
  }),
});

const bedrockMessageStopSchema = z.object({
  messageStop: z.object({
    stopReason: z.string(),
  }),
});

// {"metadata":{"usage":{"inputTokens":1,"outputTokens":54},"metrics":{},"trace":{}},"amazon-bedrock-invocationMetrics":{"inputTokenCount":1,"outputTokenCount":54,"invocationLatency":884,"firstByteLatency":99}}
const bedrockMetadataSchema = z.object({
  metadata: z.object({
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
    }),
    metrics: z.record(z.unknown()),
    trace: z.record(z.unknown()),
  }),
  "amazon-bedrock-invocationMetrics": z.object({
    inputTokenCount: z.number(),
    outputTokenCount: z.number(),
    invocationLatency: z.number(),
    firstByteLatency: z.number(),
  }),
});

const bedrockMessageSchema = z.union([
  bedrockMessageStartSchema,
  bedrockContentBlockDeltaSchema,
  bedrockContentBlockStopSchema,
  bedrockMessageStopSchema,
  bedrockMetadataSchema,
]);

interface BedrockMessageState {
  role: ChatCompletionChunk["choices"][0]["delta"]["role"];
}

export function bedrockMessageToOpenAIMessage(
  state: BedrockMessageState,
  message: unknown,
): {
  event: ChatCompletionChunk | null;
  finished: boolean;
} {
  const event = bedrockMessageSchema.parse(message);
  if ("messageStart" in event) {
    state.role = event.messageStart.role;
    return { event: null, finished: false };
  } else if ("contentBlockDelta" in event) {
    return {
      event: {
        id: uuidv4(),
        choices: [
          {
            delta: {
              role: state.role,
              content: event.contentBlockDelta.delta.text,
              // TODO: tool_calls
            },
            finish_reason: null,
            index: 0,
          },
        ],
        created: getTimestampInSeconds(),
        model: "",
        object: "chat.completion.chunk",
      },
      finished: false,
    };
  } else if ("amazon-bedrock-invocationMetrics" in event) {
    return {
      event: {
        id: uuidv4(),
        choices: [
          {
            delta: {
              role: state.role,
              content: "",
              // TODO: tool_calls
            },
            finish_reason: null,
            index: 0,
          },
        ],
        usage: {
          prompt_tokens: event.metadata.usage.inputTokens,
          completion_tokens: event.metadata.usage.outputTokens,
          total_tokens:
            event.metadata.usage.inputTokens +
            event.metadata.usage.outputTokens,
        },
        created: getTimestampInSeconds(),
        model: "",
        object: "chat.completion.chunk",
      },
      finished: true,
    };
  } else if ("messageStop" in event) {
    return { event: null, finished: true };
  }
  return { event: null, finished: false };
}
