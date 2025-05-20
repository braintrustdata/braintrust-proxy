import { v4 as uuidv4 } from "uuid";
import {
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  CompletionUsage,
} from "openai/resources";
import { getTimestampInSeconds, isEmpty } from "../util";
import { Message } from "@braintrust/core/typespecs";
import { z } from "zod";
import {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources";
import { convertMediaToBase64 } from "./util";
import {
  ImageBlockParam,
  DocumentBlockParam,
  MessageCreateParamsBase,
  Base64ImageSource,
  MessageCreateParams,
  ThinkingConfigParam,
} from "@anthropic-ai/sdk/resources/messages";
import {
  OpenAIChatCompletion,
  OpenAIChatCompletionChoice,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionChunkChoiceDelta,
  OpenAIChatCompletionCreateParams,
} from "@types";
import { getBudgetMultiplier } from "utils";
import { cleanOpenAIParams } from "utils/openai";

/*
Example events:
{"type":"message_start","message":{"id":"msg_019qcQGjCYv4QGAzYyCUr9TJ","type":"message","role":"assistant","content":[],"model":"claude-2.1","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":14,"output_tokens":1}}}
{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
{"type": "ping"}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"1"}}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" +"}}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" 1"}}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" ="}}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" 2"}}
{"type":"content_block_stop","index":0}
{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":9}}
{"type":"message_stop"}

Tools:

{
  type: 'content_block_start',
  index: 1,
  content_block: {
    type: 'tool_use',
    id: 'toolu_014nvqv5sKcHB8qiNQ7R31WP',
    name: 'add',
    input: {}
  }
}
{
  type: 'content_block_delta',
  index: 1,
  delta: { type: 'input_json_delta', partial_json: '' }
}
{
  type: 'content_block_delta',
  index: 1,
  delta: { type: 'input_json_delta', partial_json: '{"a"' }
}
{ type: 'content_block_stop', index: 1 }
{
  type: 'message_delta',
  delta: { stop_reason: 'tool_use', stop_sequence: null },
  usage: { output_tokens: 82 }
}
*/

export const anthropicDeltaSchema = z.union([
  z.object({
    type: z.literal("text_delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("input_json_delta"),
    partial_json: z.string(),
  }),
  z.object({
    type: z.literal("stop_reason"),
    stop_reason: z.string(),
    stop_sequence: z.string().nullish(),
  }),
]);

export const anthropicUsage = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
});

export const anthropicStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message_start"),
    message: z.object({
      id: z.string(),
      type: z.literal("message"),
      role: z.literal("assistant"),
      content: z.array(z.unknown()),
      stop_reason: z.string().nullish(),
      stop_sequence: z.string().nullish(),
      usage: anthropicUsage.optional(),
      model: z.string(),
    }),
  }),
  z.object({
    type: z.literal("content_block_start"),
    index: z.number(),
    content_block: z.union([
      z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
      z.object({
        type: z.literal("thinking"),
        thinking: z.string(),
        signature: z.string(),
      }),
      z.object({
        type: z.literal("tool_use"),
        id: z.string(),
        name: z.string(),
        input: z.record(z.unknown()),
      }),
    ]),
  }),
  z.object({
    type: z.literal("content_block_delta"),
    index: z.number(),
    delta: z.any(),
  }),
  z.object({
    type: z.literal("content_block_stop"),
    index: z.number(),
  }),
  z.object({
    type: z.literal("message_delta"),
    delta: z.object({
      stop_reason: z.union([
        z.literal("end_turn"),
        z.literal("tool_use"),
        z.literal("max_tokens"),
        z.literal("stop_sequence"),
      ]),
      stop_sequence: z.string().nullish(),
    }),
    usage: anthropicUsage.optional(),
  }),
  z.object({
    type: z.literal("message_stop"),
  }),
  z.object({
    type: z.literal("ping"),
  }),
  z.object({
    type: z.literal("overloaded_error"),
  }),
]);

export type AnthropicStreamEvent = z.infer<typeof anthropicStreamEventSchema>;

/*
Example completion:

{"completion":" 1+1 is equal to 2.","stop_reason":"stop_sequence","model":"claude-instant-1.2","stop":"\n\nHuman:","log_id":"52b6541a56276366ef89078152bfb52372ebc52e8a139d1a44cd0a6ca13c7c4d"}
{"id":"msg_015zpNgnRMvPbU6JQ4iUqN81","type":"message","role":"assistant","content":[{"type":"text","text":"1 + 1 = 2"}],"model":"claude-2.1","stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":14,"output_tokens":9}}
*/
export interface AnthropicCompletion {
  id: string;
  type: "message";
  role: "assistant";
  content: [
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string; signature: string }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      },
  ];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

function updateUsage(
  anthropic: z.infer<typeof anthropicUsage>,
  openai: Partial<CompletionUsage>,
) {
  if (!isEmpty(anthropic.input_tokens)) {
    openai.prompt_tokens = anthropic.input_tokens;
  }
  if (!isEmpty(anthropic.output_tokens)) {
    openai.completion_tokens = anthropic.output_tokens;
  }
}

export function anthropicEventToOpenAIEvent(
  idx: number,
  usage: Partial<CompletionUsage>,
  eventU: unknown,
  isStructuredOutput: boolean,
): { event: OpenAIChatCompletionChunk | null; finished: boolean } {
  const parsedEvent = anthropicStreamEventSchema.safeParse(eventU);
  if (!parsedEvent.success) {
    throw new Error(
      `Unable to parse Anthropic event: ${JSON.stringify(eventU)}\n${
        parsedEvent.error.message
      }`,
    );
  }
  const event = parsedEvent.data;
  if (event.type === "message_stop") {
    return {
      event: null,
      finished: true,
    };
  }

  let content: string | undefined = undefined;
  let tool_calls:
    | OpenAIChatCompletionChunkChoiceDelta["tool_calls"]
    | undefined = undefined;

  let reasoning: OpenAIChatCompletionChunkChoiceDelta["reasoning"] | undefined =
    undefined;

  if (event.type === "message_start") {
    if (event.message.usage) {
      updateUsage(event.message.usage, usage);
    }
    return {
      event: null,
      finished: false,
    };
  } else if (
    event.type === "content_block_start" &&
    event.content_block.type === "text"
  ) {
    content = event.content_block.text.trimStart();
  } else if (
    event.type === "content_block_start" &&
    event.content_block.type === "tool_use"
  ) {
    if (
      event.content_block.input &&
      Object.keys(event.content_block.input).length > 0
    ) {
      throw new Error(
        `Unknown non-empty tool use 'input' field in Anthropic: ${JSON.stringify(
          eventU,
        )}`,
      );
    }
    if (isStructuredOutput) {
      content = "";
    } else {
      tool_calls = [
        {
          id: event.content_block.id,
          index: event.index,
          type: "function",
          function: {
            name: event.content_block.name,
            arguments: "",
          },
        },
      ];
    }
  } else if (
    event.type === "content_block_delta" &&
    event.delta.type === "text_delta"
  ) {
    content = idx === 0 ? event.delta.text.trimStart() : event.delta.text;
  } else if (
    event.type === "content_block_start" &&
    event.content_block.type === "thinking"
  ) {
    reasoning = {
      id: event.content_block.signature,
      content: event.content_block.thinking,
    };
  } else if (
    event.type === "content_block_delta" &&
    event.delta.type === "thinking_delta"
  ) {
    reasoning = {
      content: event.delta.thinking,
    };
  } else if (
    event.type === "content_block_delta" &&
    event.delta.type === "signature_delta"
  ) {
    reasoning = {
      id: event.delta.signature,
    };
  } else if (
    event.type === "content_block_delta" &&
    event.delta.type === "input_json_delta"
  ) {
    if (isStructuredOutput) {
      content = event.delta.partial_json;
    } else {
      tool_calls = [
        {
          index: event.index,
          function: {
            arguments: event.delta.partial_json,
          },
        },
      ];
    }
  } else if (event.type === "message_delta") {
    if (event.usage) {
      updateUsage(event.usage, usage);
    }
    return {
      event: {
        id: uuidv4(),
        choices: [
          {
            delta: {},
            finish_reason:
              isStructuredOutput && event.delta.stop_reason === "tool_use"
                ? "stop"
                : event.delta.stop_reason === "end_turn" ||
                    event.delta.stop_reason === "stop_sequence"
                  ? "stop"
                  : "tool_calls",
            index: 0,
          },
        ],
        model: "",
        object: "chat.completion.chunk",
        created: getTimestampInSeconds(),
        usage:
          !isEmpty(usage.completion_tokens) && !isEmpty(usage.prompt_tokens)
            ? {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.completion_tokens + usage.prompt_tokens,
              }
            : undefined,
      },
      finished: true,
    };
  } else if (event.type === "ping" || event.type === "content_block_stop") {
    return {
      event: null,
      finished: false,
    };
  } else {
    console.warn(
      `Skipping unhandled Anthropic stream event: ${JSON.stringify(eventU)}`,
    );
    return {
      event: null,
      finished: false,
    };
  }

  return {
    event: {
      id: uuidv4(),
      choices: [
        {
          delta: {
            content,
            tool_calls: isStructuredOutput ? undefined : tool_calls,
            role: "assistant",
            reasoning,
          },
          finish_reason: null, // Anthropic places this in a separate stream event.
          index: 0,
        },
      ],
      created: getTimestampInSeconds(),
      model: "",
      object: "chat.completion.chunk",
    },
    finished: false,
  };
}

export function anthropicCompletionToOpenAICompletion(
  completion: AnthropicCompletion,
  isFunction: boolean,
  isStructuredOutput: boolean,
): OpenAIChatCompletion {
  // TODO: will we ever have text -> thinking -> text -> tool_use, thus are we dropping tokens?
  const firstText = completion.content.find((c) => c.type === "text");
  const firstThinking = completion.content.find((c) => c.type === "thinking");
  const firstTool = completion.content.find((c) => c.type === "tool_use");

  return {
    id: completion.id,
    choices: [
      {
        logprobs: null,
        finish_reason:
          isStructuredOutput && firstTool
            ? "stop"
            : anthropicFinishReason(completion.stop_reason) || "stop",
        index: 0,
        message: {
          role: "assistant",
          content:
            isStructuredOutput && firstTool
              ? JSON.stringify(firstTool.input)
              : firstText?.text.trimStart() ?? null,
          tool_calls:
            !isStructuredOutput && !isFunction && firstTool
              ? [
                  {
                    id: firstTool.id,
                    type: "function",
                    function: {
                      name: firstTool.name,
                      arguments: JSON.stringify(firstTool.input),
                    },
                  },
                ]
              : undefined,
          function_call:
            isFunction && firstTool
              ? {
                  name: firstTool.name,
                  arguments: JSON.stringify(firstTool.input),
                }
              : undefined,
          refusal: null,
          ...(firstThinking && {
            reasoning: [
              {
                id: firstThinking.signature,
                content: firstThinking.thinking,
              },
            ],
          }),
        },
      },
    ],
    created: getTimestampInSeconds(),
    model: completion.model,
    object: "chat.completion",
    usage: {
      prompt_tokens: completion.usage.input_tokens,
      completion_tokens: completion.usage.output_tokens,
      total_tokens:
        completion.usage.input_tokens + completion.usage.output_tokens,
    },
  };
}

function anthropicFinishReason(
  stop_reason: string,
): OpenAIChatCompletionChoice["finish_reason"] | null {
  return stop_reason === "stop_reason"
    ? "stop"
    : stop_reason === "max_tokens"
      ? "length"
      : null;
}

export async function makeAnthropicMediaBlock(
  media: string,
): Promise<ImageBlockParam | DocumentBlockParam> {
  const { media_type, data } = await convertMediaToBase64({
    media,
    allowedMediaTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
    ],
    maxMediaBytes: 5 * 1024 * 1024,
  });
  if (media_type === "application/pdf") {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type,
        data,
      },
    };
  } else {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: media_type as Base64ImageSource["media_type"],
        data,
      },
    };
  }
}

export async function openAIContentToAnthropicContent(
  content: Message["content"],
): Promise<MessageParam["content"]> {
  if (typeof content === "string") {
    return content;
  }
  return Promise.all(
    content?.map(async (part) =>
      part.type === "text"
        ? part
        : await makeAnthropicMediaBlock(part.image_url.url),
    ) ?? [],
  );
}

export function openAIToolMessageToAnthropicToolCall(
  toolCall: ChatCompletionToolMessageParam,
): ToolResultBlockParam[] {
  return [
    {
      tool_use_id: toolCall.tool_call_id,
      type: "tool_result",
      content: toolCall.content,
    },
  ];
}

export function openAIToolCallsToAnthropicToolUse(
  toolCalls: ChatCompletionMessageToolCall[],
): ToolUseBlockParam[] {
  return toolCalls.map((t) => ({
    id: t.id,
    type: "tool_use",
    input: JSON.parse(t.function.arguments),
    name: t.function.name,
  }));
}

export function upgradeAnthropicContentMessage(
  content: MessageParam["content"],
): Exclude<MessageParam["content"], string> {
  if (typeof content === "string") {
    if (content.trim() !== "") {
      return [{ text: content, type: "text" }];
    } else {
      return [];
    }
  } else {
    return content;
  }
}

export function flattenAnthropicMessages(
  messages: Array<MessageParam>,
): Array<MessageParam> {
  const result: Array<MessageParam> = [];
  for (let i = 0; i < messages.length; i++) {
    if (
      result.length > 0 &&
      result[result.length - 1].role === messages[i].role
    ) {
      result[result.length - 1].content = upgradeAnthropicContentMessage(
        result[result.length - 1].content,
      ).concat(upgradeAnthropicContentMessage(messages[i].content));
    } else {
      result.push(messages[i]);
    }
  }
  return result;
}

const anthropicToolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string().nullish(),
  input_schema: z.any(),
});

const anthropicTools = z.array(anthropicToolSchema);

export function openAIToolsToAnthropicTools(
  toolsU: unknown,
): z.infer<typeof anthropicTools> {
  // We don't have a zoddified version of ChatCompletionTool, so
  // just do some basic checks:
  if (!Array.isArray(toolsU)) {
    throw new Error("Expected an array of tools");
  }

  const tools = toolsU as Array<ChatCompletionTool>;
  return tools.map((tool) => {
    return anthropicToolSchema.parse({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    });
  });
}

export function anthropicToolChoiceToOpenAIToolChoice(
  toolChoice: OpenAIChatCompletionCreateParams["tool_choice"],
): MessageCreateParamsBase["tool_choice"] {
  if (!toolChoice) {
    return undefined;
  }
  switch (toolChoice) {
    case "none":
      return undefined;
    case "auto":
      return { type: "auto" };
    case "required":
      return { type: "any" };
    default:
      return { type: "tool", name: toolChoice.function.name };
  }
}

export function openaiParamsToAnthropicMesssageParams(
  openai: OpenAIChatCompletionCreateParams,
): MessageCreateParams {
  const anthropic: MessageCreateParams = {
    // TODO: we depend on translateParams to get us half way there
    ...(cleanOpenAIParams(openai) as any),
  };

  const maxTokens =
    Math.max(openai.max_completion_tokens || 0, openai.max_tokens || 0) || 1024;

  anthropic.max_tokens = maxTokens;

  if (
    openai.reasoning_effort !== undefined ||
    openai.reasoning_budget !== undefined ||
    openai.reasoning_enabled !== undefined
  ) {
    anthropic.thinking = getAnthropicThinkingParams({
      ...openai,
      max_completion_tokens: maxTokens,
    });

    if (anthropic.thinking.type === "enabled") {
      // must be 1 when thinking
      anthropic.temperature = 1;

      // avoid anthropic APIs complaining about this
      // need to make sure max_tokens are greater than budget_tokens
      const effectiveMax = Math.max(
        anthropic.max_tokens,
        anthropic.thinking.budget_tokens,
      );
      if (effectiveMax === anthropic.thinking.budget_tokens) {
        anthropic.max_tokens = Math.floor(anthropic.max_tokens * 1.5);
      }
    }
  }

  return anthropic;
}

const getAnthropicThinkingParams = (
  openai: OpenAIChatCompletionCreateParams & {
    max_completion_tokens: Required<number>;
  },
): ThinkingConfigParam => {
  if (openai.reasoning_enabled === false || openai.reasoning_budget === 0) {
    return { type: "disabled" };
  }

  return {
    type: "enabled",
    budget_tokens: getThinkingBudget(openai),
  };
};

const getThinkingBudget = (
  openai: OpenAIChatCompletionCreateParams & {
    max_completion_tokens: Required<number>;
  },
): number => {
  if (openai.reasoning_budget !== undefined) {
    return openai.reasoning_budget;
  }

  let budget = 1024;

  if (openai.reasoning_effort !== undefined) {
    // budget must be at least 1024
    budget = Math.max(
      Math.floor(
        getBudgetMultiplier(openai.reasoning_effort || "low") *
          openai.max_completion_tokens,
      ),
      1024,
    );
  }

  return budget;
};
