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

export { makeWavFile, makeMp3File } from "./audioEncoder";

export function getCurrentUnixTimestamp(): number {
  return Date.now() / 1000;
}

export const effortToBudgetMultiplier = {
  none: 0,
  minimal: 0,
  low: 0.2,
  medium: 0.5,
  high: 0.8,
  xhigh: 1.0,
} as const;

export const getBudgetMultiplier = (
  effort: keyof typeof effortToBudgetMultiplier,
) => {
  return effortToBudgetMultiplier[effort] || effortToBudgetMultiplier.low;
};
