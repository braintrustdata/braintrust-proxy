import {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";
import { trimStartOfStreamHelper } from "ai";
import { ChatCompletionCreateParams, Completion } from "openai/resources";

/**
 * Creates a parser function for processing the OpenAI stream data.
 * The parser extracts and trims text content from the JSON data. This parser
 * can handle data for chat or completion models.
 *
 * @return {(data: string) => string | void} A parser function that takes a JSON string as input and returns the extracted text content or nothing.
 */
export function parseOpenAIStream(): (data: string) => string | void {
  const extract = chunkToText();
  return (data) => extract(JSON.parse(data) as OpenAIStreamReturnTypes);
}

function chunkToText(): (chunk: OpenAIStreamReturnTypes) => string | void {
  const trimStartOfStream = trimStartOfStreamHelper();
  let isFunctionStreamingIn: boolean;
  return (json) => {
    if (isChatCompletionChunk(json)) {
      const delta = json.choices[0]?.delta;
      if (delta.function_call?.name) {
        isFunctionStreamingIn = true;
        return `{"function_call": {"name": "${delta.function_call.name}", "arguments": "`;
      } else if (delta.tool_calls?.[0]?.function?.name) {
        isFunctionStreamingIn = true;
        const toolCall = delta.tool_calls[0];
        if (toolCall.index === 0) {
          return `{"tool_calls":[ {"id": "${toolCall.id}", "type": "function", "function": {"name": "${toolCall.function?.name}", "arguments": "`;
        } else {
          return `"}}, {"id": "${toolCall.id}", "type": "function", "function": {"name": "${toolCall.function?.name}", "arguments": "`;
        }
      } else if (delta.function_call?.arguments) {
        return cleanupArguments(delta.function_call?.arguments);
      } else if (delta.tool_calls?.[0]?.function?.arguments) {
        return cleanupArguments(delta.tool_calls?.[0]?.function?.arguments);
      } else if (
        isFunctionStreamingIn &&
        (json.choices[0]?.finish_reason === "function_call" ||
          json.choices[0]?.finish_reason === "stop")
      ) {
        isFunctionStreamingIn = false; // Reset the flag
        return '"}}';
      } else if (
        isFunctionStreamingIn &&
        json.choices[0]?.finish_reason === "tool_calls"
      ) {
        isFunctionStreamingIn = false; // Reset the flag
        return '"}}]}';
      }
    }

    const text = trimStartOfStream(
      isChatCompletionChunk(json) && json.choices[0].delta.content
        ? json.choices[0].delta.content
        : isCompletion(json)
          ? json.choices[0].text
          : "",
    );
    return text;
  };

  function cleanupArguments(argumentChunk: string) {
    let escapedPartialJson = argumentChunk
      .replace(/\\/g, "\\\\") // Replace backslashes first to prevent double escaping
      .replace(/\//g, "\\/") // Escape slashes
      .replace(/"/g, '\\"') // Escape double quotes
      .replace(/\n/g, "\\n") // Escape new lines
      .replace(/\r/g, "\\r") // Escape carriage returns
      .replace(/\t/g, "\\t") // Escape tabs
      .replace(/\f/g, "\\f"); // Escape form feeds

    return `${escapedPartialJson}`;
  }
}

const __internal__OpenAIFnMessagesSymbol = Symbol(
  "internal_openai_fn_messages",
);

type AzureChatCompletions = any;

type AsyncIterableOpenAIStreamReturnTypes =
  | AsyncIterable<OpenAIChatCompletionChunk>
  | AsyncIterable<Completion>
  | AsyncIterable<AzureChatCompletions>;

type ExtractType<T> = T extends AsyncIterable<infer U> ? U : never;

type OpenAIStreamReturnTypes =
  ExtractType<AsyncIterableOpenAIStreamReturnTypes>;

export function isChatCompletionChunk(
  data: unknown,
): data is OpenAIChatCompletionChunk {
  if (!data || typeof data !== "object") {
    return false;
  }
  return (
    "choices" in data &&
    data.choices &&
    Array.isArray(data.choices) &&
    data.choices[0] &&
    "delta" in data.choices[0]
  );
}

export function isCompletion(data: unknown): data is Completion {
  if (!data || typeof data !== "object") {
    return false;
  }
  return (
    "choices" in data &&
    data.choices &&
    Array.isArray(data.choices) &&
    data.choices[0] &&
    "text" in data.choices[0]
  );
}

/**
 * Cleans the OpenAI parameters by removing extra braintrust fields.
 *
 * @param {OpenAIChatCompletionCreateParams} params - The OpenAI parameters to clean.
 * @returns {ChatCompletionCreateParams} - The cleaned OpenAI parameters.
 */
export function cleanOpenAIParams({
  reasoning_effort,
  reasoning_budget,
  reasoning_enabled,
  ...openai
}: OpenAIChatCompletionCreateParams): ChatCompletionCreateParams {
  return openai;
}
