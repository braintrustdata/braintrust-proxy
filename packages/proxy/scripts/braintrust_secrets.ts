import https from "https";
import { z } from "zod";

// Centralized secret access: every model-list / verification flow authenticates
// with a SINGLE Braintrust API key and pulls the underlying provider secrets
// (and their metadata, e.g. api_base) from the Braintrust control plane's
// /api/secret endpoint. This avoids sprawling per-provider env vars in CI.

const BRAINTRUST_API_URL =
  process.env.BRAINTRUST_API_URL ?? "https://api.braintrust.dev";

const providerSecretSchema = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    secret: z.string().optional(),
    metadata: z.record(z.unknown()).nullish(),
  })
  .passthrough();

const providerSecretListSchema = z.array(providerSecretSchema);

export type ProviderSecret = {
  type: string;
  secret: string;
  metadata: Record<string, unknown>;
};

export function resolveBraintrustApiKey(explicitApiKey?: string): string {
  const apiKey = explicitApiKey ?? process.env.BRAINTRUST_CI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing API key. Pass --api-key or set BRAINTRUST_CI_API_KEY.",
    );
  }
  return apiKey;
}

function postJson(
  url: string,
  apiKey: string,
  payload: unknown,
): Promise<string> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `Braintrust /api/secret returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`,
              ),
            );
            return;
          }
          resolve(data);
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Fetch provider secrets for the given provider types from Braintrust, keyed by
// provider type. Only entries with a non-empty secret are returned. When a type
// has multiple secrets configured, the first one is used.
export async function fetchProviderSecrets(
  braintrustApiKey: string,
  types: string[],
): Promise<Map<string, ProviderSecret>> {
  if (types.length === 0) {
    return new Map();
  }
  const raw = await postJson(
    `${BRAINTRUST_API_URL}/api/secret`,
    braintrustApiKey,
    {
      mode: "full",
      types,
    },
  );
  let parsed: z.infer<typeof providerSecretListSchema>;
  try {
    parsed = providerSecretListSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `Failed to parse Braintrust /api/secret response: ${(error as Error).message}`,
    );
  }

  const byType = new Map<string, ProviderSecret>();
  for (const entry of parsed) {
    if (!entry.type || !entry.secret) {
      continue;
    }
    if (byType.has(entry.type)) {
      continue;
    }
    byType.set(entry.type, {
      type: entry.type,
      secret: entry.secret,
      metadata: (entry.metadata as Record<string, unknown>) ?? {},
    });
  }
  return byType;
}
