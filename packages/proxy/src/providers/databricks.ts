import { z } from "zod";
import { DatabricksOAuthSecretSchema } from "@braintrust/proxy/schema";

const databricksOAuthResponseSchema = z.union([
  z.object({
    access_token: z.string(),
    token_type: z.literal("Bearer"),
    expires_in: z.number(),
  }),
  z.object({
    error: z.string(),
  }),
]);

export async function getDatabricksOAuthAccessToken({
  secret,
  apiBase,
  digest,
  cacheGet,
  cachePut,
}: {
  secret: z.infer<typeof DatabricksOAuthSecretSchema>;
  apiBase: string;
  digest: (message: string) => Promise<string>;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>;
}): Promise<string> {
  const { client_id, client_secret } = secret;
  const tokenUrl = `${apiBase}/oidc/v1/token`;

  const cachePath = await digest(`${client_id}:${client_secret}:${apiBase}`);
  const cacheKey = `aiproxy/proxy/databricks/${cachePath}`;
  const encryptionKey = await digest(`${cachePath}:${client_secret}`);

  const cached = await cacheGet(encryptionKey, cacheKey);
  if (cached) {
    return cached;
  }

  // Create credentials for basic auth.
  const credentials = Buffer.from(`${client_id}:${client_secret}`).toString(
    "base64",
  );
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "all-apis",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Databricks OAuth error (${res.status}): ${res.statusText} ${await res.text()}`,
    );
  }

  const data = await res.json();
  const parsed = databricksOAuthResponseSchema.parse(data);
  if ("error" in parsed) {
    throw new Error(`Databricks OAuth error: ${parsed.error}`);
  }

  // Give it a 1 minute buffer.
  const cacheTtl = Math.max(parsed.expires_in - 60, 0);
  if (cacheTtl > 0) {
    await cachePut(encryptionKey, cacheKey, parsed.access_token, cacheTtl);
  }

  return parsed.access_token;
}
