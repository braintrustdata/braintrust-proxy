const PREFIXED_PROVIDERS = new Set([
  "gemini",
  "xai",
  "groq",
  "together_ai",
  "cerebras",
  "mistral",
  "perplexity",
  "databricks",
  "fireworks",
  "fireworks_ai",
  "baseten",
]);

export function translateToBraintrust(
  modelName: string,
  provider?: string,
): string {
  if (provider && PREFIXED_PROVIDERS.has(provider)) {
    const prefix = `${provider}/`;
    if (modelName.startsWith(prefix)) {
      return modelName.substring(prefix.length);
    }
  }

  if (provider === "gemini") {
    if (modelName.startsWith("gemini/gemini-gemma-")) {
      return "google/" + modelName.substring(14);
    }
    if (modelName.startsWith("gemini/gemma-")) {
      return "google/" + modelName.substring(7);
    }
  }

  if (modelName.startsWith("google/")) {
    return modelName;
  }

  return modelName;
}

export function canonicalizeLocalModelName(modelName: string): string {
  if (modelName.startsWith("fireworks_ai/accounts/fireworks/models/")) {
    return modelName.substring("fireworks_ai/".length);
  }

  if (modelName.startsWith("fireworks/accounts/fireworks/models/")) {
    return modelName.substring("fireworks/".length);
  }

  return modelName;
}

export function getEquivalentLocalModelNames(modelName: string): string[] {
  const canonicalName = canonicalizeLocalModelName(modelName);
  if (!canonicalName.startsWith("accounts/fireworks/models/")) {
    return [canonicalName];
  }

  return [
    canonicalName,
    `fireworks_ai/${canonicalName}`,
    `fireworks/${canonicalName}`,
  ];
}

export function isSupportedTranslatedModelName(
  modelName: string,
  provider?: string,
): boolean {
  if (!modelName || modelName.endsWith("/")) {
    return false;
  }

  if (provider === "fireworks" || provider === "fireworks_ai") {
    return modelName.startsWith("accounts/fireworks/models/");
  }

  return true;
}
