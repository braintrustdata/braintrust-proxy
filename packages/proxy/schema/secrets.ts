import { z } from "zod";

interface APISecretBase {
  id?: string;
  org_name?: string;
  name?: string;
  secret: string;
  metadata?: Record<string, unknown>;
}

// XXX: Converge with main ModelSpec
interface ModelSpec {
  format: Omit<"openai" | "anthropic" | "google" | "js", "js">;
  flavor: "completion" | "chat";
}

interface BaseMetadata {
  models?: string[] | Record<string, ModelSpec>;
}

const BaseMetadataSchema = z.object({
  models: z
    .union([
      z.array(z.string()),
      z.record(
        z.object({
          format: z.union([
            z.literal("openai"),
            z.literal("anthropic"),
            z.literal("google"),
          ]),
          flavor: z.union([z.literal("completion"), z.literal("chat")]),
        }),
      ),
    ])
    .optional(),
});

export const AzureMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    api_base: z.string(),
    api_version: z.string().default("2023-07-01-preview"),
    deployment: z.string().optional(),
  }),
);

export const OpenAIMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    organization_id: z.string().optional(),
  }),
);
const APISecretBaseSchema = z.object({
  id: z.string().uuid().optional(),
  org_name: z.string().optional(),
  name: z.string().optional(),
  secret: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

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
      metadata: OpenAIMetadataSchema,
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("azure"),
      metadata: AzureMetadataSchema,
    }),
  ),
]);

// XXX REMOVE?
export type APISecret = APISecretBase &
  (
    | {
        type:
          | "perplexity"
          | "anthropic"
          | "google"
          | "replicate"
          | "together"
          | "mistral"
          | "js";
        metadata?: BaseMetadata;
      }
    | {
        type: "openai";
        metadata?: BaseMetadata & {
          organization_id?: string;
        };
      }
    | {
        type: "azure";
        metadata?: BaseMetadata & {
          api_base: string;
          api_version: string;
          deployment?: string;
        };
      }
  );
