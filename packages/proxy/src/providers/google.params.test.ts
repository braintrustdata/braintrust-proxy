import { describe, it, expect } from "vitest";
import { callProxyV1, createCapturingFetch } from "../../utils/tests";
import {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "../../types";

describe("Google parameter translation (captureOnly)", () => {
  describe("basic generation config params", () => {
    it("should translate temperature", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          temperature: 0.7,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate top_p to topP", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          top_p: 0.9,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          topP: 0.9,
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate max_tokens to maxOutputTokens", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          max_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 500,
        },
      });
    });

    it("should preserve maxOutputTokens when passed directly (Google format)", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          maxOutputTokens: 750,
          stream: false,
        } as OpenAIChatCompletionCreateParams,
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 750,
        },
      });
    });

    it("should preserve topP when passed directly (Google format)", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          topP: 0.85,
          stream: false,
        } as OpenAIChatCompletionCreateParams,
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          topP: 0.85,
        },
      });
    });

    it("should preserve topK when passed directly (Google format)", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          topK: 40,
          stream: false,
        } as OpenAIChatCompletionCreateParams,
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          topK: 40,
        },
      });
    });

    it("should handle mixed OpenAI and Google format params together", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          temperature: 0.7,
          top_p: 0.9,
          topK: 40,
          maxOutputTokens: 500,
          stream: false,
        } as OpenAIChatCompletionCreateParams,
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 500,
        },
      });
    });

    it("should translate stop array to stopSequences", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Write a story" }],
          stop: ["END", "\n\n"],
          max_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Write a story" }] }],
        generationConfig: {
          stopSequences: ["END", "\n\n"],
          maxOutputTokens: 500,
        },
      });
    });

    it("should translate single stop string to stopSequences array", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Write a story" }],
          stop: "DONE",
          max_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Write a story" }] }],
        generationConfig: {
          stopSequences: ["DONE"],
          maxOutputTokens: 500,
        },
      });
    });

    it("should translate multiple params together", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          temperature: 0.5,
          top_p: 0.8,
          max_tokens: 200,
          stop: ["STOP"],
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          temperature: 0.5,
          topP: 0.8,
          maxOutputTokens: 200,
          stopSequences: ["STOP"],
        },
      });
    });
  });

  describe("messages translation", () => {
    it("should translate simple user message to contents", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "What is the capital of France?" },
          ],
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [
          {
            role: "user",
            parts: [{ text: "What is the capital of France?" }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate system message to systemInstruction", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "You are a pirate. Always respond in pirate speak.",
            },
            { role: "user", content: "Tell me about the weather." },
          ],
          max_tokens: 150,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        systemInstruction: {
          parts: [
            { text: "You are a pirate. Always respond in pirate speak." },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: "Tell me about the weather." }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 150,
        },
      });
    });

    it("should translate multi-turn conversation", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Hi, my name is Alice." },
            { role: "assistant", content: "Hello Alice! Nice to meet you." },
            { role: "user", content: "What did I just tell you my name was?" },
          ],
          max_tokens: 200,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [
          { role: "user", parts: [{ text: "Hi, my name is Alice." }] },
          {
            role: "model",
            parts: [{ text: "Hello Alice! Nice to meet you." }],
          },
          {
            role: "user",
            parts: [{ text: "What did I just tell you my name was?" }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 200,
        },
      });
    });
  });

  describe("tool calling", () => {
    it("should translate tool_choice 'auto' to tool_config", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "What is the weather?" }],
          tools: [
            {
              type: "function",
              function: {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tool_choice: "auto",
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "What is the weather?" }] }],
        tools: [
          {
            function_declarations: [
              {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        ],
        tool_config: {
          function_calling_config: {
            mode: "AUTO",
          },
        },
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate tool_choice 'required' to tool_config ANY", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "What is the weather?" }],
          tools: [
            {
              type: "function",
              function: {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tool_choice: "required",
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "What is the weather?" }] }],
        tools: [
          {
            function_declarations: [
              {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        ],
        tool_config: {
          function_calling_config: {
            mode: "ANY",
          },
        },
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate tool_choice 'none' to tool_config NONE", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "What is the weather?" }],
          tools: [
            {
              type: "function",
              function: {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tool_choice: "none",
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "What is the weather?" }] }],
        tools: [
          {
            function_declarations: [
              {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        ],
        tool_config: {
          function_calling_config: {
            mode: "NONE",
          },
        },
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate tool_choice with specific function to tool_config with allowed_function_names", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "What is the weather?" }],
          tools: [
            {
              type: "function",
              function: {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
            },
            {
              type: "function",
              function: {
                name: "get_time",
                description: "Get time",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "get_weather" },
          },
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "What is the weather?" }] }],
        tools: [
          {
            function_declarations: [
              {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {} },
              },
              {
                name: "get_time",
                description: "Get time",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        ],
        tool_config: {
          function_calling_config: {
            mode: "ANY",
            allowed_function_names: ["get_weather"],
          },
        },
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate tools to Google format", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: "What is the weather like in Paris, France?",
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "get_weather",
                description: "Get the current weather for a location",
                parameters: {
                  type: "object",
                  properties: {
                    city_and_state: {
                      type: "string",
                      description: "The city and state, e.g. San Francisco, CA",
                    },
                    unit: {
                      type: "string",
                      enum: ["celsius", "fahrenheit"],
                      description: "The unit of temperature",
                    },
                  },
                  required: ["city_and_state"],
                },
              },
            },
          ],
          max_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [
          {
            role: "user",
            parts: [{ text: "What is the weather like in Paris, France?" }],
          },
        ],
        tools: [
          {
            function_declarations: [
              {
                name: "get_weather",
                description: "Get the current weather for a location",
                parameters: {
                  type: "object",
                  properties: {
                    city_and_state: {
                      type: "string",
                      description: "The city and state, e.g. San Francisco, CA",
                    },
                    unit: {
                      type: "string",
                      enum: ["celsius", "fahrenheit"],
                      description: "The unit of temperature",
                    },
                  },
                  required: ["city_and_state"],
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 500,
        },
      });
    });

    it("should translate tool result messages", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "What is 127 multiplied by 49?" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "calculate",
                    arguments: JSON.stringify({
                      operation: "multiply",
                      a: 127,
                      b: 49,
                    }),
                  },
                },
              ],
            },
            {
              role: "tool",
              tool_call_id: "call_123",
              content: "6223",
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
                      enum: ["add", "subtract", "multiply", "divide"],
                    },
                    a: { type: "number" },
                    b: { type: "number" },
                  },
                  required: ["operation", "a", "b"],
                },
              },
            },
          ],
          max_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
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
                  name: "call_123",
                  args: { operation: "multiply", a: 127, b: 49 },
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "call_123",
                  response: {
                    content: "6223",
                    name: "call_123",
                  },
                },
              },
            ],
          },
        ],
        tools: [
          {
            function_declarations: [
              {
                name: "calculate",
                description: "Perform a mathematical calculation",
                parameters: {
                  type: "object",
                  properties: {
                    operation: {
                      type: "string",
                      enum: ["add", "subtract", "multiply", "divide"],
                    },
                    a: { type: "number" },
                    b: { type: "number" },
                  },
                  required: ["operation", "a", "b"],
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 500,
        },
      });
    });
  });

  describe("response format", () => {
    it("should translate json_object response format", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Return a JSON object with name and age" },
          ],
          response_format: { type: "json_object" },
          max_tokens: 200,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [
          {
            role: "user",
            parts: [{ text: "Return a JSON object with name and age" }],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          maxOutputTokens: 200,
        },
      });
    });

    it("should translate json_schema response format", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "You extract structured information from user queries.",
            },
            {
              role: "user",
              content: "Alice is 30 years old and lives in New York.",
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "person_info",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  age: { type: "number" },
                  city: { type: "string" },
                },
                required: ["name", "age", "city"],
                additionalProperties: false,
              },
            },
          },
          max_tokens: 300,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        systemInstruction: {
          parts: [
            { text: "You extract structured information from user queries." },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: "Alice is 30 years old and lives in New York." }],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          response_schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "number" },
              city: { type: "string" },
            },
            required: ["name", "age", "city"],
          },
          maxOutputTokens: 300,
        },
      });
    });
  });

  describe("image input", () => {
    it("should translate image_url with base64 data to inlineData", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });
      const fakeBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      await callProxyV1<
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
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${fakeBase64}`,
                  },
                },
                { type: "text", text: "What color is this image?" },
              ],
            },
          ],
          max_tokens: 150,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: fakeBase64,
                },
              },
              { text: "What color is this image?" },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 150,
        },
      });
    });
  });

  describe("unsupported params should be filtered", () => {
    it("should not pass frequency_penalty to Google", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          frequency_penalty: 0.5,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should not pass presence_penalty to Google", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          presence_penalty: 0.5,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });
  });

  describe("streaming mode", () => {
    it("should set alt=sse query param for streaming requests", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Count from 1 to 10" }],
          max_tokens: 200,
          stream: true,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("streamGenerateContent");
      expect(requests[0].url).toContain("alt=sse");
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Count from 1 to 10" }] }],
        generationConfig: {
          maxOutputTokens: 200,
        },
      });
    });

    it("should use generateContent endpoint for non-streaming", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("generateContent");
      expect(requests[0].url).not.toContain("streamGenerateContent");
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate params correctly for streaming with temperature", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Tell me a story" }],
          temperature: 0.8,
          top_p: 0.95,
          max_tokens: 500,
          stream: true,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("streamGenerateContent");
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Tell me a story" }] }],
        generationConfig: {
          temperature: 0.8,
          topP: 0.95,
          maxOutputTokens: 500,
        },
      });
    });

    it("should translate system message correctly for streaming", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello" },
          ],
          max_tokens: 100,
          stream: true,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("streamGenerateContent");
      expect(requests[0].body).toEqual({
        systemInstruction: {
          parts: [{ text: "You are a helpful assistant." }],
        },
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate tools correctly for streaming", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "What time is it?" }],
          tools: [
            {
              type: "function",
              function: {
                name: "get_time",
                description: "Get the current time",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tool_choice: "auto",
          max_tokens: 100,
          stream: true,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("streamGenerateContent");
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "What time is it?" }] }],
        tools: [
          {
            function_declarations: [
              {
                name: "get_time",
                description: "Get the current time",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        ],
        tool_config: {
          function_calling_config: {
            mode: "AUTO",
          },
        },
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should translate reasoning params correctly for streaming", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Think step by step" }],
          reasoning_budget: 4096,
          max_tokens: 1000,
          stream: true,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("streamGenerateContent");
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Think step by step" }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 4096,
          },
        },
      });
    });
  });

  describe("max_completion_tokens", () => {
    it("should translate max_completion_tokens to maxOutputTokens", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          max_completion_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 500,
        },
      });
    });

    it("should use max of max_completion_tokens and max_tokens", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          max_completion_tokens: 300,
          max_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 500,
        },
      });
    });
  });

  describe("seed parameter", () => {
    it("should not pass seed to Google (used only for caching)", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          seed: 12345,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });
  });

  describe("reasoning/thinking params", () => {
    it("should translate reasoning_effort to thinkingConfig", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Solve this math problem" }],
          reasoning_effort: "medium",
          max_tokens: 1000,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      const body = requests[0].body as Record<string, unknown>;
      const generationConfig = body.generationConfig as Record<string, unknown>;
      const thinkingConfig = generationConfig.thinkingConfig as Record<
        string,
        unknown
      >;
      expect(thinkingConfig.includeThoughts).toBe(true);
      expect(typeof thinkingConfig.thinkingBudget).toBe("number");
    });

    it("should translate reasoning_budget to thinkingConfig", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Think about this" }],
          reasoning_budget: 2048,
          max_tokens: 1000,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Think about this" }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 2048,
          },
        },
      });
    });

    it("should disable thinking when reasoning_enabled is false", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          reasoning_enabled: false,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      });
    });

    it("should disable thinking when reasoning_budget is 0", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          reasoning_budget: 0,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      });
    });
  });

  describe("n parameter (multiple completions)", () => {
    it("should translate n to candidateCount", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          n: 3,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
          candidateCount: 3,
        },
      });
    });
  });

  describe("other unsupported params should be filtered", () => {
    it("should not pass logprobs to Google", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          logprobs: true,
          top_logprobs: 5,
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });

    it("should not pass user to Google", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Say hello" }],
          user: "test-user-123",
          max_tokens: 100,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
        generationConfig: {
          maxOutputTokens: 100,
        },
      });
    });
  });

  describe("file input (documents/PDFs)", () => {
    it("should translate file type with PDF to inlineData", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });
      const fakePdfBase64 =
        "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo+Pg==";

      await callProxyV1<
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
                  type: "file",
                  file: {
                    file_data: `data:application/pdf;base64,${fakePdfBase64}`,
                    filename: "test-document.pdf",
                  },
                },
                { type: "text", text: "What is in this document?" },
              ],
            },
          ],
          max_tokens: 200,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: fakePdfBase64,
                },
              },
              { text: "What is in this document?" },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 200,
        },
      });
    });
  });

  describe("mixed content", () => {
    it("should translate multiple text and image parts in a single message", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });
      const fakeImageBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "First, look at this image:" },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${fakeImageBase64}`,
                  },
                },
                {
                  type: "text",
                  text: "Now describe what you see and explain why it matters.",
                },
              ],
            },
          ],
          max_tokens: 200,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        contents: [
          {
            role: "user",
            parts: [
              { text: "First, look at this image:" },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: fakeImageBase64,
                },
              },
              {
                text: "Now describe what you see and explain why it matters.",
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 200,
        },
      });
    });
  });

  describe("multi-turn reasoning", () => {
    it("should translate multi-turn conversation with reasoning params", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content:
                "What is the pattern in this sequence: 2, 6, 12, 20, 30?",
            },
            {
              role: "assistant",
              content:
                "The pattern is n*(n+1). Each term is the product of consecutive integers.",
            },
            {
              role: "user",
              content: "Using that pattern, what is the 10th term?",
            },
          ],
          reasoning_effort: "high",
          max_tokens: 1000,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      const body = requests[0].body as Record<string, unknown>;
      const generationConfig = body.generationConfig as Record<string, unknown>;
      const thinkingConfig = generationConfig.thinkingConfig as Record<
        string,
        unknown
      >;
      expect(thinkingConfig.includeThoughts).toBe(true);
      expect(typeof thinkingConfig.thinkingBudget).toBe("number");

      expect(body.contents).toEqual([
        {
          role: "user",
          parts: [
            { text: "What is the pattern in this sequence: 2, 6, 12, 20, 30?" },
          ],
        },
        {
          role: "model",
          parts: [
            {
              text: "The pattern is n*(n+1). Each term is the product of consecutive integers.",
            },
          ],
        },
        {
          role: "user",
          parts: [{ text: "Using that pattern, what is the 10th term?" }],
        },
      ]);
    });

    it("should translate reasoning/thought signatures from previous turns", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content:
                "What is the pattern in this sequence: 2, 6, 12, 20, 30?",
            },
            {
              role: "assistant",
              content:
                "The pattern is n*(n+1). Each term is the product of consecutive integers.",
              reasoning: [
                {
                  id: "thought_sig_abc123",
                  content:
                    "Let me analyze the differences: 6-2=4, 12-6=6, 20-12=8, 30-20=10. The differences increase by 2 each time. This suggests a quadratic pattern. If I try n*(n+1): 1*2=2, 2*3=6, 3*4=12, 4*5=20, 5*6=30. Yes, this matches!",
                },
              ],
            },
            {
              role: "user",
              content: "Using that pattern, what is the 10th term?",
            },
          ],
          reasoning_effort: "high",
          max_tokens: 1000,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      const body = requests[0].body as Record<string, unknown>;
      const generationConfig = body.generationConfig as Record<string, unknown>;
      const thinkingConfig = generationConfig.thinkingConfig as Record<
        string,
        unknown
      >;
      expect(thinkingConfig.includeThoughts).toBe(true);
      expect(typeof thinkingConfig.thinkingBudget).toBe("number");

      const contents = body.contents as Array<Record<string, unknown>>;
      expect(contents).toHaveLength(3);

      expect(contents[0]).toEqual({
        role: "user",
        parts: [
          { text: "What is the pattern in this sequence: 2, 6, 12, 20, 30?" },
        ],
      });

      expect(contents[1]).toEqual({
        role: "model",
        parts: [
          {
            text: "Let me analyze the differences: 6-2=4, 12-6=6, 20-12=8, 30-20=10. The differences increase by 2 each time. This suggests a quadratic pattern. If I try n*(n+1): 1*2=2, 2*3=6, 3*4=12, 4*5=20, 5*6=30. Yes, this matches!",
            thought: true,
          },
          {
            text: "The pattern is n*(n+1). Each term is the product of consecutive integers.",
          },
        ],
      });

      expect(contents[2]).toEqual({
        role: "user",
        parts: [{ text: "Using that pattern, what is the 10th term?" }],
      });
    });

    it("should handle multiple reasoning entries in a single message", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: "Solve: What is 15% of 80?",
            },
            {
              role: "assistant",
              content: "15% of 80 is 12.",
              reasoning: [
                {
                  id: "thought_1",
                  content:
                    "First, I need to convert 15% to a decimal: 15/100 = 0.15",
                },
                {
                  id: "thought_2",
                  content: "Now multiply: 0.15 × 80 = 12",
                },
              ],
            },
            {
              role: "user",
              content: "Now what is 20% of that result?",
            },
          ],
          reasoning_budget: 1024,
          max_tokens: 500,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      const body = requests[0].body as Record<string, unknown>;
      const contents = body.contents as Array<Record<string, unknown>>;
      expect(contents).toHaveLength(3);

      expect(contents[1]).toEqual({
        role: "model",
        parts: [
          {
            text: "First, I need to convert 15% to a decimal: 15/100 = 0.15",
            thought: true,
          },
          {
            text: "Now multiply: 0.15 × 80 = 12",
            thought: true,
          },
          {
            text: "15% of 80 is 12.",
          },
        ],
      });
    });

    it("should handle reasoning with tool calls in multi-turn", async () => {
      const { fetch, requests } = createCapturingFetch({ captureOnly: true });

      await callProxyV1<
        OpenAIChatCompletionCreateParams,
        OpenAIChatCompletionChunk
      >({
        body: {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Calculate 127 * 49 for me" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_calc_1",
                  type: "function",
                  function: {
                    name: "calculate",
                    arguments: JSON.stringify({
                      operation: "multiply",
                      a: 127,
                      b: 49,
                    }),
                  },
                },
              ],
            },
            {
              role: "tool",
              tool_call_id: "call_calc_1",
              content: "6223",
            },
            {
              role: "assistant",
              content: "The result of 127 × 49 is 6223.",
            },
            {
              role: "user",
              content: "Now divide that by 7",
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "calculate",
                description: "Perform mathematical calculations",
                parameters: {
                  type: "object",
                  properties: {
                    operation: {
                      type: "string",
                      enum: ["add", "subtract", "multiply", "divide"],
                    },
                    a: { type: "number" },
                    b: { type: "number" },
                  },
                  required: ["operation", "a", "b"],
                },
              },
            },
          ],
          reasoning_budget: 2048,
          max_tokens: 1000,
          stream: false,
        },
        fetch,
      });

      expect(requests).toHaveLength(1);
      const body = requests[0].body as Record<string, unknown>;

      expect(body.generationConfig).toEqual({
        maxOutputTokens: 1000,
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 2048,
        },
      });

      expect(body.contents).toEqual([
        {
          role: "user",
          parts: [{ text: "Calculate 127 * 49 for me" }],
        },
        {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "call_calc_1",
                args: { operation: "multiply", a: 127, b: 49 },
              },
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "call_calc_1",
                response: {
                  content: "6223",
                  name: "call_calc_1",
                },
              },
            },
          ],
        },
        {
          role: "model",
          parts: [{ text: "The result of 127 × 49 is 6223." }],
        },
        {
          role: "user",
          parts: [{ text: "Now divide that by 7" }],
        },
      ]);

      expect(body.tools).toEqual([
        {
          function_declarations: [
            {
              name: "calculate",
              description: "Perform mathematical calculations",
              parameters: {
                type: "object",
                properties: {
                  operation: {
                    type: "string",
                    enum: ["add", "subtract", "multiply", "divide"],
                  },
                  a: { type: "number" },
                  b: { type: "number" },
                },
                required: ["operation", "a", "b"],
              },
            },
          ],
        },
      ]);
    });
  });
});

describe("Vertex location resolution (captureOnly)", () => {
  it("should default Vertex Google calls to us-central1 when location is omitted", async () => {
    const { fetch, requests } = createCapturingFetch({ captureOnly: true });

    await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "publishers/google/models/gemini-1.0-pro",
        messages: [{ role: "user", content: "Say hello" }],
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
    expect(requests[0].url).toContain("/locations/us-central1/");
  });

  it("should honor Vertex metadata location for Google calls", async () => {
    const { fetch, requests } = createCapturingFetch({ captureOnly: true });

    await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "publishers/google/models/gemini-1.0-pro",
        messages: [{ role: "user", content: "Say hello" }],
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
            location: "us-east5",
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
});
