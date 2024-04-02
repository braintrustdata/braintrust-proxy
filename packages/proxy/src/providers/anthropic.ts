import { v4 as uuidv4 } from "uuid";
import { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import { getTimestampInSeconds } from "../util";
import {
  AnthropicContent,
  AnthropicImageBlock,
  anthropicImageBlockSchema,
} from "@schema";
import { Message } from "@braintrust/core/typespecs";

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
*/
export interface AnthropicStreamEvent {
  type:
    | "message_start"
    | "content_block_start"
    | "content_block_delta"
    | "content_block_stop"
    | "message_delta"
    | "message_stop"
    | "ping";
  message?: AnthropicCompletion;
  index?: number;
  delta?:
    | { type: "text_delta"; text: string }
    | { stop_reason: string; stop_sequence: string | null };
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
}

/*
Example completion:

{"completion":" 1+1 is equal to 2.","stop_reason":"stop_sequence","model":"claude-instant-1.2","stop":"\n\nHuman:","log_id":"52b6541a56276366ef89078152bfb52372ebc52e8a139d1a44cd0a6ca13c7c4d"}
{"id":"msg_015zpNgnRMvPbU6JQ4iUqN81","type":"message","role":"assistant","content":[{"type":"text","text":"1 + 1 = 2"}],"model":"claude-2.1","stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":14,"output_tokens":9}}
*/
export interface AnthropicCompletion {
  id: string;
  type: "message";
  role: "assistant";
  content: [{ type: "text"; text: string }];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export function anthropicEventToOpenAIEvent(
  idx: number,
  event: AnthropicStreamEvent,
): { event: ChatCompletionChunk | null; finished: boolean } {
  if (event.type === "message_stop") {
    return {
      event: null,
      finished: true,
    };
  }

  if (!(event.delta && "text" in event.delta)) {
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
            content:
              // Anthropic inserts extra whitespace at the beginning of the completion
              idx === 0 ? event.delta.text.trimStart() : event.delta.text,
            role: "assistant",
          },
          finish_reason: null, // Anthropic places this in a separate stream event.
          index: 0,
        },
      ],
      created: getTimestampInSeconds(),
      model: event.model || "",
      object: "chat.completion.chunk",
    },
    finished: false,
  };
}

export function anthropicCompletionToOpenAICompletion(
  completion: AnthropicCompletion,
): ChatCompletion {
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
          content: completion.content[0].text.trimStart(),
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
