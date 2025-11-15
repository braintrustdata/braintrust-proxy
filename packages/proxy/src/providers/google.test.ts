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

// Integration tests that actually call the Google API
for (const model of [
  "gemini-2.5-flash-preview-05-20",
  // TODO: re-enable when we have a working CI/CD solution
  // "publishers/google/models/gemini-2.5-flash-preview-05-20",
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
        model: "gemini-2.5-flash-preview-05-20",
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
        model: "gemini-2.5-flash-preview-05-20",
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
      const messageContent = response.choices[0]?.message?.content;
      if (messageContent) {
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
    const pdfDataUrl =
      "data:application/pdf;base64,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"; // codespell:ignore

    const { json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "gemini-2.5-flash-preview-05-20",
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
                  file_data: pdfDataUrl,
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
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].message.content).toBeTruthy();
    expect(typeof response.choices[0].message.content).toBe("string");
  });

  const imageDataUrl =
    "data:image/png;base64,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";

  it("should handle file content parts with image data", async () => {
    const { json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "gemini-2.5-flash-preview-05-20",
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
                  file_data: imageDataUrl,
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
    console.log(response.choices);
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
        model: "gemini-2.5-flash-preview-05-20",
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
                  url: imageDataUrl,
                },
              },
              {
                type: "file",
                file: {
                  file_data: imageDataUrl,
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
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].message.content).toBeTruthy();
  });
});
