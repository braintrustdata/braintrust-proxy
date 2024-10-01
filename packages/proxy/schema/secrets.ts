import { z } from "zod";
import { ModelSchema } from "./models";

export const BaseMetadataSchema = z
  .object({
    models: z.array(z.string()).nullish(),
    customModels: z.record(ModelSchema).nullish(),
    excludeDefaultModels: z.boolean().nullish(),
  })
  .strict();

export const AzureMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    api_base: z.string().url(),
    api_version: z.string().default("2023-07-01-preview"),
    deployment: z.string().nullish(),
  }),
).strict();

export const BedrockMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    region: z.string().min(1, "Region cannot be empty"),
    access_key: z.string().min(1, "Access key cannot be empty"),
    session_token: z.string().nullish(),
  }),
).strict();
export type BedrockMetadata = z.infer<typeof BedrockMetadataSchema>;

export const OpenAIMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    api_base: z.union([
      z.string().url().optional(),
      z.string().length(0),
      z.null(),
    ]),
    organization_id: z.string().nullish(),
  }),
).strict();

const APISecretBaseSchema = z
  .object({
    id: z.string().uuid().nullish(),
    org_name: z.string().nullish(),
    name: z.string().nullish(),
    secret: z.string(),
    metadata: z.record(z.unknown()).nullish(),
  })
  .strict();

export const APISecretSchema = z.union([
  APISecretBaseSchema.merge(
    z.object({
      type: z.enum([
        "perplexity",
        "anthropic",
        "google",
        "replicate",
        "together",
        "mistral",
        "ollama",
        "groq",
        "lepton",
        "fireworks",
        "cerebras",
        "js",
      ]),
      metadata: BaseMetadataSchema.nullish(),
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("openai"),
      metadata: OpenAIMetadataSchema.nullish(),
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("azure"),
      metadata: AzureMetadataSchema.nullish(),
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("bedrock"),
      metadata: BedrockMetadataSchema.nullish(),
    }),
  ),
]);

export type APISecret = z.infer<typeof APISecretSchema>;
