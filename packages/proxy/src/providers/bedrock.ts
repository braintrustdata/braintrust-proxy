import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  ConverseCommandOutput,
  ConverseStreamCommand,
  ConverseStreamOutput,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  StopReason,
  SystemContentBlock,
  Message as BedrockMessage,
  ImageBlock,
  ToolConfiguration,
  InferenceConfiguration,
  ImageFormat,
} from "@aws-sdk/client-bedrock-runtime";
import { APISecret, BedrockMetadata, MessageTypeToMessageType } from "@schema";
import {
  anthropicCompletionToOpenAICompletion,
  anthropicEventToOpenAIEvent,
} from "./anthropic";
import { ChatCompletionChunk, CompletionUsage } from "openai/resources";
import {
  getTimestampInSeconds,
  writeToReadable,
  isEmpty,
  ProxyBadRequestError,
} from "..";
import {
  Message as OaiMessage,
  MessageRole,
  toolsSchema,
  responseFormatJsonSchemaSchema,
} from "@braintrust/core/typespecs";
import {
  ChatCompletion,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { convertImageToBase64 } from "./util";

const brt = new BedrockRuntimeClient({});
export async function fetchBedrockAnthropic({
  secret,
  body,
  isFunction,
  isStructuredOutput,
}: {
  secret: APISecret;
  body: Record<string, unknown>;
  isFunction: boolean;
  isStructuredOutput: boolean;
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
            const parsed = anthropicEventToOpenAIEvent(
              idx,
              usage,
              valueData,
              isStructuredOutput,
            );
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
          isStructuredOutput,
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

async function imageBlock(url: string): Promise<ImageBlock> {
  const imageBlock = await convertImageToBase64({
    image: url,
    allowedImageTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    maxImageBytes: 5 * 1024 * 1024,
  });
  return {
    format: imageBlock.media_type.replace("image/", "") as ImageFormat,
    source: {
      bytes: new Uint8Array(Buffer.from(imageBlock.data, "base64")),
    },
  };
}

export async function translateContent(
  content: OaiMessage["content"],
): Promise<ContentBlock[]> {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return await Promise.all(
    content?.map(async (part) =>
      part.type === "text"
        ? part
        : { image: await imageBlock(part.image_url.url) },
    ) ?? [],
  );
}

function translateToolResults(
  toolCall: ChatCompletionToolMessageParam,
): ContentBlock[] {
  return [
    {
      toolResult: {
        toolUseId: toolCall.tool_call_id,
        content: ((content) => {
          if (typeof content === "string") {
            if (content.trim() !== "") {
              return [{ text: content }];
            } else {
              return [];
            }
          } else {
            return content;
          }
        })(toolCall.content),
      },
    },
  ];
}

function translateToolCalls(
  toolCalls: ChatCompletionMessageToolCall[],
): ContentBlock[] {
  return toolCalls.map((toolCall) => ({
    toolUse: {
      toolUseId: toolCall.id,
      name: toolCall.function.name,
      input: JSON.parse(toolCall.function.arguments),
    },
  }));
}

function flattenMessages(
  messages: Array<BedrockMessage>,
): Array<BedrockMessage> {
  const result: Array<BedrockMessage> = [];
  for (let i = 0; i < messages.length; i++) {
    if (
      result.length > 0 &&
      result[result.length - 1].role === messages[i].role
    ) {
      result[result.length - 1].content = result[
        result.length - 1
      ].content?.concat(messages[i].content ?? []);
    } else {
      result.push(messages[i]);
    }
  }
  return result;
}

function translateTools(tools: ChatCompletionTool[]): ToolConfiguration {
  return {
    tools: tools.map((tool) => ({
      toolSpec: {
        name: tool.function.name,
        description: tool.function.description,
        inputSchema: {
          json: tool.function.parameters as any,
        },
      },
    })),
  };
}

export async function fetchConverse({
  secret,
  body,
}: {
  secret: APISecret;
  body: Record<string, unknown>;
}) {
  if (secret.type !== "bedrock") {
    throw new Error("Bedrock: expected secret");
  }

  const { model, stream, messages: oaiMessages, ...oaiParams } = body;
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

  let messages: Array<BedrockMessage> | undefined = undefined;
  let system: SystemContentBlock[] | undefined = undefined;
  for (const m of oaiMessages as OaiMessage[]) {
    if (m.role === "system") {
      system = [{ text: m.content }];
      continue;
    }

    let role: MessageRole = m.role;
    let content = await translateContent(m.content);
    if (
      m.role === "function" ||
      ("function_call" in m && !isEmpty(m.function_call))
    ) {
      throw new ProxyBadRequestError(
        "Bedrock does not support function messages or function_calls",
      );
    } else if (m.role === "tool") {
      role = "user";
      content = translateToolResults(m);
    } else if (m.role === "assistant" && m.tool_calls) {
      content.push(...translateToolCalls(m.tool_calls));
    }

    const translatedRole = MessageTypeToMessageType[role];
    if (
      !translatedRole ||
      !(translatedRole === "user" || translatedRole === "assistant")
    ) {
      throw new ProxyBadRequestError(`Unsupported Bedrock role ${role}`);
    }

    if (messages === undefined) {
      messages = [];
    }
    messages.push({
      role: translatedRole,
      content,
    });
  }

  let toolConfig: ToolConfiguration | undefined = undefined;
  if (oaiParams.tools || oaiParams.functions) {
    const tools =
      oaiParams.tools ||
      (oaiParams.functions as Array<any>).map((f: any) => ({
        type: "function",
        function: f,
      }));
    const parsed = toolsSchema.safeParse(tools);
    if (!parsed.success) {
      console.warn("Bedrock: invalid tool config: " + parsed.error.message);
    } else {
      toolConfig = translateTools(parsed.data);
    }
    delete oaiParams.functions;
  }

  let isStructuredOutput = false;
  const parsed = z
    .object({
      type: z.literal("json_schema"),
      json_schema: responseFormatJsonSchemaSchema,
    })
    .safeParse(oaiParams.response_format);
  if (parsed.success) {
    isStructuredOutput = true;
    if (toolConfig) {
      throw new ProxyBadRequestError(
        "Structured output is not supported with tools",
      );
    }
    toolConfig = {
      tools: [
        {
          toolSpec: {
            name: "json",
            description: "Output the result in JSON format",
            inputSchema: {
              json: parsed.data.json_schema.schema as any,
            },
          },
        },
      ],
      toolChoice: {
        tool: {
          name: "json",
        },
      },
    };
  }

  const input = {
    modelId: model,
    system,
    messages: messages ? flattenMessages(messages) : undefined,
    inferenceConfig: translateInferenceConfig(oaiParams),
    toolConfig,
  };

  const httpResponse = new Response(null, {
    status: 200,
  });

  let responseStream;
  try {
    if (stream) {
      const command = new ConverseStreamCommand(input);
      const response = await brt.send(command);
      if (!response.stream) {
        throw new Error("Bedrock: empty response body");
      }
      const bodyStream = response.stream;
      const iterator = bodyStream[Symbol.asyncIterator]();
      let next: IteratorResult<ConverseStreamOutput, any> | null =
        await iterator.next(); // So that we can throw a nice error message
      let state: BedrockMessageState = {
        completionId: uuidv4(),
        role: "assistant",
      };
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
            try {
              const { event, finished } = bedrockMessageToOpenAIMessage(
                state,
                value,
                isStructuredOutput,
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
        },
        async cancel() {
          // Optional: Handle any cleanup if necessary when the stream is canceled
          if (typeof iterator.return === "function") {
            await iterator.return();
          }
        },
      });
    } else {
      const command = new ConverseCommand(input);
      const response = await brt.send(command);
      responseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify(
                openAIResponse(model, response, isStructuredOutput),
              ),
            ),
          );
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

function openAIFinishReason(s: StopReason) {
  switch (s) {
    case "content_filtered":
      return "content_filter";
    case "end_turn":
      return "stop";
    case "guardrail_intervened":
      return "stop";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "tool_calls";
    default:
      console.warn("Bedrock: unsupported stop reason: " + s);
      return "stop";
  }
}
function openAIResponse(
  model: string,
  response: ConverseCommandOutput,
  isStructuredOutput: boolean,
): ChatCompletion {
  const firstText = response.output?.message?.content?.find(
    (c) => c.text !== undefined,
  );
  const firstTool = response.output?.message?.content?.find(
    (c) => c.toolUse !== undefined,
  );

  return {
    id: uuidv4(),
    object: "chat.completion",
    created: getTimestampInSeconds(),
    model: model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            isStructuredOutput && firstTool
              ? JSON.stringify(firstTool.toolUse.input)
              : firstText?.text ?? "",
          tool_calls:
            !isStructuredOutput && firstTool
              ? [
                  {
                    id: firstTool.toolUse.toolUseId ?? "",
                    type: "function",
                    function: {
                      name: firstTool.toolUse.name ?? "",
                      arguments: JSON.stringify(firstTool.toolUse.input),
                    },
                  },
                ]
              : undefined,
          refusal: null,
        },
        finish_reason:
          isStructuredOutput && firstTool
            ? "stop"
            : openAIFinishReason(response.stopReason ?? "end_turn"),
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: response.usage?.inputTokens ?? 0,
      completion_tokens: response.usage?.outputTokens ?? 0,
      total_tokens:
        (response.usage?.inputTokens ?? 0) +
        (response.usage?.outputTokens ?? 0),
    },
  };
}

function translateInferenceConfig(
  params: Record<string, unknown>,
): InferenceConfiguration {
  return Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [
        k === "max_tokens"
          ? "maxTokens"
          : k === "top_p"
            ? "topP"
            : k === "top_k"
              ? "topK"
              : k,
        v,
      ])
      .filter(([k, _]) =>
        ["maxTokens", "temperature", "topP", "topK"].includes(k as string),
      ),
  );
}

interface BedrockMessageState {
  completionId: string;
  role: ChatCompletionChunk["choices"][0]["delta"]["role"];
}

export function bedrockMessageToOpenAIMessage(
  state: BedrockMessageState,
  output: ConverseStreamOutput,
  isStructuredOutput: boolean,
): {
  event: ChatCompletionChunk | null;
  finished: boolean;
} {
  return ConverseStreamOutput.visit<{
    event: ChatCompletionChunk | null;
    finished: boolean;
  }>(output, {
    messageStart: (value) => {
      state.role = value.role;
      return { event: null, finished: false };
    },
    contentBlockDelta: (value) => ({
      event: {
        id: state.completionId,
        choices: [
          {
            delta: {
              role: state.role,
              content: isStructuredOutput
                ? value.delta?.toolUse
                  ? value.delta.toolUse.input
                  : ""
                : value.delta?.text,
              tool_calls: isStructuredOutput
                ? undefined
                : value.delta?.toolUse
                  ? [
                      {
                        index: value.contentBlockIndex ?? 0,
                        function: {
                          arguments: value.delta?.toolUse?.input,
                        },
                      },
                    ]
                  : undefined,
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
    }),
    metadata: (value) => ({
      event: {
        id: state.completionId,
        choices: [
          {
            delta: {
              role: state.role,
            },
            finish_reason: null,
            index: 0,
          },
        ],
        usage: {
          prompt_tokens: value.usage?.inputTokens ?? 0,
          completion_tokens: value.usage?.outputTokens ?? 0,
          total_tokens:
            (value.usage?.inputTokens ?? 0) + (value.usage?.outputTokens ?? 0),
        },
        created: getTimestampInSeconds(),
        model: "",
        object: "chat.completion.chunk",
      },
      finished: true,
    }),
    messageStop: (value) => ({
      event: {
        id: state.completionId,
        choices: [
          {
            delta: {
              role: state.role,
            },
            finish_reason:
              isStructuredOutput && value.stopReason === "tool_use"
                ? "stop"
                : openAIFinishReason(value.stopReason ?? "end_turn"),
            index: 0,
          },
        ],
        created: getTimestampInSeconds(),
        model: "",
        object: "chat.completion.chunk",
      },
      finished: true,
    }),
    contentBlockStart: (value) => ({
      event: {
        id: state.completionId,
        choices: [
          {
            delta: {
              role: state.role,
              content: isStructuredOutput ? "" : undefined,
              tool_calls: isStructuredOutput
                ? undefined
                : [
                    {
                      index: value.contentBlockIndex ?? 0,
                      id: value.start?.toolUse?.toolUseId,
                      function: {
                        name: value.start?.toolUse?.name,
                      },
                    },
                  ],
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
    }),
    contentBlockStop: () => ({ event: null, finished: false }),
    internalServerException: () => ({ event: null, finished: true }),
    modelStreamErrorException: () => ({ event: null, finished: true }),
    validationException: () => ({ event: null, finished: true }),
    throttlingException: () => ({ event: null, finished: true }),
    serviceUnavailableException: () => ({ event: null, finished: true }),
    _: () => ({ event: null, finished: false }),
  });
}
