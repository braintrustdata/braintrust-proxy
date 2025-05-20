// TODO: move from core
import { chatCompletionMessageParamSchema } from "@braintrust/core/typespecs";

import { z } from "zod";

import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
} from "openai/resources";

export type OpenAIChatCompletionMessage = z.infer<
  typeof chatCompletionMessageParamSchema
>;

export type OpenAIChatCompletionChoice = ChatCompletion.Choice & {
  message: OpenAIChatCompletionMessage;
};

export type OpenAIChatCompletion = ChatCompletion & {
  choices: Array<OpenAIChatCompletionChoice>;
};

export const chatCompletionMessageReasoningSchema = z
  .object({
    id: z
      .string()
      .nullish()
      .transform((x) => x ?? undefined),
    content: z
      .string()
      .nullish()
      .transform((x) => x ?? undefined),
  })
  .describe(
    "Note: This is not part of the OpenAI API spec, but we added it for interoperability with multiple reasoning models.",
  );

export type OpenAIReasoning = z.infer<
  typeof chatCompletionMessageReasoningSchema
>;

export type OpenAIChatCompletionChunkChoiceDelta =
  ChatCompletionChunk.Choice.Delta & {
    reasoning?: OpenAIReasoning;
  };

export type OpenAIChatCompletionChunkChoice = ChatCompletionChunk.Choice & {
  delta: OpenAIChatCompletionChunkChoiceDelta;
};

export type OpenAIChatCompletionChunk = ChatCompletionChunk & {
  choices: Array<OpenAIChatCompletionChunkChoice>;
};

export type OpenAIChatCompletionCreateParams = ChatCompletionCreateParams & {
  messages: Array<OpenAIChatCompletionMessage>;
  reasoning_enabled?: boolean;
  reasoning_budget?: number;
};

// overrides
import "openai/resources/chat/completions";

declare module "openai/resources/chat/completions" {
  interface ChatCompletionCreateParamsBase {
    reasoning_enabled?: boolean;
    reasoning_budget?: number;
  }
  interface ChatCompletionAssistantMessageParam {
    reasoning?: OpenAIReasoning[];
  }
  namespace ChatCompletion {
    interface Choice {
      reasoning?: OpenAIReasoning[];
    }
  }
}

export const completionUsageSchema = z.object({
  completion_tokens: z.number(),
  prompt_tokens: z.number(),
  total_tokens: z.number(),
  completion_tokens_details: z
    .object({
      accepted_prediction_tokens: z.number().optional(),
      audio_tokens: z.number().optional(),
      reasoning_tokens: z.number().optional(),
      rejected_prediction_tokens: z.number().optional(),
    })
    .optional(),
  prompt_tokens_details: z
    .object({
      audio_tokens: z.number().optional(),
      cached_tokens: z.number().optional(),
      cache_creation_tokens: z
        .number()
        .optional()
        .describe(
          "Extension to support Anthropic `cache_creation_input_tokens`",
        ),
    })
    .optional(),
});

export type CompletionUsage = z.infer<typeof completionUsageSchema>;
