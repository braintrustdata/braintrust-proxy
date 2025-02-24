import { ChatCompletionChunk, ChatCompletion } from "openai/resources";

function openAIChatCompletionToChatEvent(
  completion: ChatCompletion,
): ChatCompletionChunk {
  return {
    id: completion.id,
    choices: completion.choices.map((choice) => ({
      index: choice.index,
      delta: {
        role: choice.message.role,
        content: choice.message.content || "",
        tool_calls: choice.message.tool_calls
          ? choice.message.tool_calls.map((tool_call, index) => ({
              index,
              id: tool_call.id,
              function: tool_call.function,
              type: tool_call.type,
            }))
          : undefined,
      },
      finish_reason: choice.finish_reason,
    })),
    created: completion.created,
    model: completion.model,
    object: "chat.completion.chunk",
    usage: completion.usage,
  };
}

export function makeFakeOpenAIStreamTransformer() {
  let responseChunks: Uint8Array[] = [];
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      responseChunks.push(chunk);
    },
    flush(controller) {
      const decoder = new TextDecoder();
      const responseText = responseChunks
        .map((c) => decoder.decode(c))
        .join("");
      let responseJson: ChatCompletion = {
        id: "invalid",
        choices: [],
        created: 0,
        model: "invalid",
        object: "chat.completion",
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
      try {
        responseJson = JSON.parse(responseText);
      } catch (e) {
        console.error("Failed to parse response as JSON", responseText);
      }
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify(openAIChatCompletionToChatEvent(responseJson))}\n\n`,
        ),
      );
      controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
      controller.terminate();
    },
  });
}
