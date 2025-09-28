import { describe, it, expect } from "vitest";
import { callProxyV1 } from "../../utils/tests";
import {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";
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
}
