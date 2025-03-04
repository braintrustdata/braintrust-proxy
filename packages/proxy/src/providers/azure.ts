import { z } from "zod";
import { FullAzureEntraMetadataSchema } from "@braintrust/proxy/schema";

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

export async function getAzureEntraAccessToken(
  secret: z.infer<typeof FullAzureEntraMetadataSchema>,
): Promise<string> {
  if (!secret.metadata) {
    throw new Error("Azure Entra secret must have metadata");
  }
  const { client_id, tenant_id, scope } = secret.metadata;
  const tokenUrl = `https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id,
    tenant: tenant_id,
    scope,
    grant_type: "client_credentials",
    client_secret: secret.secret,
  });
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
  console.log("parsed", parsed.access_token);
  return parsed.access_token;
}
