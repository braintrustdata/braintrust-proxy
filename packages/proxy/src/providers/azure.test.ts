import { OpenAIChatCompletion, OpenAIChatCompletionCreateParams } from "@types";
import { expect, it } from "vitest";
import { callProxyV1 } from "../../utils/tests";

it("should filter Braintrust parameters when calling OpenAI", async () => {
  if (!process.env.AZURE_OPENAI_API_KEY) {
    console.warn(
      "Skipping Azure OpenAI test because AZURE_OPENAI_API_KEY is not set",
    );
    expect(1).toBe(1);
    return;
  }

  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams & {
      reasoning_enabled?: boolean;
      reasoning_budget?: number;
    },
    OpenAIChatCompletion
  >({
    body: {
      model: "gpt-5",
      // These Braintrust parameters should be filtered out before reaching OpenAI
      reasoning_enabled: true,
      reasoning_budget: 5000,
      messages: [
        {
          role: "user",
          content: "Say hello in one word",
        },
      ],
      max_tokens: 1000,
      stream: false,
    },
    proxyHeaders: {
      "x-bt-endpoint-name": "azure",
    },
  });

  expect(json()).toMatchObject({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        logprobs: null,
        message: {
          annotations: [],
          content: expect.any(String),
          refusal: null,
          role: "assistant",
        },
      },
    ],
    created: expect.any(Number),
    id: expect.any(String),
    model: expect.stringContaining("gpt-5"),
    object: "chat.completion",
  });
});
