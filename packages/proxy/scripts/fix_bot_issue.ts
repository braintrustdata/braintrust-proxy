import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { z } from "zod";
import {
  fetchVertexSupportedRegions,
  GOOGLE_VERTEX_LOCATIONS_URL,
  syncVertexSupportedRegions,
} from "./sync_vertex_regions";
import {
  type ModelEndpointType,
  type ModelFormat,
  ModelSchema,
  type ModelSpec,
} from "../schema/models";

const partialModelSchema = ModelSchema.partial();
const issueMetadataSchema = z.object({
  kind: z.enum(["missing_model", "stale_metadata"]).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  models: z.array(z.string()).optional(),
  status: z
    .enum([
      "active",
      "preview",
      "deprecated",
      "retired",
      "replaced",
      "old",
      "unknown",
    ])
    .optional(),
  deprecation_date: z.string().optional(),
  model_spec: partialModelSchema.optional(),
  model_specs: z.record(partialModelSchema).optional(),
  source_urls: z.array(z.string().url()).optional(),
});
const fixResultSchema = z.object({
  action: z.enum(["changed", "already_present", "deprecated", "unsupported"]),
  message: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  pr_title: z.string().optional(),
  changed_models: z.array(z.string()),
  added_models: z.array(z.string()),
  updated_models: z.array(z.string()),
  comment_body: z.string().optional(),
  source_urls: z.array(z.string().url()).optional(),
  verification_summary: z.string().optional(),
  verification_rows: z
    .array(
      z.object({
        model: z.string(),
        format: z.string(),
        flavor: z.string(),
        providers: z.string(),
        token_limits: z.string(),
        pricing: z.string(),
        lifecycle: z.string(),
      }),
    )
    .optional(),
});

type PartialModelSpec = z.infer<typeof partialModelSchema>;
type IssueMetadata = z.infer<typeof issueMetadataSchema>;
type FixResult = z.infer<typeof fixResultSchema>;
type LocalModelList = Record<string, ModelSpec>;
type ParsedIssue = {
  provider: string | null;
  models: string[];
  metadata: IssueMetadata | null;
  aliasTargets: Record<string, string>;
};

const LOCAL_MODEL_LIST_PATH = path.resolve(
  __dirname,
  "../schema/model_list.json",
);
const SCHEMA_INDEX_PATH = path.resolve(__dirname, "../schema/index.ts");
const DATE_SUFFIX_PATTERN = /^(.*)-(\d{4}-\d{2}-\d{2})$/;
const PROVIDER_CAPTURE_GROUP =
  "(OpenAI|Anthropic|Azure|Google|Vertex|AWS Bedrock|Bedrock|Groq|Mistral|xAI|Together|Fireworks|Databricks|Cerebras|Perplexity)";
const BOT_ISSUE_TITLE_PATTERN = new RegExp(
  `^\\[(?:BOT ISSUE|Bot Issue)\\]\\s+Missing\\s+${PROVIDER_CAPTURE_GROUP}\\s+(\\S+)\\s+model$`,
  "i",
);
const BOT_ISSUE_MULTI_MODEL_PARENS_PATTERN = new RegExp(
  `^\\[(?:BOT ISSUE|Bot Issue)\\]\\s+Missing\\s+${PROVIDER_CAPTURE_GROUP}\\s+.+\\(([^)]+)\\)\\s*$`,
  "i",
);
const BOT_ISSUE_MULTI_MODEL_COLON_PATTERN = new RegExp(
  `^\\[(?:BOT ISSUE|Bot Issue)\\]\\s+Missing\\s+${PROVIDER_CAPTURE_GROUP}\\s+[^:]+:\\s+(.+)$`,
  "i",
);
const ISSUE_METADATA_MARKER = "<!-- fix-bot-issue-metadata -->";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeProvider(provider?: string): string | null {
  if (!provider) {
    return null;
  }

  const normalized = provider.trim().toLowerCase();
  if (normalized === "aws bedrock") {
    return "bedrock";
  }
  if (normalized === "xai") {
    return "xai";
  }
  if (
    [
      "anthropic",
      "azure",
      "bedrock",
      "cerebras",
      "databricks",
      "fireworks",
      "google",
      "groq",
      "mistral",
      "openai",
      "perplexity",
      "together",
      "vertex",
    ].includes(normalized)
  ) {
    return normalized;
  }

  return null;
}

function normalizeModelId(model: string): string {
  return model.trim().replace(/^`|`$/g, "").trim();
}

function uniqueModels(models: string[]): string[] {
  return Array.from(
    new Set(
      models
        .map((model) => normalizeModelId(model))
        .filter((model) => model.length > 0),
    ),
  );
}

function formatModelList(models: string[]): string {
  return models.map((model) => `\`${model}\``).join(", ");
}

function summarizeModelsForTitle(models: string[]): string {
  if (models.length === 0) {
    return "model catalog";
  }
  if (models.length === 1) {
    return models[0];
  }
  if (models.length === 2) {
    return `${models[0]} and ${models[1]}`;
  }
  return `${models[0]} +${models.length - 1} more`;
}

function providerDisplayName(provider?: string): string {
  if (!provider) {
    return "model";
  }

  const names: Record<string, string> = {
    anthropic: "Anthropic",
    azure: "Azure",
    bedrock: "Bedrock",
    cerebras: "Cerebras",
    databricks: "Databricks",
    fireworks: "Fireworks",
    google: "Google",
    groq: "Groq",
    mistral: "Mistral",
    openai: "OpenAI",
    perplexity: "Perplexity",
    together: "Together",
    vertex: "Vertex",
    xai: "xAI",
  };

  return names[provider] ?? provider;
}

function buildChangeTitle(args: {
  provider?: string;
  addedModels: string[];
  updatedModels: string[];
}): string {
  const provider = providerDisplayName(args.provider);
  if (args.addedModels.length > 0 && args.updatedModels.length === 0) {
    return `fix: add ${provider} models ${summarizeModelsForTitle(args.addedModels)}`;
  }
  if (args.updatedModels.length > 0 && args.addedModels.length === 0) {
    return `fix: update ${provider} model metadata for ${summarizeModelsForTitle(args.updatedModels)}`;
  }
  return `fix: update ${provider} model catalog for ${summarizeModelsForTitle([
    ...args.addedModels,
    ...args.updatedModels,
  ])}`;
}

function extractUrls(text: string): string[] {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/https?:\/\/[^\s)<>"`]+/g), (match) =>
        match[0].replace(/[.,]$/, ""),
      ),
    ),
  );
}

function extractOfficialSourceUrls(body: string): string[] {
  const officialSourceSection = body.match(
    /## Official source\s*([\s\S]*?)(?:\n## |\s*$)/i,
  )?.[1];

  if (!officialSourceSection) {
    return extractUrls(body);
  }

  return extractUrls(officialSourceSection);
}

function getVerificationSourceUrls(
  parsedIssue: ParsedIssue,
  body: string,
): string[] {
  return Array.from(
    new Set([
      ...(parsedIssue.metadata?.source_urls ?? []),
      ...extractOfficialSourceUrls(body),
    ]),
  );
}

function buildVerificationSummary(args: {
  sourceUrls: string[];
  models: Array<{ name: string; model: ModelSpec }>;
}): string | undefined {
  if (args.sourceUrls.length === 0 && args.models.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  if (args.sourceUrls.length > 0) {
    lines.push(`Verification sources: ${args.sourceUrls.join(", ")}`);
  }

  if (args.models.length > 0) {
    lines.push("Verified metadata applied:");
    for (const { name, model } of args.models) {
      const details: string[] = [];
      details.push(`format=${model.format}`);
      details.push(`flavor=${model.flavor}`);
      if (model.displayName) {
        details.push(`displayName=${model.displayName}`);
      }
      if (model.parent) {
        details.push(`parent=${model.parent}`);
      }
      if (model.max_input_tokens !== undefined) {
        details.push(`max_input_tokens=${model.max_input_tokens}`);
      } else {
        details.push("max_input_tokens=not provided");
      }
      if (model.max_output_tokens !== undefined) {
        details.push(`max_output_tokens=${model.max_output_tokens}`);
      } else if (model.flavor === "embedding") {
        details.push("max_output_tokens=n/a");
      } else {
        details.push("max_output_tokens=not provided");
      }
      if (
        model.input_cost_per_mil_tokens !== undefined ||
        model.output_cost_per_mil_tokens !== undefined
      ) {
        details.push(
          `pricing(input/output per 1M)=${model.input_cost_per_mil_tokens ?? "?"}/${model.output_cost_per_mil_tokens ?? "?"}`,
        );
      } else {
        details.push("pricing=not provided");
      }
      if (model.input_cache_read_cost_per_mil_tokens !== undefined) {
        details.push(
          `input_cache_read_cost_per_mil_tokens=${model.input_cache_read_cost_per_mil_tokens}`,
        );
      }
      if (model.input_cache_write_cost_per_mil_tokens !== undefined) {
        details.push(
          `input_cache_write_cost_per_mil_tokens=${model.input_cache_write_cost_per_mil_tokens}`,
        );
      }
      if (model.available_providers && model.available_providers.length > 0) {
        details.push(`providers=${model.available_providers.join("|")}`);
      } else {
        details.push("providers=not provided");
      }
      if (model.endpoint_types && model.endpoint_types.length > 0) {
        details.push(`endpoint_types=${model.endpoint_types.join("|")}`);
      }
      if (model.locations && model.locations.length > 0) {
        details.push(`locations=${model.locations.join("|")}`);
      }
      if (model.supported_regions && model.supported_regions.length > 0) {
        details.push(`supported_regions=${model.supported_regions.join("|")}`);
      }
      if (model.reasoning !== undefined) {
        details.push(`reasoning=${String(model.reasoning)}`);
      }
      if (model.reasoning_budget !== undefined) {
        details.push(`reasoning_budget=${String(model.reasoning_budget)}`);
      }
      if (model.multimodal !== undefined) {
        details.push(`multimodal=${String(model.multimodal)}`);
      }
      if (model.deprecated !== undefined) {
        details.push(`deprecated=${String(model.deprecated)}`);
      }
      if (model.deprecation_date) {
        details.push(`deprecation_date=${model.deprecation_date}`);
      }
      lines.push(`- \`${name}\`: ${details.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function buildVerificationRows(
  models: Array<{ name: string; model: ModelSpec }>,
): Array<{
  model: string;
  format: string;
  flavor: string;
  providers: string;
  token_limits: string;
  pricing: string;
  lifecycle: string;
}> {
  return models.map(({ name, model }) => {
    const providers =
      model.available_providers && model.available_providers.length > 0
        ? model.available_providers.join(", ")
        : model.endpoint_types && model.endpoint_types.length > 0
          ? model.endpoint_types.join(", ")
          : "n/a";

    const tokenLimits = [
      `input=${model.max_input_tokens ?? "n/a"}`,
      model.max_output_tokens !== undefined
        ? `output=${model.max_output_tokens}`
        : model.flavor === "embedding"
          ? "output=n/a"
          : "output=not provided",
    ].join(", ");

    const pricingParts: string[] = [];
    if (
      model.input_cost_per_mil_tokens !== undefined ||
      model.output_cost_per_mil_tokens !== undefined
    ) {
      pricingParts.push(
        `in/out=${model.input_cost_per_mil_tokens ?? "?"}/${model.output_cost_per_mil_tokens ?? "?"} per 1M`,
      );
    }
    if (model.input_cache_read_cost_per_mil_tokens !== undefined) {
      pricingParts.push(
        `cache read=${model.input_cache_read_cost_per_mil_tokens} per 1M`,
      );
    }
    if (model.input_cache_write_cost_per_mil_tokens !== undefined) {
      pricingParts.push(
        `cache write=${model.input_cache_write_cost_per_mil_tokens} per 1M`,
      );
    }

    const lifecycleParts: string[] = [];
    if (model.parent) {
      lifecycleParts.push(`parent=${model.parent}`);
    }
    if (model.deprecated !== undefined) {
      lifecycleParts.push(`deprecated=${String(model.deprecated)}`);
    }
    if (model.deprecation_date) {
      lifecycleParts.push(`date=${model.deprecation_date}`);
    }
    if (model.multimodal !== undefined) {
      lifecycleParts.push(`multimodal=${String(model.multimodal)}`);
    }
    if (model.reasoning !== undefined) {
      lifecycleParts.push(`reasoning=${String(model.reasoning)}`);
    }

    return {
      model: name,
      format: model.format,
      flavor: model.flavor,
      providers,
      token_limits: tokenLimits,
      pricing: pricingParts.length > 0 ? pricingParts.join("; ") : "n/a",
      lifecycle:
        lifecycleParts.length > 0 ? lifecycleParts.join("; ") : "active",
    };
  });
}

function buildUnsupportedTicketComment(args: {
  message: string;
  provider: string;
  targetModels: string[];
  body: string;
  issueKind: "missing_model" | "stale_metadata";
}): string {
  const sourceUrls = extractOfficialSourceUrls(args.body);
  const commentSections = [
    "Autofix could not safely resolve this ticket.",
    "",
    args.message,
    "",
    "Verified information from this run:",
    `- Provider: \`${args.provider}\``,
    `- Parsed models: ${formatModelList(args.targetModels)}`,
  ];

  if (sourceUrls.length > 0) {
    commentSections.push(
      `- Official source URLs already on the ticket: ${sourceUrls.join(", ")}`,
    );
  }

  commentSections.push(
    "",
    `To make autofix work on a future run, update the machine-readable metadata block for this ${args.issueKind === "stale_metadata" ? "stale metadata" : "missing model"} issue and include the verified fields needed for the catalog change, such as:`,
    "- `model_spec` for single-model issues or `model_specs` for multi-model issues",
    "- pricing fields",
    "- `max_input_tokens`",
    "- `max_output_tokens`",
    "- `available_providers`",
    "- `deprecated` / `deprecation_date`",
    "- `locations` when the provider/model requires explicit location metadata",
  );

  return commentSections.join("\n");
}

function sortLocations(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => {
    if (left === "global" && right !== "global") {
      return -1;
    }
    if (left !== "global" && right === "global") {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function isPastDate(value?: string): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return timestamp < Date.now();
}

async function readLocalModels(filePath: string): Promise<LocalModelList> {
  const fileContent = await fs.promises.readFile(filePath, "utf-8");
  return z.record(ModelSchema).parse(JSON.parse(fileContent));
}

function providersForName(providerName?: string): ModelEndpointType[] {
  const normalized = normalizeProvider(providerName);
  if (!normalized) {
    return [];
  }

  if (normalized === "xai") {
    return ["xAI"];
  }
  if (normalized === "openai") {
    return ["openai", "azure"];
  }
  if (normalized === "google") {
    return ["google"];
  }
  if (normalized === "vertex") {
    return ["vertex"];
  }

  const singleProviderMap: Record<string, ModelEndpointType> = {
    anthropic: "anthropic",
    azure: "azure",
    bedrock: "bedrock",
    cerebras: "cerebras",
    databricks: "databricks",
    fireworks: "fireworks",
    groq: "groq",
    mistral: "mistral",
    perplexity: "perplexity",
    together: "together",
  };

  const endpointType = singleProviderMap[normalized];
  if (endpointType) {
    return [endpointType];
  }

  return [];
}

function getSnapshotParent(modelName: string): string | null {
  const match = modelName.match(DATE_SUFFIX_PATTERN);
  if (!match) {
    return null;
  }
  return match[1];
}

function formatDisplayToken(token: string): string {
  if (token.toLowerCase() === "gpt") {
    return "GPT";
  }
  if (token.toLowerCase() === "ai") {
    return "AI";
  }
  if (token.toLowerCase() === "api") {
    return "API";
  }
  if (token.length === 0) {
    return token;
  }
  return token[0].toUpperCase() + token.slice(1);
}

function buildDisplayName(modelName: string): string | undefined {
  const snapshotParent = getSnapshotParent(modelName);
  const baseName = snapshotParent ?? modelName;
  const baseLeafParts = baseName.split("/");
  const baseLeaf = baseLeafParts[baseLeafParts.length - 1];
  if (!baseLeaf) {
    return undefined;
  }

  const pieces = baseLeaf.split("-").filter(Boolean);
  if (pieces.length === 0) {
    return undefined;
  }

  let formattedName = "";
  if (pieces[0].toLowerCase() === "gpt" && pieces[1]) {
    const remaining = pieces.slice(2).map(formatDisplayToken);
    formattedName = [`GPT-${pieces[1]}`, ...remaining].join(" ");
  } else {
    formattedName = pieces.map(formatDisplayToken).join(" ");
  }

  if (!snapshotParent) {
    return formattedName;
  }

  const snapshotMatch = modelName.match(DATE_SUFFIX_PATTERN);
  if (!snapshotMatch) {
    return formattedName;
  }

  return `${formattedName} (${snapshotMatch[2]})`;
}

function deriveInsertionPrefixes(modelName: string): string[] {
  const prefixes: string[] = [];
  let current = getSnapshotParent(modelName) ?? modelName;

  while (current.length > 0) {
    if (!prefixes.includes(current)) {
      prefixes.push(current);
    }

    const slashIndex = current.lastIndexOf("/");
    const dashIndex = current.lastIndexOf("-");
    if (dashIndex > slashIndex) {
      current = current.slice(0, dashIndex);
      continue;
    }
    if (slashIndex >= 0) {
      const withoutSlash = current.slice(0, slashIndex);
      if (!withoutSlash) {
        break;
      }
      current = withoutSlash;
      continue;
    }
    break;
  }

  return prefixes;
}

function insertionIndex(orderedNames: string[], modelName: string): number {
  const prefixes = deriveInsertionPrefixes(modelName);
  let lastMatch = -1;

  for (let index = 0; index < orderedNames.length; index += 1) {
    const existingName = orderedNames[index];
    if (prefixes.some((prefix) => existingName.startsWith(prefix))) {
      lastMatch = index;
    }
  }

  if (lastMatch >= 0) {
    return lastMatch + 1;
  }

  return orderedNames.length;
}

function serializeModel(model: ModelSpec): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  const schemaKeys = Object.keys(ModelSchema.shape) as Array<keyof ModelSpec>;

  for (const key of schemaKeys) {
    const value = model[key];
    if (value !== undefined && value !== null) {
      serialized[key] = value;
    }
  }

  for (const [key, value] of Object.entries(model)) {
    if (key in serialized || value === undefined || value === null) {
      continue;
    }
    serialized[key] = value;
  }

  return serialized;
}

async function writeLocalModels(localModels: LocalModelList): Promise<void> {
  const orderedModels: Record<string, Record<string, unknown>> = {};
  for (const [modelName, model] of Object.entries(localModels)) {
    orderedModels[modelName] = serializeModel(model);
  }
  await fs.promises.writeFile(
    LOCAL_MODEL_LIST_PATH,
    JSON.stringify(orderedModels, null, 2) + "\n",
  );
}

function providerMappingsForModels(
  modelsToAdd: Array<{ name: string; model: ModelSpec }>,
): Record<string, readonly ModelEndpointType[]> {
  const mappings: Record<string, readonly ModelEndpointType[]> = {};

  for (const { name, model } of modelsToAdd) {
    if (!model.available_providers || model.available_providers.length === 0) {
      continue;
    }
    mappings[name] = model.available_providers;
  }

  return mappings;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateAvailableEndpointTypes(
  mappings: Record<string, readonly ModelEndpointType[]>,
): Promise<void> {
  const names = Object.keys(mappings);
  if (names.length === 0) {
    return;
  }

  const content = await fs.promises.readFile(SCHEMA_INDEX_PATH, "utf-8");
  const startMarker =
    "export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {";
  const startIndex = content.indexOf(startMarker);
  if (startIndex < 0) {
    throw new Error("Could not find AvailableEndpointTypes in schema/index.ts");
  }

  const objectStartIndex = startIndex + startMarker.length - 1;
  const objectEndIndex = content.indexOf("\n};", objectStartIndex);
  if (objectStartIndex < 0 || objectEndIndex < 0) {
    throw new Error("Could not locate AvailableEndpointTypes object bounds");
  }

  let objectBody = content.slice(objectStartIndex + 1, objectEndIndex);
  const missingLines: string[] = [];

  for (const name of names) {
    const linePattern = new RegExp(
      `^\\s*"${escapeForRegex(name)}": .*?,\\n?`,
      "m",
    );
    const newLine = `  "${name}": ${JSON.stringify(mappings[name])},`;
    if (linePattern.test(objectBody)) {
      objectBody = objectBody.replace(linePattern, `${newLine}\n`);
      continue;
    }
    missingLines.push(newLine);
  }

  const trimmedBody = objectBody.replace(/^\n/, "").trimEnd();
  const insertionAnchor = '  "grok-beta": ["xAI"],';
  let normalizedBody = trimmedBody.length === 0 ? "" : trimmedBody;

  if (missingLines.length === 0) {
    normalizedBody = `\n${normalizedBody}`;
  } else if (normalizedBody.includes(insertionAnchor)) {
    normalizedBody = normalizedBody.replace(
      insertionAnchor,
      `${insertionAnchor}\n${missingLines.join("\n")}`,
    );
  } else if (normalizedBody.length > 0) {
    normalizedBody = `${normalizedBody}\n${missingLines.join("\n")}`;
  } else {
    normalizedBody = missingLines.join("\n");
  }

  if (!normalizedBody.startsWith("\n")) {
    normalizedBody = `\n${normalizedBody}`;
  }

  const updatedContent =
    content.slice(0, objectStartIndex + 1) +
    normalizedBody +
    content.slice(objectEndIndex);

  await fs.promises.writeFile(SCHEMA_INDEX_PATH, updatedContent);
}

function applyModelChanges(
  localModels: LocalModelList,
  modelsToApply: Array<{ name: string; model: ModelSpec }>,
): LocalModelList {
  const orderedEntries = Object.entries(localModels);

  for (const modelToApply of modelsToApply) {
    const existingIndex = orderedEntries.findIndex(
      ([name]) => name === modelToApply.name,
    );

    if (existingIndex >= 0) {
      orderedEntries[existingIndex] = [modelToApply.name, modelToApply.model];
      continue;
    }

    const currentNames = orderedEntries.map(([name]) => name);
    const index = insertionIndex(currentNames, modelToApply.name);
    orderedEntries.splice(index, 0, [modelToApply.name, modelToApply.model]);
  }

  const updatedModels: LocalModelList = {};
  for (const [name, model] of orderedEntries) {
    updatedModels[name] = model;
  }

  return updatedModels;
}

function modelsAreEquivalent(left: ModelSpec, right: ModelSpec): boolean {
  return (
    JSON.stringify(serializeModel(left)) ===
    JSON.stringify(serializeModel(right))
  );
}

function parseAliasTargets(body: string): Record<string, string> {
  const aliasTargets: Record<string, string> = {};

  for (const match of body.matchAll(
    /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|$/gm,
  )) {
    const alias = normalizeModelId(match[1]);
    const target = normalizeModelId(match[2]);
    if (alias.length > 0 && target.length > 0) {
      aliasTargets[alias] = target;
    }
  }

  return aliasTargets;
}

function parseGapSectionModels(body: string): string[] {
  const gapMatch = body.match(/## Gap\s*([\s\S]*?)(?:\n## |\s*$)/i);
  if (!gapMatch?.[1]) {
    return [];
  }

  return uniqueModels(
    Array.from(
      gapMatch[1].matchAll(/^\s*-\s+`([^`]+)`\s*$/gm),
      (match) => match[1],
    ),
  );
}

function parseModelTableModels(body: string): string[] {
  return uniqueModels(
    Array.from(body.matchAll(/^\|\s*`([^`]+)`\s*\|.*$/gm), (match) => match[1]),
  );
}

function parseIssueMetadata(body: string): IssueMetadata | null {
  const candidateBlocks: string[] = [];
  const markerIndex = body.indexOf(ISSUE_METADATA_MARKER);
  if (markerIndex >= 0) {
    const markerSlice = body.slice(markerIndex);
    const markedMatch = markerSlice.match(/```json\s*([\s\S]*?)```/i);
    if (markedMatch?.[1]) {
      candidateBlocks.push(markedMatch[1]);
    }
  }

  for (const match of body.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    if (match[1]) {
      candidateBlocks.push(match[1]);
    }
  }

  for (const block of candidateBlocks) {
    try {
      return issueMetadataSchema.parse(JSON.parse(block));
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function parseIssueTitle(title: string): {
  provider: string | null;
  models: string[];
} {
  const singleMatch = title.match(BOT_ISSUE_TITLE_PATTERN);
  if (singleMatch) {
    return {
      provider: normalizeProvider(singleMatch[1]),
      models: uniqueModels([singleMatch[2]]),
    };
  }

  const parensMatch = title.match(BOT_ISSUE_MULTI_MODEL_PARENS_PATTERN);
  if (parensMatch) {
    return {
      provider: normalizeProvider(parensMatch[1]),
      models: uniqueModels(parensMatch[2].split(",")),
    };
  }

  const colonMatch = title.match(BOT_ISSUE_MULTI_MODEL_COLON_PATTERN);
  if (colonMatch) {
    return {
      provider: normalizeProvider(colonMatch[1]),
      models: uniqueModels(colonMatch[2].split(",")),
    };
  }

  return { provider: null, models: [] };
}

function parseIssue(title: string, body: string): ParsedIssue {
  const metadata = parseIssueMetadata(body);
  const titleData = parseIssueTitle(title);
  const aliasTargets = parseAliasTargets(body);
  const metadataModels = uniqueModels([
    ...(metadata?.model ? [metadata.model] : []),
    ...(metadata?.models ?? []),
  ]);
  const tableModels = parseModelTableModels(body);
  const bodyModels =
    Object.keys(aliasTargets).length > 0
      ? uniqueModels(Object.keys(aliasTargets))
      : uniqueModels([...parseGapSectionModels(body), ...tableModels]);

  const metadataProvider = normalizeProvider(metadata?.provider);

  return {
    provider: metadataProvider ?? titleData.provider,
    models:
      metadataModels.length > 0
        ? metadataModels
        : bodyModels.length > 0
          ? bodyModels
          : titleData.models,
    metadata,
    aliasTargets,
  };
}

function getModelSpecPatch(
  metadata: IssueMetadata | null,
  targetModel: string,
): PartialModelSpec | undefined {
  return metadata?.model_specs?.[targetModel] ?? metadata?.model_spec;
}

function getIssueKind(
  metadata: IssueMetadata | null,
): "missing_model" | "stale_metadata" {
  return metadata?.kind ?? "missing_model";
}

function inferFormat(
  provider: string,
  modelName: string,
  metadataSpec?: PartialModelSpec,
): ModelFormat | null {
  if (metadataSpec?.format) {
    return metadataSpec.format;
  }

  if (provider === "anthropic") {
    return "anthropic";
  }
  if (provider === "google") {
    return "google";
  }
  if (provider === "bedrock") {
    return "converse";
  }
  if (provider === "vertex") {
    if (modelName.startsWith("publishers/google/models/")) {
      return "google";
    }
    return "openai";
  }
  if (
    [
      "azure",
      "cerebras",
      "databricks",
      "fireworks",
      "groq",
      "mistral",
      "openai",
      "perplexity",
      "together",
      "xai",
    ].includes(provider)
  ) {
    return "openai";
  }

  return null;
}

function applyModelSpecPatch(model: ModelSpec, patch?: PartialModelSpec): void {
  if (!patch) {
    return;
  }

  if (patch.format) {
    model.format = patch.format;
  }
  if (patch.flavor) {
    model.flavor = patch.flavor;
  }
  if (patch.multimodal !== undefined) {
    model.multimodal = patch.multimodal;
  }
  if (patch.input_cost_per_token !== undefined) {
    model.input_cost_per_token = patch.input_cost_per_token;
  }
  if (patch.output_cost_per_token !== undefined) {
    model.output_cost_per_token = patch.output_cost_per_token;
  }
  if (patch.input_cost_per_mil_tokens !== undefined) {
    model.input_cost_per_mil_tokens = patch.input_cost_per_mil_tokens;
  }
  if (patch.output_cost_per_mil_tokens !== undefined) {
    model.output_cost_per_mil_tokens = patch.output_cost_per_mil_tokens;
  }
  if (patch.input_cache_read_cost_per_mil_tokens !== undefined) {
    model.input_cache_read_cost_per_mil_tokens =
      patch.input_cache_read_cost_per_mil_tokens;
  }
  if (patch.input_cache_write_cost_per_mil_tokens !== undefined) {
    model.input_cache_write_cost_per_mil_tokens =
      patch.input_cache_write_cost_per_mil_tokens;
  }
  if (patch.displayName !== undefined) {
    model.displayName = patch.displayName;
  }
  if (patch.o1_like !== undefined) {
    model.o1_like = patch.o1_like;
  }
  if (patch.reasoning !== undefined) {
    model.reasoning = patch.reasoning;
  }
  if (patch.reasoning_budget !== undefined) {
    model.reasoning_budget = patch.reasoning_budget;
  }
  if (patch.experimental !== undefined) {
    model.experimental = patch.experimental;
  }
  if (patch.deprecated !== undefined) {
    model.deprecated = patch.deprecated;
  }
  if (patch.deprecation_date !== undefined) {
    model.deprecation_date = patch.deprecation_date;
  }
  if (patch.parent !== undefined) {
    model.parent = patch.parent;
  }
  if (patch.endpoint_types !== undefined) {
    model.endpoint_types = [...patch.endpoint_types];
  }
  if (patch.locations !== undefined) {
    model.locations = sortLocations(patch.locations);
  }
  if (patch.supported_regions !== undefined) {
    model.supported_regions = sortLocations(patch.supported_regions);
  }
  if (patch.description !== undefined) {
    model.description = patch.description;
  }
  if (patch.max_input_tokens !== undefined) {
    model.max_input_tokens = patch.max_input_tokens;
  }
  if (patch.max_output_tokens !== undefined) {
    model.max_output_tokens = patch.max_output_tokens;
  }
  if (patch.available_providers !== undefined) {
    model.available_providers = [...patch.available_providers];
  }
}

function buildManualModelSpec(
  provider: string,
  modelName: string,
  metadata: IssueMetadata | null,
): ModelSpec {
  const modelSpecPatch = getModelSpecPatch(metadata, modelName);
  const format = inferFormat(provider, modelName, modelSpecPatch);
  if (!format) {
    throw new Error(`Could not determine format for ${modelName}`);
  }

  const model: ModelSpec = {
    format,
    flavor: modelSpecPatch?.flavor ?? "chat",
  };

  const fallbackProviders = providersForName(provider);
  if (fallbackProviders.length > 0) {
    model.available_providers = fallbackProviders;
  }

  const parent = getSnapshotParent(modelName);
  if (parent) {
    model.parent = parent;
  }

  const displayName = buildDisplayName(modelName);
  if (displayName) {
    model.displayName = displayName;
  }

  applyModelSpecPatch(model, modelSpecPatch);
  return model;
}

function cloneLocalModel(model: ModelSpec): ModelSpec {
  return ModelSchema.parse(serializeModel(model));
}

function shouldCloseAsDeprecated(
  parsedIssue: ParsedIssue,
  targetModel: string,
  localModels: LocalModelList,
): boolean {
  const metadata = parsedIssue.metadata;
  const aliasSource = parsedIssue.aliasTargets[targetModel];
  const aliasedModel =
    aliasSource && localModels[aliasSource] ? localModels[aliasSource] : null;
  const modelSpecPatch = getModelSpecPatch(metadata, targetModel);

  if (
    metadata?.status === "deprecated" ||
    metadata?.status === "retired" ||
    metadata?.status === "replaced" ||
    metadata?.status === "old"
  ) {
    return true;
  }

  if (modelSpecPatch?.deprecated) {
    return true;
  }

  if (isPastDate(metadata?.deprecation_date)) {
    return true;
  }

  if (isPastDate(modelSpecPatch?.deprecation_date)) {
    return true;
  }

  if (isPastDate(aliasedModel?.deprecation_date)) {
    return true;
  }

  return false;
}

function requiresExplicitLocations(
  provider: string,
  modelName: string,
): boolean {
  return provider === "vertex" || modelName.startsWith("publishers/");
}

function ensureResolvedModelMetadata(
  provider: string,
  modelName: string,
  model: ModelSpec,
): void {
  if (
    requiresExplicitLocations(provider, modelName) &&
    (!model.locations || model.locations.length === 0)
  ) {
    throw new Error(
      `Refusing to update ${modelName} without explicit location metadata`,
    );
  }
}

function ensureRequiredModelMetadataForAdd(
  provider: string,
  modelName: string,
  model: ModelSpec,
): void {
  if (
    model.max_input_tokens === undefined &&
    model.max_output_tokens === undefined
  ) {
    throw new Error(
      `Refusing to add ${modelName} without verified token limits in the issue metadata`,
    );
  }

  ensureResolvedModelMetadata(provider, modelName, model);
}

function buildUpdatedLocalModel(
  parsedIssue: ParsedIssue,
  targetModel: string,
  existingModel: ModelSpec,
): ModelSpec {
  const modelSpecPatch = getModelSpecPatch(parsedIssue.metadata, targetModel);
  if (!modelSpecPatch) {
    throw new Error(
      `Refusing to update ${targetModel} without machine-readable metadata describing the change`,
    );
  }

  const updatedModel = cloneLocalModel(existingModel);
  applyModelSpecPatch(updatedModel, modelSpecPatch);
  ensureResolvedModelMetadata(
    parsedIssue.provider ?? "",
    targetModel,
    updatedModel,
  );
  return updatedModel;
}

function buildModelsForIssue(
  parsedIssue: ParsedIssue,
  targetModel: string,
  localModels: LocalModelList,
): Array<{ name: string; model: ModelSpec }> {
  if (!parsedIssue.provider) {
    return [];
  }

  const issueKind = getIssueKind(parsedIssue.metadata);
  if (issueKind === "stale_metadata") {
    const existingModel = localModels[targetModel];
    if (!existingModel) {
      throw new Error(
        `Refusing to update ${targetModel} because it is not present in the local catalog`,
      );
    }

    return [
      {
        name: targetModel,
        model: buildUpdatedLocalModel(parsedIssue, targetModel, existingModel),
      },
    ];
  }

  const aliasSource = parsedIssue.aliasTargets[targetModel];
  if (aliasSource && localModels[aliasSource]) {
    const model = cloneLocalModel(localModels[aliasSource]);
    return [{ name: targetModel, model }];
  }

  const model = buildManualModelSpec(
    parsedIssue.provider,
    targetModel,
    parsedIssue.metadata,
  );
  ensureRequiredModelMetadataForAdd(parsedIssue.provider, targetModel, model);
  return [{ name: targetModel, model }];
}

async function writeResult(
  resultPath: string | undefined,
  result: FixResult,
): Promise<void> {
  if (!resultPath) {
    return;
  }

  await fs.promises.writeFile(
    resultPath,
    JSON.stringify(fixResultSchema.parse(result), null, 2) + "\n",
  );
}

async function resolveIssueCommand(argv: {
  title: string;
  bodyFile: string;
  write: boolean;
  resultPath?: string;
}): Promise<void> {
  const body = await fs.promises.readFile(argv.bodyFile, "utf-8");
  const parsedIssue = parseIssue(argv.title, body);
  const issueKind = getIssueKind(parsedIssue.metadata);
  const targetModels = uniqueModels(parsedIssue.models);
  const primaryModel = targetModels[0];
  const sourceUrls = getVerificationSourceUrls(parsedIssue, body);

  if (!parsedIssue.provider || targetModels.length === 0) {
    await writeResult(argv.resultPath, {
      action: "unsupported",
      message:
        "Autofix skipped because the issue body/title did not contain parseable bot metadata for a model catalog change.",
      changed_models: [],
      added_models: [],
      updated_models: [],
      source_urls: sourceUrls,
    });
    return;
  }

  const localModels = await readLocalModels(LOCAL_MODEL_LIST_PATH);
  const existingModels = targetModels.filter((model) => !!localModels[model]);
  const missingModels = targetModels.filter((model) => !localModels[model]);

  if (issueKind === "missing_model" && missingModels.length === 0) {
    await writeResult(argv.resultPath, {
      action: "already_present",
      message: `Closing this bot issue because ${formatModelList(targetModels)} ${targetModels.length === 1 ? "is" : "are"} already present in \`packages/proxy/schema/model_list.json\`.`,
      provider: parsedIssue.provider,
      model: primaryModel,
      changed_models: [],
      added_models: [],
      updated_models: [],
      source_urls: sourceUrls,
      verification_summary: buildVerificationSummary({
        sourceUrls,
        models: [],
      }),
    });
    return;
  }

  if (issueKind === "stale_metadata" && existingModels.length === 0) {
    const message = `Autofix skipped because ${formatModelList(targetModels)} ${targetModels.length === 1 ? "is" : "are"} not present in \`packages/proxy/schema/model_list.json\`, so there is no local record to update.`;
    await writeResult(argv.resultPath, {
      action: "unsupported",
      message,
      provider: parsedIssue.provider,
      model: primaryModel,
      changed_models: [],
      added_models: [],
      updated_models: [],
      source_urls: sourceUrls,
      verification_summary: buildVerificationSummary({
        sourceUrls,
        models: [],
      }),
      comment_body: buildUnsupportedTicketComment({
        message,
        provider: parsedIssue.provider,
        targetModels,
        body,
        issueKind,
      }),
    });
    return;
  }

  const modelsToEvaluate =
    issueKind === "stale_metadata" ? existingModels : missingModels;
  const deprecatedModels =
    issueKind === "missing_model"
      ? modelsToEvaluate.filter((model) =>
          shouldCloseAsDeprecated(parsedIssue, model, localModels),
        )
      : [];
  const modelsToResolve = modelsToEvaluate.filter(
    (model) => !deprecatedModels.includes(model),
  );

  if (modelsToResolve.length === 0) {
    await writeResult(argv.resultPath, {
      action: "deprecated",
      message: `Closing this bot issue because ${formatModelList(modelsToEvaluate)} ${modelsToEvaluate.length === 1 ? "is" : "are"} already deprecated, retired, or too old to keep changing in the active model catalog.`,
      provider: parsedIssue.provider,
      model: primaryModel,
      changed_models: [],
      added_models: [],
      updated_models: [],
      source_urls: sourceUrls,
      verification_summary: buildVerificationSummary({
        sourceUrls,
        models: [],
      }),
    });
    return;
  }

  let builtModelEntries: Array<{ name: string; model: ModelSpec }>;
  try {
    builtModelEntries = modelsToResolve.flatMap((targetModel) =>
      buildModelsForIssue(parsedIssue, targetModel, localModels),
    );
  } catch (error) {
    const message = `Autofix skipped because the issue does not yet contain enough verified metadata to safely apply catalog changes for ${formatModelList(modelsToResolve)}. ${errorMessage(error)}`;
    await writeResult(argv.resultPath, {
      action: "unsupported",
      message,
      provider: parsedIssue.provider,
      model: primaryModel,
      changed_models: [],
      added_models: [],
      updated_models: [],
      source_urls: sourceUrls,
      verification_summary: buildVerificationSummary({
        sourceUrls,
        models: [],
      }),
      comment_body: buildUnsupportedTicketComment({
        message,
        provider: parsedIssue.provider,
        targetModels,
        body,
        issueKind,
      }),
    });
    return;
  }

  const modelsToApply = uniqueModels(
    builtModelEntries.map((entry) => entry.name),
  ).map((name) => {
    const entry = builtModelEntries.find(
      (candidate) => candidate.name === name,
    );
    if (!entry) {
      throw new Error(`Could not build model payload for ${name}`);
    }
    return entry;
  });

  if (modelsToApply.length === 0) {
    const message = `Autofix skipped because no resolvable model payload could be built for ${formatModelList(modelsToResolve)}.`;
    await writeResult(argv.resultPath, {
      action: "unsupported",
      message,
      provider: parsedIssue.provider,
      model: primaryModel,
      changed_models: [],
      added_models: [],
      updated_models: [],
      source_urls: sourceUrls,
      verification_summary: buildVerificationSummary({
        sourceUrls,
        models: [],
      }),
      comment_body: buildUnsupportedTicketComment({
        message,
        provider: parsedIssue.provider,
        targetModels,
        body,
        issueKind,
      }),
    });
    return;
  }

  const changedModelEntries = modelsToApply.filter((entry) => {
    const existingModel = localModels[entry.name];
    if (!existingModel) {
      return true;
    }

    return !modelsAreEquivalent(existingModel, entry.model);
  });

  if (changedModelEntries.length === 0) {
    await writeResult(argv.resultPath, {
      action: "already_present",
      message: `Closing this bot issue because ${formatModelList(modelsToResolve)} ${modelsToResolve.length === 1 ? "is" : "are"} already up to date in the local catalog.`,
      provider: parsedIssue.provider,
      model: primaryModel,
      changed_models: [],
      added_models: [],
      updated_models: [],
      source_urls: sourceUrls,
      verification_summary: buildVerificationSummary({
        sourceUrls,
        models: [],
      }),
    });
    return;
  }

  const addedModels = changedModelEntries
    .filter((entry) => !localModels[entry.name])
    .map((entry) => entry.name);
  const updatedModelNames = changedModelEntries
    .filter((entry) => !!localModels[entry.name])
    .map((entry) => entry.name);

  const updatedModels = applyModelChanges(localModels, changedModelEntries);
  const needsVertexSync = changedModelEntries.some((entry) =>
    entry.model.available_providers?.includes("vertex"),
  );

  if (needsVertexSync) {
    console.log(
      `Fetching Vertex supported regions from: ${GOOGLE_VERTEX_LOCATIONS_URL}`,
    );
    const supportedRegionsByModel = await fetchVertexSupportedRegions();
    syncVertexSupportedRegions(updatedModels, supportedRegionsByModel);
  }

  if (argv.write) {
    await writeLocalModels(updatedModels);
    await updateAvailableEndpointTypes(
      providerMappingsForModels(changedModelEntries),
    );
  }

  await writeResult(argv.resultPath, {
    action: "changed",
    message: [
      `Prepared catalog updates for ${formatModelList(changedModelEntries.map((entry) => entry.name))}.`,
      addedModels.length > 0
        ? `Added models: ${formatModelList(addedModels)}.`
        : "",
      updatedModelNames.length > 0
        ? `Updated models: ${formatModelList(updatedModelNames)}.`
        : "",
      issueKind === "missing_model" && existingModels.length > 0
        ? `Already present: ${formatModelList(existingModels)}.`
        : "",
      deprecatedModels.length > 0
        ? `Skipped deprecated/old models: ${formatModelList(deprecatedModels)}.`
        : "",
    ]
      .filter((line) => line.length > 0)
      .join(" "),
    provider: parsedIssue.provider,
    model: primaryModel,
    pr_title: buildChangeTitle({
      provider: parsedIssue.provider,
      addedModels,
      updatedModels: updatedModelNames,
    }),
    changed_models: changedModelEntries.map((entry) => entry.name),
    added_models: addedModels,
    updated_models: updatedModelNames,
    source_urls: sourceUrls,
    verification_summary: buildVerificationSummary({
      sourceUrls,
      models: changedModelEntries,
    }),
    verification_rows: buildVerificationRows(changedModelEntries),
  });

  for (const model of changedModelEntries) {
    const verb = localModels[model.name]
      ? argv.write
        ? "Updated"
        : "Would update"
      : argv.write
        ? "Added"
        : "Would add";
    console.log(`${verb} ${model.name}`);
  }
}

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .command(
      "resolve-issue",
      "Resolve a bot issue body into either a close action or a model catalog update",
      (builder) =>
        builder
          .option("title", {
            type: "string",
            demandOption: true,
            description: "GitHub issue title",
          })
          .option("body-file", {
            type: "string",
            demandOption: true,
            description: "Path to a file containing the GitHub issue body",
          })
          .option("result-path", {
            type: "string",
            description: "Where to write the structured resolution result",
          })
          .option("write", {
            type: "boolean",
            default: false,
            description: "Write the updated model list to disk when needed",
          }),
      async (argv) => {
        await resolveIssueCommand({
          title: argv.title,
          bodyFile: argv.bodyFile,
          write: argv.write,
          resultPath: argv.resultPath,
        });
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

void main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
