import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ModelSchema } from "../schema/models";
import {
  effectiveProviders,
  parseIndexEndpointTypes,
} from "./reconcile_provider_models";

const capability = z.enum([
  "multimodal",
  "o1_like",
  "reasoning",
  "reasoning_budget",
  "supports_streaming",
  "supports_decisions",
  "streaming_only",
]);
const evidenceSchema = z.array(
  z.object({
    model: z.string().min(1),
    provider: z.string().min(1),
    surface: z.string().trim().min(1),
    capability,
    supported: z.boolean(),
    source: z.string().url().startsWith("https://"),
    quote: z.string().trim().min(1),
  }),
);
type Capability = z.infer<typeof capability>;
type Catalog = Record<
  string,
  Partial<Record<Capability, boolean | null>> & {
    available_providers?: string[] | null;
  }
>;
type ProviderMappings = { before: string; after: string };

const priceKeys = Object.keys(ModelSchema.shape).filter((key) =>
  /_cost_per_(?:mil_)?tokens?$/.test(key),
);
const priceEvidenceSchema = z.array(
  z.object({
    model: z.string().min(1),
    provider: z.string().min(1),
    surface: z.string().trim().min(1),
    field: z.string(),
    value: z.number().nonnegative(),
    source: z.string().url().startsWith("https://"),
    quote: z.string().trim().min(1),
  }),
);
const providerSourceDomains = new Map<string, string[]>([
  ["anthropic", ["anthropic.com", "claude.com"]],
  ["azure", ["azure.com", "microsoft.com"]],
  ["baseten", ["baseten.co"]],
  ["bedrock", ["aws.amazon.com"]],
  ["cerebras", ["cerebras.ai"]],
  ["databricks", ["databricks.com"]],
  ["fireworks", ["fireworks.ai"]],
  ["google", ["ai.google.dev", "ai.google"]],
  ["groq", ["groq.com"]],
  ["mistral", ["mistral.ai"]],
  ["openai", ["openai.com"]],
  ["openrouter", ["openrouter.ai"]],
  ["perplexity", ["perplexity.ai"]],
  ["together", ["together.ai", "together.xyz"]],
  ["vertex", ["cloud.google.com"]],
  ["xAI", ["x.ai"]],
]);

function isProviderHost(host: string, provider: string): boolean {
  return (
    providerSourceDomains
      .get(provider)
      ?.some((domain) => host === domain || host.endsWith(`.${domain}`)) ??
    false
  );
}

type PricingCatalog = Record<
  string,
  Record<string, unknown> & {
    available_providers?: string[] | null;
    displayName?: string | null;
  }
>;

export function readEvidenceFile(filePath: string | undefined): unknown {
  if (!filePath || !existsSync(filePath)) return [];
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function quoteNames(quote: string, name: string): boolean {
  const literal = name.trim().replace(/\s+/g, " ");
  if (!literal) return false;
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w/:-])${escaped}(?![\\w/-]|[.:]\\w)`, "i").test(
    quote,
  );
}

function quoteHasPrice(quote: string, value: number): boolean {
  const amounts = quote.matchAll(
    /(?:\$|\bUSD)\s*(\d+(?:,\d{3})*(?:\.\d+)?)(?!\d|[.,]\d)/gi,
  );
  return Array.from(amounts).some(
    ([, amount]) => Number(amount.replace(/,/g, "")) === value,
  );
}

export function checkModelPrices(
  before: PricingCatalog,
  after: PricingCatalog,
  rawEvidence: unknown,
  providerMappings: ProviderMappings,
): void {
  const evidence = priceEvidenceSchema.parse(rawEvidence);
  const beforeIndex = parseIndexEndpointTypes(providerMappings.before);
  const afterIndex = parseIndexEndpointTypes(providerMappings.after);
  for (const [model, entry] of Object.entries(after)) {
    const previous = before[model];
    const previousProviders = effectiveProviders(
      model,
      { available_providers: previous?.available_providers ?? undefined },
      beforeIndex,
    );
    const providers = effectiveProviders(
      model,
      { available_providers: entry.available_providers ?? undefined },
      afterIndex,
    );
    for (const field of priceKeys) {
      const value = entry[field];
      if (value == null) continue;
      const unchanged = value === previous?.[field];
      if (
        providers.length === 0 &&
        (!unchanged || previousProviders.length > 0)
      ) {
        throw new Error(`${model}: no provider to verify ${field} against`);
      }
      for (const provider of providers) {
        if (unchanged && previousProviders.includes(provider)) continue;
        const verified = evidence.some((claim) => {
          if (
            claim.model !== model ||
            claim.provider !== provider ||
            claim.field !== field ||
            claim.value !== value
          ) {
            return false;
          }
          if (!isProviderHost(new URL(claim.source).hostname, provider)) {
            return false;
          }

          const quote = claim.quote.replace(/\s+/g, " ");
          return (
            (provider !== "fireworks" ||
              claim.surface.toLowerCase() === "serverless") &&
            (quoteNames(quote, model) ||
              (entry.displayName != null &&
                quoteNames(quote, entry.displayName))) &&
            quoteNames(quote, claim.surface) &&
            quoteHasPrice(quote, claim.value)
          );
        });
        if (!verified) {
          throw new Error(
            `${model} @ ${provider}: missing exact-provider pricing evidence for ${field}; omit the unverified price`,
          );
        }
      }
    }
  }
}

type CapabilityClaim = z.infer<typeof evidenceSchema>[number];

const capabilityPhrase: Record<Capability, string> = {
  multimodal: "(?:images? as (?:an? )?inputs?|(?:text and )?image inputs?)",
  o1_like: "(?:(?:extended )?thinking|reasoning)(?: tokens)?",
  reasoning: "(?:(?:extended )?thinking|reasoning)(?: tokens)?",
  reasoning_budget:
    "(?:(?:reasoning|thinking)(?: token)? budgets?|budget_tokens|thinking_budget)",
  supports_streaming: "(?:native )?streaming(?: responses?)?",
  supports_decisions: "(?:the )?(?:POST )?/v1/decisions(?: endpoint)?",
  streaming_only: "streaming(?: to be enabled)?",
};

function normalizeQuote(text: string): string {
  return text
    .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[`"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]$/, "");
}

function quoteSupportsClaim(claim: CapabilityClaim, quote: string): boolean {
  if (!quote.startsWith(`${claim.model} `)) return false;
  const assertion = quote.slice(claim.model.length + 1);
  const verb = claim.capability === "streaming_only" ? "require" : "support";
  const verbPhrase = claim.supported
    ? claim.capability === "multimodal"
      ? "(?:supports|accepts)"
      : `${verb}s`
    : `(?:does not|doesn't|doesn’t) ${verb}`;
  const surface =
    claim.provider === "fireworks" ? " on (?:Fireworks )?Serverless" : "";
  return new RegExp(
    `^${verbPhrase} ${capabilityPhrase[claim.capability]}${surface}$`,
    "i",
  ).test(assertion);
}

function sourceStatements(body: string): string[] {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:p|div|li|section|tr|br|h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .split(/\r?\n\s*\r?\n|(?<=[.!?])\s+/)
    .map(normalizeQuote);
}

function capabilitySourceLoader(): (
  source: string,
  provider: string,
) => Promise<Set<string> | undefined> {
  const cache = new Map<string, Promise<Set<string> | undefined>>();
  async function load(source: string, provider: string) {
    let url = new URL(source);
    const signal = AbortSignal.timeout(15_000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        !isProviderHost(url.hostname, provider)
      ) {
        return undefined;
      }
      const response = await fetch(url, { redirect: "manual", signal });
      if (response.ok) return new Set(sourceStatements(await response.text()));
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return undefined;
      }
      url = new URL(location, url);
    }
    return undefined;
  }
  return (source, provider) => {
    const key = `${provider} ${source}`;
    let result = cache.get(key);
    if (!result) {
      result = load(source, provider).catch(() => undefined);
      cache.set(key, result);
    }
    return result;
  };
}

export async function checkModelCapabilities(
  before: Catalog,
  after: Catalog,
  rawEvidence: unknown,
  structuredSupport: (
    model: string,
    provider: string,
    capability: Capability,
  ) => Promise<boolean | undefined>,
  providerMappings: ProviderMappings = {
    before: "",
    after: "",
  },
): Promise<void> {
  const evidence = evidenceSchema.parse(rawEvidence);
  const loadSource = capabilitySourceLoader();
  async function hasEvidence(claims: CapabilityClaim[], supported: boolean) {
    for (const claim of claims) {
      if (claim.supported !== supported) continue;
      const quote = normalizeQuote(claim.quote);
      if (!quoteSupportsClaim(claim, quote)) continue;
      if ((await loadSource(claim.source, claim.provider))?.has(quote)) {
        return true;
      }
    }
    return false;
  }
  const beforeIndex = parseIndexEndpointTypes(providerMappings.before);
  const afterIndex = parseIndexEndpointTypes(providerMappings.after);
  for (const [model, entry] of Object.entries(after)) {
    const previous = before[model];
    const previousProviders = effectiveProviders(
      model,
      { available_providers: previous?.available_providers ?? undefined },
      beforeIndex,
    );
    const providers = effectiveProviders(
      model,
      { available_providers: entry.available_providers ?? undefined },
      afterIndex,
    );
    for (const flag of capability.options) {
      if (entry[flag] !== true) continue;
      for (const provider of providers) {
        if (previous?.[flag] === true && previousProviders.includes(provider)) {
          continue;
        }
        const claims = evidence.filter(
          (claim) =>
            claim.model === model &&
            claim.provider === provider &&
            claim.capability === flag &&
            (provider !== "fireworks" ||
              claim.surface.toLowerCase() === "serverless"),
        );
        const structured = await structuredSupport(model, provider, flag);
        if (structured === false || (await hasEvidence(claims, false))) {
          throw new Error(`${model} @ ${provider}: ${flag} is unsupported`);
        }
        if (structured !== true && !(await hasEvidence(claims, true))) {
          throw new Error(
            `${model} @ ${provider}: missing exact-provider evidence for ${flag}`,
          );
        }
      }
      if (
        providers.length === 0 &&
        (previous?.[flag] !== true || previousProviders.length > 0)
      ) {
        throw new Error(`${model}: no provider to verify ${flag} against`);
      }
    }
  }
}

async function fireworksCapability(
  model: string,
): Promise<boolean | undefined> {
  if (!/^accounts\/[^/]+\/models\/[^/]+$/.test(model)) return undefined;
  const path = model.split("/").map(encodeURIComponent).join("/");
  const key = process.env.FIREWORKS_API_KEY;
  if (key) {
    const response = await fetch(`https://api.fireworks.ai/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const metadata = z
        .object({ supportsImageInput: z.boolean().optional() })
        .parse(await response.json());
      if (metadata.supportsImageInput !== undefined) {
        return metadata.supportsImageInput;
      }
    }
  }
  const [, account, , slug] = path.split("/");
  const card = await fetch(`https://fireworks.ai/models/${account}/${slug}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!card.ok) return undefined;
  const html = await card.text();
  if (!html.includes(`"modelApiName\\":\\"${model}\\"`)) return undefined;
  const imageInput =
    /Supporting image input<\/span><\/div><div[^>]*><span[^>]*>(Supported|Not Supported)<\/span>/.exec(
      html,
    );
  return imageInput ? imageInput[1] === "Supported" : undefined;
}

const modelMetadata = z.object({
  id: z.string(),
  input_modalities: z.array(z.string()).optional(),
  supported_features: z.array(z.string()).optional(),
  supported_parameters: z.array(z.string()).optional(),
  architecture: z
    .object({ input_modalities: z.array(z.string()).optional() })
    .optional(),
  capabilities: z
    .object({
      vision: z.boolean().optional(),
      reasoning: z.boolean().optional(),
    })
    .optional(),
});

const capabilityModelLists = new Map([
  [
    "baseten",
    { url: "https://inference.baseten.co/v1/models", key: "BASETEN_API_KEY" },
  ],
  [
    "groq",
    { url: "https://api.groq.com/openai/v1/models", key: "GROQ_API_KEY" },
  ],
  [
    "xAI",
    {
      url: "https://api.x.ai/v1/language-models",
      key: "XAI_API_KEY",
      list: "models",
    },
  ],
  ["cerebras", { url: "https://api.cerebras.ai/public/v1/models" }],
  ["openrouter", { url: "https://openrouter.ai/api/v1/models" }],
]);

export function providerCapabilityLookup() {
  type Metadata = z.infer<typeof modelMetadata>;
  const cache = new Map<string, Promise<Map<string, Metadata> | undefined>>();
  async function load(provider: string) {
    const endpoint = capabilityModelLists.get(provider);
    if (!endpoint) return undefined;
    const key = endpoint.key ? process.env[endpoint.key] : undefined;
    if (endpoint.key && !key) return undefined;
    const response = await fetch(endpoint.url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    const list = (await response.json())[endpoint.list ?? "data"];
    if (!Array.isArray(list)) return undefined;
    const models = new Map<string, Metadata>();
    for (const item of list) {
      const model = modelMetadata.safeParse(item);
      if (model.success) models.set(model.data.id, model.data);
    }
    return models;
  }
  return async (model: string, provider: string, flag: Capability) => {
    if (provider === "fireworks" && flag === "multimodal") {
      return fireworksCapability(model);
    }
    if (flag !== "multimodal" && flag !== "reasoning" && flag !== "o1_like") {
      return undefined;
    }
    if (provider === "xAI" && flag !== "multimodal") return undefined;
    let result = cache.get(provider);
    if (!result) {
      result = load(provider).catch(() => undefined);
      cache.set(provider, result);
    }
    const metadata = (await result)?.get(model);
    if (!metadata) return undefined;
    if (provider === "cerebras") {
      return flag === "multimodal"
        ? metadata.capabilities?.vision
        : metadata.capabilities?.reasoning;
    }
    if (provider === "openrouter") {
      return flag === "multimodal"
        ? metadata.architecture?.input_modalities?.includes("image")
        : metadata.supported_parameters?.some(
            (parameter) =>
              parameter === "reasoning" || parameter === "reasoning_effort",
          );
    }
    return flag === "multimodal"
      ? metadata.input_modalities?.includes("image")
      : metadata.supported_features?.includes("reasoning");
  };
}

const executionSchema = z.array(
  z.object({
    type: z.string(),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    error: z.unknown().optional(),
    message: z
      .object({
        content: z.union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              is_error: z.boolean().optional(),
            }),
          ),
        ]),
      })
      .optional(),
  }),
);

export function checkModelResearch(execution: unknown): void {
  const messages = executionSchema.parse(execution);
  for (const message of messages) {
    if (
      message.is_error ||
      message.error ||
      (Array.isArray(message.message?.content) &&
        message.message.content.some((block) => block.is_error))
    ) {
      throw new Error(
        "Model research encountered an API or tool error; inspect the Claude execution report before retrying.",
      );
    }
  }
  const result = messages.find((message) => message.type === "result");
  if (result?.subtype !== "success" || result.is_error !== false) {
    throw new Error("Model research did not complete successfully.");
  }
}

async function main(): Promise<void> {
  const executionFile = process.env.EXECUTION_FILE;
  if (!executionFile) {
    throw new Error(
      "Missing Claude execution file; cannot verify model research.",
    );
  }
  checkModelResearch(JSON.parse(readFileSync(executionFile, "utf8")));
  const catalog = "packages/proxy/schema/model_list.json";
  const index = "packages/proxy/schema/index.ts";
  const readHead = (path: string) =>
    execFileSync("git", ["show", `HEAD:${path}`], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  const priceEvidenceFile = process.env.PRICE_EVIDENCE_FILE;
  if (priceEvidenceFile) {
    checkModelPrices(
      JSON.parse(readHead(catalog)),
      JSON.parse(readFileSync(catalog, "utf8")),
      readEvidenceFile(priceEvidenceFile),
      { before: readHead(index), after: readFileSync(index, "utf8") },
    );
  }
  const evidenceFile = process.env.CAPABILITY_EVIDENCE_FILE;
  if (evidenceFile) {
    await checkModelCapabilities(
      JSON.parse(readHead(catalog)),
      JSON.parse(readFileSync(catalog, "utf8")),
      readEvidenceFile(evidenceFile),
      providerCapabilityLookup(),
      { before: readHead(index), after: readFileSync(index, "utf8") },
    );
  }
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
