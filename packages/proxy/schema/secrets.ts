import { z } from "zod";

export const BaseMetadataSchema = z
  .object({
    models: z.array(z.string()).optional(),
    customModels: z
      .record(
        z.object({
          format: z.enum(["openai", "anthropic", "google"]),
          flavor: z.enum(["completion", "chat"]),
        }),
      )
      .optional(),
  })
  .strict();

export const AzureMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    api_base: z.string(),
    api_version: z.string().default("2023-07-01-preview"),
    deployment: z.string().optional(),
  }),
).strict();

export const OpenAIMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    organization_id: z.string().optional(),
  }),
).strict();

const APISecretBaseSchema = z
  .object({
    id: z.string().uuid().optional(),
    org_name: z.string().optional(),
    name: z.string().optional(),
    secret: z.string(),
    metadata: z.record(z.unknown()).optional(),
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
        "js",
      ]),
      metadata: BaseMetadataSchema.optional(),
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("openai"),
      metadata: OpenAIMetadataSchema.optional(),
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("azure"),
      metadata: AzureMetadataSchema.optional(),
    }),
  ),
]);

export type APISecret = z.infer<typeof APISecretSchema>;
