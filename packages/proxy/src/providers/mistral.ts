import { ChatCompletionChunk } from "openai/resources";

export function transformMistralThinkingChunks(): (data: string) => {
  data: string | null;
  finished: boolean;
} {
  return (data: string) => {
    const chunk: ChatCompletionChunk = JSON.parse(data);

    // Mistral would return a lot of thinking chunks, in a specific format not compatible with OpenAI's streaming format
    // e.g. {"id":"426a1c8c62704d959621a94c1ff0cffb","object":"chat.completion.chunk","created":1759752086,"model":"magistral-medium-latest","choices":[{"index":0,"delta":{"content":[{"type":"thinking","thinking":[{"type":"text","text":" by 2 is"}]}]},"finish_reason":null}]}
    // We need to reformat these chunks to extract the thinking text
    for (const choice of chunk.choices || []) {
      const content = choice.delta?.content;
      if (Array.isArray(content)) {
        let extractedText = "";
        let hasThinking = false;
        const nonThinkingTextItems = [];

        for (const item of content) {
          if (item.type === "thinking" && Array.isArray(item.thinking)) {
            hasThinking = true;
            for (const thinkingItem of item.thinking) {
              if (thinkingItem.type === "text" && thinkingItem.text) {
                extractedText += thinkingItem.text;
              }
            }
          } else if (item.type === "text" && item.text) {
            // Collect non-thinking text items to concatenate
            nonThinkingTextItems.push(item.text);
          }
          // Other types (images, etc.) are not text and can't be concatenated
        }

        if (hasThinking) {
          // If we found thinking items, put extracted text in reasoning.content
          // and put any other text content in delta.content
          if (!choice.delta.reasoning) {
            choice.delta.reasoning = { content: "" };
          }
          choice.delta.reasoning.content = extractedText;

          if (nonThinkingTextItems.length > 0) {
            choice.delta.content = nonThinkingTextItems.join("");
          } else {
            // Clear the original content array since we moved it to reasoning
            choice.delta.content = null;
          }
        }
      }
    }

    return {
      data: JSON.stringify(chunk),
      finished: false,
    };
  };
}
