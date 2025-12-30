import { z } from "zod/v3";
import { AzureEntraSecretSchema } from "@braintrust/proxy/schema";

const azureEntraResponseSchema = z.union([
  z.object({
    access_token: z.string(),
    token_type: z.literal("Bearer"),
    expires_in: z.number(),
  }),
  z.object({
    error: z.string(),
  }),
]);

export async function getAzureEntraAccessToken({
  secret,
  digest,
  cacheGet,
  cachePut,
}: {
  secret: z.infer<typeof AzureEntraSecretSchema>;
  digest: (message: string) => Promise<string>;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>;
}): Promise<string> {
  const { client_id, tenant_id, scope, client_secret } = secret;
  const tokenUrl = `https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id,
    tenant: tenant_id,
    scope,
    grant_type: "client_credentials",
    client_secret,
  });

  const cachePath = await digest(
    `${client_id}:${tenant_id}:${scope}:${client_secret}`,
  );
  const cacheKey = `aiproxy/proxy/entra/${cachePath}`;
  const encryptionKey = await digest(`${cachePath}:${client_secret}`);

  const cached = await cacheGet(encryptionKey, cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Azure Entra error (${res.status}): ${res.statusText} ${await res.text()}`,
    );
  }
  const data = await res.json();
  const parsed = azureEntraResponseSchema.parse(data);
  if ("error" in parsed) {
    throw new Error(`Azure Entra error: ${parsed.error}`);
  }

  // Give it a 1 minute buffer.
  const cacheTtl = Math.max(parsed.expires_in - 60, 0);
  if (cacheTtl > 0) {
    await cachePut(encryptionKey, cacheKey, parsed.access_token, cacheTtl);
  }
  return parsed.access_token;
}
