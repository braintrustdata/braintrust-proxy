import { z } from "zod";

export const BaseMetadataSchema = z
  .object({
    models: z.array(z.string()).optional(),
    customModels: z
      .record(
        z.object({
          format: z.union([
            z.literal("openai"),
            z.literal("anthropic"),
            z.literal("google"),
          ]),
          flavor: z.union([z.literal("completion"), z.literal("chat")]),
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
      type: z.union([
        z.literal("perplexity"),
        z.literal("anthropic"),
        z.literal("google"),
        z.literal("replicate"),
        z.literal("together"),
        z.literal("mistral"),
        z.literal("js"),
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
