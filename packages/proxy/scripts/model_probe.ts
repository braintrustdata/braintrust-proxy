import https from "https";
import { z } from "zod";
import type { ProviderSecret } from "./braintrust_secrets";

// Per-provider model-list and direct-probe adapters used by the deprecation
// audit. Probes hit the provider directly (not the gateway) because the gateway
// returns control-plane-lag 404s for new models that are not yet provisioned —
// the provider's own response is the authoritative signal for deprecation.

export type ProbeOutcome = "active" | "deprecated" | "transient" | "unknown";

type HttpResult = { status: number; body: string };

function request(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

const RATE_LIMIT_STATUS = new Set([429, 503, 529]);
const TRANSIENT_TEXT =
  /rate[\s_-]?limit|too many requests|overloaded|quota exceeded|temporarily unavailable|service unavailable|try again/i;
// Markers that a model id was rejected because it does not exist / was retired.
const DEPRECATED_TEXT =
  /not[\s_-]?found|does not exist|no longer available|has been deprecated|decommission|model_not_found|invalid model|unknown model|unsupported model|is not supported/i;
// Markers that the model EXISTS but is not usable from chat/completions (image,
// audio, realtime, embeddings, responses-only models). These must NOT be
// treated as deprecations even though they often come back as 404/400.
const WRONG_ENDPOINT_TEXT =
  /not a chat model|chat completions are not supported|v1\/(completions|responses|audio|embeddings|images|realtime)|only supports streaming|must be at least/i;

// Classify a direct-provider probe. A single definitive not-found / deprecated
// response marks the model deprecated; rate-limit / overload / network noise is
// transient (never deprecate); anything else is unknown (inconclusive).
export function classifyProbe(status: number, body: string): ProbeOutcome {
  if (status >= 200 && status < 300) {
    return "active";
  }
  if (RATE_LIMIT_STATUS.has(status) || TRANSIENT_TEXT.test(body)) {
    return "transient";
  }
  // The model exists but is the wrong modality / endpoint for a chat probe —
  // not a deprecation. Check this before the not-found rules below.
  if (WRONG_ENDPOINT_TEXT.test(body)) {
    return "unknown";
  }
  // 404 is always a missing model. 400/403/410 only when the body says so, to
  // avoid mistaking an unrelated bad-request for a deprecation.
  if (status === 404 || status === 410) {
    return "deprecated";
  }
  if (
    (status === 400 || status === 403 || status === 422) &&
    DEPRECATED_TEXT.test(body)
  ) {
    return "deprecated";
  }
  return "unknown";
}

const listSchema = z
  .object({
    data: z.array(z.object({ id: z.string() }).passthrough()).optional(),
    models: z.array(z.object({ name: z.string() }).passthrough()).optional(),
    endpoints: z.array(z.object({ name: z.string() }).passthrough()).optional(),
  })
  .passthrough();

// OpenAI-compatible /models responses come back either as { data: [{id}] } or,
// for some providers (e.g. Together), as a bare array of { id }.
function extractOpenAiModelIds(body: string): Set<string> {
  const json: unknown = JSON.parse(body);
  const arr = Array.isArray(json) ? json : listSchema.parse(json).data ?? [];
  const ids = new Set<string>();
  for (const entry of arr) {
    if (entry && typeof entry === "object" && "id" in entry) {
      const id = (entry as { id: unknown }).id;
      if (typeof id === "string" && id) {
        ids.add(id);
      }
    }
  }
  return ids;
}

function metaApiBase(secret: ProviderSecret, fallback: string): string {
  const base = secret.metadata?.api_base;
  return (typeof base === "string" && base ? base : fallback).replace(
    /\/$/,
    "",
  );
}

export type ProviderApi = {
  // Live model-id set from the provider's list endpoint, or null if none.
  listModels: ((secret: ProviderSecret) => Promise<Set<string>>) | null;
  // Direct single-model probe, or null when only the list is authoritative.
  probeModel:
    | ((secret: ProviderSecret, modelId: string) => Promise<HttpResult>)
    | null;
  // When true, absence from listModels alone is treated as deprecated (no probe
  // needed because the list is authoritative for what is currently served).
  listIsAuthoritative?: boolean;
};

// OpenAI-compatible providers: GET /models to list, POST /chat/completions to
// probe. The list narrows the probe set; the direct probe confirms.
function openAiCompatible(defaultBase: string): ProviderApi {
  return {
    listModels: async (secret) => {
      const base = metaApiBase(secret, defaultBase);
      const { status, body } = await request("GET", `${base}/models`, {
        authorization: `Bearer ${secret.secret}`,
      });
      if (status >= 400) {
        throw new Error(
          `list ${base}/models -> HTTP ${status}: ${body.slice(0, 160)}`,
        );
      }
      return extractOpenAiModelIds(body);
    },
    probeModel: async (secret, modelId) => {
      const base = metaApiBase(secret, defaultBase);
      return request(
        "POST",
        `${base}/chat/completions`,
        {
          authorization: `Bearer ${secret.secret}`,
          "content-type": "application/json",
        },
        JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 16,
        }),
      );
    },
  };
}

const ANTHROPIC_VERSION = "2023-06-01";

// Provider id (catalog ModelEndpointType) -> adapter. Providers absent from
// this map (bedrock, vertex) have no automated source and are report-only.
export const PROVIDER_APIS: Record<string, ProviderApi> = {
  openai: openAiCompatible("https://api.openai.com/v1"),
  together: openAiCompatible("https://api.together.xyz/v1"),
  fireworks: openAiCompatible("https://api.fireworks.ai/inference/v1"),
  groq: openAiCompatible("https://api.groq.com/openai/v1"),
  xAI: openAiCompatible("https://api.x.ai/v1"),
  mistral: openAiCompatible("https://api.mistral.ai/v1"),
  cerebras: openAiCompatible("https://api.cerebras.ai/v1"),
  baseten: openAiCompatible("https://inference.baseten.co/v1"),
  // Perplexity has no public /models list, but its chat endpoint probes fine.
  perplexity: {
    listModels: null,
    probeModel: async (secret, modelId) =>
      request(
        "POST",
        "https://api.perplexity.ai/chat/completions",
        {
          authorization: `Bearer ${secret.secret}`,
          "content-type": "application/json",
        },
        JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 16,
        }),
      ),
  },
  anthropic: {
    listModels: async (secret) => {
      const { status, body } = await request(
        "GET",
        "https://api.anthropic.com/v1/models?limit=1000",
        { "x-api-key": secret.secret, "anthropic-version": ANTHROPIC_VERSION },
      );
      if (status >= 400) {
        throw new Error(
          `list anthropic models -> HTTP ${status}: ${body.slice(0, 160)}`,
        );
      }
      const parsed = listSchema.parse(JSON.parse(body));
      return new Set((parsed.data ?? []).map((m) => m.id));
    },
    probeModel: async (secret, modelId) =>
      request(
        "POST",
        "https://api.anthropic.com/v1/messages",
        {
          "x-api-key": secret.secret,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        JSON.stringify({
          model: modelId,
          max_tokens: 16,
          messages: [{ role: "user", content: "ok" }],
        }),
      ),
  },
  google: {
    listModels: async (secret) => {
      const { status, body } = await request(
        "GET",
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${secret.secret}`,
        {},
      );
      if (status >= 400) {
        throw new Error(
          `list google models -> HTTP ${status}: ${body.slice(0, 160)}`,
        );
      }
      const parsed = listSchema.parse(JSON.parse(body));
      // Names come back as "models/gemini-..."; the catalog stores the bare id.
      return new Set(
        (parsed.models ?? []).map((m) => m.name.replace(/^models\//, "")),
      );
    },
    probeModel: async (secret, modelId) =>
      request(
        "POST",
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelId,
        )}:generateContent?key=${secret.secret}`,
        { "content-type": "application/json" },
        JSON.stringify({ contents: [{ parts: [{ text: "ok" }] }] }),
      ),
  },
  // Databricks serving-endpoints is the authoritative deployed-model list for
  // the workspace; absence means the endpoint is gone. No direct probe needed.
  databricks: {
    listIsAuthoritative: true,
    probeModel: null,
    listModels: async (secret) => {
      const base = metaApiBase(secret, "");
      if (!base) {
        throw new Error("databricks secret missing api_base metadata");
      }
      const { status, body } = await request(
        "GET",
        `${base}/api/2.0/serving-endpoints`,
        { authorization: `Bearer ${secret.secret}` },
      );
      if (status >= 400) {
        throw new Error(
          `list databricks endpoints -> HTTP ${status}: ${body.slice(0, 160)}`,
        );
      }
      const parsed = listSchema.parse(JSON.parse(body));
      return new Set((parsed.endpoints ?? []).map((e) => e.name));
    },
  },
};

// Providers whose model availability is account / region / workspace scoped, so
// absence from one account's view is NOT a global deprecation signal:
//   - bedrock / vertex: no simple global list and region/account gated
//   - databricks: serving-endpoints is per-workspace
//   - fireworks: serverless deployments are account-scoped — current models
//     (deepseek-v3, glm-5, kimi-k2 ...) report "not deployed" when simply not
//     provisioned on this account, which is not a deprecation
// These are surfaced for manual review rather than auto-deprecated.
export const REPORT_ONLY_PROVIDERS = new Set([
  "bedrock",
  "vertex",
  "databricks",
  "fireworks",
]);
