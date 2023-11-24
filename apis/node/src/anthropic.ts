import { AIStreamCallbacksAndOptions } from "ai";
import { AIStream } from "ai";

// https://github.com/anthropics/anthropic-sdk-typescript/blob/0fc31f4f1ae2976afd0af3236e82d9e2c84c43c9/src/resources/completions.ts#L28-L49
interface CompletionChunk {
  /**
   * The resulting completion up to and excluding the stop sequences.
   */
  completion: string;

  /**
   * The model that performed the completion.
   */
  model: string;

  /**
   * The reason that we stopped sampling.
   *
   * This may be one the following values:
   *
   * - `"stop_sequence"`: we reached a stop sequence — either provided by you via the
   *   `stop_sequences` parameter, or a stop sequence built into the model
   * - `"max_tokens"`: we exceeded `max_tokens_to_sample` or the model's maximum
   */
  stop_reason: string;
}

interface StreamError {
  error: {
    type: string;
    message: string;
  };
}

interface StreamPing {}

type StreamData = CompletionChunk | StreamError | StreamPing;

function parseAnthropicStream(): (data: string) => string | void {
  let isFirst = true;
  return (data) => {
    const json = JSON.parse(data as string) as StreamData;

    // error event
    if ("error" in json) {
      throw new Error(`${json.error.type}: ${json.error.message}`);
    }

    // ping event
    if (!("completion" in json)) {
      return "";
    }

    let text = json.completion;
    if (isFirst) {
      text = text.trimStart();
      isFirst = false;
    }
    return text;
  };
}

export function AnthropicStream(
  res: Response,
  cb?: AIStreamCallbacksAndOptions
): ReadableStream {
  return AIStream(res, parseAnthropicStream(), cb);
}
