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
  console.log("DATA", data);
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
  };
}

// This is copied from the google sdk (readFromReader)
// https://github.com/google/generative-ai-js/blob/0a6a22275666be69770c5f20d10cbf5ed87a889c/packages/main/src/requests/stream-reader.ts
const responseLineRE = /^data\: (.*)\r\n/;
export function google_readFromReader(
  reader: ReadableStreamDefaultReader,
): ReadableStream<GenerateContentResponse> {
  let currentText = "";
  const stream = new ReadableStream<GenerateContentResponse>({
    start(controller) {
      return pump();
      async function pump(): Promise<(() => Promise<void>) | undefined> {
        return reader.read().then(({ value, done }) => {
          if (done) {
            controller.close();
            return;
          }
          const chunk = new TextDecoder().decode(value);
          currentText += chunk;
          const match = currentText.match(responseLineRE);
          if (match) {
            let parsedResponse: GenerateContentResponse;
            try {
              parsedResponse = JSON.parse(match[1]);
            } catch (e) {
              throw new Error(`Error parsing JSON response: "${match[1]}"`);
            }
            currentText = "";
            controller.enqueue(parsedResponse);
          }
          return pump();
        });
      }
    },
  });
  return stream;
}
