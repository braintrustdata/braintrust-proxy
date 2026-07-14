export type RemoteModelDescriptor = {
  litellm_provider?: string;
};

const BEDROCK_PREFIXES = [
  "ai21.",
  "amazon.",
  "anthropic.",
  "apac.",
  "au.",
  "cohere.",
  "eu.",
  "global.",
  "jp.",
  "meta.",
  "mistral.",
  "openai.",
  "stability.",
  "us-gov.",
  "us.",
];

function normalizeProviderName(providerName?: string): string | undefined {
  if (!providerName) {
    return undefined;
  }

  const lowerProvider = providerName.toLowerCase();

  if (lowerProvider === "xai" || lowerProvider.includes("xai")) {
    return "xai";
  }
  if (lowerProvider === "anthropic" || lowerProvider.includes("anthropic")) {
    return "anthropic";
  }
  if (lowerProvider === "openai" || lowerProvider.includes("openai")) {
    return "openai";
  }
  if (
    lowerProvider === "google" ||
    lowerProvider === "gemini" ||
    lowerProvider.includes("google") ||
    lowerProvider.includes("gemini")
  ) {
    return "google";
  }
  if (lowerProvider === "mistral" || lowerProvider.includes("mistral")) {
    return "mistral";
  }
  if (
    lowerProvider === "together" ||
    lowerProvider === "together_ai" ||
    lowerProvider.includes("together")
  ) {
    return "together";
  }
  if (lowerProvider === "groq" || lowerProvider.includes("groq")) {
    return "groq";
  }
  if (lowerProvider === "replicate" || lowerProvider.includes("replicate")) {
    return "replicate";
  }
  if (lowerProvider.includes("fireworks")) {
    return "fireworks";
  }
  if (lowerProvider === "perplexity" || lowerProvider.includes("perplexity")) {
    return "perplexity";
  }
  if (lowerProvider === "databricks" || lowerProvider.includes("databricks")) {
    return "databricks";
  }
  if (lowerProvider === "lepton" || lowerProvider.includes("lepton")) {
    return "lepton";
  }
  if (lowerProvider === "cerebras" || lowerProvider.includes("cerebras")) {
    return "cerebras";
  }
  if (lowerProvider === "baseten" || lowerProvider.includes("baseten")) {
    return "baseten";
  }
  if (lowerProvider === "bedrock" || lowerProvider.includes("bedrock")) {
    return "bedrock";
  }
  if (
    lowerProvider === "vertex" ||
    lowerProvider === "vertex_ai" ||
    lowerProvider.includes("vertex")
  ) {
    return "vertex";
  }

  return undefined;
}

function getOrderingBaseName(modelName: string): string {
  const segments = modelName.split("/");
  return (segments[segments.length - 1] || modelName).toLowerCase();
}

function getOrderingGroup(modelName: string): string {
  const baseName = getOrderingBaseName(modelName);
  const matchers = [
    /^(claude-(?:fable|opus|sonnet|haiku))/,
    /^(gpt-(?:image|audio|realtime))/,
    /^(gpt)/,
    /^(dall-e)/,
    /^(qwen|qwq)/,
    /^(kimi)/,
    /^(deepseek)/,
    /^(glm)/,
    /^(grok)/,
  ];

  for (const matcher of matchers) {
    const match = baseName.match(matcher);
    if (match) {
      return match[1];
    }
  }

  const genericMatch = baseName.match(/^[a-z]+(?:-[a-z]+)?/);
  if (genericMatch) {
    return genericMatch[0];
  }

  return baseName;
}

function extractLeadingSemanticNumbers(baseName: string): {
  semantic: number[];
  remaining: string;
} {
  const patterns = [
    /^(claude-(?:opus|sonnet|haiku)-)(\d+)(?:-(\d+))?/,
    /^(grok-)(\d+)(?:-(\d+))?/,
    /^(qwen(?:-?v?)?)(\d+)(?:[.p](\d+))?/,
    /^(kimi-k)(\d+)(?:[.p](\d+))?/,
    /^(deepseek-v)(\d+)(?:[.p](\d+))?/,
    /^(glm-)(\d+)(?:[.p](\d+))?/,
    /^(gpt(?:-(?:image|audio|realtime))?-)(\d+)(?:\.(\d+))?/,
  ];

  for (const pattern of patterns) {
    const match = baseName.match(pattern);
    if (!match || match.index !== 0) {
      continue;
    }

    const semantic = [Number(match[2])];
    if (match[3]) {
      semantic.push(Number(match[3]));
    }

    return {
      semantic,
      remaining: baseName.substring(match[0].length),
    };
  }

  return {
    semantic: [],
    remaining: baseName,
  };
}

// Collapse separated release-date stamps into the atomic YYYYMMDD / YYYYMM form
// so a full date compares as a single chronological value. Without this, the
// tokenizer buckets the year (>= 4 digits) as `dateish` and the month/day
// (<= 3 digits) as `semantic`, and `compareModelOrdering` weighs `semantic`
// before `dateish` — inverting chronology across a year boundary (e.g. a
// 2024-11 snapshot would outrank a 2025-01 one). Gated on a 20xx year so
// version pairs like `4-6` are never mistaken for a date.
function collapseDateStamps(name: string): string {
  return name
    .replace(/(?<![0-9])(20\d{2})-(\d{2})-(\d{2})(?![0-9])/g, "$1$2$3")
    .replace(/(?<![0-9])(20\d{2})-(\d{2})(?![0-9-])/g, "$1$2");
}

function getOrderingNumberGroups(modelName: string): {
  version: number[];
  semantic: number[];
  dateish: number[];
} {
  const normalized = collapseDateStamps(getOrderingBaseName(modelName)).replace(
    /(\d)p(\d)/g,
    "$1.$2",
  );
  const { semantic: version, remaining } =
    extractLeadingSemanticNumbers(normalized);
  const matches = [...remaining.matchAll(/\d+/g)];
  const semantic: number[] = [];
  const dateish: number[] = [];

  for (const match of matches) {
    const token = match[0];
    const value = Number(token);
    if (token.length >= 4) {
      dateish.push(value);
    } else {
      semantic.push(value);
    }
  }

  return { version, semantic, dateish };
}

function compareDescendingNumberLists(a: number[], b: number[]): number {
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    const aValue = a[i] ?? 0;
    const bValue = b[i] ?? 0;
    if (aValue !== bValue) {
      return bValue - aValue;
    }
  }
  return 0;
}

export function getRemoteAccessProvider(
  remoteModelName: string,
  remoteModel: RemoteModelDescriptor,
): string | undefined {
  const lowerModelName = remoteModelName.toLowerCase();

  if (
    lowerModelName.startsWith("vertex_ai/") ||
    lowerModelName.startsWith("publishers/")
  ) {
    return "vertex";
  }

  if (BEDROCK_PREFIXES.some((prefix) => lowerModelName.startsWith(prefix))) {
    return "bedrock";
  }

  if (lowerModelName.startsWith("baseten/")) {
    return "baseten";
  }

  if (
    lowerModelName.startsWith("accounts/fireworks/models/") ||
    lowerModelName.startsWith("fireworks_ai/accounts/fireworks/models/") ||
    lowerModelName.startsWith("fireworks/accounts/fireworks/models/")
  ) {
    return "fireworks";
  }

  const providerFromRemote = normalizeProviderName(
    remoteModel.litellm_provider,
  );
  if (providerFromRemote) {
    return providerFromRemote;
  }

  return normalizeProviderName(remoteModelName.split("/")[0]);
}

export function matchesProviderFilter(
  remoteModelName: string,
  remoteModel: RemoteModelDescriptor,
  providerFilter?: string,
): boolean {
  if (!providerFilter) {
    return true;
  }

  const normalizedFilter = normalizeProviderName(providerFilter);
  if (!normalizedFilter) {
    return false;
  }

  return (
    getRemoteAccessProvider(remoteModelName, remoteModel) === normalizedFilter
  );
}

export function getProviderMappingForModel(
  remoteModelName: string,
  remoteModel: RemoteModelDescriptor,
): string[] {
  const accessProvider = getRemoteAccessProvider(remoteModelName, remoteModel);

  if (accessProvider === "xai") {
    return ["xAI"];
  }
  if (accessProvider === "anthropic") {
    return ["anthropic"];
  }
  if (accessProvider === "openai") {
    return ["openai", "azure"];
  }
  if (accessProvider === "google") {
    return ["google"];
  }
  if (accessProvider === "mistral") {
    return ["mistral"];
  }
  if (accessProvider === "together") {
    return ["together"];
  }
  if (accessProvider === "groq") {
    return ["groq"];
  }
  if (accessProvider === "replicate") {
    return ["replicate"];
  }
  if (accessProvider === "fireworks") {
    return ["fireworks"];
  }
  if (accessProvider === "perplexity") {
    return ["perplexity"];
  }
  if (accessProvider === "databricks") {
    return ["databricks"];
  }
  if (accessProvider === "lepton") {
    return ["lepton"];
  }
  if (accessProvider === "cerebras") {
    return ["cerebras"];
  }
  if (accessProvider === "baseten") {
    return ["baseten"];
  }
  if (accessProvider === "bedrock") {
    return ["bedrock"];
  }
  if (accessProvider === "vertex") {
    return ["vertex"];
  }

  return [];
}

export function compareModelOrdering(a: string, b: string): number {
  const aGroup = getOrderingGroup(a);
  const bGroup = getOrderingGroup(b);

  if (aGroup !== bGroup) {
    return a.localeCompare(b);
  }

  const aNumbers = getOrderingNumberGroups(a);
  const bNumbers = getOrderingNumberGroups(b);
  const versionComparison = compareDescendingNumberLists(
    aNumbers.version,
    bNumbers.version,
  );
  if (versionComparison !== 0) {
    return versionComparison;
  }

  const semanticComparison = compareDescendingNumberLists(
    aNumbers.semantic,
    bNumbers.semantic,
  );
  if (semanticComparison !== 0) {
    return semanticComparison;
  }

  const aHasDateish = aNumbers.dateish.length > 0;
  const bHasDateish = bNumbers.dateish.length > 0;
  if (aHasDateish !== bHasDateish) {
    return aHasDateish ? 1 : -1;
  }

  const dateishComparison = compareDescendingNumberLists(
    aNumbers.dateish,
    bNumbers.dateish,
  );
  if (dateishComparison !== 0) {
    return dateishComparison;
  }

  return a.localeCompare(b);
}

export function getFallbackCompleteOrdering(
  existingModelNames: string[],
  newModelNames: string[],
): string[] {
  const allModels = [...existingModelNames];
  for (const newModel of newModelNames) {
    if (!allModels.includes(newModel)) {
      allModels.push(newModel);
    }
  }

  const touchedGroups = new Set(
    newModelNames.map((modelName) => getOrderingGroup(modelName)),
  );
  const touchedGroupModels = new Map<string, string[]>();

  for (const modelName of allModels) {
    const group = getOrderingGroup(modelName);
    if (!touchedGroups.has(group)) {
      continue;
    }

    const groupModels = touchedGroupModels.get(group) ?? [];
    groupModels.push(modelName);
    touchedGroupModels.set(group, groupModels);
  }

  for (const [group, groupModels] of touchedGroupModels) {
    touchedGroupModels.set(group, [...groupModels].sort(compareModelOrdering));
  }

  const orderedModels: string[] = [];
  const emittedGroups = new Set<string>();

  for (const modelName of allModels) {
    const group = getOrderingGroup(modelName);
    if (!touchedGroups.has(group)) {
      orderedModels.push(modelName);
      continue;
    }

    if (emittedGroups.has(group)) {
      continue;
    }

    orderedModels.push(...(touchedGroupModels.get(group) ?? []));
    emittedGroups.add(group);
  }

  return orderedModels;
}

// Ordered class (model-family group) ranking within each provider, keyed by the
// provider's primary access name (available_providers[0]). Groups are the
// prefixes produced by getOrderingGroup. A group not listed for its provider
// sorts after every listed group, keeping its existing alphabetical order.
// Providers without an entry (e.g. bedrock, whose ids group by region/vendor
// prefix rather than model class) keep their current order untouched.
export const PROVIDER_CLASS_ORDER: Record<string, string[]> = {
  anthropic: ["claude-fable", "claude-opus", "claude-sonnet", "claude-haiku"],
  openai: [
    "gpt",
    "o",
    "chatgpt",
    "gpt-audio",
    "gpt-realtime",
    "gpt-image",
    "chatgpt-image",
    "dall-e",
    "sora",
    "tts",
    "whisper",
    "omni-moderation",
    "text-moderation",
    "babbage",
    "davinci",
    "ft",
    "container",
  ],
  google: ["gemini", "gemini-pro", "gemini-embedding"],
  xAI: ["grok"],
  mistral: [
    "mistral-large",
    "mistral-medium",
    "magistral-medium",
    "codestral",
    "codestral-latest",
    "devstral-medium",
    "devstral",
    "devstral-latest",
    "devstral-small",
    "mistral-small",
    "magistral-small",
    "pixtral",
    "voxtral-small",
    "ministral",
    "mistral-tiny",
    "open-mistral",
    "open-mixtral",
    "labs-leanstral",
  ],
  perplexity: ["sonar-pro", "sonar-reasoning", "sonar-deep", "sonar"],
  vertex: [
    "gemini",
    "gemini-pro",
    "claude-fable",
    "claude-opus",
    "claude-sonnet",
    "claude-haiku",
    "mistral-large",
    "codestral",
    "gemini-embedding",
  ],
  fireworks: [
    "deepseek",
    "qwen",
    "qwq",
    "glm",
    "kimi",
    "minimax-m",
    "llama-v",
    "llama",
    "code-llama",
    "mixtral",
    "mistral",
    "gemma",
    "yi",
    "phi",
  ],
  together: [
    "deepseek",
    "qwen",
    "glm",
    "kimi",
    "llama",
    "meta-llama",
    "minimax-m",
    "gpt",
    "mistral",
    "gemma",
    "lfm",
  ],
  baseten: ["deepseek", "glm", "kimi", "gpt", "nemotron", "nvidia-nemotron"],
  groq: ["gpt", "llama", "qwen", "compound", "compound-mini"],
  cerebras: ["gpt", "zai-glm", "gemma"],
  databricks: [
    "databricks-claude",
    "databricks-gpt",
    "databricks-gemini",
    "databricks-meta",
    "databricks-llama",
    "databricks-qwen",
  ],
};

function getClassRank(order: string[] | undefined, group: string): number {
  if (!order) {
    return Number.POSITIVE_INFINITY;
  }
  const index = order.indexOf(group);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

// The de-dated base id used to glue a dated snapshot to its stable alias so
// they occupy the same interleaving slot (e.g. claude-opus-4-5 and
// claude-opus-4-5-20251101 stay adjacent within one row).
function getSlotBaseKey(name: string): string {
  const base = collapseDateStamps(getOrderingBaseName(name));
  return base.replace(/[-@](\d{8}|\d{6})$/, "");
}

// Group one family's models into slots: each slot holds a stable alias plus any
// dated snapshots of it, ordered newest-first.
function getFamilySlots(names: string[]): string[][] {
  const slots = new Map<string, string[]>();
  for (const name of [...names].sort(compareModelOrdering)) {
    const key = getSlotBaseKey(name);
    const slot = slots.get(key);
    if (slot) {
      slot.push(name);
    } else {
      slots.set(key, [name]);
    }
  }
  return [...slots.values()];
}

// Group a provider's models by family and order the families by class tier,
// then alphabetically for families outside the tier.
function orderProviderFamilies(
  provider: string,
  names: string[],
): { group: string; models: string[] }[] {
  const families = new Map<string, string[]>();
  for (const name of names) {
    const group = getOrderingGroup(name);
    const family = families.get(group);
    if (family) {
      family.push(name);
    } else {
      families.set(group, [name]);
    }
  }

  const order = PROVIDER_CLASS_ORDER[provider];
  return [...families.keys()]
    .sort((a, b) => {
      const rankA = getClassRank(order, a);
      const rankB = getClassRank(order, b);
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return a.localeCompare(b);
    })
    .map((group) => ({ group, models: families.get(group) ?? [] }));
}

// Block layout: each family stays contiguous (newest-first), families emitted
// in class-tier order. Used for providers whose families are independent
// version series (e.g. openai gpt/o/image) rather than parallel tiers.
function blockProviderFamilies(provider: string, names: string[]): string[] {
  const ordered: string[] = [];
  for (const { models } of orderProviderFamilies(provider, names)) {
    ordered.push(...[...models].sort(compareModelOrdering));
  }
  return ordered;
}

// Interleave layout: column-major across families — the newest slot of every
// family (in class-tier order) first, then the next slot of each, and so on.
// Snapshots stay glued to their alias within a slot. Used for providers with
// genuine parallel tiers released as generations (e.g. anthropic
// fable/opus/sonnet/haiku).
function interleaveProviderFamilies(
  provider: string,
  names: string[],
): string[] {
  const slotsByFamily = orderProviderFamilies(provider, names).map(
    ({ models }) => getFamilySlots(models),
  );
  const rowCount = Math.max(0, ...slotsByFamily.map((slots) => slots.length));

  const ordered: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (const slots of slotsByFamily) {
      if (row < slots.length) {
        ordered.push(...slots[row]);
      }
    }
  }
  return ordered;
}

export function getPrimaryProvider(spec: {
  available_providers?: readonly string[] | null;
}): string | undefined {
  return spec.available_providers?.[0];
}

// Providers whose families are genuine parallel tiers released as generations,
// so they read best interleaved column-major (newest of each tier together).
// Every other tiered provider keeps each family as a contiguous version-series
// block.
const INTERLEAVE_PROVIDERS = new Set(["anthropic"]);

// Full catalog ordering: partition models into provider blocks (by their
// primary access provider, in first-appearance order). Within a block that has
// a class tier, either interleave the families column-major (parallel-tier
// providers) or lay each family out as a contiguous newest-first block, with
// families in class-tier order. Blocks for providers without a tier (bedrock,
// or models with no providers) keep their existing relative order.
export function orderModelsByProviderAndClass(
  catalog: Record<string, { available_providers?: readonly string[] | null }>,
): string[] {
  const noProviderKey = " no-provider";
  const providerOrder: string[] = [];
  const blocks = new Map<string, string[]>();

  for (const name of Object.keys(catalog)) {
    const provider = getPrimaryProvider(catalog[name]) ?? noProviderKey;
    const existing = blocks.get(provider);
    if (existing) {
      existing.push(name);
    } else {
      blocks.set(provider, [name]);
      providerOrder.push(provider);
    }
  }

  const ordered: string[] = [];
  for (const provider of providerOrder) {
    const names = blocks.get(provider) ?? [];
    if (provider !== noProviderKey && PROVIDER_CLASS_ORDER[provider]) {
      ordered.push(
        ...(INTERLEAVE_PROVIDERS.has(provider)
          ? interleaveProviderFamilies(provider, names)
          : blockProviderFamilies(provider, names)),
      );
    } else {
      ordered.push(...names);
    }
  }

  return ordered;
}
