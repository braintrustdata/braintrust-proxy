import fs from "fs";
import { pathToFileURL } from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type ModelEntry = {
  format?: string;
  flavor?: string;
  displayName?: string;
  multimodal?: boolean;
  reasoning?: boolean;
  reasoning_budget?: boolean;
  supports_streaming?: boolean;
  streaming_only?: boolean;
  supports_decisions?: boolean;
  experimental?: boolean;
  deprecated?: boolean;
  retired?: boolean;
  parent?: string;
  fallback_models?: string[];
  available_providers?: string[];
  max_input_tokens?: number;
  max_output_tokens?: number;
  input_cost_per_mil_tokens?: number;
  output_cost_per_mil_tokens?: number;
  pricing?: Record<string, Record<string, unknown>>;
};

type ModelList = Record<string, ModelEntry>;

export type ModelTestPromptOptions = {
  before: ModelList;
  after: ModelList;
  repository?: string;
  branch?: string;
  maxDetailedModels?: number;
  maxChangedModels?: number;
};

type ModelGroup = {
  id: string;
  companions: string[];
};

const DEFAULT_MAX_DETAILED_MODELS = 25;
const DEFAULT_MAX_CHANGED_MODELS = 30;
const MAX_LISTED_REMAINING_MODELS = 50;

const FLAVOR_ENDPOINTS: Record<string, string> = {
  chat: "`/v1/chat/completions`, `/v1/responses`, and `/v1/messages`",
  completion: "`/v1/completions`",
  embedding: "`/v1/embeddings`",
  decisions: "`/v1/decisions`",
  realtime: "`/v1/realtime` (WebSocket)",
  live: "`/v1/live/sessions` (WebSocket)",
};

function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPrice(value: number | undefined): string {
  return value === undefined || value === null ? "?" : `$${value}`;
}

function describeModel(id: string, entry: ModelEntry): string {
  const details = [
    `format \`${entry.format ?? "?"}\``,
    `flavor \`${entry.flavor ?? "?"}\``,
  ];
  if (entry.available_providers?.length) {
    details.push(`providers ${entry.available_providers.join(", ")}`);
  }
  const capabilities = [
    entry.multimodal && "multimodal",
    entry.reasoning && "reasoning",
    entry.reasoning_budget && "reasoning budget",
    entry.supports_decisions && "decisions",
    entry.streaming_only && "streaming only",
    entry.supports_streaming === false && "no streaming",
    entry.experimental && "experimental",
    entry.deprecated && "deprecated",
    entry.retired && "retired",
  ].filter((value): value is string => typeof value === "string");
  if (capabilities.length > 0) {
    details.push(capabilities.join(", "));
  }
  if (entry.max_input_tokens || entry.max_output_tokens) {
    details.push(
      `limits ${entry.max_input_tokens ? formatTokens(entry.max_input_tokens) : "?"} in / ${entry.max_output_tokens ? formatTokens(entry.max_output_tokens) : "?"} out`,
    );
  }
  if (
    entry.input_cost_per_mil_tokens !== undefined ||
    entry.output_cost_per_mil_tokens !== undefined
  ) {
    details.push(
      `${formatPrice(entry.input_cost_per_mil_tokens)} / ${formatPrice(entry.output_cost_per_mil_tokens)} per 1M in/out`,
    );
  } else {
    details.push("no token pricing");
  }
  const tiers = Object.entries(entry.pricing ?? {}).flatMap(
    ([provider, providerTiers]) =>
      Object.keys(providerTiers ?? {}).map((tier) => `${provider}:${tier}`),
  );
  if (tiers.length > 0) {
    details.push(`pricing tiers ${tiers.join(", ")}`);
  }
  if (entry.parent) {
    details.push(`parent \`${entry.parent}\``);
  }
  const name = entry.displayName ? ` (${entry.displayName})` : "";
  return `\`${id}\`${name}: ${details.join("; ")}`;
}

export function groupAddedModels(
  addedIds: string[],
  after: ModelList,
): ModelGroup[] {
  const added = new Set(addedIds);
  const companionOf = new Map<string, string>();
  const addedFallbacks = (id: string) =>
    (after[id]?.fallback_models ?? []).filter(
      (fallback) => added.has(fallback) && fallback !== id,
    );
  const byFallbackCount = [...addedIds].sort(
    (a, b) => addedFallbacks(b).length - addedFallbacks(a).length,
  );
  for (const id of byFallbackCount) {
    if (companionOf.has(id)) {
      continue;
    }
    for (const fallback of addedFallbacks(id)) {
      if (!companionOf.has(fallback)) {
        companionOf.set(fallback, id);
      }
    }
  }
  for (const id of addedIds) {
    const parent = after[id]?.parent;
    if (
      parent &&
      added.has(parent) &&
      !companionOf.has(id) &&
      !companionOf.has(parent)
    ) {
      companionOf.set(id, parent);
    }
  }

  const resolvePrimary = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (companionOf.has(current) && !seen.has(current)) {
      seen.add(current);
      current = companionOf.get(current) ?? current;
    }
    return current;
  };

  const groups = new Map<string, ModelGroup>();
  for (const id of addedIds) {
    const primary = resolvePrimary(id);
    const group = groups.get(primary) ?? { id: primary, companions: [] };
    if (primary !== id) {
      group.companions.push(id);
    }
    groups.set(primary, group);
  }
  return Array.from(groups.values());
}

function codeList(ids: string[]): string {
  return ids.map((id) => `\`${id}\``).join(", ");
}

export function buildModelTestPrompt({
  before,
  after,
  repository = "braintrustdata/braintrust-proxy",
  branch,
  maxDetailedModels = DEFAULT_MAX_DETAILED_MODELS,
  maxChangedModels = DEFAULT_MAX_CHANGED_MODELS,
}: ModelTestPromptOptions): string | null {
  const addedIds = Object.keys(after).filter((id) => !(id in before));
  const changedIds = Object.keys(after).filter(
    (id) =>
      id in before && JSON.stringify(before[id]) !== JSON.stringify(after[id]),
  );
  if (addedIds.length === 0 && changedIds.length === 0) {
    return null;
  }

  const groups = groupAddedModels(addedIds, after);
  const detailedGroups = groups.slice(0, maxDetailedModels);
  const remainingGroups = groups.slice(maxDetailedModels);
  const flavors = new Set(
    addedIds.map((id) => after[id]?.flavor).filter(Boolean),
  );
  const source = branch
    ? `the \`${branch}\` branch of \`${repository}\``
    : `this \`${repository}\` pull request`;

  const modelLines: string[] = [];
  for (const group of detailedGroups) {
    modelLines.push(`- ${describeModel(group.id, after[group.id] ?? {})}`);
    if (group.companions.length > 0) {
      modelLines.push(`  - Companions: ${codeList(group.companions)}`);
    }
  }
  const remainingIds = remainingGroups.flatMap((group) => [
    group.id,
    ...group.companions,
  ]);
  if (remainingIds.length > 0) {
    modelLines.push(
      `- ${remainingIds.length} more new models (read their entries in \`model_list.json\`): ${codeList(remainingIds.slice(0, MAX_LISTED_REMAINING_MODELS))}${remainingIds.length > MAX_LISTED_REMAINING_MODELS ? `, and ${remainingIds.length - MAX_LISTED_REMAINING_MODELS} more` : ""}`,
    );
  }
  if (addedIds.length === 0) {
    modelLines.push("- None. This change only updates existing models.");
  }

  const changedLines =
    changedIds.length > 0
      ? [
          "",
          "## Existing models with changed metadata",
          "",
          "Spot-check that the changed pricing, limits, and lifecycle fields match official provider docs and that Braintrust's cost estimates use the new values:",
          "",
          `- ${codeList(changedIds.slice(0, maxChangedModels))}${changedIds.length > maxChangedModels ? `, and ${changedIds.length - maxChangedModels} more` : ""}`,
        ]
      : [];

  const flavorLines = Array.from(flavors)
    .filter((flavor): flavor is string => typeof flavor === "string")
    .map(
      (flavor) =>
        `   - Call \`${flavor}\` models through ${FLAVOR_ENDPOINTS[flavor] ?? "the Gateway endpoint for this flavor"}.`,
    );

  const prompt = [
    `You are validating model catalog changes from ${source} end to end against Braintrust. Use only official provider documentation as the source of truth. Do not edit code; report findings.`,
    "",
    "## New models",
    "",
    "Primary models are listed first. Companions are the same model served through another provider surface (for example Bedrock, Vertex, Azure, or OpenRouter).",
    "",
    ...modelLines,
    ...changedLines,
    "",
    "## Setup",
    "",
    "- The hosted Gateway (`https://gateway.braintrust.dev`) reloads `packages/proxy/schema/model_list.json` from `main`, so run this after the PR merges. To test before merging, run a local Gateway from `braintrustdata/braintrust` with its `proxy` submodule checked out to this branch and `MODEL_CATALOG_REFRESH_SECONDS=0` so it does not reload the catalog from `main`.",
    "- Authenticate with `BRAINTRUST_API_KEY` for an organization that has AI provider keys for the providers above. Skip and report providers you have no credentials for.",
    "- Send every request with the `x-bt-project-name: model-validation` header so it is logged to one project you can inspect afterward.",
    "",
    "## Steps",
    "",
    "1. **Read the migration guide.** For each primary model, find the provider's official model page, release notes, and migration or upgrade guide, and compare against its `parent` or the previous model in the family. List every change that affects API callers: new, removed, or renamed parameters (for example `temperature`, `top_p`, `max_tokens` vs `max_completion_tokens`, reasoning effort or thinking budget), new tools or content types, context and output limits, pricing, and behavior changes. Each item becomes a test case in step 3.",
    "2. **Check the catalog entry.** Compare each entry in `model_list.json` against the official docs: format, flavor, display name, token limits, multimodal and reasoning flags, standard and tier pricing, available providers, `parent`, and companion `fallback_models`.",
    "3. **Test through the Gateway.** For each primary model, and at least one companion per provider you have credentials for:",
    "   - Send non-streaming and streaming requests in the model's native API format.",
    "   - Send the same request through other formats (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages) to exercise translation.",
    "   - Cover system prompts, multi-turn conversations, tool calling (including parallel calls and tool result round trips), and structured output with a JSON schema, wherever the model supports them.",
    "   - Send image input for multimodal models. Exercise reasoning effort or budget parameters for reasoning models and confirm reasoning tokens appear in usage.",
    "   - Run every test case from step 1, including parameters that the provider now rejects or ignores.",
    "   - Confirm `usage` token counts are populated and that a repeated request with `x-bt-use-cache: always` is served from cache.",
    ...flavorLines,
    "4. **Check Braintrust surfaces.** If you have browser access, confirm each primary model appears in the playground model picker with the right display name, run a prompt in the playground, and save it as a prompt. In the `model-validation` project logs, confirm each LLM span records the model, token metrics, and an estimated cost that matches the catalog pricing for the reported usage.",
    "5. **Report.** Produce a table of model × test case with pass, fail, or skip (with a reason). For each failure include the request, the response or error, and where the bug lives: the catalog (`model_list.json` in `braintrustdata/braintrust-proxy`), the Gateway or Lingua translation layer (`gateway/` or `lingua/` in `braintrustdata/braintrust`), or the provider. Propose a concrete fix for each catalog discrepancy.",
  ].join("\n");

  return [
    "## Model validation prompt",
    "",
    "Run this starter prompt with an agent that has a Braintrust API key to validate the new models end to end.",
    "",
    "<details>",
    `<summary>Validation prompt (${addedIds.length} new, ${changedIds.length} changed)</summary>`,
    "",
    "````markdown",
    prompt,
    "````",
    "",
    "</details>",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option("before", {
      type: "string",
      demandOption: true,
      describe: "Path to the model list before changes",
    })
    .option("after", {
      type: "string",
      demandOption: true,
      describe: "Path to the model list after changes",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      describe: "Path to append the validation prompt Markdown to",
    })
    .option("branch", {
      type: "string",
      demandOption: false,
      describe: "Branch the catalog changes are pushed to",
    })
    .strict()
    .help()
    .parseAsync();

  const before = JSON.parse(
    await fs.promises.readFile(argv.before, "utf8"),
  ) as ModelList;
  const after = JSON.parse(
    await fs.promises.readFile(argv.after, "utf8"),
  ) as ModelList;
  const section = buildModelTestPrompt({ before, after, branch: argv.branch });
  if (section) {
    await fs.promises.appendFile(argv.output, `\n${section}`);
  }
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
