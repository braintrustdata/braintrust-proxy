export {
  parseOpenAIStream,
  isChatCompletionChunk,
  isCompletion,
} from "./openai";
export * from "./encrypt";

export function getCurrentUnixTimestamp(): number {
  return Date.now() / 1000;
}
