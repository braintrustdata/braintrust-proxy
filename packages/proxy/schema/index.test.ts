import { MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/messages";
import { GenerateContentParameters } from "@google/genai";
import { ChatCompletionCreateParams } from "openai/resources";
import { expect, it } from "vitest";
import { ModelFormat, translateParams } from "./index";

const examples: Record<
  string,
  {
    openai: ChatCompletionCreateParams;
  } & ( // NOTE: these are not strictly the API params.
    | { google: GenerateContentParameters }
    | { anthropic: MessageCreateParamsBase }
  )
> = {
  simple: {
    openai: {
      model: "gpt-4o",
      max_tokens: 1500,
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello, how are you?" },
      ],
      stream: true,
    },
    google: {
      max_tokens: 1500,
      messages: [
        {
          content: "You are a helpful assistant.",
          role: "system",
        },
        {
          content: "Hello, how are you?",
          role: "user",
        },
      ],
      model: "gpt-4o",
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
    },
    anthropic: {
      max_tokens: 1500,
      messages: [
        {
          content: "You are a helpful assistant.",
          // @ts-expect-error -- TODO: shouldn't we have translated this to a non system role?
          role: "system",
        },
        {
          content: "Hello, how are you?",
          role: "user",
        },
      ],
      model: "gpt-4o",
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
    },
  },
  reasoning: {
    openai: {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      max_tokens: 1000,
      reasoning_effort: "high",
      stream: false,
    },
    google: {
      model: "gpt-4o",
      // notice how this is still an intermediate param
      // google's api expects a content instead of messages, for example
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      thinkingConfig: {
        thinkingBudget: 4096,
        includeThoughts: true,
      },
      maxOutputTokens: 5120,
      stream: false,
    },
    anthropic: {
      model: "gpt-4o",
      messages: [
        {
          // @ts-expect-error  -- we use the role to later manipulate the request
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      max_tokens: 5120,
      temperature: 1,
      stream: false,
      thinking: {
        budget_tokens: 4096,
        type: "enabled",
      },
    },
  },
  "reasoning disable": {
    openai: {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      max_tokens: 1000,
      reasoning_effort: undefined,
      stream: false,
    },
    google: {
      model: "gpt-4o",
      // notice how this is still an intermediate param
      // google's api expects a content instead of messages, for example
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      maxOutputTokens: 1000,
      thinkingConfig: {
        thinkingBudget: 0,
        includeThoughts: true,
      },
      stream: false,
    },
    anthropic: {
      model: "gpt-4o",
      messages: [
        {
          // @ts-expect-error  -- we use the role to later manipulate the request
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      max_tokens: 1000,
      temperature: 0,
      stream: false,
      thinking: {
        type: "disabled",
      },
    },
  },
};

Object.entries(examples).forEach(([example, { openai, ...providers }]) => {
  Object.entries(providers).forEach(([provider, expected]) => {
    it(`[${example}] translate openai to ${provider} params`, () => {
      const result = translateParams(
        provider as ModelFormat,
        openai as unknown as Record<string, unknown>,
      );
      try {
        expect(result).toEqual(expected);
      } catch (error) {
        console.warn(
          `Exact openai -> ${provider} translation failed. Found:`,
          JSON.stringify(result, null, 2),
        );
        expect.soft(result).toEqual(expected);
      }
    });
  });
});
