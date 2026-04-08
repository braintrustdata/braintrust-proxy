type SupportedProvider = "openai" | "anthropic" | "google" | "vertex";

type ModelSyncFilterOptions = {
  provider?: string;
  remoteProvider?: string;
  filterRegex?: RegExp | null;
  majorOnly?: boolean;
  translatedModelName: string;
  remoteModelName: string;
};

type ExplicitExcludeList = {
  exact?: string[];
  prefixes?: string[];
  suffixes?: string[];
  contains?: string[];
};

// These are a bunch of old models that we haven't included yet. Let's continue
// to exclude them unless we have a reason not to.
const MAJOR_ONLY_EXCLUDE_LISTS: Record<SupportedProvider, ExplicitExcludeList> =
  {
    openai: {
      exact: [
        "babbage-002",
        "chatgpt-image-latest",
        "dall-e-3",
        "davinci-002",
        "dall-e-2",
        "whisper-1",
        "text-embedding-ada-002",
        "text-embedding-ada-002-v2",
        "gpt-5.1-codex-max",
        "gpt-5.2-pro",
      ],
      prefixes: [
        "ft:",
        "chatgpt-",
        "codex-mini-",
        "gpt-3.5-",
        "gpt-4-",
        "gpt-4o-",
        "gpt-4-turbo",
        "gpt-5-search-api",
        "gpt-audio",
        "gpt-image",
        "gpt-realtime",
        "o3-deep-research",
        "o4-mini-deep-research",
        "omni-moderation-",
        "openai/",
        "sora-2",
        "text-embedding-",
        "text-moderation-",
        "tts-1",
        "1024-x-",
        "1536-x-",
        "256-x-",
        "512-x-",
        "hd/",
        "high/",
        "low/",
        "medium/",
        "standard/",
      ],
    },
    anthropic: {
      exact: [
        "anthropic.claude-instant-v1",
        "anthropic.claude-v1",
        "anthropic.claude-v2:1",
        "claude-opus-4-1",
      ],
      prefixes: [
        "claude-3-",
        "anthropic.",
        "vertex_ai/claude-3-",
        "vertex_ai/claude-",
        "apac.anthropic.",
        "au.anthropic.",
        "eu.anthropic.",
        "global.anthropic.",
        "jp.anthropic.",
        "us-gov.anthropic.",
        "us.anthropic.",
      ],
      suffixes: [
        "@default",
        "@20240229",
        "@20240620",
        "@20241022",
        "@20250219",
        "@20250514",
        "@20250805",
        "@20250929",
        "@20251001",
        "@20251101",
        "-20240229",
        "-20240307",
        "-20240620-v1:0",
        "-20241022-v1:0",
        "-20241022-v2:0",
        "-20250219-v1:0",
        "-20250514",
        "-20250514-v1:0",
        "-20250805",
        "-20250805-v1:0",
        "-20250929-v1:0",
        "-20251001-v1:0",
        "-20251101-v1:0",
        "-20260205",
        "-v1",
      ],
    },
    google: {
      prefixes: [
        "gemini-1.",
        "gemini-2.0",
        "gemini-2.5-",
        "gemini-embedding-",
        "gemini-gemma-",
        "gemma-",
        "google_pse/",
        "deep-research-",
        "lyria-",
        "veo-",
      ],
      contains: [
        "live",
        "tts",
        "image",
        "exp",
        "native-audio",
        "robotics",
        "computer-use",
      ],
    },
    vertex: {
      exact: [
        "medlm-large",
        "medlm-medium",
        "multimodalembedding",
        "multimodalembedding@001",
        "text-embedding-004",
        "text-embedding-005",
        "text-embedding-preview-0409",
        "text-embedding-large-exp-03-07",
        "text-multilingual-embedding-002",
        "text-unicorn",
        "text-unicorn@001",
      ],
      prefixes: [
        "vertex_ai/chirp",
        "vertex_ai/claude-",
        "vertex_ai/codestral",
        "vertex_ai/jamba-",
        "vertex_ai/deepseek-",
        "vertex_ai/gemini-embedding-",
        "vertex_ai/imagegeneration",
        "vertex_ai/imagen-",
        "vertex_ai/meta/",
        "vertex_ai/minimaxai/",
        "vertex_ai/mistral",
        "vertex_ai/mistralai/",
        "vertex_ai/moonshotai/",
        "vertex_ai/openai/",
        "vertex_ai/qwen/",
        "vertex_ai/search_api",
        "vertex_ai/veo-",
        "vertex_ai/zai-org/",
      ],
      contains: [
        "experimental",
        "robotics",
        "computer-use",
        "deep-research",
        "tts",
        "live",
        "thinking",
      ],
    },
  };

function normalizeProvider(provider?: string): SupportedProvider | null {
  const normalized = provider?.toLowerCase();
  if (
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "google" ||
    normalized === "vertex"
  ) {
    return normalized;
  }
  return null;
}

function inferProvider({
  provider,
  remoteProvider,
  translatedModelName,
  remoteModelName,
}: Pick<
  ModelSyncFilterOptions,
  "provider" | "remoteProvider" | "translatedModelName" | "remoteModelName"
>): SupportedProvider | null {
  const explicitProvider = normalizeProvider(provider);
  if (explicitProvider) {
    return explicitProvider;
  }

  const normalizedRemoteProvider = remoteProvider?.toLowerCase() ?? "";
  const names = [
    translatedModelName.toLowerCase(),
    remoteModelName.toLowerCase(),
  ];

  if (
    normalizedRemoteProvider.includes("vertex") ||
    names.some((name) => name.startsWith("vertex_ai/"))
  ) {
    return "vertex";
  }

  if (
    normalizedRemoteProvider.includes("anthropic") ||
    names.some((name) => name.startsWith("claude-"))
  ) {
    return "anthropic";
  }

  if (
    normalizedRemoteProvider.includes("google") ||
    normalizedRemoteProvider.includes("gemini") ||
    names.some((name) => name.startsWith("gemini-"))
  ) {
    return "google";
  }

  if (
    normalizedRemoteProvider.includes("openai") ||
    names.some((name) =>
      /^(gpt-|o[34](?:-|$)|omni-moderation-|text-embedding-3-|sora-2)/i.test(
        name,
      ),
    )
  ) {
    return "openai";
  }

  return null;
}

function matchesExplicitExclude(
  value: string,
  excludeList: ExplicitExcludeList,
): boolean {
  const normalizedValue = value.toLowerCase();

  return (
    (excludeList.exact ?? []).some(
      (candidate) => normalizedValue === candidate,
    ) ||
    (excludeList.prefixes ?? []).some((candidate) =>
      normalizedValue.startsWith(candidate),
    ) ||
    (excludeList.suffixes ?? []).some((candidate) =>
      normalizedValue.endsWith(candidate),
    ) ||
    (excludeList.contains ?? []).some((candidate) =>
      normalizedValue.includes(candidate),
    )
  );
}

export function shouldIncludeModelForSync({
  provider,
  remoteProvider,
  filterRegex,
  majorOnly,
  translatedModelName,
  remoteModelName,
}: ModelSyncFilterOptions): boolean {
  if (
    filterRegex &&
    !filterRegex.test(translatedModelName) &&
    !filterRegex.test(remoteModelName)
  ) {
    return false;
  }

  if (!majorOnly) {
    return true;
  }

  const normalizedProvider = inferProvider({
    provider,
    remoteProvider,
    translatedModelName,
    remoteModelName,
  });
  if (!normalizedProvider) {
    return false;
  }

  const excludeList = MAJOR_ONLY_EXCLUDE_LISTS[normalizedProvider];
  const isExcluded =
    matchesExplicitExclude(translatedModelName, excludeList) ||
    matchesExplicitExclude(remoteModelName, excludeList);

  return !isExcluded;
}
