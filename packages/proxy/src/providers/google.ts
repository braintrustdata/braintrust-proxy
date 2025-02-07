import { v4 as uuidv4 } from "uuid";
import { Message } from "@braintrust/core/typespecs";
import {
  Content,
  FinishReason,
  GenerateContentResponse,
  InlineDataPart,
  Part,
} from "@google/generative-ai";
import { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import { getTimestampInSeconds } from "..";
import { convertImageToBase64 } from "./util";

export async function makeGoogleImageBlock(
  image: string,
): Promise<InlineDataPart> {
  const imageBlock = await convertImageToBase64({
    image,
    allowedImageTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    maxImageBytes: null,
  });

  return {
    inlineData: {
      mimeType: imageBlock.media_type,
      data: imageBlock.data,
    },
  };
}

async function openAIContentToGoogleContent(
  content: Message["content"],
): Promise<Part[]> {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return Promise.all(
    content?.map(async (part) =>
      part.type === "text"
        ? { text: part.text }
        : await makeGoogleImageBlock(part.image_url.url),
    ) ?? [],
  );
}

export async function openAIMessagesToGoogleMessages(
  messages: Message[],
): Promise<Content[]> {
  // First, do a basic mapping
  const content: Content[] = await Promise.all(
    messages.map(
      async (m: Message): Promise<Content> => ({
        parts: await openAIContentToGoogleContent(m.content),
        // TODO: Add tool call support
        role: m.role === "assistant" ? "model" : m.role,
      }),
    ),
  );

  // Then, flatten each content item into an individual message
  const flattenedContent: Content[] = content.flatMap((c) =>
    c.parts.map((p) => ({
      role: c.role,
      parts: [p],
    })),
  );

  // Finally, sort the messages so that:
  // 1. All images are up front
  // 2. The system prompt.
  // 3. Then all user messages' text parts
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
    case FinishReason.LANGUAGE:
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
          choices: (data.candidates || []).map((candidate) => {
            console.log("candidate", candidate);
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
): ChatCompletion {
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
