import { ChatCompletionChunk, ChatCompletion } from "openai/resources";

export function openAIChatCompletionToChatEvent(
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
