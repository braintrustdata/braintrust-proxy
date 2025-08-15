import { z } from "zod";
import { ModelSchema } from "./models";
import { rateLimitSchema } from "./rate_limits";

export const BaseMetadataSchema = z
  .object({
    models: z.array(z.string()).nullish(),
    customModels: z.record(ModelSchema).nullish(),
    excludeDefaultModels: z.boolean().nullish(),
    additionalHeaders: z.record(z.string(), z.string()).nullish(),
    supportsStreaming: z.boolean().default(true),
  })
  .strict();

export const AzureMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    api_base: z.string().url(),
    api_version: z.string().default("2023-07-01-preview"),
    deployment: z.string().nullish(),
    auth_type: z.enum(["api_key", "entra_api"]).default("api_key"),
    no_named_deployment: z
      .boolean()
      .default(false)
      .describe(
        "If true, the deployment name will not be used in the request path.",
      ),
  }),
).strict();

export const AzureEntraSecretSchema = z.object({
  client_id: z.string().min(1, "Client ID cannot be empty"),
  client_secret: z.string().min(1, "Client secret cannot be empty"),
  tenant_id: z.string().min(1, "Tenant ID cannot be empty"),
  scope: z.string().min(1, "Scope cannot be empty"),
});
export type AzureEntraSecret = z.infer<typeof AzureEntraSecretSchema>;

export const BedrockMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    region: z.string().min(1, "Region cannot be empty"),
    access_key: z.string().min(1, "Access key cannot be empty"),
    session_token: z.string().nullish(),
    api_base: z.union([z.string().url(), z.string().length(0)]).nullish(),
  }),
).strict();
export type BedrockMetadata = z.infer<typeof BedrockMetadataSchema>;

export const VertexMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    project: z.string().min(1, "Project cannot be empty"),
    authType: z.enum(["access_token", "service_account_key"]),
    api_base: z.union([z.string().url(), z.string().length(0)]).nullish(),
  }),
).strict();

export const DatabricksMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    api_base: z.string().url(),
    auth_type: z.enum(["pat", "service_principal_oauth"]).default("pat"),
  }),
).strict();

export const DatabricksOAuthSecretSchema = z.object({
  client_id: z.string().min(1, "Client ID cannot be empty"),
  client_secret: z.string().min(1, "Client secret cannot be empty"),
});
export type DatabricksOAuthSecret = z.infer<typeof DatabricksOAuthSecretSchema>;

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

export const MistralMetadataSchema = BaseMetadataSchema.merge(
  z.object({
    api_base: z.union([z.string().url(), z.string().length(0)]).nullish(),
  }),
).strict();

const APISecretBaseSchema = z
  .object({
    id: z.string().uuid().nullish(),
    org_name: z.string().nullish(),
    name: z.string().nullish(),
    secret: z.string(),
    metadata: z.record(z.unknown()).nullish(),
    rate_limit: rateLimitSchema.nullish(),
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
        "baseten",
        "ollama",
        "groq",
        "lepton",
        "fireworks",
        "cerebras",
        "xAI",
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
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("vertex"),
      metadata: VertexMetadataSchema.nullish(),
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("databricks"),
      metadata: DatabricksMetadataSchema.nullish(),
    }),
  ),
  APISecretBaseSchema.merge(
    z.object({
      type: z.literal("mistral"),
      metadata: MistralMetadataSchema.nullish(),
    }),
  ),
]);

export type APISecret = z.infer<typeof APISecretSchema>;

export const proxyLoggingParamSchema = z
  .object({
    project_name: z.string(),
    compress_audio: z.boolean().default(true),
  })
  .describe(
    "If present, proxy will log requests to the given Braintrust project name.",
  );

export type ProxyLoggingParam = z.infer<typeof proxyLoggingParamSchema>;

export const credentialsRequestSchema = z
  .object({
    model: z
      .string()
      .nullish()
      .describe(
        "Granted model name. Null/undefined to grant usage of all models.",
      ),
    ttl_seconds: z
      .number()
      .max(60 * 60 * 24)
      .default(60 * 10)
      .describe("TTL of the temporary credential. 10 minutes by default."),
    logging: proxyLoggingParamSchema.nullish(),
  })
  .describe("Payload for requesting temporary credentials.");
export type CredentialsRequest = z.infer<typeof credentialsRequestSchema>;

export const tempCredentialsCacheValueSchema = z
  .object({
    authToken: z.string().describe("Braintrust API key."),
  })
  .describe("Schema for the proxy's internal credential cache.");
export type TempCredentialsCacheValue = z.infer<
  typeof tempCredentialsCacheValueSchema
>;

export const tempCredentialJwtPayloadSchema = z
  .object({
    iss: z.literal("braintrust_proxy"),
    aud: z.literal("braintrust_proxy"),
    jti: z
      .string()
      .min(1)
      .describe("JWT ID, a unique identifier for this token."),
    exp: z.number().describe("Standard JWT expiration field."),
    iat: z.number().describe("Standard JWT issued-at field"),
    bt: z
      .object({
        org_name: z.string().nullish(),
        model: z.string().nullish(),
        secret: z.string().min(1),
        logging: proxyLoggingParamSchema.nullish(),
      })
      .describe("Braintrust-specific grants. See credentialsRequestSchema."),
  })
  .describe("Braintrust Proxy JWT payload.");
export type TempCredentialJwtPayload = z.infer<
  typeof tempCredentialJwtPayloadSchema
>;
