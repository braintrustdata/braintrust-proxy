import { OpenAIChatCompletion, OpenAIChatCompletionCreateParams } from "@types";
import { describe, expect, it } from "vitest";
import { translateParams } from "@schema";
import { callProxyV1 } from "../../utils/tests";

it("should remove reasoning_enabled and reasoning_budget parameters", () => {
  const body = {
    model: "gpt-4o",
    reasoning_enabled: true,
    reasoning_budget: 5000,
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.7,
    max_tokens: 100,
  };

  const result = translateParams("openai", body);

  expect(result).not.toHaveProperty("reasoning_enabled");
  expect(result).not.toHaveProperty("reasoning_budget");
  expect(result).toHaveProperty("model");
  expect(result).toHaveProperty("messages");
  expect(result).toHaveProperty("temperature");
  expect(result).toHaveProperty("max_tokens");
});

it("should preserve reasoning_effort (valid OpenAI parameter for o1/o3 models)", () => {
  const body = {
    model: "o3-mini",
    reasoning_effort: "medium",
    reasoning_enabled: true,
    reasoning_budget: 5000,
    messages: [{ role: "user", content: "hello" }],
  };

  const result = translateParams("openai", body);

  expect(result).toHaveProperty("reasoning_effort");
  expect(result.reasoning_effort).toBe("medium");
  expect(result).not.toHaveProperty("reasoning_enabled");
  expect(result).not.toHaveProperty("reasoning_budget");
});

it("should filter Braintrust parameters when calling OpenAI", async () => {
  const { json, headers } = await callProxyV1<
    OpenAIChatCompletionCreateParams & {
      reasoning_enabled?: boolean;
      reasoning_budget?: number;
    },
    OpenAIChatCompletion
  >({
    proxyHeaders: {
      "content-type": "application/json",
      authorization: `Bearer dummy-token`,
      "x-bt-endpoint-name": "openai",
    },
    body: {
      model: "gpt-4o-mini",
      // These Braintrust parameters should be filtered out before reaching OpenAI
      reasoning_enabled: true,
      reasoning_budget: 5000,
      messages: [
        {
          role: "user",
          content: "Say hello in one word",
        },
      ],
      max_tokens: 10,
      stream: false,
    },
  });

  // Verify we used the OpenAI endpoint
  expect(headers["x-bt-used-endpoint"]).toBe("openai");

  const response = json();

  // The key assertion: if parameters were properly filtered, we should NOT get
  // errors about reasoning_enabled or reasoning_budget being unknown parameters
  if (response.error) {
    expect(response.error.param).not.toBe("reasoning_enabled");
    expect(response.error.param).not.toBe("reasoning_budget");
    expect(response.error.message).not.toContain("reasoning_enabled");
    expect(response.error.message).not.toContain("reasoning_budget");

    console.log(
      "Request had an error, but NOT about reasoning parameters - test passes",
    );
    console.log("Error:", response.error.message);
  } else {
    // Success case - parameters were filtered and request succeeded
    console.log("Request succeeded - parameters were properly filtered");
    expect(response.choices).toBeDefined();
  }
});
