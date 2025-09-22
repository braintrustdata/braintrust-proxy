import { describe, it, expect } from "vitest";
import { callProxyV1 } from "../../utils/tests";
import {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";
import { GenerateContentParameters } from "@google/genai";
import {
  geminiParamsToOpenAIParams,
  geminiParamsToOpenAIMessages,
  geminiParamsToOpenAITools,
} from "./google";

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
            type: "object",
            properties: {
              location: { type: "string" },
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
            type: "object",
            properties: {
              query: { type: "string" },
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
}
