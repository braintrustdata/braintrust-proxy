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
  endOffset: z.string().optional(),
  startOffset: z.string().optional(),
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
  code: z.string().optional(),
  language: languageSchema.optional(),
});

const fileDataSchema = z.object({
  fileUri: z.string().optional(),
  mimeType: z.string().optional(),
});

const functionCallSchema = z.object({
  id: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  name: z.string().optional(),
});

const functionResponseSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  response: z.record(z.unknown()).optional(),
});

const blobSchema = z.object({
  data: z.string().optional(),
  mimeType: z.string().optional(),
});

const partSchema = z.object({
  videoMetadata: videoMetadataSchema.optional(),
  thought: z.boolean().optional(),
  codeExecutionResult: codeExecutionResultSchema.optional(),
  executableCode: executableCodeSchema.optional(),
  fileData: fileDataSchema.optional(),
  functionCall: functionCallSchema.optional(),
  functionResponse: functionResponseSchema.optional(),
  inlineData: blobSchema.optional(),
  text: z.string().optional(),
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

const toolCodeExecutionSchema = z.object({});

const vertexAiSearchSchema = z.object({
  datastore: z.string().optional(),
  engine: z.string().optional(),
});

const vertexRagStoreRagResourceSchema = z.object({
  ragCorpus: z.string().optional(),
  ragFileIds: z.array(z.string()).optional(),
});

const ragRetrievalConfigFilterSchema = z.object({
  metadataFilter: z.string().optional(),
  vectorDistanceThreshold: z.string().optional(),
  vectorSimilarityThreshold: z.string().optional(),
});

const ragRetrievalConfigHybridSearchSchema = z.object({
  alpha: z.number().optional(),
});

const ragRetrievalConfigRankingLlmRankerSchema = z.object({
  modelName: z.string().optional(),
});

const ragRetrievalConfigRankingRankServiceSchema = z.object({
  modelName: z.string().optional(),
});

const ragRetrievalConfigRankingSchema = z.object({
  llmRanker: ragRetrievalConfigRankingLlmRankerSchema.optional(),
  rankService: ragRetrievalConfigRankingRankServiceSchema.optional(),
});

const ragRetrievalConfigSchema = z.object({
  filter: ragRetrievalConfigFilterSchema.optional(),
  hybridSearch: ragRetrievalConfigHybridSearchSchema.optional(),
  ranking: ragRetrievalConfigRankingSchema.optional(),
  topK: z.number().optional(),
});

const vertexRagStoreSchema = z.object({
  ragCorpora: z.array(z.string()).optional(),
  ragResources: z.array(vertexRagStoreRagResourceSchema).optional(),
  ragRetrievalConfig: ragRetrievalConfigSchema.optional(),
  similarityTopK: z.number().optional(),
  vectorDistanceThreshold: z.number().optional(),
});

const retrievalSchema = z.object({
  disableAttribution: z.boolean().optional(),
  vertexAiSearch: vertexAiSearchSchema.optional(),
  vertexRagStore: vertexRagStoreSchema.optional(),
});

const googleSearchSchema = z.object({});

const dynamicRetrievalConfigModeSchema = z.enum([
  "MODE_UNSPECIFIED",
  "MODE_DYNAMIC",
]);

const dynamicRetrievalConfigSchema = z.object({
  mode: dynamicRetrievalConfigModeSchema.optional(),
  dynamicThreshold: z.number().optional(),
});

const googleSearchRetrievalSchema = z.object({
  mode: dynamicRetrievalConfigSchema.optional(),
  dynamicThreshold: z.number().optional(),
});

const enterpriseWebSearchSchema = z.object({});

const googleMapsSchema = z.object({
  // authConfig
});

const functionDeclarationSchema = z.object({
  description: z.string().optional(),
  name: z.string().optional(),
  parameters: z.lazy(() => schemaSchema).optional(),
  response: z.lazy(() => schemaSchema).optional(),
});

const toolSchema = z.object({
  retrieval: retrievalSchema.optional(),
  googleSearch: googleSearchSchema.optional(),
  googleSearchRetrieval: googleSearchRetrievalSchema.optional(),
  enterpriseWebSearch: enterpriseWebSearchSchema.optional(),
  googleMaps: googleMapsSchema.optional(),
  codeExecution: toolCodeExecutionSchema.optional(),
  functionDeclarations: z.array(functionDeclarationSchema).optional(),
});

const functionCallingConfigSchema = z.object({
  mode: z.enum(["MODE_UNSPECIFIED", "AUTO", "ANY", "NONE"]).optional(),
  allowedFunctionNames: z.array(z.string()).optional(),
});

const retrievalConfigSchema = z.object({
  maxChunksToRetrieve: z.number().optional(),
  minScore: z.number().optional(),
  filters: z
    .object({
      metadataFilters: z
        .array(
          z.object({
            key: z.string().optional(),
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
              .optional(),
            stringValue: z.string().optional(),
            numericValue: z.number().optional(),
            conditions: z.lazy(() => z.array(z.unknown())).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const toolConfigSchema = z.object({
  functionCallingConfig: functionCallingConfigSchema.optional(),
  retrievalConfig: retrievalConfigSchema.optional(),
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
  anyOf: z.lazy(() => z.array(schemaSchema)).optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  example: z.unknown().optional(),
  format: z.string().optional(),
  items: z.lazy(() => schemaSchema).optional(),
  maxItems: z.string().optional(), // genai sdk shows string instead of number
  maxLength: z.string().optional(), // genai sdk shows string instead of number
  maxProperties: z.string().optional(), // genai sdk shows string instead of number
  maximum: z.number().optional(),
  minItems: z.string().optional(), // genai sdk shows string instead of number
  minLength: z.string().optional(), // genai sdk shows string instead of number
  minProperties: z.string().optional(), // genai sdk shows string instead of number
  minimum: z.number().optional(),
  nullable: z.boolean().optional(),
  pattern: z.string().optional(),
  properties: z.lazy(() => z.record(schemaSchema)).optional(),
  propertyOrdering: z.array(z.string()).optional(),
  required: z.array(z.string()).optional(),
  title: z.string().optional(),
  type: typeSchema.optional(),
});

const generationConfigRoutingAutoRoutingMode = z.object({
  modelRoutingPreference: z
    .enum(["UNKNOWN", "PRIORITIZE_QUALITY", "BALANCED", "PRIORITIZE_COST"])
    .optional(),
});

const generationConfigRoutingManualRoutingMode = z.object({
  modelName: z.string().optional(),
});

const generationConfigRoutingConfigSchema = z.object({
  autoMode: generationConfigRoutingAutoRoutingMode.optional(),
  manualMode: generationConfigRoutingManualRoutingMode.optional(),
});

const featureSelectionPreferenceSchema = z.enum([
  "FEATURE_SELECTION_PREFERENCE_UNSPECIFIED",
  "PRIORITIZE_QUALITY",
  "BALANCED",
  "PRIORITIZE_COST",
]);

const modelSelectionConfigSchema = z.object({
  featureSelectionPreference: featureSelectionPreferenceSchema.optional(),
});

const mediaResolutionSchema = z.enum([
  "MEDIA_RESOLUTION_UNSPECIFIED",
  "MEDIA_RESOLUTION_LOW",
  "MEDIA_RESOLUTION_MEDIUM",
  "MEDIA_RESOLUTION_HIGH",
]);

const thinkingConfigSchema = z.object({
  includeThoughts: z.boolean().optional(),
  thinkingBudget: z.number().optional(),
});

const prebuiltVoiceConfigSchema = z.object({
  voiceName: z.string().optional(),
});

const voiceConfigSchema = z.object({
  prebuiltVoiceConfig: prebuiltVoiceConfigSchema.optional(),
});

const speechConfigSchema = z.object({
  voiceConfig: voiceConfigSchema.optional(),
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

const contentListUnionSchema = z.union([
  contentSchema,
  z.array(contentSchema),
  partUnionSchema,
  z.array(partUnionSchema),
]);

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
  method: harmBlockMethodSchema.optional(),
  category: harmCategorySchema.optional(),
  threshold: harmBlockThresholdSchema.optional(),
});

const generateContentConfigSchema = z.object({
  // httpOptions
  // abortSignals
  systemInstruction: contentUnionSchema.optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  candidateCount: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  stopSequences: z.array(z.string()).optional(),
  responseLogprobs: z.boolean().optional(),
  logprobs: z.number().optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  seed: z.number().optional(),
  responseMimeType: z.string().optional(),
  responseSchema: schemaUnionSchema.optional(),
  routingConfig: generationConfigRoutingConfigSchema.optional(),
  modelSelectionConfig: modelSelectionConfigSchema.optional(),
  safetySettings: z.array(safetySettingSchema).optional(),
  tools: toolListUnionSchema.optional(),
  toolConfig: toolConfigSchema.optional(),
  labels: z.record(z.string()).optional(),
  cachedContent: z.string().optional(),
  responseModalities: z.array(z.string()).optional(),
  mediaResolution: mediaResolutionSchema.optional(),
  speechConfig: speechConfigUnionSchema.optional(),
  audioTimestamp: z.boolean().optional(),
  thinkingConfig: thinkingConfigSchema.optional(),
});

export const generateContentParametersSchema = z.object({
  model: z.string(),
  contents: contentListUnionSchema,
  config: generateContentConfigSchema.optional(),
});

export type GenerateContentParameters = z.infer<
  typeof generateContentParametersSchema
>;
