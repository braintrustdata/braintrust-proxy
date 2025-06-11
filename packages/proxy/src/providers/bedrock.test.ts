import { it, expect } from "vitest";
import { callProxyV1 } from "../../utils/tests";
import {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";

it("should convert single system message OpenAI request to Bedrock and back", async () => {
  if (!process.env.AWS_SECRET_ACCESS_KEY) {
    expect(1).toBe(1);
    return;
  }

  const { events } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "amazon.nova-lite-v1:0",
      messages: [{ role: "system", content: "What is 1+2?" }],
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
