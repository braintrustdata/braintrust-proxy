import { z } from "zod";
import { ModelSchema } from "./models";
import { generateRandomPassword, getCurrentUnixTimestamp } from "utils";
import { v4 } from "uuid";
import { isEmpty } from "@lib/util";

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

export const credentialsRequestSchema = z.object({
  model: z.string().nullish(),
  project_name: z.string().nullish(),
  ttl_seconds: z.number().default(60 * 10) /* 10 minutes by default */,
});

export const tempCredentialsSchema = z.object({
  secrets: z.array(APISecretSchema),
  braintrust_api_key: z.string().optional(),
  project_name: z.string().optional(),
  expires_at: z.number(),
});
export type TempCredentials = z.infer<typeof tempCredentialsSchema>;

export async function makeTempCredentials({
  authToken,
  body: rawBody,
  orgName,
  digest,
  getApiSecrets,
  cachePut,
}: {
  authToken: string;
  body: unknown;
  orgName: string | undefined;
  getApiSecrets: (
    useCache: boolean,
    authToken: string,
    model: string | null,
    org_name?: string,
  ) => Promise<APISecret[]>;
  digest: (message: string) => Promise<string>;
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>;
}) {
  const body = credentialsRequestSchema.safeParse(rawBody);
  if (!body.success) {
    throw new Error(body.error.message);
  }

  const { model, ttl_seconds, project_name } = body.data;
  const expiresAt = getCurrentUnixTimestamp() + ttl_seconds;

  let secrets = await getApiSecrets(false, authToken, model ?? null, orgName);

  let braintrust_api_key: string | undefined;
  if (!isEmpty(project_name) && secrets.length > 0) {
    // If there is a project specified, only use secrets that came from Braintrust
    // (this effectively forces it to be a BRAINTRUST_API_KEY).
    secrets = secrets.filter((secret) => !!secret.id);
    if (secrets.length === 0) {
      throw new Error(`No secrets found matching project ${project_name}`);
    }

    // Ideally we can create a temporary write-only key (that is scoped to the project),
    // but for now, just use the auth token itself.
    braintrust_api_key = authToken;
  }

  if (secrets.length === 0) {
    throw new Error("No secrets found");
  }

  const tempCredentials: TempCredentials = {
    secrets,
    braintrust_api_key,
    project_name: project_name ?? undefined,
    expires_at: expiresAt,
  };

  const cacheKey = v4();
  const expiredHex = Math.floor(expiresAt).toString(36);
  const resultKey = `bt_temp_${generateRandomPassword(60)}_${expiredHex}_${cacheKey}`;
  const encryptionKey = await digest(resultKey);

  await cachePut(
    encryptionKey,
    cacheKey,
    JSON.stringify(tempCredentials),
    ttl_seconds,
  );

  return resultKey;
}

export function isTempCredential(key: string) {
  return key.startsWith("bt_temp_");
}

export async function fetchTempCredentials({
  key,
  cacheGet,
  digest,
}: {
  key: string;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  digest: (message: string) => Promise<string>;
}): Promise<TempCredentials | "invalid" | "expired"> {
  const parts = key.split("_");
  if (parts.length !== 5) {
    console.warn(`Invalid temp key, expect 4 parts, got ${parts.length}`);
    return "invalid";
  }
  const expiredHex = parts[3];
  const cacheKey = parts[4];
  const encryptionKey = await digest(key);

  const expiresAt = parseInt(expiredHex, 36);
  if (expiresAt < getCurrentUnixTimestamp()) {
    console.warn(`Temp key expired at ${expiresAt}`);
    return "expired";
  }

  const cacheResponse = await cacheGet(encryptionKey, cacheKey);
  if (!cacheResponse) {
    console.warn(`Temp key not found in cache`);
    return "invalid";
  }

  const tempCredentials = tempCredentialsSchema.safeParse(
    JSON.parse(cacheResponse),
  );
  if (!tempCredentials.success) {
    return "invalid";
  }
  return tempCredentials.data;
}
