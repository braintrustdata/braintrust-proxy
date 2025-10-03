import { describe, it, expect } from "vitest";
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
} from "./google";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

for (const model of [
  "gemini-2.5-flash-preview-05-20",
  // TODO: re-enable when we have a working CI/CD solution
  // "publishers/google/models/gemini-2.5-flash-preview-05-20",
]) {
  describe(model, () => {
    it("should accept and should not return reasoning/thinking params and detail streaming", async () => {
      const { events, json } = await callProxyV1<
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
  });

  describe("geminiParamsToOpenAIParams", () => {
    it("should convert basic Gemini params to OpenAI format", () => {
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

    it("should handle thinking config", () => {
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

    it("should convert response format correctly", () => {
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

    it("should convert tool config to tool_choice", () => {
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
      expect(openaiParams.tools[0]).toEqual({
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather info",
          parameters: {
            $schema: "http://json-schema.org/draft-04/schema#",
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
  });

  describe("geminiParamsToOpenAITools", () => {
    it("should convert function declarations to tools", () => {
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
      expect(tools[0]).toEqual({
        type: "function",
        function: {
          name: "search",
          description: "Search the web",
          parameters: {
            $schema: "http://json-schema.org/draft-04/schema#",
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
      expect(tools[1]).toEqual({
        type: "function",
        function: {
          name: "calculate",
          description: "Perform calculations",
          parameters: {
            $schema: "http://json-schema.org/draft-04/schema#",
            type: "object",
            properties: {
              expression: { type: "string" },
            },
          },
        },
      });
    });

    it("should return undefined for empty tools", () => {
      const geminiParams: GenerateContentParameters = {
        model: "gemini-2.0-flash",
        contents: "Test",
      };

      const tools = geminiParamsToOpenAITools(geminiParams);

      expect(tools).toBeUndefined();
    });
  });

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
}
