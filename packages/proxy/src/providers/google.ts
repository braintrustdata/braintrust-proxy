import { v4 as uuidv4 } from "uuid";

import { FinishReason, GenerateContentResponse } from "@google/generative-ai";
import { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import { getTimestampInSeconds } from "..";

function translateFinishReason(
  reason?: FinishReason,
): ChatCompletion.Choice["finish_reason"] | null {
  // "length" | "stop" | "tool_calls" | "content_filter" | "function_call"
  switch (reason) {
    case FinishReason.MAX_TOKENS:
      return "length";
    case FinishReason.SAFETY:
      return "content_filter";
    case FinishReason.STOP:
      return "stop";
    case FinishReason.RECITATION:
    case FinishReason.OTHER:
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case undefined:
      return null;
  }
}

export function googleEventToOpenAIChatEvent(
  model: string,
  data: GenerateContentResponse,
): { event: ChatCompletionChunk | null; finished: boolean } {
  return {
    event: data.candidates
      ? {
          id: uuidv4(),
          choices: (data.candidates || []).map((candidate) => ({
            index: candidate.index,
            delta: {
              role: "assistant",
              content: candidate.content.parts[0].text || "",
            },
            finish_reason: translateFinishReason(candidate.finishReason),
          })),
          created: getTimestampInSeconds(),
          model,
          object: "chat.completion.chunk",
          usage: data.usageMetadata
            ? {
                prompt_tokens: data.usageMetadata.promptTokenCount,
                completion_tokens: data.usageMetadata.candidatesTokenCount,
                total_tokens: data.usageMetadata.totalTokenCount,
              }
            : undefined,
        }
      : null,
    finished:
      false /* all of the events seem to have STOP as the finish reason */,
  };
}

export function googleCompletionToOpenAICompletion(
  model: string,
  data: GenerateContentResponse,
): ChatCompletion {
  return {
    id: uuidv4(),
    choices: (data.candidates || []).map((candidate) => ({
      logprobs: null,
      index: candidate.index,
      message: {
        role: "assistant",
        content: candidate.content.parts[0].text || "",
      },
      finish_reason: translateFinishReason(candidate.finishReason) || "stop",
    })),
    created: getTimestampInSeconds(),
    model,
    object: "chat.completion",
    usage: data.usageMetadata
      ? {
          prompt_tokens: data.usageMetadata.promptTokenCount,
          completion_tokens: data.usageMetadata.candidatesTokenCount,
          total_tokens: data.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

export const OpenAIParamsToGoogleParams: {
  [name: string]: string | null;
} = {
  temperature: "temperature",
  top_p: "topP",
  stop: "stopSequences",
  max_tokens: "maxOutputTokens",
  frequency_penalty: null,
  presence_penalty: null,
  tool_choice: null,
};
