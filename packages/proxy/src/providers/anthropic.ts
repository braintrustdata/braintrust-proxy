import { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import { getTimestampInSeconds } from "../util";

/*
Example events:

{"completion":" 2","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":" =","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":" 6","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":"\n\nSo","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":" the","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":" final","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":" answer","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":" is","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":":","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":" 6","stop_reason":null,"model":"claude-instant-1.2","stop":null,"log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
{"completion":"","stop_reason":"stop_sequence","model":"claude-instant-1.2","stop":"\n\nHuman:","log_id":"c2c3a6812db0df763bfada66ce4354cc0ae9a5ee7308464853834d74eb7d4dc6"}
*/
export interface AnthropicStreamEvent {
  completion?: string;
  stop_reason: string | null;
  model: string;
  stop: string | null;
  log_id: string;
}

/*
Example completion:

{"completion":" 1+1 is equal to 2.","stop_reason":"stop_sequence","model":"claude-instant-1.2","stop":"\n\nHuman:","log_id":"52b6541a56276366ef89078152bfb52372ebc52e8a139d1a44cd0a6ca13c7c4d"}
*/
export interface AnthropicCompletion {
  completion: string;
  stop_reason: string;
  model: string;
  stop: string;
  log_id: string;
}

export function anthropicEventToOpenAIEvent(
  idx: number,
  event: AnthropicStreamEvent
): { event: ChatCompletionChunk | null; finished: boolean } {
  if (!event.completion) {
    return {
      event: null,
      finished: false,
    };
  }

  return {
    event: {
      id: event.log_id,
      choices: [
        {
          delta: {
            content:
              // Anthropic inserts extra whitespace at the beginning of the completion
              idx === 0 ? event.completion.trimStart() : event.completion,
            role: "assistant",
          },
          finish_reason: event.stop_reason
            ? anthropicFinishReason(event.stop_reason)
            : null,
          index: 0,
        },
      ],
      created: getTimestampInSeconds(),
      model: event.model,
      object: "chat.completion.chunk",
    },
    finished: !!event.stop_reason,
  };
}

export function anthropicCompletionToOpenAICompletion(
  completion: AnthropicCompletion
): ChatCompletion {
  return {
    id: completion.log_id,
    choices: [
      {
        finish_reason: anthropicFinishReason(completion.stop_reason) || "stop",
        index: 0,
        message: {
          role: "assistant",
          // Anthropic inserts extra whitespace at the beginning of the completion
          content: completion.completion.trimStart(),
        },
      },
    ],
    created: getTimestampInSeconds(),
    model: completion.model,
    object: "chat.completion",
  };
}

function anthropicFinishReason(
  stop_reason: string
): ChatCompletion.Choice["finish_reason"] | null {
  return stop_reason === "stop_reason"
    ? "stop"
    : stop_reason === "max_tokens"
    ? "length"
    : null;
}
