import {
  chatCompletionMessageParamSchema,
  chatCompletionMessageReasoningSchema,
} from "@braintrust/core/typespecs/dist";
import { z } from "zod";

import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
} from "openai/resources";

export type ExtendedOpenAIChatCompletionMessage = z.infer<
  typeof chatCompletionMessageParamSchema
>;

export type ExtendedOpenAIChatCompletionChoice = ChatCompletion.Choice & {
  message: ExtendedOpenAIChatCompletionMessage;
};

export type ExtendedOpenAIChatCompletion = ChatCompletion & {
  choices: Array<ExtendedOpenAIChatCompletionChoice>;
};

export type ExtendedOpenAIChatCompletionChunkChoiceDelta =
  ChatCompletionChunk.Choice.Delta & {
    reasoning?: z.infer<typeof chatCompletionMessageReasoningSchema>;
  };

export type ExtendedChatCompletionChunkChoice = ChatCompletionChunk.Choice & {
  delta: ExtendedOpenAIChatCompletionChunkChoiceDelta;
};

export type ExtendedOpenAIChatCompletionChunk = ChatCompletionChunk & {
  choices: Array<ExtendedChatCompletionChunkChoice>;
};

export type ExtendedOpenAIChatCompletionCreateParams =
  ChatCompletionCreateParams & {
    messages: Array<ExtendedOpenAIChatCompletionMessage>;
  };
