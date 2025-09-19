import { z } from "zod";

const finishReasonSchema = z.enum([
  "FINISH_REASON_UNSPECIFIED",
  "STOP",
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "OTHER",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
  "IMAGE_SAFETY",
  "UNEXPECTED_TOOL_CALL",
  "TOO_MANY_TOOL_CALLS",
]);

export const generateContentResponseFinishReasonSchema = finishReasonSchema;

const blockedReasonSchema = z.enum([
  "BLOCKED_REASON_UNSPECIFIED",
  "SAFETY",
  "OTHER",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "IMAGE_SAFETY",
]);

const harmCategorySchema = z.enum([
  "HARM_CATEGORY_CIVIC_INTEGRITY",
  "HARM_CATEGORY_DANGEROUS",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_DEROGATORY",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_MEDICAL",
  "HARM_CATEGORY_SEXUAL",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_TOXICITY",
  "HARM_CATEGORY_UNSPECIFIED",
  "HARM_CATEGORY_VIOLENCE",
]);

const harmProbabilitySchema = z.enum([
  "HARM_PROBABILITY_UNSPECIFIED",
  "NEGLIGIBLE",
  "LOW",
  "MEDIUM",
  "HIGH",
]);

const mediaModalitySchema = z.enum([
  "MODALITY_UNSPECIFIED",
  "TEXT",
  "IMAGE",
  "AUDIO",
  "VIDEO",
]);

const schedulingSchema = z.enum([
  "SCHEDULING_UNSPECIFIED",
  "SILENT",
  "WHEN_IDLE",
  "INTERRUPT",
]);

const videoMetadataSchema = z.object({
  startOffset: z.string().optional(),
  endOffset: z.string().optional(),
  fps: z.number().optional(),
});

const outcomeSchema = z.enum([
  "OUTCOME_UNSPECIFIED",
  "OUTCOME_OK",
  "OUTCOME_FAILED",
  "OUTCOME_DEADLINE_EXCEEDED",
]);

const codeExecutionResultSchema = z.object({
  outcome: outcomeSchema.optional(),
  output: z.string().optional(),
});

const languageSchema = z.enum(["LANGUAGE_UNSPECIFIED", "PYTHON"]);

const executableCodeSchema = z.object({
  language: languageSchema.optional(),
  code: z.string().optional(),
});

const fileDataSchema = z.object({
  fileUri: z.string().optional(),
  mimeType: z.string().optional(),
});

const functionCallSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  args: z.record(z.unknown()).optional(),
});

const functionResponseSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  response: z.record(z.unknown()).optional(),
  willContinue: z.boolean().optional(),
  scheduling: schedulingSchema.optional(),
});

const blobSchema = z.object({
  mimeType: z.string().optional(),
  data: z.string().optional(),
});

const partSchema = z.object({
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
  text: z.string().optional(),
  inlineData: blobSchema.optional(),
  functionCall: functionCallSchema.optional(),
  functionResponse: functionResponseSchema.optional(),
  fileData: fileDataSchema.optional(),
  executableCode: executableCodeSchema.optional(),
  codeExecutionResult: codeExecutionResultSchema.optional(),
  videoMetadata: videoMetadataSchema.optional(),
});

const contentSchema = z.object({
  parts: z.array(partSchema).optional(),
  role: z.string().optional(),
});

export const generateContentResponseContentSchema = contentSchema;

const citationSourcesSchema = z.object({
  startIndex: z.number().optional(),
  endIndex: z.number().optional(),
  uri: z.string().optional(),
  license: z.string().optional(),
});

const citationMetadataSchema = z.object({
  citationSources: z.array(citationSourcesSchema).optional(),
});

const safetyRatingSchema = z.object({
  category: harmCategorySchema.optional(),
  probability: harmProbabilitySchema.optional(),
  blocked: z.boolean().optional(),
});

const logprobsResultCandidateSchema = z.object({
  logProbability: z.number().optional(),
  token: z.string().optional(),
  tokenId: z.number().optional(),
});

const logprobsResultTopCandidatesSchema = z.object({
  candidates: z.array(logprobsResultCandidateSchema).optional(),
});

const logprobsResultSchema = z.object({
  topCandidates: z.array(logprobsResultTopCandidatesSchema).optional(),
  chosenCandidates: z.array(logprobsResultCandidateSchema).optional(),
});

const groundingPassageSchema = z.object({
  passageId: z.string().optional(),
  partIndex: z.number().optional(),
});

const semanticRetrieverChunkSchema = z.object({
  source: z.string().optional(),
  chunk: z.string().optional(),
});

const attributionSourceId = z.object({
  groundingPassage: groundingPassageSchema.optional(),
  semanticRetrieverChunk: semanticRetrieverChunkSchema.optional(),
});

const groundingAttributionSchema = z.object({
  sourceId: attributionSourceId.optional(),
  content: contentSchema.optional(),
});

const webSchema = z.object({
  uri: z.string().optional(),
  title: z.string().optional(),
});

const groundingChunkSchema = z.object({
  web: webSchema.optional(),
});

const segmentSchema = z.object({
  partIndex: z.number().optional(),
  startIndex: z.number().optional(),
  endIndex: z.number().optional(),
  text: z.string().optional(),
});

const groundingSupportSchema = z.object({
  groundingChunkIndices: z.array(z.number()).optional(),
  confidenceScores: z.array(z.number()).optional(),
  segment: segmentSchema.optional(),
});

const searchEntryPointSchema = z.object({
  renderedContent: z.string().optional(),
  sdkBlob: z.string().optional(),
});

const retrievalMetadataSchema = z.object({
  googleSearchDynamicRetrievalScore: z.number().optional(),
});

const topCandidatesSchema = z.object({
  candidates: z.unknown().optional(), // TODO: use candidateSchema
});

const logpropsResultSchema = z.object({
  topCandidates: z.array(topCandidatesSchema).optional(),
  chosenCandidates: z.array(z.unknown()).optional(), // TODO: use candidateSchema
});

const urlRetrievalStatusSchema = z.enum([
  "URL_RETRIEVAL_STATUS_UNSPECIFIED",
  "URL_RETRIEVAL_STATUS_SUCCESS",
  "URL_RETRIEVAL_STATUS_ERROR",
  "URL_RETRIEVAL_STATUS_PAYWALL",
  "URL_RETRIEVAL_STATUS_UNSAFE",
]);

const urlMetadataSchema = z.object({
  retrievedUrl: z.string().optional(),
  urlRetrievalStatus: urlRetrievalStatusSchema.optional(),
});

const urlContextMetadataSchema = z.object({
  urlMetadata: z.array(urlMetadataSchema).optional(),
});

const groundingMetadataSchema = z.object({
  groundingChunks: z.array(groundingChunkSchema).optional(),
  groundingSupports: z.array(groundingSupportSchema).optional(),
  webSearchQueries: z.array(z.string()).optional(),
  searchEntryPoint: searchEntryPointSchema.optional(),
  retrievalMetadata: retrievalMetadataSchema.optional(),
  avgLogprobs: z.number().optional(),
  logprobsResult: logpropsResultSchema.optional(),
  urlContextMetadata: urlContextMetadataSchema.optional(),
  index: z.number().optional(),
});

export const generateContentResponseGroundingMetadataSchema =
  groundingMetadataSchema;

const candidateSchema = z.object({
  content: contentSchema.optional(),
  finishReason: finishReasonSchema.optional(),
  safetyRatings: z.array(safetyRatingSchema).optional(),
  citationMetadata: citationMetadataSchema.optional(),
  tokenCount: z.number().optional(),
  groundingAttributions: z.array(groundingAttributionSchema).optional(),
  groundingMetadata: groundingMetadataSchema.optional(),
  finishMessage: z.string().optional(),
  logprobs: logprobsResultSchema.optional(),
});

export const generateContentResponseCandidateSchema = candidateSchema;

const modalityTokenCountSchema = z.object({
  modality: mediaModalitySchema.optional(),
  tokenCount: z.number().optional(),
});

export const generateContentResponsePromptFeedbackSchema = z.object({
  blockReason: blockedReasonSchema.optional(),
  safetyRatings: z.array(safetyRatingSchema).optional(),
});

// TODO: a bit silly to have this prefix
export const generateContentResponseUsageMetadataSchema = z.object({
  promptTokenCount: z.number().optional(),
  cachedContentTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  toolUsePromptTokenCount: z.number().optional(),
  thoughtsTokenCount: z.number().optional(),
  totalTokenCount: z.number().optional(),
  promptTokensDetails: z.array(modalityTokenCountSchema).optional(),
  cacheTokensDetails: z.array(modalityTokenCountSchema).optional(),
  candidatesTokensDetails: z.array(modalityTokenCountSchema).optional(),
  toolUsePromptTokensDetails: z.array(modalityTokenCountSchema).optional(),
});

export const generateContentResponseSchema = z.object({
  candidates: z.array(candidateSchema).optional(),
  createTime: z.string().optional(),
  responseId: z.string().optional(),
  modelVersion: z.string().optional(),
  promptFeedback: generateContentResponsePromptFeedbackSchema.optional(),
  usageMetadata: generateContentResponseUsageMetadataSchema.optional(),
});

export type GenerateContentResponse = z.infer<
  typeof generateContentResponseSchema
>;
