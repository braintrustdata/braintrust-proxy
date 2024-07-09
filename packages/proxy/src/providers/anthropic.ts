import { v4 as uuidv4 } from "uuid";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources";
import { getTimestampInSeconds } from "../util";
import {
  AnthropicContent,
  AnthropicImageBlock,
  anthropicImageBlockSchema,
} from "@schema";
import { Message } from "@braintrust/core/typespecs";
import { z } from "zod";

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

export const anthropicStreamEventSchema = z.union([
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
      stop_reason: z.union([z.literal("end_turn"), z.literal("tool_use")]),
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

export function anthropicEventToOpenAIEvent(
  idx: number,
  eventU: unknown,
): { event: ChatCompletionChunk | null; finished: boolean } {
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
  let tool_calls: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined =
    undefined;

  if (
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
    tool_calls = [
      {
        id: event.content_block.id,
        index: event.index - 1,
        type: "function",
        function: {
          name: event.content_block.name,
          arguments: "",
        },
      },
    ];
  } else if (
    event.type === "content_block_delta" &&
    event.delta.type === "text_delta"
  ) {
    content = idx === 0 ? event.delta.text.trimStart() : event.delta.text;
  } else if (
    event.type === "content_block_delta" &&
    event.delta.type === "input_json_delta"
  ) {
    tool_calls = [
      {
        index: event.index - 1,
        function: {
          arguments: event.delta.partial_json,
        },
      },
    ];
  } else if (event.type === "message_delta") {
    return {
      event: {
        id: uuidv4(),
        choices: [
          {
            delta: {},
            finish_reason:
              event.delta.stop_reason === "end_turn" ? "stop" : "tool_calls",
            index: 0,
          },
        ],
        model: "",
        object: "chat.completion.chunk",
        created: getTimestampInSeconds(),
      },
      finished: true,
    };
  } else {
    return {
      event: null,
      finished: false,
    };
    console.warn(
      `Skipping unhandled Anthropic stream event: ${JSON.stringify(eventU)}`,
    );
  }

  return {
    event: {
      id: uuidv4(),
      choices: [
        {
          delta: {
            content,
            tool_calls,
            role: "assistant",
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
): ChatCompletion {
  const firstText = completion.content.find((c) => c.type === "text");
  const firstTool = completion.content.find((c) => c.type === "tool_use");
  return {
    id: completion.id,
    choices: [
      {
        logprobs: null,
        finish_reason: anthropicFinishReason(completion.stop_reason) || "stop",
        index: 0,
        message: {
          role: "assistant",
          // Anthropic inserts extra whitespace at the beginning of the completion
          content: firstText ? firstText.text.trimStart() : null,
          tool_calls: isFunction
            ? undefined
            : firstTool
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
): ChatCompletion.Choice["finish_reason"] | null {
  return stop_reason === "stop_reason"
    ? "stop"
    : stop_reason === "max_tokens"
      ? "length"
      : null;
}

const base64ImagePattern =
  /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function convertBase64Image(image: string): AnthropicImageBlock {
  const match = image.match(base64ImagePattern);
  if (!match) {
    throw new Error("Unable to parse base64 image: " + image);
  }

  const [, media_type, data] = match;
  return anthropicImageBlockSchema.parse({
    type: "image",
    source: {
      type: "base64",
      media_type,
      data,
    },
  });
}

const maxImageBytes = 5 * 1024 * 1024;
const allowedImageTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binaryString = "";
  bytes.forEach((b) => (binaryString += String.fromCharCode(b)));
  return btoa(binaryString);
}

async function convertImageUrl(url: string): Promise<AnthropicImageBlock> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType) {
    throw new Error("Failed to get content type of the image");
  }
  if (!allowedImageTypes.includes(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxImageBytes) {
    throw new Error("Image size exceeds the 5 MB limit for Claude");
  }

  const data = arrayBufferToBase64(arrayBuffer);

  return anthropicImageBlockSchema.parse({
    type: "image",
    source: {
      type: "base64",
      media_type: contentType,
      data,
    },
  });
}

export async function makeAnthropicImageBlock(
  image: string,
): Promise<AnthropicImageBlock> {
  if (base64ImagePattern.test(image)) {
    return convertBase64Image(image);
  }

  return convertImageUrl(image);
}

export async function openAIContentToAnthropicContent(
  content: Message["content"],
): Promise<AnthropicContent> {
  if (typeof content === "string") {
    return content;
  }
  return Promise.all(
    content?.map(async (part) =>
      part.type === "text"
        ? part
        : await makeAnthropicImageBlock(part.image_url.url),
    ) ?? [],
  );
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
