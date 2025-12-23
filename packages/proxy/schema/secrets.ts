import { z } from "zod";
import { ModelSchema } from "./models";

export const BaseMetadataSchema = z.strictObject({
    models: z.array(z.string()).nullish(),
    customModels: z.record(z.string(), ModelSchema).nullish(),
    excludeDefaultModels: z.boolean().nullish(),
    additionalHeaders: z.record(z.string(), z.string()).nullish(),
    supportsStreaming: z.boolean().prefault(true),
  });

export const AzureMetadataSchema = BaseMetadataSchema.extend(
  z.strictObject({
        api_base: z.url(),
        api_version: z.string().prefault("2023-07-01-preview"),
        deployment: z.string().nullish(),
        auth_type: z.enum(["api_key", "entra_api"]).prefault("api_key"),
        no_named_deployment: z
          .boolean()
          .prefault(false)
          .describe(
            "If true, the deployment name will not be used in the request path.",
          ),
      }).shape
);

export const AzureEntraSecretSchema = z.object({
  client_id: z.string().min(1, "Client ID cannot be empty"),
  client_secret: z.string().min(1, "Client secret cannot be empty"),
  tenant_id: z.string().min(1, "Tenant ID cannot be empty"),
  scope: z.string().min(1, "Scope cannot be empty"),
});
export type AzureEntraSecret = z.infer<typeof AzureEntraSecretSchema>;

export const BedrockMetadataSchema = BaseMetadataSchema.extend(
  z.strictObject({
        region: z.string().min(1, "Region cannot be empty"),
        access_key: z.string().min(1, "Access key cannot be empty"),
        session_token: z.string().nullish(),
        api_base: z.union([z.url(), z.string().length(0)]).nullish(),
      }).shape
);
export type BedrockMetadata = z.infer<typeof BedrockMetadataSchema>;

export const VertexMetadataSchema = BaseMetadataSchema.extend(
  z.strictObject({
        project: z.string().min(1, "Project cannot be empty"),
        authType: z.enum(["access_token", "service_account_key"]),
        api_base: z.union([z.url(), z.string().length(0)]).nullish(),
      }).shape
);

export const DatabricksMetadataSchema = BaseMetadataSchema.extend(
  z.strictObject({
        api_base: z.url(),
        auth_type: z.enum(["pat", "service_principal_oauth"]).prefault("pat"),
      }).shape
);

export const DatabricksOAuthSecretSchema = z.object({
  client_id: z.string().min(1, "Client ID cannot be empty"),
  client_secret: z.string().min(1, "Client secret cannot be empty"),
});
export type DatabricksOAuthSecret = z.infer<typeof DatabricksOAuthSecretSchema>;

export const OpenAIMetadataSchema = BaseMetadataSchema.extend(
  z.strictObject({
        api_base: z.union([
          z.url().optional(),
          z.string().length(0),
          z.null(),
        ]),
        organization_id: z.string().nullish(),
      }).shape
);

export const MistralMetadataSchema = BaseMetadataSchema.extend(
  z.strictObject({
        api_base: z.union([z.url(), z.string().length(0)]).nullish(),
      }).shape
);

const APISecretBaseSchema = z.strictObject({
    id: z.uuid().nullish(),
    org_name: z.string().nullish(),
    name: z.string().nullish(),
    secret: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  });

export const APISecretSchema = z.union([
  APISecretBaseSchema.extend(
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
            }).shape
  ),
  APISecretBaseSchema.extend(
    z.object({
              type: z.literal("openai"),
              metadata: OpenAIMetadataSchema.nullish(),
            }).shape
  ),
  APISecretBaseSchema.extend(
    z.object({
            type: z.literal("azure"),
            metadata: AzureMetadataSchema.nullish(),
          }).shape
  ),
  APISecretBaseSchema.extend(
    z.object({
            type: z.literal("bedrock"),
            metadata: BedrockMetadataSchema.nullish(),
          }).shape
  ),
  APISecretBaseSchema.extend(
    z.object({
            type: z.literal("vertex"),
            metadata: VertexMetadataSchema.nullish(),
          }).shape
  ),
  APISecretBaseSchema.extend(
    z.object({
            type: z.literal("databricks"),
            metadata: DatabricksMetadataSchema.nullish(),
          }).shape
  ),
  APISecretBaseSchema.extend(
    z.object({
            type: z.literal("mistral"),
            metadata: MistralMetadataSchema.nullish(),
          }).shape
  ),
]);

export type APISecret = z.infer<typeof APISecretSchema>;

export const proxyLoggingParamSchema = z
  .object({
    parent: z.string().optional(),
    project_name: z.string().optional(),
    compress_audio: z.boolean().prefault(true),
  })
  .refine((data) => data.parent || data.project_name, {
      error: "Either 'parent' or 'project_name' must be provided"
})
  .describe(
    "If present, proxy will log requests to the given Braintrust project or parent span.",
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
      .prefault(60 * 10)
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
