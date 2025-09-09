import { type ChatCompletionMessageParamType as Message } from "../generated_types";
import {
  Content,
  FinishReason,
  GenerateContentConfig,
  GenerateContentParameters,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part,
  ThinkingConfig,
} from "@google/genai";
import {
  OpenAIChatCompletion,
  OpenAIChatCompletionChoice,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
  OpenAICompletionUsage,
} from "@types";
import { getBudgetMultiplier } from "utils";
import { cleanOpenAIParams } from "utils/openai";
import { v4 as uuidv4 } from "uuid";
import { getTimestampInSeconds } from "../util";
import { convertMediaToBase64 } from "./util";

async function makeGoogleMediaBlock(media: string): Promise<Part> {
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
      const reasoningParts =
        "reasoning" in m && m.reasoning
          ? m.reasoning.map((r) => ({ text: r.content, thought: true }))
          : [];

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
                    content: m.content,
                  },
                },
              },
            ]
          : [];
      return {
        parts: [
          ...reasoningParts,
          ...contentParts,
          ...toolCallParts,
          ...toolResponseParts,
        ],
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
    const last = flattenedContent[flattenedContent.length - 1];
    if (last && last.role === content[i].role) {
      last.parts = [...(last.parts || []), ...(content[i].parts || [])];
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
    const aFirst = a.parts?.[0];
    const bFirst = b.parts?.[0];

    if (aFirst?.inlineData && !bFirst?.inlineData) {
      return -1;
    } else if (bFirst?.inlineData && !aFirst?.inlineData) {
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
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.SPII:
    case FinishReason.BLOCKLIST:
      return "content_filter";
    case FinishReason.STOP:
      return "stop";
    case FinishReason.RECITATION:
    case FinishReason.LANGUAGE:
    case FinishReason.OTHER:
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case FinishReason.MALFORMED_FUNCTION_CALL:
      return "content_filter";
    case undefined:
    default:
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
            const firstThought = candidate.content?.parts?.find(
              (part) => part.text !== undefined && part.thought,
            );
            const firstText = candidate.content?.parts?.find(
              (part) => part.text !== undefined && !part.thought,
            );
            const toolCalls =
              candidate.content?.parts
                ?.filter((part) => part.functionCall !== undefined)
                .map((part, i) => ({
                  id: uuidv4(),
                  type: "function" as const,
                  function: {
                    name: part?.functionCall?.name,
                    arguments: JSON.stringify(part.functionCall?.args),
                  },
                  index: i,
                })) || [];
            return {
              index: 0,
              delta: {
                role: "assistant",
                content: firstText?.text ?? "",
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                ...(firstThought && {
                  reasoning: {
                    id: uuidv4(),
                    content: firstThought.text,
                  },
                }),
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
          usage: geminiUsageToOpenAIUsage(data.usageMetadata),
        }
      : null,
    finished:
      data.candidates?.every(
        (candidate) => candidate.finishReason !== undefined,
      ) ?? false,
  };
}

const geminiUsageToOpenAIUsage = (
  usageMetadata?: GenerateContentResponseUsageMetadata,
): OpenAICompletionUsage | undefined => {
  if (!usageMetadata) {
    return undefined;
  }

  const thoughtsTokenCount = usageMetadata.thoughtsTokenCount;
  const cachedContentTokenCount = usageMetadata.cachedContentTokenCount;

  return {
    prompt_tokens: usageMetadata.promptTokenCount || 0,
    completion_tokens: usageMetadata.candidatesTokenCount || 0,
    total_tokens: usageMetadata.totalTokenCount || 0,
    ...(thoughtsTokenCount && {
      completion_tokens_details: { reasoning_tokens: thoughtsTokenCount },
    }),
    ...(cachedContentTokenCount && {
      prompt_tokens_details: { cached_tokens: cachedContentTokenCount },
    }),
  };
};

export function googleCompletionToOpenAICompletion(
  model: string,
  data: GenerateContentResponse,
): OpenAIChatCompletion {
  return {
    id: uuidv4(),
    choices: (data.candidates || []).map((candidate) => {
      const firstText = candidate.content?.parts?.find(
        (part) => part.text !== undefined && !part.thought,
      );
      const firstThought = candidate.content?.parts?.find(
        (part) => part.text !== undefined && part.thought,
      );
      const toolCalls =
        candidate.content?.parts
          ?.filter((part) => part.functionCall !== undefined)
          .map((part) => ({
            id: uuidv4(),
            type: "function" as const,
            function: {
              name: part?.functionCall?.name || "unknown",
              arguments: JSON.stringify(part?.functionCall?.args),
            },
          })) || [];
      return {
        logprobs: null,
        index: candidate.index || 0,
        message: {
          role: "assistant",
          content: firstText?.text ?? "",
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          refusal: null,
          ...(firstThought && {
            reasoning: [{ id: uuidv4(), content: firstThought.text }],
          }),
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
    usage: geminiUsageToOpenAIUsage(data.usageMetadata),
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

// because GenAI sdk doesn't provide a convenient API equivalent type
type GeminiGenerateContentParams = Omit<GenerateContentParameters, "config"> &
  Omit<
    GenerateContentConfig,
    | "httpOptions"
    | "abortSignal"
    | "routingConfig"
    | "modelSelectionConfig"
    | "labels"
  >;

export const openaiParamsToGeminiMessageParams = (
  openai: OpenAIChatCompletionCreateParams,
): GeminiGenerateContentParams => {
  const gemini: GeminiGenerateContentParams = {
    // TODO: we depend on translateParams to get us half way there
    ...(cleanOpenAIParams(openai) as any),
  };

  const maxTokens =
    openai.max_completion_tokens !== undefined ||
    openai.max_tokens !== undefined
      ? Math.max(openai.max_completion_tokens || 0, openai.max_tokens || 0) ||
        1024
      : undefined;

  gemini.maxOutputTokens = maxTokens;

  if (
    openai.reasoning_effort !== undefined ||
    openai.reasoning_budget !== undefined ||
    openai.reasoning_enabled !== undefined
  ) {
    gemini.thinkingConfig = getGeminiThinkingParams({
      ...openai,
      max_completion_tokens: maxTokens,
    });
  }

  return gemini;
};

const getGeminiThinkingParams = (
  openai: OpenAIChatCompletionCreateParams & {
    max_completion_tokens?: Required<number>;
  },
): ThinkingConfig => {
  if (openai.reasoning_enabled === false || openai.reasoning_budget === 0) {
    return {
      thinkingBudget: 0,
    };
  }

  return {
    includeThoughts: true,
    thinkingBudget: getThinkingBudget(openai),
  };
};

const getThinkingBudget = (
  openai: OpenAIChatCompletionCreateParams & {
    max_completion_tokens?: Required<number>;
  },
): number => {
  if (openai.reasoning_budget !== undefined) {
    return openai.reasoning_budget;
  }

  let budget = 1024;

  if (openai.reasoning_effort !== undefined) {
    budget = Math.floor(
      getBudgetMultiplier(openai.reasoning_effort || "low") *
        (openai.max_completion_tokens ?? 1024),
    );
  }

  return budget;
};
