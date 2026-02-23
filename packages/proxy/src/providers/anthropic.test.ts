import { it, expect, describe } from "vitest";
import { callProxyV1, createCapturingFetch } from "../../utils/tests";
import {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";
import {
  IMAGE_DATA_URL,
  PDF_DATA_URL,
  TEXT_DATA_URL,
  MD_DATA_URL,
  CSV_DATA_URL,
  AUDIO_DATA_URL,
  VIDEO_DATA_URL,
} from "../../tests/fixtures/base64";

it("should convert OpenAI streaming request to Anthropic and back", async () => {
  const { events } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "claude-3-haiku-20240307",
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
      model: "claude-3-haiku-20240307",
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
    model: "claude-3-haiku-20240307",
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

it("should handle file content parts with PDF data", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What's in this document?",
            },
            {
              type: "file",
              file: {
                file_data: PDF_DATA_URL,
                filename: "test.pdf",
              },
            },
          ],
        },
      ],
      stream: false,
    },
  });

  const response = json();
  expect(response).toBeTruthy();

  console.log(response);

  expect(response!.choices[0].message.role).toBe("assistant");
  expect(response!.choices[0].message.content).toBeTruthy();
  expect(typeof response!.choices[0].message.content).toBe("string");
});

it("should handle file content parts with image data", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image.",
            },
            {
              type: "file",
              file: {
                file_data: IMAGE_DATA_URL,
                filename: "test.png",
              },
            },
          ],
        },
      ],
      stream: false,
    },
  });

  const response = json();
  expect(response).toBeTruthy();
  expect(response!.choices[0].message.role).toBe("assistant");
  expect(response!.choices[0].message.content).toBeTruthy();
  expect(typeof response!.choices[0].message.content).toBe("string");
});

it("should use model's max_output_tokens as default when max_tokens not specified", async () => {
  // This test verifies BRA-3646: when max_tokens is not set, the proxy should
  // use the model's max_output_tokens from the model spec instead of the
  // hardcoded 4096 default. claude-sonnet-4-5 has max_output_tokens: 64000.
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
      // Intentionally NOT setting max_tokens - this is the key part of the test.
      // Previously this would default to 4096.
      // Now it should use the model's max_output_tokens (64000).
    },
    fetch,
  });

  expect(requests).toHaveLength(1);
  // Verify the proxy sent max_tokens: 64000 (from model spec) instead of 4096
  expect(requests[0].body).toMatchObject({ max_tokens: 64000 });
});

it("should default Vertex Anthropic calls to us-east5 when location is omitted", async () => {
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "publishers/anthropic/models/claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    },
    fetch,
    getApiSecrets: async () => [
      {
        type: "vertex",
        secret: "test-token",
        name: "vertex",
        metadata: {
          project: "test-project",
          authType: "access_token",
          api_base: "",
          supportsStreaming: true,
          excludeDefaultModels: false,
        },
      },
    ],
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain("/locations/us-east5/");
});

it("should honor Vertex metadata location for Anthropic calls", async () => {
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "publishers/anthropic/models/claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    },
    fetch,
    getApiSecrets: async () => [
      {
        type: "vertex",
        secret: "test-token",
        name: "vertex",
        metadata: {
          project: "test-project",
          location: "us-central1",
          authType: "access_token",
          api_base: "",
          supportsStreaming: true,
          excludeDefaultModels: false,
        },
      },
    ],
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain("/locations/us-central1/");
});

it("should return error when non-3.7 model receives max_tokens exceeding its limit", async () => {
  const { statusCode } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
      max_tokens: 128000,
    },
  });

  expect(statusCode).toBeGreaterThanOrEqual(400);
});

it("should use 128000 max_tokens and add beta header for claude-3-7-sonnet when unset", async () => {
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [{ role: "user", content: "Say hi" }],
      stream: false,
    },
    fetch,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].body).toMatchObject({ max_tokens: 128000 });
  expect(requests[0].headers["anthropic-beta"]).toContain(
    "output-128k-2025-02-19",
  );
});

it("should convert plain text file to Anthropic PlainTextSource document", async () => {
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What's in this text file?",
            },
            {
              type: "file",
              file: {
                file_data: TEXT_DATA_URL,
                filename: "test.txt",
              },
            },
          ],
        },
      ],
      stream: false,
    },
    fetch,
  });

  expect(requests).toHaveLength(1);
  const messages = requests[0].body.messages;
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toHaveLength(2);
  expect(messages[0].content[0]).toMatchObject({ type: "text" });
  expect(messages[0].content[1]).toMatchObject({
    type: "document",
    source: {
      type: "text",
      media_type: "text/plain",
    },
  });
  expect(typeof messages[0].content[1].source.data).toBe("string");
  expect(messages[0].content[1].source.data).toContain("Hello");
});

it("should convert markdown file to Anthropic PlainTextSource document", async () => {
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What's in this markdown file?",
            },
            {
              type: "file",
              file: {
                file_data: MD_DATA_URL,
                filename: "test.md",
              },
            },
          ],
        },
      ],
      stream: false,
    },
    fetch,
  });

  expect(requests).toHaveLength(1);
  const messages = requests[0].body.messages;
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toHaveLength(2);
  expect(messages[0].content[0]).toMatchObject({ type: "text" });
  expect(messages[0].content[1]).toMatchObject({
    type: "document",
    source: {
      type: "text",
      media_type: "text/plain",
    },
  });
  expect(typeof messages[0].content[1].source.data).toBe("string");
});

it("should convert CSV file to Anthropic PlainTextSource document", async () => {
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "List all the muppets in this CSV file",
            },
            {
              type: "file",
              file: {
                file_data: CSV_DATA_URL,
                filename: "muppets.csv",
              },
            },
          ],
        },
      ],
      stream: false,
    },
    fetch,
  });

  expect(requests).toHaveLength(1);
  const messages = requests[0].body.messages;
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toHaveLength(2);
  expect(messages[0].content[0]).toMatchObject({ type: "text" });
  expect(messages[0].content[1]).toMatchObject({
    type: "document",
    source: {
      type: "text",
      media_type: "text/plain",
    },
  });
  expect(typeof messages[0].content[1].source.data).toBe("string");
  expect(messages[0].content[1].source.data).toContain("Kermit");
  expect(messages[0].content[1].source.data).toContain("Miss Piggy");
});

it("should handle file content parts with plain text data", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What's in this text file?",
            },
            {
              type: "file",
              file: {
                file_data: TEXT_DATA_URL,
                filename: "test.txt",
              },
            },
          ],
        },
      ],
      stream: false,
    },
  });

  const response = json();
  expect(response).toBeTruthy();
  expect(response!.choices[0].message.role).toBe("assistant");
  expect(response!.choices[0].message.content).toBeTruthy();
  expect(typeof response!.choices[0].message.content).toBe("string");
});

it("should handle file content parts with markdown data", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "claude-3-7-sonnet-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What's in this markdown file?",
            },
            {
              type: "file",
              file: {
                file_data: MD_DATA_URL,
                filename: "test.md",
              },
            },
          ],
        },
      ],
      stream: false,
    },
  });

  const response = json();
  expect(response).toBeTruthy();
  expect(response!.choices[0].message.role).toBe("assistant");
  expect(response!.choices[0].message.content).toBeTruthy();
  expect(typeof response!.choices[0].message.content).toBe("string");
});

describe("unsupported media types", () => {
  it("should return error for audio file content", async () => {
    const { statusCode, json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletion
    >({
      body: {
        model: "claude-3-7-sonnet-latest",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What's in this audio file?",
              },
              {
                type: "file",
                file: {
                  file_data: AUDIO_DATA_URL,
                  filename: "test.wav",
                },
              },
            ],
          },
        ],
        stream: false,
      },
    });

    expect(statusCode).toBe(400);
    const response = json();
    expect(response).toMatchObject({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: expect.stringMatching(
          /media_type.*should be 'application\/pdf'/,
        ),
      },
    });
  });

  it("should return error for video file content", async () => {
    const { statusCode, json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletion
    >({
      body: {
        model: "claude-3-7-sonnet-latest",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What's in this video file?",
              },
              {
                type: "file",
                file: {
                  file_data: VIDEO_DATA_URL,
                  filename: "test.mp4",
                },
              },
            ],
          },
        ],
        stream: false,
      },
    });

    expect(statusCode).toBe(400);
    const response = json();
    expect(response).toMatchObject({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: expect.stringMatching(
          /media_type.*should be 'application\/pdf'/,
        ),
      },
    });
  });
});

it("should translate json_object response format to tool-based structured output", async () => {
  // This test verifies BRA-3896: json_object response format should be translated
  // to a tool-based workaround for Anthropic, similar to how json_schema is handled.
  const { fetch, requests } = createCapturingFetch({ captureOnly: true });

  await callProxyV1<OpenAIChatCompletionCreateParams, OpenAIChatCompletion>({
    body: {
      model: "claude-3-haiku-20240307",
      messages: [{ role: "user", content: "Return JSON" }],
      response_format: { type: "json_object" },
      stream: false,
      max_tokens: 150,
    },
    fetch,
  });

  expect(requests).toHaveLength(1);
  // Verify the proxy created a tool with generic object schema
  expect(requests[0].body).toMatchObject({
    tools: [
      {
        name: "json",
        description: "Output the result in JSON format",
        input_schema: { type: "object" },
      },
    ],
    tool_choice: { type: "tool", name: "json" },
  });
});
