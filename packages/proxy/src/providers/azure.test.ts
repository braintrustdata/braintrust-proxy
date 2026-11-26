import { OpenAIChatCompletion, OpenAIChatCompletionCreateParams } from "@types";
import { expect } from "vitest";
import { callProxyV1, createCapturingFetch, it } from "../../utils/tests";

it("should filter Braintrust parameters when calling Azure OpenAI", async () => {
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<
    OpenAIChatCompletionCreateParams & {
      reasoning_enabled?: boolean;
      reasoning_budget?: number;
    },
    OpenAIChatCompletion
  >({
    body: {
      model: "gpt-5",
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
    fetch,
    getApiSecrets: async () => [
      {
        type: "azure",
        secret: "test-token",
        name: "azure",
        metadata: {
          api_base: "https://test.openai.azure.com",
          auth_type: "api_key",
          deployment: "gpt-5",
          api_version: "2025-01-01-preview",
        },
      },
    ],
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain(
    "https://test.openai.azure.com/openai/deployments/gpt-5/chat/completions",
  );
  expect(requests[0].body).not.toHaveProperty("reasoning_enabled");
  expect(requests[0].body).not.toHaveProperty("reasoning_budget");
});
