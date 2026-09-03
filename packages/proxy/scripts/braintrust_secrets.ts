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

// Whether a secret serves the provider's shared/default models. A custom-only
// endpoint (its own api_base plus customModels and excludeDefaultModels) points
// at a different inference surface than the canonical provider, so probing the
// shared catalog's models against it returns spurious not-found responses. The
// model-list / deprecation audit must therefore not select such a secret. This
// mirrors the gateway's routing-secret eligibility rule (braintrust #19487).
export function secretServesDefaultModels(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const meta = metadata ?? {};
  const customModels = meta.customModels;
  const hasCustomModels =
    typeof customModels === "object" &&
    customModels !== null &&
    !Array.isArray(customModels) &&
    Object.keys(customModels).length > 0;
  return !(hasCustomModels && meta.excludeDefaultModels === true);
}

// Collapse the raw /api/secret entries to one secret per provider type. Only
// entries with a non-empty secret are considered. When a type has multiple
// secrets configured, the first one that serves the provider's default models
// is used; custom-only endpoints are skipped so they cannot shadow the real
// provider key and cause false deprecations. A type with no eligible secret is
// left absent (the provider is then skipped by the audit rather than misprobed).
export function selectProviderSecretsByType(
  entries: z.infer<typeof providerSecretListSchema>,
): Map<string, ProviderSecret> {
  const byType = new Map<string, ProviderSecret>();
  for (const entry of entries) {
    if (!entry.type || !entry.secret) {
      continue;
    }
    if (byType.has(entry.type)) {
      continue;
    }
    if (!secretServesDefaultModels(entry.metadata)) {
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

// Fetch provider secrets for the given provider types from Braintrust, keyed by
// provider type. See selectProviderSecretsByType for the per-type selection rule.
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

  return selectProviderSecretsByType(parsed);
}
