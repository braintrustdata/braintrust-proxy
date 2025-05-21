import { describe, it, expect } from "vitest";
import { callProxyV1 } from "../../utils/tests";
import {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";

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
}
