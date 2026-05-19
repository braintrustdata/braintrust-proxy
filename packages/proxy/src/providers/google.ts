import type {
  ChatCompletionContentPartType,
  ChatCompletionMessageParamType as Message,
} from "../generated_types";
import type { Content, Part } from "../../types/google";
import { convertMediaToBase64 } from "./util";

export * from "./google-converter";

export async function openAIContentToGoogleContent(
  content: Message["content"],
): Promise<Part[]> {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return Promise.all(content?.map(openAIContentPartToGooglePart) ?? []);
}

const openAIContentPartToGooglePart = async (
  part: ChatCompletionContentPartType,
): Promise<Part> => {
  switch (part.type) {
    case "text":
      return { text: part.text };
    case "image_url":
    case "file": {
      let media: string;
      if (part.type === "image_url") {
        media = part.image_url.url;
      } else {
        if (!part.file?.file_data) {
          throw new Error("File part missing file_data");
        }
        media = part.file.file_data;
      }

      const { media_type: mimeType, data } = await convertMediaToBase64({
        media,
        allowedMediaTypes: null,
        maxMediaBytes: null,
      });

      return {
        inlineData: {
          mimeType,
          data,
        },
      };
    }
    default:
      const _exhaustive: never = part;
      throw new Error(`Unsupported content type: ${_exhaustive}`);
  }
};

export async function openAIMessagesToGoogleMessages(
  messages: Message[],
): Promise<Content[]> {
  // First, do a basic mapping
  const content: Content[] = await Promise.all(
    messages.map(async (m) => {
      const reasoningParts =
        "reasoning" in m && m.reasoning
          ? m.reasoning.map((r) => ({ text: r.content, thought: true }))
          : [];

      const contentParts =
        m.role === "tool" ? [] : await openAIContentToGoogleContent(m.content);
      const toolCallParts: Part[] =
        m.role === "assistant"
          ? m.tool_calls?.map((t) => ({
              functionCall: {
                name: t.id,
                args: JSON.parse(t.function.arguments),
              },
            })) ?? []
          : [];
      const toolResponseParts: Part[] =
        m.role === "tool"
          ? [
              {
                functionResponse: {
                  name: m.tool_call_id,
                  response: {
                    name: m.tool_call_id,
                    content: m.content,
                  },
                },
              },
            ]
          : [];
      return {
        parts: [
          ...reasoningParts,
          ...contentParts,
          ...toolCallParts,
          ...toolResponseParts,
        ],
        role:
          m.role === "assistant"
            ? "model"
            : m.role === "tool"
              ? "user"
              : m.role,
      };
    }),
  );

  const flattenedContent: Content[] = [];
  for (let i = 0; i < content.length; i++) {
    const last = flattenedContent[flattenedContent.length - 1];
    if (last && last.role === content[i].role) {
      last.parts = [...(last.parts || []), ...(content[i].parts || [])];
    } else {
      flattenedContent.push(content[i]);
    }
  }

  // Finally, sort the messages so that:
  // 1. All images are up front
  // 2. The system prompt.
  // 3. Then all user messages' text parts
  // The EcmaScript spec requires the sort to be stable, so this is safe.
  const sortedContent: Content[] = flattenedContent.sort((a, b) => {
    const aFirst = a.parts?.[0];
    const bFirst = b.parts?.[0];

    if (aFirst?.inlineData && !bFirst?.inlineData) {
      return -1;
    } else if (bFirst?.inlineData && !aFirst?.inlineData) {
      return 1;
    }

    if (a.role === "system" && b.role !== "system") {
      return -1;
    } else if (b.role === "system" && a.role !== "system") {
      return 1;
    }

    return 0;
  });

  return sortedContent;
}
