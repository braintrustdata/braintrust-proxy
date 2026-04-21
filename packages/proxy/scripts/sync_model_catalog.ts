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
    /^(claude-(?:opus|sonnet|haiku))/,
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

function getOrderingNumberGroups(modelName: string): {
  version: number[];
  semantic: number[];
  dateish: number[];
} {
  const normalized = getOrderingBaseName(modelName).replace(
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
