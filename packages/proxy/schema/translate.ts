import type { ChatCompletionMessageParamType as Message } from "../src/generated_types";
import { openaiParamsToAnthropicMesssageParams } from "../src/providers/anthropic";
import { openaiParamsToGeminiMessageParams } from "../src/providers/google";
import type { OpenAIChatCompletionCreateParams } from "../types";

import {
  defaultModelParamSettings,
  type ModelFormat,
  type ModelSpec,
  modelParamToModelParam,
} from "./index";

const paramMappers: Partial<
  Record<
    ModelFormat,
    (
      params: OpenAIChatCompletionCreateParams,
      modelSpec?: ModelSpec | null,
    ) => object
  >
> = {
  anthropic: openaiParamsToAnthropicMesssageParams,
  google: openaiParamsToGeminiMessageParams,
};

export function buildClassicChatPrompt(messages: Message[]) {
  return (
    messages
      .map(
        ({ content, role }) => `<|im_start|>${role}
${content}<|im_end|>`,
      )
      .join("\n") + "\n<|im_start|>assistant"
  );
}

export function translateParams(
  toProvider: ModelFormat,
  params: Record<string, unknown>,
  modelSpec?: ModelSpec | null,
): Record<string, unknown> {
  let translatedParams: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(params || {})) {
    const safeValue = v ?? undefined;
    const translatedKey = modelParamToModelParam[k];

    if (translatedKey === null) {
      continue;
    }

    const hasDefaultParam =
      translatedKey !== undefined &&
      Object.prototype.hasOwnProperty.call(
        defaultModelParamSettings[toProvider] ?? {},
        translatedKey,
      );

    translatedParams[hasDefaultParam ? translatedKey : k] = safeValue;
  }

  const mapper = paramMappers[toProvider];
  if (mapper) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- translateParams incrementally normalizes an OpenAI-shaped params object before handing it to provider-specific mappers
    translatedParams = mapper(
      translatedParams as unknown as OpenAIChatCompletionCreateParams,
      modelSpec,
    ) as unknown as Record<string, unknown>;
  }

  return translatedParams;
}
