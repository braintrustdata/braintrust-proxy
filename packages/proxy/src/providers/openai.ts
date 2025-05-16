import {
  ChatCompletionChunk,
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources";
import { base64ToUrl, convertBase64Media, convertMediaToBase64 } from "./util";
import { parseFilenameFromUrl } from "..";

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

export async function normalizeOpenAIMessages(
  messages: ChatCompletionMessageParam[],
): Promise<ChatCompletionMessageParam[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (
        message.role === "user" &&
        message.content &&
        typeof message.content !== "string"
      ) {
        message.content = await Promise.all(
          message.content.map(
            async (c): Promise<ChatCompletionContentPart> =>
              await normalizeOpenAIContent(c),
          ),
        );
      }
      // not part of the openai spec
      if ("reasoning" in message) {
        delete message.reasoning;
      }
      return message;
    }),
  );
}

// https://platform.openai.com/docs/guides/pdf-files?api-mode=chat
async function normalizeOpenAIContent(
  content: ChatCompletionContentPart,
): Promise<ChatCompletionContentPart> {
  if (typeof content === "string") {
    return content;
  }
  switch (content.type) {
    case "image_url":
      if (convertBase64Media(content.image_url.url)) {
        return content;
      } else if (content.image_url.url.endsWith(".pdf")) {
        const base64 = await convertMediaToBase64({
          media: content.image_url.url,
          allowedMediaTypes: ["application/pdf"],
          maxMediaBytes: 20 * 1024 * 1024,
        });
        return {
          type: "file",
          file: {
            filename:
              parseFilenameFromUrl(content.image_url.url) ?? "image.pdf",
            file_data: base64ToUrl(base64),
          },
        };
      } else if (
        content.image_url.url.startsWith("http://127.0.0.1") ||
        content.image_url.url.startsWith("http://localhost")
      ) {
        const base64 = await convertMediaToBase64({
          media: content.image_url.url,
          allowedMediaTypes: null,
          maxMediaBytes: 20 * 1024 * 1024,
        });
        return {
          type: "image_url",
          image_url: {
            url: base64ToUrl(base64),
          },
        };
      }
      return content;
    default:
      return content;
  }
}
