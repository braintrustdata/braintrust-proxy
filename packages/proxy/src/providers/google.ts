import { v4 as uuidv4 } from "uuid";

import { FinishReason, GenerateContentResponse } from "@google/generative-ai";
import { ChatCompletion } from "openai/resources";
import { getTimestampInSeconds } from "..";

function translateFinishReason(
  reason?: FinishReason,
): ChatCompletion.Choice["finish_reason"] {
  // "length" | "stop" | "tool_calls" | "content_filter" | "function_call"
  switch (reason) {
    case FinishReason.MAX_TOKENS:
      return "length";
    case FinishReason.SAFETY:
      return "content_filter";
    case FinishReason.RECITATION:
    case FinishReason.OTHER:
    case FinishReason.STOP:
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case undefined:
      return "stop";
  }
}

export function googleEventToOpenAIChatEvent(
  model: string,
  data: GenerateContentResponse,
): ChatCompletion {
  return {
    id: uuidv4(),
    choices: (data.candidates || []).map((candidate) => ({
      index: candidate.index,
      message: {
        role: "assistant",
        content: candidate.content.parts[0].text || "",
      },
      finish_reason: translateFinishReason(candidate.finishReason),
    })),
    created: getTimestampInSeconds(),
    model,
    object: "chat.completion",
  };
}

export function googleCompletionToOpenAICompletion(
  model: string,
  data: GenerateContentResponse,
): ChatCompletion {
  return {
    id: uuidv4(),
    choices: (data.candidates || []).map((candidate) => ({
      index: candidate.index,
      message: {
        role: "assistant",
        content: candidate.content.parts[0].text || "",
      },
      finish_reason: translateFinishReason(candidate.finishReason),
    })),
    created: getTimestampInSeconds(),
    model,
    object: "chat.completion",
  };
}
