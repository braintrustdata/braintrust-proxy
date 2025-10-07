import { ChatCompletionChunk } from "openai/resources";
import { AIStreamParser } from "../proxy";

export function transformMistralThinkingChunks(): AIStreamParser {
  return (data: string) => {
    const chunk: ChatCompletionChunk = JSON.parse(data);

    // Mistral would return a lot of thinking chunks, in a specific format not compatible with OpenAI's streaming format
    // e.g. {"id":"426a1c8c62704d959621a94c1ff0cffb","object":"chat.completion.chunk","created":1759752086,"model":"magistral-medium-latest","choices":[{"index":0,"delta":{"content":[{"type":"thinking","thinking":[{"type":"text","text":" by 2 is"}]}]},"finish_reason":null}]}
    // We need to reformat these chunks to extract the thinking text
    for (const choice of chunk.choices || []) {
      const content = choice.delta?.content;
      if (Array.isArray(content)) {
        let extractedText = "";
        for (const item of content) {
          if (item.type === "thinking" && Array.isArray(item.thinking)) {
            for (const thinkingItem of item.thinking) {
              if (thinkingItem.type === "text" && thinkingItem.text) {
                extractedText += thinkingItem.text;
              }
            }
          }
        }

        if (extractedText) {
          choice.delta.content = extractedText;
        }
      }
    }

    return {
      data: JSON.stringify(chunk),
      finished: false,
    };
  };
}
