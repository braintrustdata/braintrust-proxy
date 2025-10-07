import { describe, it, expect } from "vitest";
import { transformMistralThinkingChunks } from "./mistral";

describe("transformMistralThinkingChunks", () => {
  it("should extract thinking text from Mistral chunks", () => {
    const parser = transformMistralThinkingChunks();

    const mistralChunk = JSON.stringify({
      id: "426a1c8c62704d959621a94c1ff0cffb",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [
                  { type: "text", text: " by 2 is" },
                  { type: "text", text: " equal to" },
                ],
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(mistralChunk);

    expect(result.finished).toBe(false);
    expect(result.data).toBeTruthy();

    const parsedResult = JSON.parse(result.data!);
    expect(parsedResult.choices[0].delta.content).toBe(" by 2 is equal to");
  });

  it("should handle non-thinking content without modification", () => {
    const parser = transformMistralThinkingChunks();

    const normalChunk = JSON.stringify({
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: "Normal text content",
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(normalChunk);
    const parsedResult = JSON.parse(result.data!);
    expect(parsedResult.choices[0].delta.content).toBe("Normal text content");
  });

  it("should handle empty thinking array", () => {
    const parser = transformMistralThinkingChunks();

    const emptyThinkingChunk = JSON.stringify({
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [],
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(emptyThinkingChunk);
    const parsedResult = JSON.parse(result.data!);
    // Empty thinking array returns empty string
    expect(parsedResult.choices[0].delta.content).toBe("");
  });

  it("should handle multiple choices", () => {
    const parser = transformMistralThinkingChunks();

    const multiChoiceChunk = JSON.stringify({
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [{ type: "text", text: "First choice" }],
              },
            ],
          },
          finish_reason: null,
        },
        {
          index: 1,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [{ type: "text", text: "Second choice" }],
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(multiChoiceChunk);
    const parsedResult = JSON.parse(result.data!);
    expect(parsedResult.choices[0].delta.content).toBe("First choice");
    expect(parsedResult.choices[1].delta.content).toBe("Second choice");
  });

  it("should handle mixed content types in array", () => {
    const parser = transformMistralThinkingChunks();

    const mixedContentChunk = JSON.stringify({
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [{ type: "text", text: "Thinking text" }],
              },
              {
                type: "other",
                data: "other data",
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(mixedContentChunk);
    const parsedResult = JSON.parse(result.data!);
    expect(parsedResult.choices[0].delta.content).toBe("Thinking text");
  });

  it("should concatenate thinking and text content", () => {
    const parser = transformMistralThinkingChunks();

    const mixedChunk = JSON.stringify({
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [{ type: "text", text: "Thought: " }],
              },
              {
                type: "text",
                text: "actual response",
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(mixedChunk);
    const parsedResult = JSON.parse(result.data!);
    expect(parsedResult.choices[0].delta.content).toBe(
      "Thought: actual response",
    );
  });

  it("should handle thinking items without text field", () => {
    const parser = transformMistralThinkingChunks();

    const noTextChunk = JSON.stringify({
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [
                  { type: "text" },
                  { type: "other", value: "ignored" },
                ],
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(noTextChunk);
    const parsedResult = JSON.parse(result.data!);
    // When thinking has no text, it returns empty string
    expect(parsedResult.choices[0].delta.content).toBe("");
  });

  it("should preserve non-thinking content unchanged", () => {
    const parser = transformMistralThinkingChunks();

    const nonThinkingChunk = JSON.stringify({
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1759752086,
      model: "magistral-medium-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "text",
                text: "Regular text",
              },
              {
                type: "image",
                url: "http://example.com/image.png",
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    const result = parser(nonThinkingChunk);
    const parsedResult = JSON.parse(result.data!);
    // Non-thinking content arrays remain unchanged
    expect(parsedResult.choices[0].delta.content).toEqual([
      {
        type: "text",
        text: "Regular text",
      },
      {
        type: "image",
        url: "http://example.com/image.png",
      },
    ]);
  });
});
