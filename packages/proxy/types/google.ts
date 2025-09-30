import { z } from "zod";

export const finishReasonSchema = z.enum([
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

export type FinishReason = z.infer<typeof finishReasonSchema>;

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
  endOffset: z.string().nullish(),
  startOffset: z.string().nullish(),
});

const outcomeSchema = z.enum([
  "OUTCOME_UNSPECIFIED",
  "OUTCOME_OK",
  "OUTCOME_FAILED",
  "OUTCOME_DEADLINE_EXCEEDED",
]);

const codeExecutionResultSchema = z.object({
  outcome: outcomeSchema.nullish(),
  output: z.string().nullish(),
});

const languageSchema = z.enum(["LANGUAGE_UNSPECIFIED", "PYTHON"]);

const executableCodeSchema = z.object({
  code: z.string().nullish(),
  language: languageSchema.nullish(),
});

const fileDataSchema = z.object({
  fileUri: z.string().nullish(),
  mimeType: z.string().nullish(),
});

const functionCallSchema = z.object({
  id: z.string().nullish(),
  args: z.record(z.unknown()).nullish(),
  name: z.string().nullish(),
});

const functionResponseSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  response: z.record(z.unknown()).nullish(),
});

const blobSchema = z.object({
  data: z.string().nullish(),
  mimeType: z.string().nullish(),
});

const partSchema = z.object({
  videoMetadata: videoMetadataSchema.nullish(),
  thought: z.boolean().nullish(),
  codeExecutionResult: codeExecutionResultSchema.nullish(),
  executableCode: executableCodeSchema.nullish(),
  fileData: fileDataSchema.nullish(),
  functionCall: functionCallSchema.nullish(),
  functionResponse: functionResponseSchema.nullish(),
  inlineData: blobSchema.nullish(),
  text: z.string().nullish(),
});

export type Part = z.infer<typeof partSchema>;

const contentSchema = z.object({
  parts: z.array(partSchema).nullish(),
  role: z.string().nullish(),
});

export type Content = z.infer<typeof contentSchema>;

export const generateContentResponseContentSchema = contentSchema;

const citationSourcesSchema = z.object({
  startIndex: z.number().nullish(),
  endIndex: z.number().nullish(),
  uri: z.string().nullish(),
  license: z.string().nullish(),
});

const citationMetadataSchema = z.object({
  citationSources: z.array(citationSourcesSchema).nullish(),
});

const safetyRatingSchema = z.object({
  category: harmCategorySchema.nullish(),
  probability: harmProbabilitySchema.nullish(),
  blocked: z.boolean().nullish(),
});

const logprobsResultCandidateSchema = z.object({
  logProbability: z.number().nullish(),
  token: z.string().nullish(),
  tokenId: z.number().nullish(),
});

const logprobsResultTopCandidatesSchema = z.object({
  candidates: z.array(logprobsResultCandidateSchema).nullish(),
});

const logprobsResultSchema = z.object({
  topCandidates: z.array(logprobsResultTopCandidatesSchema).nullish(),
  chosenCandidates: z.array(logprobsResultCandidateSchema).nullish(),
});

const groundingPassageSchema = z.object({
  passageId: z.string().nullish(),
  partIndex: z.number().nullish(),
});

const semanticRetrieverChunkSchema = z.object({
  source: z.string().nullish(),
  chunk: z.string().nullish(),
});

const attributionSourceId = z.object({
  groundingPassage: groundingPassageSchema.nullish(),
  semanticRetrieverChunk: semanticRetrieverChunkSchema.nullish(),
});

const groundingAttributionSchema = z.object({
  sourceId: attributionSourceId.nullish(),
  content: contentSchema.nullish(),
});

const webSchema = z.object({
  uri: z.string().nullish(),
  title: z.string().nullish(),
});

const groundingChunkSchema = z.object({
  web: webSchema.nullish(),
});

const segmentSchema = z.object({
  partIndex: z.number().nullish(),
  startIndex: z.number().nullish(),
  endIndex: z.number().nullish(),
  text: z.string().nullish(),
});

const groundingSupportSchema = z.object({
  groundingChunkIndices: z.array(z.number()).nullish(),
  confidenceScores: z.array(z.number()).nullish(),
  segment: segmentSchema.nullish(),
});

const searchEntryPointSchema = z.object({
  renderedContent: z.string().nullish(),
  sdkBlob: z.string().nullish(),
});

const retrievalMetadataSchema = z.object({
  googleSearchDynamicRetrievalScore: z.number().nullish(),
});

const topCandidatesSchema = z.object({
  candidates: z.unknown().nullish(), // TODO: use candidateSchema
});

const logpropsResultSchema = z.object({
  topCandidates: z.array(topCandidatesSchema).nullish(),
  chosenCandidates: z.array(z.unknown()).nullish(), // TODO: use candidateSchema
});

const urlRetrievalStatusSchema = z.enum([
  "URL_RETRIEVAL_STATUS_UNSPECIFIED",
  "URL_RETRIEVAL_STATUS_SUCCESS",
  "URL_RETRIEVAL_STATUS_ERROR",
  "URL_RETRIEVAL_STATUS_PAYWALL",
  "URL_RETRIEVAL_STATUS_UNSAFE",
]);

const urlMetadataSchema = z.object({
  retrievedUrl: z.string().nullish(),
  urlRetrievalStatus: urlRetrievalStatusSchema.nullish(),
});

const urlContextMetadataSchema = z.object({
  urlMetadata: z.array(urlMetadataSchema).nullish(),
});

const groundingMetadataSchema = z.object({
  groundingChunks: z.array(groundingChunkSchema).nullish(),
  groundingSupports: z.array(groundingSupportSchema).nullish(),
  webSearchQueries: z.array(z.string()).nullish(),
  searchEntryPoint: searchEntryPointSchema.nullish(),
  retrievalMetadata: retrievalMetadataSchema.nullish(),
  avgLogprobs: z.number().nullish(),
  logprobsResult: logpropsResultSchema.nullish(),
  urlContextMetadata: urlContextMetadataSchema.nullish(),
  index: z.number().nullish(),
});

export const generateContentResponseGroundingMetadataSchema =
  groundingMetadataSchema;

const candidateSchema = z.object({
  content: contentSchema.nullish(),
  finishReason: finishReasonSchema.nullish(),
  safetyRatings: z.array(safetyRatingSchema).nullish(),
  citationMetadata: citationMetadataSchema.nullish(),
  tokenCount: z.number().nullish(),
  groundingAttributions: z.array(groundingAttributionSchema).nullish(),
  groundingMetadata: groundingMetadataSchema.nullish(),
  finishMessage: z.string().nullish(),
  logprobs: logprobsResultSchema.nullish(),
});

export const generateContentResponseCandidateSchema = candidateSchema;

const modalityTokenCountSchema = z.object({
  modality: mediaModalitySchema.nullish(),
  tokenCount: z.number().nullish(),
});

export const generateContentResponsePromptFeedbackSchema = z.object({
  blockReason: blockedReasonSchema.nullish(),
  safetyRatings: z.array(safetyRatingSchema).nullish(),
});

// TODO: a bit silly to have this prefix
export const generateContentResponseUsageMetadataSchema = z.object({
  promptTokenCount: z.number().nullish(),
  cachedContentTokenCount: z.number().nullish(),
  candidatesTokenCount: z.number().nullish(),
  toolUsePromptTokenCount: z.number().nullish(),
  thoughtsTokenCount: z.number().nullish(),
  totalTokenCount: z.number().nullish(),
  promptTokensDetails: z.array(modalityTokenCountSchema).nullish(),
  cacheTokensDetails: z.array(modalityTokenCountSchema).nullish(),
  candidatesTokensDetails: z.array(modalityTokenCountSchema).nullish(),
  toolUsePromptTokensDetails: z.array(modalityTokenCountSchema).nullish(),
});

export type GenerateContentResponseUsageMetadata = z.infer<
  typeof generateContentResponseUsageMetadataSchema
>;

export const generateContentResponseSchema = z.object({
  candidates: z.array(candidateSchema).nullish(),
  createTime: z.string().nullish(),
  responseId: z.string().nullish(),
  modelVersion: z.string().nullish(),
  promptFeedback: generateContentResponsePromptFeedbackSchema.nullish(),
  usageMetadata: generateContentResponseUsageMetadataSchema.nullish(),
});

export type GenerateContentResponse = z.infer<
  typeof generateContentResponseSchema
>;

const toolCodeExecutionSchema = z.object({});

const vertexAiSearchSchema = z.object({
  datastore: z.string().nullish(),
  engine: z.string().nullish(),
});

const vertexRagStoreRagResourceSchema = z.object({
  ragCorpus: z.string().nullish(),
  ragFileIds: z.array(z.string()).nullish(),
});

const ragRetrievalConfigFilterSchema = z.object({
  metadataFilter: z.string().nullish(),
  vectorDistanceThreshold: z.string().nullish(),
  vectorSimilarityThreshold: z.string().nullish(),
});

const ragRetrievalConfigHybridSearchSchema = z.object({
  alpha: z.number().nullish(),
});

const ragRetrievalConfigRankingLlmRankerSchema = z.object({
  modelName: z.string().nullish(),
});

const ragRetrievalConfigRankingRankServiceSchema = z.object({
  modelName: z.string().nullish(),
});

const ragRetrievalConfigRankingSchema = z.object({
  llmRanker: ragRetrievalConfigRankingLlmRankerSchema.nullish(),
  rankService: ragRetrievalConfigRankingRankServiceSchema.nullish(),
});

const ragRetrievalConfigSchema = z.object({
  filter: ragRetrievalConfigFilterSchema.nullish(),
  hybridSearch: ragRetrievalConfigHybridSearchSchema.nullish(),
  ranking: ragRetrievalConfigRankingSchema.nullish(),
  topK: z.number().nullish(),
});

const vertexRagStoreSchema = z.object({
  ragCorpora: z.array(z.string()).nullish(),
  ragResources: z.array(vertexRagStoreRagResourceSchema).nullish(),
  ragRetrievalConfig: ragRetrievalConfigSchema.nullish(),
  similarityTopK: z.number().nullish(),
  vectorDistanceThreshold: z.number().nullish(),
});

const retrievalSchema = z.object({
  disableAttribution: z.boolean().nullish(),
  vertexAiSearch: vertexAiSearchSchema.nullish(),
  vertexRagStore: vertexRagStoreSchema.nullish(),
});

const googleSearchSchema = z.object({});

const dynamicRetrievalConfigModeSchema = z.enum([
  "MODE_UNSPECIFIED",
  "MODE_DYNAMIC",
]);

const dynamicRetrievalConfigSchema = z.object({
  mode: dynamicRetrievalConfigModeSchema.nullish(),
  dynamicThreshold: z.number().nullish(),
});

const googleSearchRetrievalSchema = z.object({
  mode: dynamicRetrievalConfigSchema.nullish(),
  dynamicThreshold: z.number().nullish(),
});

const enterpriseWebSearchSchema = z.object({});

const googleMapsSchema = z.object({
  // authConfig
});

const functionDeclarationSchema = z.object({
  description: z.string().nullish(),
  name: z.string().nullish(),
  parameters: z.lazy(() => schemaSchema).nullish(),
  response: z.lazy(() => schemaSchema).nullish(),
});

const toolSchema = z.object({
  retrieval: retrievalSchema.nullish(),
  googleSearch: googleSearchSchema.nullish(),
  googleSearchRetrieval: googleSearchRetrievalSchema.nullish(),
  enterpriseWebSearch: enterpriseWebSearchSchema.nullish(),
  googleMaps: googleMapsSchema.nullish(),
  codeExecution: toolCodeExecutionSchema.nullish(),
  functionDeclarations: z.array(functionDeclarationSchema).nullish(),
});

const functionCallingConfigSchema = z.object({
  mode: z.enum(["MODE_UNSPECIFIED", "AUTO", "ANY", "NONE"]).nullish(),
  allowedFunctionNames: z.array(z.string()).nullish(),
});

const retrievalConfigSchema = z.object({
  maxChunksToRetrieve: z.number().nullish(),
  minScore: z.number().nullish(),
  filters: z
    .object({
      metadataFilters: z
        .array(
          z.object({
            key: z.string().nullish(),
            operation: z
              .enum([
                "OPERATOR_UNSPECIFIED",
                "LESS",
                "LESS_EQUAL",
                "EQUAL",
                "GREATER_EQUAL",
                "GREATER",
                "NOT_EQUAL",
                "INCLUDES",
                "EXCLUDES",
                "AND",
                "OR",
                "NOT",
                "IN",
                "NOT_IN",
                "CUSTOM",
              ])
              .nullish(),
            stringValue: z.string().nullish(),
            numericValue: z.number().nullish(),
            conditions: z.lazy(() => z.array(z.unknown())).nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

const toolConfigSchema = z.object({
  functionCallingConfig: functionCallingConfigSchema.nullish(),
  retrievalConfig: retrievalConfigSchema.nullish(),
});

const typeSchema = z.enum([
  "TYPE_UNSPECIFIED",
  "STRING",
  "NUMBER",
  "INTEGER",
  "BOOLEAN",
  "ARRAY",
  "OBJECT",
]);

const schemaSchema: z.ZodSchema<any> = z.object({
  anyOf: z.lazy(() => z.array(schemaSchema)).nullish(),
  default: z.unknown().nullish(),
  description: z.string().nullish(),
  enum: z.array(z.string()).nullish(),
  example: z.unknown().nullish(),
  format: z.string().nullish(),
  items: z.lazy(() => schemaSchema).nullish(),
  maxItems: z.string().nullish(), // genai sdk shows string instead of number
  maxLength: z.string().nullish(), // genai sdk shows string instead of number
  maxProperties: z.string().nullish(), // genai sdk shows string instead of number
  maximum: z.number().nullish(),
  minItems: z.string().nullish(), // genai sdk shows string instead of number
  minLength: z.string().nullish(), // genai sdk shows string instead of number
  minProperties: z.string().nullish(), // genai sdk shows string instead of number
  minimum: z.number().nullish(),
  nullable: z.boolean().nullish(),
  pattern: z.string().nullish(),
  properties: z.lazy(() => z.record(schemaSchema)).nullish(),
  propertyOrdering: z.array(z.string()).nullish(),
  required: z.array(z.string()).nullish(),
  title: z.string().nullish(),
  type: typeSchema.nullish(),
});

const generationConfigRoutingAutoRoutingMode = z.object({
  modelRoutingPreference: z
    .enum(["UNKNOWN", "PRIORITIZE_QUALITY", "BALANCED", "PRIORITIZE_COST"])
    .nullish(),
});

const generationConfigRoutingManualRoutingMode = z.object({
  modelName: z.string().nullish(),
});

const generationConfigRoutingConfigSchema = z.object({
  autoMode: generationConfigRoutingAutoRoutingMode.nullish(),
  manualMode: generationConfigRoutingManualRoutingMode.nullish(),
});

const featureSelectionPreferenceSchema = z.enum([
  "FEATURE_SELECTION_PREFERENCE_UNSPECIFIED",
  "PRIORITIZE_QUALITY",
  "BALANCED",
  "PRIORITIZE_COST",
]);

const modelSelectionConfigSchema = z.object({
  featureSelectionPreference: featureSelectionPreferenceSchema.nullish(),
});

const mediaResolutionSchema = z.enum([
  "MEDIA_RESOLUTION_UNSPECIFIED",
  "MEDIA_RESOLUTION_LOW",
  "MEDIA_RESOLUTION_MEDIUM",
  "MEDIA_RESOLUTION_HIGH",
]);

const thinkingConfigSchema = z.object({
  includeThoughts: z.boolean().nullish(),
  thinkingBudget: z.number().nullish(),
});

export type ThinkingConfig = z.infer<typeof thinkingConfigSchema>;

const prebuiltVoiceConfigSchema = z.object({
  voiceName: z.string().nullish(),
});

const voiceConfigSchema = z.object({
  prebuiltVoiceConfig: prebuiltVoiceConfigSchema.nullish(),
});

const speechConfigSchema = z.object({
  voiceConfig: voiceConfigSchema.nullish(),
});

const speechConfigUnionSchema = z.union([speechConfigSchema, z.undefined()]);

const schemaUnionSchema = schemaSchema;

const toolListUnionSchema = z.array(toolSchema);

const partUnionSchema = z.union([partSchema, z.string()]);

const partListUnionSchema = z.union([
  partUnionSchema,
  z.array(partUnionSchema),
]);

const contentUnionSchema = z.union([
  contentSchema,
  z.array(partUnionSchema),
  partUnionSchema,
]);

export type ContentUnion = z.infer<typeof contentUnionSchema>;

const contentListUnionSchema = z.union([
  contentSchema,
  z.array(contentSchema),
  partUnionSchema,
  z.array(partUnionSchema),
]);

export type ContentListUnion = z.infer<typeof contentListUnionSchema>;

const harmBlockMethodSchema = z.enum([
  "HARM_BLOCK_METHOD_UNSPECIFIED",
  "SEVERITY",
  "PROBABILITY",
]);

const harmBlockThresholdSchema = z.enum([
  "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
  "BLOCK_LOW_AND_ABOVE",
  "BLOCK_MEDIUM_AND_ABOVE",
  "BLOCK_ONLY_HIGH",
  "BLOCK_NONE",
  "OFF",
]);

const safetySettingSchema = z.object({
  method: harmBlockMethodSchema.nullish(),
  category: harmCategorySchema.nullish(),
  threshold: harmBlockThresholdSchema.nullish(),
});

const generateContentConfigSchema = z.object({
  // httpOptions
  // abortSignals
  systemInstruction: contentUnionSchema.nullish(),
  temperature: z.number().nullish(),
  topP: z.number().nullish(),
  topK: z.number().nullish(),
  candidateCount: z.number().nullish(),
  maxOutputTokens: z.number().nullish(),
  stopSequences: z.array(z.string()).nullish(),
  responseLogprobs: z.boolean().nullish(),
  logprobs: z.number().nullish(),
  presencePenalty: z.number().nullish(),
  frequencyPenalty: z.number().nullish(),
  seed: z.number().nullish(),
  responseMimeType: z.string().nullish(),
  responseSchema: schemaUnionSchema.nullish(),
  routingConfig: generationConfigRoutingConfigSchema.nullish(),
  modelSelectionConfig: modelSelectionConfigSchema.nullish(),
  safetySettings: z.array(safetySettingSchema).nullish(),
  tools: toolListUnionSchema.nullish(),
  toolConfig: toolConfigSchema.nullish(),
  labels: z.record(z.string()).nullish(),
  cachedContent: z.string().nullish(),
  responseModalities: z.array(z.string()).nullish(),
  mediaResolution: mediaResolutionSchema.nullish(),
  speechConfig: speechConfigUnionSchema.nullish(),
  audioTimestamp: z.boolean().nullish(),
  thinkingConfig: thinkingConfigSchema.nullish(),
});

export type GenerateContentConfig = z.infer<typeof generateContentConfigSchema>;

export const generateContentParametersSchema = z.object({
  model: z.string(),
  contents: contentListUnionSchema,
  config: generateContentConfigSchema.nullish(),
});

export type GenerateContentParameters = z.infer<
  typeof generateContentParametersSchema
>;
