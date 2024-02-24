import { v4 as uuidv4 } from "uuid";
import { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import { getTimestampInSeconds } from "../util";

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
