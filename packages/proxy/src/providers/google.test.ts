import { describe, it, expect, vi } from "vitest";
import { callProxyV1 } from "../../utils/tests";
import {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";
import { GenerateContentParameters } from "../../types/google";
import {
  geminiParamsToOpenAIParams,
  geminiParamsToOpenAIMessages,
  geminiParamsToOpenAITools,
  normalizeOpenAISchema,
  fromOpenAPIToJSONSchema,
  googleCompletionToOpenAICompletion,
  googleEventToOpenAIChatEvent,
} from "./google";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { IMAGE_DATA_URL, PDF_DATA_URL } from "./fixtures";

// Integration tests that actually call the Google API
for (const model of [
  "gemini-2.5-flash",
  // TODO: re-enable when we have a working CI/CD solution
  // "publishers/google/models/gemini-2.5-flash",
]) {
  describe(model, () => {
    it("should accept and should not return reasoning/thinking params and detail streaming", async () => {
      const { events } = await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model,
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
                  id: "",
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

      const hasContent = streamedEvents.some(
        (event) => event.data.choices[0]?.delta?.content !== undefined,
      );
      expect(hasContent).toBe(true);

      const hasReasoning = streamedEvents.some(
        (event) =>
          event.data.choices[0]?.delta?.reasoning?.content !== undefined,
      );
      expect(hasReasoning).toBe(true);
    });

    it("should accept and return reasoning/thinking params and detail non-streaming", async () => {
      const { json } = await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model,
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
                  id: "",
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
                  id: expect.any(String),
                  content: expect.any(String),
                },
              ],
              refusal: null,
              role: "assistant",
            },
          },
        ],
        created: expect.any(Number),
        id: expect.any(String),
        model,
        object: "chat.completion",
        usage: {
          completion_tokens: expect.any(Number),
          completion_tokens_details: {
            reasoning_tokens: expect.any(Number),
          },
          prompt_tokens: expect.any(Number),
          total_tokens: expect.any(Number),
        },
      });
    });

    it("should disable reasoning/thinking non-streaming", async () => {
      const { json } = await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model,
          reasoning_enabled: true,
          reasoning_budget: 0,
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
                  id: "",
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
        model,
        object: "chat.completion",
        usage: {
          completion_tokens: expect.any(Number),
          prompt_tokens: expect.any(Number),
          total_tokens: expect.any(Number),
        },
      });
    });

    it("should work with zod-json-schemafied parameters (convert to valid gemini (openapi 3) objects)", async () => {
      // Test union types that include null with more than 2 options
      const unionSchema = z.object({
        status: z
          .union([z.literal("active"), z.literal("inactive"), z.null()])
          .optional(),
        count: z.union([z.number(), z.null()]),
        data: z
          .union([
            z.object({
              type: z.literal("text"),
              content: z.string(),
            }),
            z.object({
              type: z.literal("number"),
              value: z.number(),
            }),
            z.null(),
          ])
          .optional(),
      });

      // we do this in sdk/js/src/functions/upload.ts
      const jsonSchema = zodToJsonSchema(unionSchema);

      const body: OpenAIChatCompletionCreateParams = {
        model,
        messages: [
          {
            role: "user",
            content: "Use the union tool. Let's try 10.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "unionTool",
              description: "A tool with union types including null",
              parameters: jsonSchema as any,
            },
          },
        ],
        stream: false,
      };

      const result = await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body,
      });

      expect(result.json()).toMatchObject({
        id: expect.any(String),
        choices: [
          {
            logprobs: null,
            index: 0,
            message: {
              role: "assistant",
              content: "",
              refusal: null,
              tool_calls: [
                {
                  function: {
                    arguments: expect.any(String),
                    name: "unionTool",
                  },
                  id: expect.any(String),
                  type: "function",
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        created: expect.any(Number),
        model: "gemini-2.5-flash",
        object: "chat.completion",
        usage: {
          prompt_tokens: expect.any(Number),
          completion_tokens: expect.any(Number),
          total_tokens: expect.any(Number),
          completion_tokens_details: { reasoning_tokens: expect.any(Number) },
        },
      });
    });

    it("should work with openapi 3 parameters", async () => {
      const body: OpenAIChatCompletionCreateParams = {
        model,
        messages: [
          {
            role: "user",
            content: "Use the union tool. Let's try 10.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "unionTool",
              description: "A tool with union types including null",
              parameters: {
                type: "object",
                properties: {
                  status: {
                    anyOf: [
                      { type: "string", nullable: true, enum: ["active"] },
                      { type: "string", nullable: true, enum: ["inactive"] },
                    ],
                  },
                  count: { type: "number", nullable: true },
                  data: {
                    anyOf: [
                      {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["text"] },
                          content: { type: "string" },
                        },
                        required: ["type", "content"],
                        nullable: true,
                      },
                      {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["number"] },
                          value: { type: "number" },
                        },
                        required: ["type", "value"],
                        nullable: true,
                      },
                    ],
                  },
                },
                required: ["count"],
              },
            },
          },
        ],
        stream: false,
      };

      const result = await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body,
      });

      expect(result.json()).toMatchObject({
        id: expect.any(String),
        choices: [
          {
            logprobs: null,
            index: 0,
            message: {
              role: "assistant",
              content: "",
              refusal: null,
              tool_calls: [
                {
                  function: {
                    arguments: expect.any(String),
                    name: "unionTool",
                  },
                  id: expect.any(String),
                  type: "function",
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        created: expect.any(Number),
        model: "gemini-2.5-flash",
        object: "chat.completion",
        usage: {
          prompt_tokens: expect.any(Number),
          completion_tokens: expect.any(Number),
          total_tokens: expect.any(Number),
          completion_tokens_details: { reasoning_tokens: expect.any(Number) },
        },
      });
    });

    it("should work with schemas containing $ref and $defs references", async () => {
      // Schema with $ref and $defs that need to be resolved
      const schemaWithRefs = {
        type: "object",
        properties: {
          name: { type: "string" },
          addresses: {
            type: "array",
            items: { $ref: "#/$defs/address" },
          },
        },
        required: ["name", "addresses"],
        $defs: {
          address: {
            type: "object",
            properties: {
              street: { type: "string" },
              city: { type: "string" },
              zipCode: { type: "string" },
            },
            required: ["street", "city"],
          },
        },
      };

      const body: OpenAIChatCompletionCreateParams = {
        model,
        messages: [
          {
            role: "user",
            content:
              "Generate a person with name John Doe and two addresses: one in New York and one in Los Angeles.",
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "person_with_addresses",
            schema: schemaWithRefs,
            strict: true,
          },
        },
        stream: false,
      };

      const result = await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body,
      });

      const response = result.json();
      expect(response).toMatchObject({
        id: expect.any(String),
        choices: expect.arrayContaining([
          expect.objectContaining({
            message: expect.objectContaining({
              role: "assistant",
              content: expect.any(String),
            }),
          }),
        ]),
        model: expect.stringContaining("gemini"),
      });

      // Parse and validate the response content
      const choice = response.choices[0];
      const messageContent =
        choice &&
        "message" in choice &&
        typeof choice.message === "object" &&
        choice.message !== null &&
        "content" in choice.message
          ? (choice.message as { content?: unknown }).content
          : undefined;
      if (messageContent && typeof messageContent === "string") {
        const parsed = JSON.parse(messageContent);
        expect(parsed).toHaveProperty("name");
        expect(parsed).toHaveProperty("addresses");
        expect(Array.isArray(parsed.addresses)).toBe(true);
        if (parsed.addresses.length > 0) {
          expect(parsed.addresses[0]).toHaveProperty("street");
          expect(parsed.addresses[0]).toHaveProperty("city");
        }
      }
    });
  });
}

// Unit tests for helper functions
describe("geminiParamsToOpenAIParams", () => {
  it("should convert basic Gemini params to OpenAI format", async () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Hello, world!",
      config: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1024,
        stopSequences: ["STOP"],
        candidateCount: 2,
        seed: 42,
      },
    };

    const openaiParams = geminiParamsToOpenAIParams(geminiParams);

    expect(openaiParams).toEqual({
      model: "gemini-2.0-flash",
      messages: expect.any(Array),
      n: 2,
      top_p: 0.9,
      max_completion_tokens: 1024,
      stop: ["STOP"],
      temperature: 0.7,
      seed: 42,
      reasoning_enabled: false,
      reasoning_budget: 0,
    });
  });

  it("should handle thinking config", async () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Think about this",
      config: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 500,
        },
      },
    };

    const openaiParams = geminiParamsToOpenAIParams(geminiParams);

    expect(openaiParams.reasoning_enabled).toBe(true);
    expect(openaiParams.reasoning_budget).toBe(500);
  });

  it("should convert response format correctly", async () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Generate JSON",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name", "age"],
        },
      },
    };

    const openaiParams = geminiParamsToOpenAIParams(geminiParams);

    expect(openaiParams.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name", "age"],
        },
        strict: true,
      },
    });
  });

  it("should convert tool config to tool_choice", async () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Use a tool",
      config: {
        tools: [
          {
            functionDeclarations: [
              {
                name: "get_weather",
                description: "Get weather info",
                parameters: {
                  type: "object",
                  properties: {
                    location: { type: "string" },
                  },
                },
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: "AUTO",
          },
        },
      },
    };

    const openaiParams = geminiParamsToOpenAIParams(geminiParams);

    expect(openaiParams.tool_choice).toBe("auto");
    expect(openaiParams.tools).toHaveLength(1);
    expect(openaiParams.tools?.[0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather info",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
            },
          },
        },
      },
    });
  });
});

describe("geminiParamsToOpenAIMessages", () => {
  it("should convert simple text content to user message", () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Hello, how are you?",
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "user",
        content: "Hello, how are you?",
      },
    ]);
  });

  it("should include system instruction as system message", () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Hello",
      config: {
        systemInstruction: "You are a helpful assistant.",
      },
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "system",
        content: "You are a helpful assistant.",
      },
      {
        role: "user",
        content: "Hello",
      },
    ]);
  });

  it("should handle Content array with multiple turns", () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: "What's the weather?" }],
        },
        {
          role: "model",
          parts: [{ text: "I'll check the weather for you." }],
        },
        {
          role: "user",
          parts: [{ text: "Thanks!" }],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "user",
        content: "What's the weather?",
      },
      {
        role: "assistant",
        content: "I'll check the weather for you.",
      },
      {
        role: "user",
        content: "Thanks!",
      },
    ]);
  });

  it("should handle function calls in assistant messages", () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "model",
          parts: [
            { text: "Let me check the weather." },
            {
              functionCall: {
                name: "get_weather",
                args: { location: "New York" },
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "assistant",
        content: "Let me check the weather.",
        tool_calls: [
          {
            id: expect.any(String),
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"location":"New York"}',
            },
          },
        ],
      },
    ]);
  });

  it("should handle function responses as tool messages", () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "call_123",
                name: "get_weather",
                response: { temperature: 72, condition: "sunny" },
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "tool",
        tool_call_id: "call_123",
        content: '{"temperature":72,"condition":"sunny"}',
      },
    ]);
  });

  it("should maintain consistent IDs between function calls and responses", () => {
    const params: any = {
      contents: [
        {
          role: "user",
          parts: [{ text: "What is 127 multiplied by 49?" }],
        },
        {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "calculate",
                args: { a: 127, b: 49, operation: "multiply" },
                // Note: no id field
              },
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "calculate",
                response: { result: 6223 },
                // Note: no id field
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(params);

    // Should have 3 messages: user, assistant with tool_call, tool response
    expect(messages).toHaveLength(3);

    // First message should be user
    expect(messages[0]).toEqual({
      role: "user",
      content: "What is 127 multiplied by 49?",
    });

    // Second message should be assistant with tool_call
    expect(messages[1]).toHaveProperty("role", "assistant");
    expect(messages[1]).toHaveProperty("tool_calls");
    const assistantMessage = messages[1] as any;
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls[0]).toHaveProperty("type", "function");
    expect(assistantMessage.tool_calls[0].function).toEqual({
      name: "calculate",
      arguments: JSON.stringify({ a: 127, b: 49, operation: "multiply" }),
    });

    // Third message should be tool response
    expect(messages[2]).toHaveProperty("role", "tool");
    expect(messages[2]).toHaveProperty(
      "content",
      JSON.stringify({ result: 6223 }),
    );

    // CRITICAL: The tool_call_id should match between the assistant's tool_call and the tool response
    const toolCallId = assistantMessage.tool_calls[0].id;
    expect(toolCallId).toBeDefined();
    const toolMessage = messages[2] as any;
    expect(toolMessage.tool_call_id).toBe(toolCallId);
  });
  it("should handle exact genai.json span structure with snake_case keys", () => {
    // This test case matches the exact structure from the genai.json span
    const params: any = {
      contents: [
        {
          parts: [
            {
              text: "What is 127 multiplied by 49?",
            },
          ],
          role: "user",
        },
        {
          parts: [
            {
              functionCall: {
                args: {
                  a: 127,
                  b: 49,
                  operation: "multiply",
                },
                name: "calculate",
              },
            },
          ],
          role: "model",
        },
        {
          parts: [
            {
              functionResponse: {
                name: "calculate",
                response: {
                  result: 6223,
                },
              },
            },
          ],
          role: "user",
        },
      ],
      model: "gemini-2.0-flash-001",
    };

    const messages = geminiParamsToOpenAIMessages(params);

    // Should have 3 messages: user, assistant with tool_call, tool response
    expect(messages).toHaveLength(3);

    // First message should be user
    expect(messages[0]).toEqual({
      role: "user",
      content: "What is 127 multiplied by 49?",
    });

    // Second message should be assistant with tool_call
    expect(messages[1]).toHaveProperty("role", "assistant");
    expect(messages[1]).toHaveProperty("tool_calls");
    const assistantMessage = messages[1] as any;
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls[0]).toHaveProperty("type", "function");
    expect(assistantMessage.tool_calls[0].function).toEqual({
      name: "calculate",
      arguments: JSON.stringify({ a: 127, b: 49, operation: "multiply" }),
    });

    // Third message should be tool response
    expect(messages[2]).toHaveProperty("role", "tool");
    expect(messages[2]).toHaveProperty(
      "content",
      JSON.stringify({ result: 6223 }),
    );

    // The tool_call_id should match between the assistant's tool_call and the tool response
    const toolCallId = assistantMessage.tool_calls[0].id;
    expect(toolCallId).toBeDefined();
    expect(toolCallId).toBe("calculate"); // When no ID is provided, we use the function name
    const toolMessage = messages[2] as any;
    expect(toolMessage.tool_call_id).toBe(toolCallId);
  });

  it("should preserve inline_data with Attachment objects", () => {
    // Simulate what the Python SDK creates: inline_data with an Attachment object
    const attachmentObj = {
      type: "braintrust_attachment",
      filename: "image.png",
      content_type: "image/png",
      key: "test-key-456",
    };

    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash-001",
      contents: [
        {
          text: "Analyze this image:",
        },
        {
          inline_data: {
            data: attachmentObj, // This is an object, not a base64 string
            mime_type: "image/png",
          },
        },
        {
          text: "What do you see?",
        },
      ] as any,
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this image:",
          },
          {
            type: "image_url",
            image_url: {
              url: attachmentObj,
            },
          },
          {
            type: "text",
            text: "What do you see?",
          },
        ],
      },
    ]);
  });

  it("should fix camelCase attachment references in inline_data to snake_case", () => {
    // Test that camelCase attachment references (e.g., from toCamelCaseKeys)
    // are converted back to snake_case
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash-001",
      contents: [
        {
          text: "Look at these files:",
        },
        {
          inline_data: {
            data: {
              type: "braintrust_attachment",
              filename: "image.png",
              contentType: "image/png", // camelCase from toCamelCaseKeys
              key: "abc-123",
            },
            mime_type: "image/png",
          },
        },
        {
          inline_data: {
            data: {
              type: "external_attachment",
              filename: "doc.pdf",
              contentType: "application/pdf", // camelCase
              key: "def-456",
              url: "https://example.com/doc.pdf",
            },
            mime_type: "application/pdf",
          },
        },
      ] as any,
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Look at these files:",
          },
          {
            type: "image_url",
            image_url: {
              url: {
                type: "braintrust_attachment",
                filename: "image.png",
                content_type: "image/png", // Fixed to snake_case
                key: "abc-123",
              },
            },
          },
          {
            type: "image_url",
            image_url: {
              url: {
                type: "external_attachment",
                filename: "doc.pdf",
                content_type: "application/pdf", // Fixed to snake_case
                key: "def-456",
                url: "https://example.com/doc.pdf",
              },
            },
          },
        ],
      },
    ]);
  });

  it("should handle image_url format with attachments and data URLs", () => {
    // Test that image_url format (from wrapper/OpenAI format) is properly converted
    // This tests the new code path that handles image_url/imageUrl in parts
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash-001",
      contents: [
        {
          parts: [
            {
              text: "What color is this image?",
            },
            {
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
              },
            } as any,
          ],
        },
        {
          parts: [
            {
              text: "Analyze this image:",
            },
            {
              image_url: {
                url: {
                  type: "braintrust_attachment",
                  filename: "test-image.png",
                  contentType: "image/png", // camelCase
                  key: "test-key-123",
                },
              },
            } as any,
          ],
        },
        {
          parts: [
            {
              imageUrl: {
                url: {
                  type: "external_attachment",
                  filename: "remote.jpg",
                  contentType: "image/jpeg", // camelCase
                  key: "remote-456",
                  url: "https://example.com/image.jpg",
                },
              },
            } as any,
          ],
        },
      ] as any,
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What color is this image?",
          },
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this image:",
          },
          {
            type: "image_url",
            image_url: {
              url: {
                type: "braintrust_attachment",
                filename: "test-image.png",
                content_type: "image/png", // Fixed to snake_case
                key: "test-key-123",
              },
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: {
                type: "external_attachment",
                filename: "remote.jpg",
                content_type: "image/jpeg", // Fixed to snake_case
                key: "remote-456",
                url: "https://example.com/image.jpg",
              },
            },
          },
        ],
      },
    ]);
  });

  it("should handle snake_case function_call in assistant messages", () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: "What is the weather like in Paris, France?" }],
        },
        {
          role: "model",
          parts: [
            {
              function_call: {
                name: "get_weather",
                args: {
                  city_and_state: "Paris, France",
                  temperature_unit: "celsius",
                },
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "user",
      content: "What is the weather like in Paris, France?",
    });

    expect(messages[1]).toHaveProperty("role", "assistant");
    expect(messages[1]).toHaveProperty("tool_calls");
    const assistantMessage = messages[1] as any;
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls[0]).toHaveProperty("type", "function");
    expect(assistantMessage.tool_calls[0].function).toEqual({
      name: "get_weather",
      arguments: JSON.stringify({
        city_and_state: "Paris, France",
        temperature_unit: "celsius",
      }),
    });
  });

  it("should handle snake_case function_response as tool messages", () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              function_response: {
                id: "call_123",
                name: "get_weather",
                response: {
                  temperature_celsius: 22,
                  weather_condition: "sunny",
                  humidity_percent: 65,
                },
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: JSON.stringify({
        temperature_celsius: 22,
        weather_condition: "sunny",
        humidity_percent: 65,
      }),
    });
  });

  it("should handle mixed camelCase and snake_case in same request", () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: "Calculate something" }],
        },
        {
          role: "model",
          parts: [
            {
              function_call: {
                name: "calculate",
                args: {
                  operation_type: "multiply",
                  first_value: 5,
                  second_value: 10,
                },
              },
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "calculate",
                response: { calculation_result: 50 },
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toHaveLength(3);

    // Check function_call (snake_case) was converted
    const assistantMessage = messages[1] as any;
    expect(assistantMessage.tool_calls[0].function).toEqual({
      name: "calculate",
      arguments: JSON.stringify({
        operation_type: "multiply",
        first_value: 5,
        second_value: 10,
      }),
    });

    // Check functionResponse (camelCase) was converted
    expect(messages[2]).toHaveProperty("role", "tool");
    expect(messages[2]).toHaveProperty(
      "content",
      JSON.stringify({ calculation_result: 50 }),
    );
  });

  it("should handle snake_case file_data from Python SDK", () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              file_data: {
                mime_type: "image/png",
                file_uri: "gs://bucket/image.png",
              },
            },
            { text: "What's in this image?" },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveProperty("role", "user");
    const content = messages[0].content as any[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: {
        url: "gs://bucket/image.png",
      },
    });
    expect(content[1]).toEqual({
      type: "text",
      text: "What's in this image?",
    });
  });

  it("should handle snake_case executable_code from Python SDK", () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "model",
          parts: [
            {
              executable_code: {
                language: "python",
                code: "print('Hello, world!')",
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveProperty("role", "assistant");
    expect(messages[0].content).toBe("```python\nprint('Hello, world!')\n```");
  });

  it("should handle snake_case code_execution_result from Python SDK", () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "model",
          parts: [
            {
              code_execution_result: {
                outcome: "SUCCESS",
                output: "Hello, world!",
              },
            },
          ],
        },
      ],
    };

    const messages = geminiParamsToOpenAIMessages(geminiParams);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveProperty("role", "assistant");
    expect(messages[0].content).toBe(
      "Execution Result (SUCCESS):\nHello, world!",
    );
  });
});

describe("googleCompletionToOpenAICompletion", () => {
  it("should handle snake_case function_call in output", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiResponse: any = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                function_call: {
                  name: "get_weather",
                  args: {
                    city_and_state: "Paris, France",
                    include_forecast: true,
                    forecast_days: 7,
                  },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const result = googleCompletionToOpenAICompletion(
      "gemini-2.0-flash",
      geminiResponse,
    );

    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message).toHaveProperty("role", "assistant");
    expect(result.choices[0].message).toHaveProperty("tool_calls");
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0].function).toEqual({
      name: "get_weather",
      arguments: JSON.stringify({
        city_and_state: "Paris, France",
        include_forecast: true,
        forecast_days: 7,
      }),
    });
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("should handle mixed camelCase and snake_case function_call", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiResponse: any = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "calculate",
                  args: {
                    operation_type: "add",
                    use_decimals: false,
                  },
                },
              },
              {
                function_call: {
                  name: "get_data",
                  args: {
                    data_id: "123",
                    include_metadata: true,
                    max_depth: 3,
                  },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = googleCompletionToOpenAICompletion(
      "gemini-2.0-flash",
      geminiResponse,
    );

    expect(result.choices[0].message.tool_calls).toHaveLength(2);
    expect(result.choices[0].message.tool_calls![0].function.name).toBe(
      "calculate",
    );
    expect(result.choices[0].message.tool_calls![1].function.name).toBe(
      "get_data",
    );
    expect(
      JSON.parse(result.choices[0].message.tool_calls![1].function.arguments),
    ).toEqual({
      data_id: "123",
      include_metadata: true,
      max_depth: 3,
    });
  });
});

describe("googleEventToOpenAIChatEvent", () => {
  it("should handle snake_case function_call in streaming output", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiEvent: any = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                function_call: {
                  name: "search_database",
                  args: {
                    query_string: "test",
                    max_results: 10,
                    sort_order: "desc",
                    include_archived: false,
                  },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = googleEventToOpenAIChatEvent(
      "gemini-2.0-flash",
      geminiEvent,
    );

    expect(result.event).not.toBeNull();
    expect(result.event!.choices).toHaveLength(1);
    expect(result.event!.choices[0].delta).toHaveProperty("tool_calls");
    expect(result.event!.choices[0].delta.tool_calls).toHaveLength(1);
    expect(result.event!.choices[0].delta.tool_calls![0].function).toEqual({
      name: "search_database",
      arguments: JSON.stringify({
        query_string: "test",
        max_results: 10,
        sort_order: "desc",
        include_archived: false,
      }),
    });
    expect(result.event!.choices[0].finish_reason).toBe("tool_calls");
  });
});

describe("geminiParamsToOpenAITools", () => {
  it("should convert function declarations to tools", async () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Test",
      config: {
        tools: [
          {
            functionDeclarations: [
              {
                name: "search",
                description: "Search the web",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                  },
                  required: ["query"],
                },
              },
              {
                name: "calculate",
                description: "Perform calculations",
                parameters: {
                  type: "object",
                  properties: {
                    expression: { type: "string" },
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const tools = geminiParamsToOpenAITools(geminiParams);

    expect(tools).toHaveLength(2);
    expect(tools?.[0]).toEqual({
      type: "function",
      function: {
        name: "search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
            },
          },
          required: ["query"],
        },
      },
    });
    expect(tools?.[1]).toEqual({
      type: "function",
      function: {
        name: "calculate",
        description: "Perform calculations",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string" },
          },
        },
      },
    });
  });

  it("should return undefined for empty tools", async () => {
    const geminiParams: GenerateContentParameters = {
      model: "gemini-2.0-flash",
      contents: "Test",
    };

    const tools = geminiParamsToOpenAITools(geminiParams);

    expect(tools).toBeUndefined();
  });

  it("should handle snake_case function_declarations from Python SDK", async () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: "Test",
      config: {
        tools: [
          {
            function_declarations: [
              {
                name: "get_weather",
                description: "Get weather information",
                parameters: {
                  type: "object",
                  properties: {
                    location: { type: "string" },
                    unit: { type: "string" },
                  },
                  required: ["location"],
                },
              },
            ],
          },
        ],
      },
    };

    const tools = geminiParamsToOpenAITools(geminiParams);

    expect(tools).toHaveLength(1);
    expect(tools?.[0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather information",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" },
            unit: { type: "string" },
          },
          required: ["location"],
        },
      },
    });
  });

  it("should handle snake_case parameters_json_schema from Python SDK", async () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: "Test",
      config: {
        tools: [
          {
            function_declarations: [
              {
                name: "create_block",
                description: "Create a new block",
                parameters_json_schema: {
                  type: "object",
                  properties: {
                    block_id: { type: "string" },
                    block_type: { type: "string" },
                  },
                  required: ["block_id"],
                },
              },
            ],
          },
        ],
      },
    };

    const tools = geminiParamsToOpenAITools(geminiParams);

    expect(tools).toHaveLength(1);
    expect(tools?.[0]).toEqual({
      type: "function",
      function: {
        name: "create_block",
        description: "Create a new block",
        parameters: {
          type: "object",
          properties: {
            block_id: { type: "string" },
            block_type: { type: "string" },
          },
          required: ["block_id"],
        },
      },
    });
  });

  it("should handle snake_case response_schema from Python SDK", async () => {
    const geminiParams: any = {
      model: "gemini-2.0-flash",
      contents: "Test",
      config: {
        response_schema: {
          type: "object",
          properties: {
            user_name: { type: "string" },
            user_age: { type: "number" },
          },
          required: ["user_name"],
        },
      },
    };

    const tools = geminiParamsToOpenAITools(geminiParams);

    expect(tools).toHaveLength(1);
    expect(tools?.[0]).toEqual({
      type: "function",
      function: {
        name: "structured_output",
        description: "Structured output response",
        parameters: {
          type: "object",
          properties: {
            user_name: { type: "string" },
            user_age: { type: "number" },
          },
          required: ["user_name"],
        },
      },
    });
  });
});

describe("normalizeOpenAISchema", () => {
  it("should normalize openapi schemas to json schema", () => {
    // Test 1: Type conversions (UPPERCASE to lowercase)
    expect(
      normalizeOpenAISchema({
        type: "OBJECT",
        properties: {
          str: { type: "STRING" },
          num: { type: "NUMBER" },
          int: { type: "INTEGER" },
          bool: { type: "BOOLEAN" },
          arr: { type: "ARRAY" },
          nil: { type: "NULL" },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        str: { type: "string" },
        num: { type: "number" },
        int: { type: "integer" },
        bool: { type: "boolean" },
        arr: { type: "array" },
        nil: { type: "null" },
      },
    });

    // Test 2: Null/undefined removal
    expect(
      normalizeOpenAISchema({
        type: "OBJECT",
        nullable: null,
        undefined: undefined,
        properties: {
          field1: {
            type: "STRING",
            nullable: null,
            description: "keeps non-null values",
          },
          field2: {
            null: null,
            undefined: undefined,
            // This becomes an empty object and should be removed
          },
        },
        additionalProperties: null,
      }),
    ).toEqual({
      type: "object",
      properties: {
        field1: {
          type: "string",
          description: "keeps non-null values",
        },
      },
    });

    // Test 3: Complex nested structure with anyOf/oneOf
    expect(
      normalizeOpenAISchema({
        type: "OBJECT",
        properties: {
          polymorphic: {
            anyOf: [
              { type: "STRING", minLength: 1 },
              { type: "NUMBER", minimum: 0 },
              {
                type: "OBJECT",
                properties: {
                  nested: { type: "BOOLEAN" },
                },
              },
            ],
          },
          choice: {
            oneOf: [
              { type: "NULL" },
              {
                type: "ARRAY",
                items: { type: "INTEGER" },
                minItems: 1,
                null: null,
              },
            ],
          },
        },
        required: ["polymorphic"],
      }),
    ).toEqual({
      type: "object",
      properties: {
        polymorphic: {
          anyOf: [
            { type: "string", minLength: 1 },
            { type: "number", minimum: 0 },
            {
              type: "object",
              properties: {
                nested: { type: "boolean" },
              },
            },
          ],
        },
        choice: {
          oneOf: [
            { type: "null" },
            {
              type: "array",
              items: { type: "integer" },
              minItems: 1,
            },
          ],
        },
      },
      required: ["polymorphic"],
    });

    // Test 4: Arrays with mixed content (null, undefined, empty object, valid schemas)
    expect(
      normalizeOpenAISchema([
        null,
        undefined,
        {},
        { type: "STRING" },
        { type: "NUMBER", null: null },
      ]),
    ).toEqual([
      {}, // Empty objects in arrays are preserved
      { type: "string" },
      { type: "number" },
    ]);

    // Test 5: Deeply nested with constraints
    expect(
      normalizeOpenAISchema({
        type: "OBJECT",
        properties: {
          user: {
            type: "OBJECT",
            properties: {
              name: {
                type: "STRING",
                pattern: "^[A-Za-z ]+$",
                minLength: 1,
                maxLength: 100,
              },
              age: {
                type: "INTEGER",
                minimum: 0,
                maximum: 150,
                null: null, // should be removed
              },
              addresses: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    street: { type: "STRING" },
                    city: { type: "STRING", enum: ["NYC", "LA", "Chicago"] },
                    empty: {}, // should be removed as property
                  },
                  required: ["street", "city"],
                },
              },
            },
            required: ["name"],
          },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: {
              type: "string",
              pattern: "^[A-Za-z ]+$",
              minLength: 1,
              maxLength: 100,
            },
            age: {
              type: "integer",
              minimum: 0,
              maximum: 150,
            },
            addresses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  street: { type: "string" },
                  city: { type: "string", enum: ["NYC", "LA", "Chicago"] },
                },
                required: ["street", "city"],
              },
            },
          },
          required: ["name"],
        },
      },
    });

    // Test 6: Edge cases
    expect(normalizeOpenAISchema(null)).toBeUndefined();
    expect(normalizeOpenAISchema(undefined)).toBeUndefined();
    expect(normalizeOpenAISchema({})).toEqual({});
    expect(normalizeOpenAISchema("string value")).toEqual("string value");
    expect(normalizeOpenAISchema(42)).toEqual(42);
    expect(normalizeOpenAISchema(true)).toEqual(true);
  });
});

describe("fromOpenAPIToJSONSchema", () => {
  it("should resolve $ref and $defs in schemas", async () => {
    // Schema with $ref and $defs that need to be resolved
    const schemaWithRefs = {
      type: "object",
      properties: {
        name: { type: "string" },
        addresses: {
          type: "array",
          items: { $ref: "#/$defs/address" },
        },
      },
      required: ["name", "addresses"],
      $defs: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            zipCode: { type: "string" },
          },
          required: ["street", "city"],
        },
      },
    };

    // Call the function to resolve refs
    const resolvedSchema = await fromOpenAPIToJSONSchema(schemaWithRefs);

    // Verify $ref was resolved
    expect(resolvedSchema.properties.addresses.items.$ref).toBeUndefined();

    // Verify the address schema was properly inlined
    expect(resolvedSchema.properties.addresses.items).toEqual({
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        zipCode: { type: "string" },
      },
      required: ["street", "city"],
    });

    // Verify $defs was removed
    expect(resolvedSchema.$defs).toBeUndefined();
    expect(resolvedSchema["x-$defs"]).toBeUndefined();
  });

  it("should handle schemas without refs", async () => {
    const simpleSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    };

    const result = await fromOpenAPIToJSONSchema(simpleSchema);

    // Schema should remain largely unchanged (except for any normalization)
    expect(result.type).toBe("object");
    expect(result.properties.name).toEqual({ type: "string" });
    expect(result.properties.age).toEqual({ type: "number" });
    expect(result.required).toEqual(["name"]);
  });
});

describe("file content part handling", () => {
  it("should handle file content parts with PDF data", async () => {
    const { json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "gemini-2.5-flash",
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
    expect(response.error).not.toBeDefined();
    expect(response.choices).toBeDefined();
    expect(Array.isArray(response.choices)).toBe(true);
    expect(response.choices.length).toBeGreaterThan(0);
    expect(response.choices[0].message).toBeDefined();
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].message.content).toBeTruthy();
    expect(typeof response.choices[0].message.content).toBe("string");
  });

  it("should handle file content parts with image data", async () => {
    const { json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "gemini-2.5-flash",
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
    expect(response.error).not.toBeDefined();
    expect(response.choices).toBeDefined();
    expect(Array.isArray(response.choices)).toBe(true);
    expect(response.choices.length).toBeGreaterThan(0);
    expect(response.choices[0].message).toBeDefined();
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].message.content).toBeTruthy();
    expect(typeof response.choices[0].message.content).toBe("string");
  });

  it("should handle mixed content with file and image_url parts", async () => {
    const { json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Compare these two images.",
              },
              {
                type: "image_url",
                image_url: {
                  url: IMAGE_DATA_URL,
                },
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
    expect(response.error).not.toBeDefined();
    expect(response.choices).toBeDefined();
    expect(Array.isArray(response.choices)).toBe(true);
    expect(response.choices.length).toBeGreaterThan(0);
    expect(response.choices[0].message).toBeDefined();
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].message.content).toBeTruthy();
  });
});
