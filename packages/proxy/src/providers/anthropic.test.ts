import { describe, it, expect } from "vitest";
import { callProxyV1 } from "../../utils/tests";
import {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";

it("should convert OpenAI streaming request to Anthropic and back", async () => {
  const { events } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "claude-2",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me a short joke about programming." },
      ],
      stream: true,
      max_tokens: 150,
    },
  });

  const streamedEvents = events();

  expect(streamedEvents.length).toBeGreaterThan(0);

  streamedEvents.forEach((event) => {
    expect(event.type).toBe("event");

    const data = event.data;
    expect(data.id).toBeTruthy();
    expect(data.object).toBe("chat.completion.chunk");
    expect(data.created).toBeTruthy();
    expect(Array.isArray(data.choices)).toBe(true);

    if (data.choices[0]?.delta?.content) {
      expect(data.choices[0].delta.content.trim()).not.toBe("");
    }
  });

  const hasContent = streamedEvents.some(
    (event) => event.data.choices[0]?.delta?.content !== undefined,
  );
  expect(hasContent).toBe(true);
});

it("should convert OpenAI non-streaming request to Anthropic and back", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-2.1",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me a short joke about programming." },
      ],
      stream: false,
      max_tokens: 150,
    },
  });

  expect(json()).toEqual({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        logprobs: null,
        message: {
          content: expect.any(String),
          refusal: null,
          role: "assistant",
        },
      },
    ],
    created: expect.any(Number),
    id: expect.any(String),
    model: "claude-2.1",
    object: "chat.completion",
    usage: {
      completion_tokens: expect.any(Number),
      prompt_tokens: expect.any(Number),
      total_tokens: expect.any(Number),
      prompt_tokens_details: {
        cache_creation_tokens: expect.any(Number),
        cached_tokens: expect.any(Number),
      },
    },
  });
});

it("should accept and return reasoning/thinking params and detail streaming", async () => {
  const { events } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "claude-3-7-sonnet-latest",
      reasoning_effort: "medium",
      messages: [
        {
          role: "user",
          content: "How many rs in 'ferrocarril'",
        },
        {
          role: "assistant",
          content: "There are 4 letter 'r's in the word \"ferrocarril\".",
          refusal: null,
          reasoning: [
            {
              id: "ErUBCkYIAxgCIkDWT/7OwDfkVSgdtjIwGqUpzIHQXkiBQQpIqzh6WnHHoGxN1ilJxIlnJQNarUI4Jo/3WWrmRnnqOU3LtAakLr4REgwvY1G5jTSbLHWOo4caDKNco+CyDfNT56iXBCIwrNSFdvNJNsBaa0hpbTZ6N4Q4z4/6l+gu8hniKnftBhS+IuzcncsuJqKxWKs/EVyjKh3tvH/eDeYovKskosVSO5x64iebuze1S8JbavI3UBgC",
              content:
                "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
            },
          ],
        },
        {
          role: "user",
          content: "How many e in what you said?",
        },
      ],
      stream: true,
    },
  });

  const streamedEvents = events();
  expect(streamedEvents.length).toBeGreaterThan(0);

  const hasReasoning = streamedEvents.some(
    (event) => event.data.choices[0]?.delta?.reasoning?.content !== undefined,
  );
  expect(hasReasoning).toBe(true);

  const hasContent = streamedEvents.some(
    (event) => event.data.choices[0]?.delta?.content !== undefined,
  );
  expect(hasContent).toBe(true);
});

it("should accept and return reasoning/thinking params and detail non-streaming", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "claude-3-7-sonnet-20250219",
      reasoning_effort: "medium",
      stream: false,
      messages: [
        {
          role: "user",
          content: "How many rs in 'ferrocarril'",
        },
        {
          role: "assistant",
          content: "There are 4 letter 'r's in the word \"ferrocarril\".",
          refusal: null,
          reasoning: [
            {
              id: "ErUBCkYIAxgCIkDWT/7OwDfkVSgdtjIwGqUpzIHQXkiBQQpIqzh6WnHHoGxN1ilJxIlnJQNarUI4Jo/3WWrmRnnqOU3LtAakLr4REgwvY1G5jTSbLHWOo4caDKNco+CyDfNT56iXBCIwrNSFdvNJNsBaa0hpbTZ6N4Q4z4/6l+gu8hniKnftBhS+IuzcncsuJqKxWKs/EVyjKh3tvH/eDeYovKskosVSO5x64iebuze1S8JbavI3UBgC",
              content:
                "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
            },
          ],
        },
        {
          role: "user",
          content: "How many e in what you said?",
        },
      ],
    },
  });

  expect(json()).toEqual({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        logprobs: null,
        message: {
          content: expect.any(String),
          reasoning: [
            {
              content: expect.any(String),
              id: expect.any(String),
            },
          ],
          refusal: null,
          role: "assistant",
        },
      },
    ],
    created: expect.any(Number),
    id: expect.any(String),
    model: "claude-3-7-sonnet-20250219",
    object: "chat.completion",
    usage: {
      completion_tokens: expect.any(Number),
      prompt_tokens: expect.any(Number),
      total_tokens: expect.any(Number),
      prompt_tokens_details: {
        cache_creation_tokens: expect.any(Number),
        cached_tokens: expect.any(Number),
      },
    },
  });
});

it("should disable reasoning/thinking params non-streaming", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "claude-3-7-sonnet-20250219",
      reasoning_enabled: false,
      stream: false,
      messages: [
        {
          role: "user",
          content: "How many rs in 'ferrocarril'",
        },
        {
          role: "assistant",
          content: "There are 4 letter 'r's in the word \"ferrocarril\".",
          refusal: null,
          reasoning: [
            {
              id: "ErUBCkYIAxgCIkDWT/7OwDfkVSgdtjIwGqUpzIHQXkiBQQpIqzh6WnHHoGxN1ilJxIlnJQNarUI4Jo/3WWrmRnnqOU3LtAakLr4REgwvY1G5jTSbLHWOo4caDKNco+CyDfNT56iXBCIwrNSFdvNJNsBaa0hpbTZ6N4Q4z4/6l+gu8hniKnftBhS+IuzcncsuJqKxWKs/EVyjKh3tvH/eDeYovKskosVSO5x64iebuze1S8JbavI3UBgC",
              content:
                "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
            },
          ],
        },
        {
          role: "user",
          content: "How many e in what you said?",
        },
      ],
    },
  });

  expect(json()).toEqual({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        logprobs: null,
        message: {
          content: expect.any(String),
          refusal: null,
          role: "assistant",
        },
      },
    ],
    created: expect.any(Number),
    id: expect.any(String),
    model: "claude-3-7-sonnet-20250219",
    object: "chat.completion",
    usage: {
      completion_tokens: expect.any(Number),
      prompt_tokens: expect.any(Number),
      total_tokens: expect.any(Number),
      prompt_tokens_details: {
        cache_creation_tokens: expect.any(Number),
        cached_tokens: expect.any(Number),
      },
    },
  });
});

it("should handle max_tokens stop reason correctly with tool calls", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-3-haiku-20240307",
      messages: [
        {
          role: "user",
          content:
            "Use the calculate function to add 2 and 3 together. Explain your reasoning in detail.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "calculate",
            description: "Perform a mathematical calculation",
            parameters: {
              type: "object",
              properties: {
                operation: {
                  type: "string",
                  description: "The mathematical operation to perform",
                },
                a: {
                  type: "number",
                  description: "First number",
                },
                b: {
                  type: "number",
                  description: "Second number",
                },
              },
              required: ["operation", "a", "b"],
            },
          },
        },
      ],
      tool_choice: "auto",
      stream: false,
      max_tokens: 5, // Very small to force max_tokens stop reason
    },
  });

  const response = json();
  expect(response).toBeTruthy();
  expect(response!.choices[0].finish_reason).toBe("length");
  expect(response!.choices[0].message.role).toBe("assistant");
  expect(response!.usage?.completion_tokens).toBeLessThanOrEqual(5);
});

it("should handle tool_use stop reason correctly with sufficient tokens", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-3-haiku-20240307",
      messages: [
        {
          role: "user",
          content: "Use the calculate function to add 2 and 3.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "calculate",
            description: "Perform a mathematical calculation",
            parameters: {
              type: "object",
              properties: {
                operation: {
                  type: "string",
                  description: "The mathematical operation to perform",
                },
                a: {
                  type: "number",
                  description: "First number",
                },
                b: {
                  type: "number",
                  description: "Second number",
                },
              },
              required: ["operation", "a", "b"],
            },
          },
        },
      ],
      tool_choice: "required", // Force tool usage
      stream: false,
      max_tokens: 150, // Sufficient tokens to complete tool call
    },
  });

  const response = json();
  expect(response).toBeTruthy();
  expect(response!.choices[0].finish_reason).toBe("tool_calls");
  expect(response!.choices[0].message.role).toBe("assistant");
  expect(response!.choices[0].message.tool_calls).toBeTruthy();
  expect(response!.choices[0].message.tool_calls).toHaveLength(1);
  expect(response!.choices[0].message.tool_calls![0].function.name).toBe(
    "calculate",
  );
  expect(response!.choices[0].message.tool_calls![0].type).toBe("function");
});

it("should avoid anthropic-beta headers for vertex calls", async () => {
  if (!process.env.VERTEX_AI_API_KEY) {
    expect(1).toBe(1);
    return;
  }

  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "publishers/anthropic/models/claude-sonnet-4",
      messages: [
        {
          role: "user",
          content: "Use the calculate function to add 2 and 3.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "calculate",
            description: "Perform a mathematical calculation",
            parameters: {
              type: "object",
              properties: {
                operation: {
                  type: "string",
                  description: "The mathematical operation to perform",
                },
                a: {
                  type: "number",
                  description: "First number",
                },
                b: {
                  type: "number",
                  description: "Second number",
                },
              },
              required: ["operation", "a", "b"],
            },
          },
        },
      ],
      tool_choice: "required", // Force tool usage
      stream: false,
      max_tokens: 150, // Sufficient tokens to complete tool call
    },
  });

  const response = json();
  expect(response).toBeTruthy();
  expect(response!.choices[0].finish_reason).toBe("tool_calls");
  expect(response!.choices[0].message.role).toBe("assistant");
  expect(response!.choices[0].message.tool_calls).toBeTruthy();
  expect(response!.choices[0].message.tool_calls).toHaveLength(1);
  expect(response!.choices[0].message.tool_calls![0].function.name).toBe(
    "calculate",
  );
  expect(response!.choices[0].message.tool_calls![0].type).toBe("function");
});
