export {
  parseOpenAIStream,
  isChatCompletionChunk,
  isCompletion,
} from "./openai";
export * from "./encrypt";

export {
  isTempCredential,
  makeTempCredentials,
  verifyTempCredentials,
} from "./tempCredentials";

export function getCurrentUnixTimestamp(): number {
  return Date.now() / 1000;
}
