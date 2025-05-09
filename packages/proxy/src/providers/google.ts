import { v4 as uuidv4 } from "uuid";
import { Message } from "@braintrust/core/typespecs";
import {
  Content,
  FinishReason,
  GenerateContentResponse,
  InlineDataPart,
  Part,
} from "@google/generative-ai";
import { getTimestampInSeconds } from "..";
import {
  OpenAIChatCompletion,
  OpenAIChatCompletionChoice,
  OpenAIChatCompletionChunk,
} from "@types";
import { convertMediaToBase64 } from "./util";

async function makeGoogleMediaBlock(media: string): Promise<InlineDataPart> {
  const { media_type: mimeType, data } = await convertMediaToBase64({
    media,
    allowedMediaTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
      "video/mp4",
      "video/webm",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/webm",
      "application/pdf",
    ],
    maxMediaBytes: null,
  });

  return {
    inlineData: {
      mimeType,
      data,
    },
  };
}

export async function openAIContentToGoogleContent(
  content: Message["content"],
): Promise<Part[]> {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return Promise.all(
    content?.map(async (part) =>
      part.type === "text"
        ? { text: part.text }
        : await makeGoogleMediaBlock(part.image_url.url),
    ) ?? [],
  );
}

export async function openAIMessagesToGoogleMessages(
  messages: Message[],
): Promise<Content[]> {
  // First, do a basic mapping
  const content: Content[] = await Promise.all(
    messages.map(async (m) => {
      const contentParts =
        m.role === "tool" ? [] : await openAIContentToGoogleContent(m.content);
      const toolCallParts: Part[] =
        m.role === "assistant"
          ? m.tool_calls?.map((t) => ({
              functionCall: {
                name: t.id,
                args: JSON.parse(t.function.arguments),
              },
            })) ?? []
          : [];
      const toolResponseParts: Part[] =
        m.role === "tool"
          ? [
              {
                functionResponse: {
                  name: m.tool_call_id,
                  response: {
                    name: m.tool_call_id,
                    content: JSON.parse(m.content),
                  },
                },
              },
            ]
          : [];
      return {
        parts: [...contentParts, ...toolCallParts, ...toolResponseParts],
        role:
          m.role === "assistant"
            ? "model"
            : m.role === "tool"
              ? "user"
              : m.role,
      };
    }),
  );

  const flattenedContent: Content[] = [];
  for (let i = 0; i < content.length; i++) {
    if (
      flattenedContent.length > 0 &&
      flattenedContent[flattenedContent.length - 1].role === content[i].role
    ) {
      flattenedContent[flattenedContent.length - 1].parts = flattenedContent[
        flattenedContent.length - 1
      ].parts.concat(content[i].parts);
    } else {
      flattenedContent.push(content[i]);
    }
  }

  // Finally, sort the messages so that:
  // 1. All images are up front
  // 2. The system prompt.
  // 3. Then all user messages' text parts
  // The EcmaScript spec requires the sort to be stable, so this is safe.
  const sortedContent: Content[] = flattenedContent.sort((a, b) => {
    if (a.parts[0].inlineData && !b.parts[0].inlineData) {
      return -1;
    } else if (b.parts[0].inlineData && !a.parts[0].inlineData) {
      return 1;
    }

    if (a.role === "system" && b.role !== "system") {
      return -1;
    } else if (b.role === "system" && a.role !== "system") {
      return 1;
    }

    return 0;
  });

  return sortedContent;
}

function translateFinishReason(
  reason?: FinishReason,
): OpenAIChatCompletionChoice["finish_reason"] | null {
  // "length" | "stop" | "tool_calls" | "content_filter" | "function_call"
  switch (reason) {
    case FinishReason.MAX_TOKENS:
      return "length";
    case FinishReason.SAFETY:
      return "content_filter";
    case FinishReason.STOP:
      return "stop";
    case FinishReason.RECITATION:
    case FinishReason.LANGUAGE:
    case FinishReason.OTHER:
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case undefined:
      return null;
  }
  return null;
}

export function googleEventToOpenAIChatEvent(
  model: string,
  data: GenerateContentResponse,
): { event: OpenAIChatCompletionChunk | null; finished: boolean } {
  return {
    event: data.candidates
      ? {
          id: uuidv4(),
          choices: (data.candidates || []).map((candidate) => {
            const firstText = candidate.content.parts.find(
              (p) => p.text !== undefined,
            );
            const toolCalls = candidate.content.parts
              .filter((p) => p.functionCall !== undefined)
              .map((p, i) => ({
                id: uuidv4(),
                type: "function" as const,
                function: {
                  name: p.functionCall.name,
                  arguments: JSON.stringify(p.functionCall.args),
                },
                index: i,
              }));
            return {
              index: 0,
              delta: {
                role: "assistant",
                content: firstText?.text ?? "",
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
              },
              finish_reason:
                toolCalls.length > 0
                  ? "tool_calls"
                  : translateFinishReason(candidate.finishReason),
            };
          }),
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
      data.candidates?.every(
        (candidate) => candidate.finishReason !== undefined,
      ) ?? false,
  };
}

export function googleCompletionToOpenAICompletion(
  model: string,
  data: GenerateContentResponse,
): OpenAIChatCompletion {
  return {
    id: uuidv4(),
    choices: (data.candidates || []).map((candidate) => {
      const firstText = candidate.content.parts.find(
        (p) => p.text !== undefined,
      );
      const toolCalls = candidate.content.parts
        .filter((p) => p.functionCall !== undefined)
        .map((p) => ({
          id: uuidv4(),
          type: "function" as const,
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args),
          },
        }));
      return {
        logprobs: null,
        index: candidate.index,
        message: {
          role: "assistant",
          content: firstText?.text ?? "",
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          refusal: null,
        },
        finish_reason:
          toolCalls.length > 0
            ? "tool_calls"
            : translateFinishReason(candidate.finishReason) || "stop",
      };
    }),
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
