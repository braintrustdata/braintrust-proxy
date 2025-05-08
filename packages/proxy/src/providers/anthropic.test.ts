import { describe, it, expect } from "vitest";
import { callProxyV1 } from "../../utils/tests";
import { ChatCompletion, ChatCompletionChunk } from "openai/resources";

describe("Anthropic Provider", () => {
  it("should convert OpenAI streaming request to Anthropic and back", async () => {
    const { events } = await callProxyV1<ChatCompletionChunk>({
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

  it.only("should convert OpenAI non-streaming request to Anthropic and back", async () => {
    const { json } = await callProxyV1<ChatCompletion>({
      body: {
        model: "claude-2",
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
      },
    });
  });
});
