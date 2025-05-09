// TODO(ibolmo): move from core
import { chatCompletionMessageParamSchema } from "@braintrust/core/typespecs/dist";
export { chatCompletionMessageParamSchema } from "@braintrust/core/typespecs/dist";

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
};
