import fs from "fs";
import https from "https";
import path from "path";
import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { pathToFileURL } from "url";
import { ModelSchema, ModelSpec } from "../schema/models";
import {
  canonicalizeLocalModelName,
  getEquivalentLocalModelNames,
  isSupportedTranslatedModelName,
  translateToBraintrust,
} from "./model_name_translation";
import {
  getFallbackCompleteOrdering,
  getProviderMappingForModel,
  matchesProviderFilter,
} from "./sync_model_catalog";
import {
  fetchVertexSupportedRegions,
  GOOGLE_VERTEX_LOCATIONS_URL,
  syncVertexSupportedRegions,
} from "./sync_vertex_regions";

const execAsync = promisify(exec);

// Zod schema for individual model details
const searchContextCostPerQuerySchema = z
  .object({
    search_context_size_low: z.number().optional(),
    search_context_size_medium: z.number().optional(),
    search_context_size_high: z.number().optional(),
  })
  .optional();

// Schema for LiteLLM remote model details
const liteLLMModelDetailSchema = z
  .object({
    max_tokens: z.union([z.number(), z.string()]).optional(), // LEGACY: Can be number or string
    max_input_tokens: z
      .preprocess(
        (val) => (typeof val === "string" ? parseInt(val, 10) : val),
        z.number().optional(),
      )
      .optional(),
    max_output_tokens: z
      .preprocess(
        (val) => (typeof val === "string" ? parseInt(val, 10) : val),
        z.number().optional(),
      )
      .optional(),
    input_cost_per_token: z.number().optional(),
    output_cost_per_token: z.number().optional(),
    input_cost_per_mil_tokens: z.number().optional(), // From LiteLLM if available
    output_cost_per_mil_tokens: z.number().optional(), // From LiteLLM if available
    output_cost_per_reasoning_token: z.number().optional(),
    cache_creation_input_token_cost: z.number().optional(), // from LiteLLM, maps to input_cache_write
    cache_read_input_token_cost: z.number().optional(), // from LiteLLM, maps to input_cache_read
    litellm_provider: z.string().optional(),
    mode: z
      .enum([
        "chat",
        "embedding",
        "completion",
        "image_generation",
        "audio_transcription",
        "audio_speech",
        "moderation",
        "rerank",
        "responses",
        "video_generation",
        "search",
        "ocr",
        "vector_store",
        "image_edit",
        "realtime",
      ])
      .optional(),
    supports_function_calling: z.boolean().optional(),
    supports_parallel_function_calling: z.boolean().optional(),
    supports_vision: z.boolean().optional(),
    supports_audio_input: z.boolean().optional(),
    supports_audio_output: z.boolean().optional(),
    supports_prompt_caching: z.boolean().optional(),
    supports_response_schema: z.boolean().optional(),
    supports_system_messages: z.boolean().optional(),
    supports_reasoning: z.boolean().optional(),
    supports_web_search: z.boolean().optional(),
    search_context_cost_per_query: searchContextCostPerQuerySchema,
    deprecation_date: z.string().optional(), // YYYY-MM-DD
  })
  .passthrough();

const liteLLMModelListSchema = z.record(liteLLMModelDetailSchema);

type LiteLLMModelDetail = z.infer<typeof liteLLMModelDetailSchema>;
type LiteLLMModelList = z.infer<typeof liteLLMModelListSchema>;
type LocalModelDetail = ModelSpec; // Use ModelSpec from schema/models.ts
type LocalModelList = { [name: string]: ModelSpec }; // Use ModelSpec from schema/models.ts

export function isSupportedRemoteModel(
  remoteModel: LiteLLMModelDetail,
): boolean {
  return remoteModel.mode !== "embedding";
}

const LOCAL_MODEL_LIST_PATH = path.resolve(
  __dirname,
  "../schema/model_list.json",
);
const SCHEMA_INDEX_PATH = path.resolve(__dirname, "../schema/index.ts");
const REMOTE_MODEL_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/litellm/model_prices_and_context_window_backup.json";

async function fetchRemoteModels(url: string): Promise<LiteLLMModelList> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const jsonData = JSON.parse(data);
            if (
              jsonData &&
              typeof jsonData === "object" &&
              "sample_spec" in jsonData
            ) {
              delete jsonData.sample_spec;
            }
            const parsedModels = liteLLMModelListSchema.parse(jsonData);
            resolve(parsedModels);
          } catch (error) {
            if (error instanceof z.ZodError) {
              console.error(
                "Zod validation errors in remote data:",
                error.errors,
              );
              reject(
                new Error(
                  "Failed to parse remote JSON due to schema validation errors.",
                ),
              );
            } else {
              reject(
                new Error(
                  "Failed to parse remote JSON: " + (error as Error).message,
                ),
              );
            }
          }
        });
      })
      .on("error", (err) => {
        reject(new Error("Failed to fetch remote models: " + err.message));
      });
  });
}

async function readLocalModels(filePath: string): Promise<LocalModelList> {
  try {
    const fileContent = await fs.promises.readFile(filePath, "utf-8");
    const localData = JSON.parse(fileContent);
    // Validate local data with the imported ModelSchema
    return z.record(ModelSchema).parse(localData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        "Zod validation errors in local model_list.json:",
        error.errors,
      );
      throw new Error("Local model_list.json failed Zod validation.");
    }
    throw new Error(
      "Failed to read or parse local model list: " + (error as Error).message,
    );
  }
}

type ResolvedRemoteEntry = {
  remoteModelName: string;
  remoteModel: LiteLLMModelDetail;
  mergedProviders: string[];
};

// Deduplicate remote models by their translated (local) name.
// When multiple remote names translate to the same local name, the model data
// from the first entry is kept and providers from all entries are merged.
function resolveRemoteModels(
  remoteModels: LiteLLMModelList,
  providerFilter?: string,
): Map<string, ResolvedRemoteEntry> {
  const result = new Map<string, ResolvedRemoteEntry>();

  // Sort by provider then model name so collision resolution is deterministic
  // regardless of JSON key order. The alphabetically earliest provider wins as
  // the primary entry (its model data is kept); remaining entries only contribute
  // their providers to the merged list.
  const sortedNames = Object.keys(remoteModels).sort((a, b) => {
    const pa = remoteModels[a].litellm_provider ?? "";
    const pb = remoteModels[b].litellm_provider ?? "";
    return pa !== pb ? pa.localeCompare(pb) : a.localeCompare(b);
  });

  for (const remoteModelName of sortedNames) {
    const remoteModel = remoteModels[remoteModelName];

    if (!matchesProviderFilter(remoteModelName, remoteModel, providerFilter)) {
      continue;
    }
    if (!isSupportedRemoteModel(remoteModel)) {
      continue;
    }

    const translatedName = translateToBraintrust(
      remoteModelName,
      remoteModel.litellm_provider,
    );
    if (
      !isSupportedTranslatedModelName(
        translatedName,
        remoteModel.litellm_provider,
      )
    ) {
      console.warn(
        `Skipping unsupported remote model: "${remoteModelName}" -> "${translatedName}"`,
      );
      continue;
    }
    const providers = getProviderMappingForModel(remoteModelName, remoteModel);

    if (result.has(translatedName)) {
      const existing = result.get(translatedName)!;
      const newProviders = providers.filter(
        (p) => !existing.mergedProviders.includes(p),
      );
      const mergedProviders = [...existing.mergedProviders, ...newProviders];
      if (newProviders.length > 0) {
        console.warn(
          `⚠️  Collision: "${remoteModelName}" and "${existing.remoteModelName}" both translate to "${translatedName}" — merging providers: ${JSON.stringify(mergedProviders)}`,
        );
      } else {
        console.warn(
          `⚠️  Collision: "${remoteModelName}" and "${existing.remoteModelName}" both translate to "${translatedName}" — same providers, keeping first entry`,
        );
      }
      result.set(translatedName, { ...existing, mergedProviders });
    } else {
      result.set(translatedName, {
        remoteModelName,
        remoteModel,
        mergedProviders: providers,
      });
    }
  }

  return result;
}

function mergeLocalModelDetails(
  primary: LocalModelDetail,
  secondary: LocalModelDetail,
): LocalModelDetail {
  return {
    ...secondary,
    ...primary,
  };
}

export function getUpdatedAvailableProviders(
  currentProviders: string[] | undefined,
  remoteProviders: string[],
  providerFilterApplied: boolean,
): string[] {
  if (!providerFilterApplied) {
    return remoteProviders;
  }

  const mergedProviders = [...(currentProviders ?? [])];
  for (const provider of remoteProviders) {
    if (!mergedProviders.includes(provider)) {
      mergedProviders.push(provider);
    }
  }
  return mergedProviders;
}

export function normalizeLocalModels(localModels: LocalModelList): {
  models: LocalModelList;
  renamedKeys: Array<{ from: string; to: string }>;
} {
  const normalizedModels: LocalModelList = {};
  const orderedNames: string[] = [];
  const renamedKeys: Array<{ from: string; to: string }> = [];

  for (const [modelName, model] of Object.entries(localModels)) {
    const canonicalName = canonicalizeLocalModelName(modelName);
    if (canonicalName !== modelName) {
      renamedKeys.push({ from: modelName, to: canonicalName });
    }

    const existing = normalizedModels[canonicalName];
    if (!existing) {
      normalizedModels[canonicalName] = model;
      orderedNames.push(canonicalName);
      continue;
    }

    const hasCanonicalSource = Object.prototype.hasOwnProperty.call(
      localModels,
      canonicalName,
    );

    if (canonicalName === modelName) {
      normalizedModels[canonicalName] = model;
      continue;
    }

    if (hasCanonicalSource) {
      continue;
    }

    normalizedModels[canonicalName] = mergeLocalModelDetails(existing, model);
  }

  const orderedModels: LocalModelList = {};
  for (const modelName of orderedNames) {
    orderedModels[modelName] = normalizedModels[modelName];
  }

  return {
    models: orderedModels,
    renamedKeys,
  };
}

function reorderModelProperties(localModels: LocalModelList): LocalModelList {
  const orderedModelsToWrite: LocalModelList = {};
  const schemaKeys = Object.keys(ModelSchema.shape) as Array<keyof ModelSpec>;

  for (const modelName in localModels) {
    const originalModel = localModels[modelName];
    const orderedModel: Partial<ModelSpec> = {};

    for (const key of schemaKeys) {
      if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
        (orderedModel as any)[key] = originalModel[key];
      }
    }

    for (const key in originalModel) {
      if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
        if (!schemaKeys.includes(key as keyof ModelSpec)) {
          (orderedModel as any)[key] = (originalModel as any)[key];
        }
      }
    }

    orderedModelsToWrite[modelName] = orderedModel as ModelSpec;
  }

  return orderedModelsToWrite;
}

async function writeLocalModels(localModels: LocalModelList): Promise<void> {
  const orderedModelsToWrite = reorderModelProperties(localModels);
  await fs.promises.writeFile(
    LOCAL_MODEL_LIST_PATH,
    JSON.stringify(orderedModelsToWrite, null, 2) + "\n",
  );
}

function getNonZeroNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || value === 0) {
    return undefined;
  }

  return value;
}

type ProviderMappingEntryRange = {
  start: number;
  end: number;
};

function isProviderMappingEntryEnd(line: string): boolean {
  return /\],(?:\s*\/\/.*)?$/.test(line.trim());
}

function findProviderMappingEntryRange(
  lines: string[],
  modelName: string,
): ProviderMappingEntryRange | undefined {
  const entryPrefix = `  "${modelName}":`;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(entryPrefix)) {
      continue;
    }

    let end = i;
    while (end < lines.length && !isProviderMappingEntryEnd(lines[end])) {
      end += 1;
    }

    return { start: i, end };
  }

  return undefined;
}

export function normalizeProviderMappingContent(schemaContent: string): string {
  const lines = schemaContent.split("\n");
  const normalizedLines: string[] = [];
  const seenCanonicalKeys = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^  "([^"]+)":/);
    if (!match) {
      if (lines[i].trim() === "],") {
        continue;
      }

      normalizedLines.push(lines[i]);
      continue;
    }

    const originalKey = match[1];
    const canonicalKey = canonicalizeLocalModelName(originalKey);
    const entryLines = [lines[i]];

    while (
      i + 1 < lines.length &&
      !isProviderMappingEntryEnd(entryLines[entryLines.length - 1])
    ) {
      i += 1;
      entryLines.push(lines[i]);
    }

    if (seenCanonicalKeys.has(canonicalKey)) {
      continue;
    }

    if (canonicalKey !== originalKey) {
      entryLines[0] = entryLines[0].replace(originalKey, canonicalKey);
    }

    normalizedLines.push(...entryLines);
    seenCanonicalKeys.add(canonicalKey);
  }

  while (
    normalizedLines.length > 0 &&
    normalizedLines[normalizedLines.length - 1].trim() === ""
  ) {
    normalizedLines.pop();
  }

  if (normalizedLines.length === 0) {
    return "";
  }

  return `${normalizedLines.join("\n")}\n`;
}

async function normalizeProviderMappingsFile(): Promise<void> {
  const schemaContent = await fs.promises.readFile(SCHEMA_INDEX_PATH, "utf-8");
  const normalizedContent = normalizeProviderMappingContent(schemaContent);

  if (normalizedContent !== schemaContent) {
    await fs.promises.writeFile(SCHEMA_INDEX_PATH, normalizedContent);
  }
}

export function formatProviderMappingProviders(providers: string[]): string {
  return `[${providers.map((provider) => JSON.stringify(provider)).join(", ")}]`;
}

async function updateProviderMapping(
  newModels: Array<{
    name: string;
    providers: string[];
    remoteModel: LiteLLMModelDetail;
  }>,
  completeModelOrder?: string[],
): Promise<void> {
  try {
    const schemaContent = await fs.promises.readFile(
      SCHEMA_INDEX_PATH,
      "utf-8",
    );
    const normalizedContent = normalizeProviderMappingContent(schemaContent);
    const lines = normalizedContent.split("\n");
    let changed = normalizedContent !== schemaContent;

    for (const { name, providers } of newModels) {
      if (findProviderMappingEntryRange(lines, name)) {
        continue;
      }

      const newEntry = `  "${name}": ${formatProviderMappingProviders(providers)},`;
      let insertionIndex = -1;

      if (completeModelOrder) {
        const modelPosition = completeModelOrder.indexOf(name);
        if (modelPosition !== -1) {
          for (let i = modelPosition - 1; i >= 0; i--) {
            const range = findProviderMappingEntryRange(
              lines,
              completeModelOrder[i],
            );
            if (range) {
              insertionIndex = range.end + 1;
              break;
            }
          }

          if (insertionIndex === -1) {
            for (
              let i = modelPosition + 1;
              i < completeModelOrder.length;
              i++
            ) {
              const range = findProviderMappingEntryRange(
                lines,
                completeModelOrder[i],
              );
              if (range) {
                insertionIndex = range.start;
                break;
              }
            }
          }
        }
      }

      if (insertionIndex === -1) {
        const closingBraceIndex = lines.lastIndexOf("};");
        insertionIndex =
          closingBraceIndex === -1 ? lines.length : closingBraceIndex;
      }

      lines.splice(insertionIndex, 0, newEntry);
      changed = true;
    }

    if (changed) {
      await fs.promises.writeFile(
        SCHEMA_INDEX_PATH,
        normalizeProviderMappingContent(lines.join("\n")),
      );
      console.log(
        `✅ Updated provider mappings for ${newModels.length} models in schema/index.ts`,
      );
    }
  } catch (error) {
    console.error("Failed to update provider mappings:", error);
  }
}

export function convertRemoteToLocalModel(
  remoteModelName: string,
  remoteModel: LiteLLMModelDetail,
): ModelSpec {
  const baseModel: Partial<ModelSpec> = {
    format: "openai", // Default format for most models
    flavor: "chat", // Default flavor for most models
  };

  // Helper to round cost values to avoid floating point precision issues
  const roundCost = (costPerToken: number): number => {
    return parseFloat((costPerToken * 1_000_000).toFixed(8));
  };

  // Add multimodal support if indicated
  if (remoteModel.supports_vision) {
    baseModel.multimodal = true;
  }

  // Add reasoning support if indicated
  if (remoteModel.supports_reasoning) {
    baseModel.reasoning = true;
  }

  // Convert cost information
  const inputCostPerToken = getNonZeroNumber(remoteModel.input_cost_per_token);
  if (inputCostPerToken !== undefined) {
    baseModel.input_cost_per_mil_tokens = roundCost(inputCostPerToken);
  }
  const outputCostPerToken = getNonZeroNumber(
    remoteModel.output_cost_per_token,
  );
  if (outputCostPerToken !== undefined) {
    baseModel.output_cost_per_mil_tokens = roundCost(outputCostPerToken);
  }
  const cacheReadInputTokenCost = getNonZeroNumber(
    remoteModel.cache_read_input_token_cost,
  );
  if (cacheReadInputTokenCost !== undefined) {
    baseModel.input_cache_read_cost_per_mil_tokens = roundCost(
      cacheReadInputTokenCost,
    );
  }
  const cacheCreationInputTokenCost = getNonZeroNumber(
    remoteModel.cache_creation_input_token_cost,
  );
  if (cacheCreationInputTokenCost !== undefined) {
    baseModel.input_cache_write_cost_per_mil_tokens = roundCost(
      cacheCreationInputTokenCost,
    );
  }
  // Note: output_reasoning_cost_per_mil_tokens may not be in ModelSpec yet,
  // so we'll skip this for now to avoid type errors
  // if (remoteModel.output_cost_per_reasoning_token) {
  //   baseModel.output_reasoning_cost_per_mil_tokens = roundCost(remoteModel.output_cost_per_reasoning_token);
  // }

  // Add token limits
  const maxInputTokens = getNonZeroNumber(remoteModel.max_input_tokens);
  if (maxInputTokens !== undefined) {
    baseModel.max_input_tokens = maxInputTokens;
  }
  const maxOutputTokens = getNonZeroNumber(remoteModel.max_output_tokens);
  if (maxOutputTokens !== undefined) {
    baseModel.max_output_tokens = maxOutputTokens;
  }
  if (remoteModel.deprecation_date) {
    baseModel.deprecation_date = remoteModel.deprecation_date;
  }

  const providers = getProviderMappingForModel(remoteModelName, remoteModel);
  if (providers.length > 0) {
    baseModel.available_providers =
      providers as ModelSpec["available_providers"];
  }

  return baseModel as ModelSpec;
}

async function getOptimalModelOrderingFromClaude(
  modelsToAdd: Array<{ name: string; model: ModelSpec }>,
  existingModels: LocalModelList,
): Promise<string[]> {
  const existingModelNames = Object.keys(existingModels);
  const newModelNames = modelsToAdd.map((m) => m.name);

  // Focus on grok models for validation
  const grokModels = existingModelNames.filter((name) => name.includes("grok"));

  const prompt = `Order these Grok models optimally:

EXISTING: ${grokModels.join(", ")}
NEW: ${newModelNames.join(", ")}

Rules: version desc (4→3→2), then base→latest→variants, then larger→smaller sizes.

JSON array only:`;

  try {
    const output = await callClaudeWithSpawn(prompt);

    // Try to extract JSON from the output
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsedOrder = JSON.parse(jsonMatch[0]);

        // Validate that all grok models are included
        const allGrokModels = [...grokModels, ...newModelNames];
        if (
          parsedOrder.length === allGrokModels.length &&
          parsedOrder.every((name) => allGrokModels.includes(name)) &&
          allGrokModels.every((name) => parsedOrder.includes(name))
        ) {
          console.log("✅ Claude Code provided optimal Grok ordering");
          // Rebuild complete model list with optimally ordered grok models
          return rebuildCompleteModelList(existingModelNames, parsedOrder);
        } else {
          console.warn(
            `Claude response validation failed: got ${parsedOrder.length} grok models, expected ${allGrokModels.length}`,
          );
        }
      } catch (parseError) {
        console.warn(
          "Failed to parse Claude's JSON response:",
          parseError.message,
        );
      }
    } else {
      console.warn("No JSON array found in Claude's response");
    }

    console.warn(
      "Could not use Claude's response, falling back to smart ordering",
    );
    return getFallbackCompleteOrdering(existingModelNames, newModelNames);
  } catch (error) {
    console.warn("Failed to get ordering from Claude:", error.message);
    return getFallbackCompleteOrdering(existingModelNames, newModelNames);
  }
}

function callClaudeWithSpawn(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const claude = spawn("claude", [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;

    // Set up timeout
    const timeout = setTimeout(() => {
      if (!isResolved) {
        claude.kill("SIGTERM");
        isResolved = true;
        reject(new Error("Claude CLI timeout after 15 seconds"));
      }
    }, 15000);

    claude.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    claude.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        if (code === 0) {
          // Try stderr first, then stdout
          const output = stderr.trim() || stdout.trim();
          resolve(output);
        } else {
          reject(new Error(`Claude CLI exited with code ${code}`));
        }
      }
    });

    claude.on("error", (error) => {
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    });

    // Send the prompt to stdin and close it
    claude.stdin.write(prompt);
    claude.stdin.end();
  });
}

function rebuildCompleteModelList(
  existingModelNames: string[],
  orderedGrokModels: string[],
): string[] {
  // Start with existing models, replace grok models with the optimally ordered ones
  const result: string[] = [];
  const grokModelSet = new Set(orderedGrokModels);
  let grokInserted = false;

  for (const modelName of existingModelNames) {
    if (modelName.includes("grok")) {
      // Skip individual grok models, we'll insert them all at once
      if (!grokInserted) {
        result.push(...orderedGrokModels);
        grokInserted = true;
      }
    } else {
      result.push(modelName);
    }
  }

  // If no grok models were in the original list, add them at the end
  if (!grokInserted) {
    result.push(...orderedGrokModels);
  }

  return result;
}

async function findMissingCommand(argv: any) {
  try {
    console.log("Fetching remote models from:", REMOTE_MODEL_URL);
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const localModels = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    ).models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const localModelNames = new Set(Object.keys(localModels));
    const missingInLocal: string[] = [];
    const consideredRemoteModels: LiteLLMModelList = {};
    const filteredRemoteModels: LiteLLMModelList = {};

    for (const [remoteModelName, remoteModel] of Object.entries(remoteModels)) {
      if (
        matchesProviderFilter(remoteModelName, remoteModel, argv.provider) &&
        isSupportedRemoteModel(remoteModel)
      ) {
        filteredRemoteModels[remoteModelName] = remoteModel;
      }
    }

    const resolvedRemote = resolveRemoteModels(filteredRemoteModels);

    for (const [
      translatedName,
      { remoteModelName, remoteModel },
    ] of resolvedRemote) {
      consideredRemoteModels[remoteModelName] = remoteModel;
      if (argv.provider) {
        console.log(
          `[DEBUG] Remote: ${remoteModelName} (Provider: ${
            remoteModel.litellm_provider || "N/A"
          }) -> Translated: ${translatedName}`,
        );
      }
      if (!localModelNames.has(translatedName)) {
        missingInLocal.push(remoteModelName);
      }
    }

    if (argv.summarize) {
      console.log("\n--- Model Summary by Provider ---");
      if (argv.provider) {
        console.log(`(Filtered for provider: ${argv.provider})`);
      }
      const providerSummary: {
        [provider: string]: { totalRemote: number; missingInLocal: number };
      } = {};

      for (const modelName in filteredRemoteModels) {
        const modelDetail = filteredRemoteModels[modelName];
        const provider = modelDetail.litellm_provider || "Unknown Provider";
        if (!providerSummary[provider]) {
          providerSummary[provider] = { totalRemote: 0, missingInLocal: 0 };
        }
        providerSummary[provider].totalRemote++;
      }

      for (const modelName of missingInLocal) {
        const modelDetail = consideredRemoteModels[modelName];
        if (modelDetail) {
          const provider = modelDetail.litellm_provider || "Unknown Provider";
          if (!providerSummary[provider]) {
            providerSummary[provider] = { totalRemote: 0, missingInLocal: 0 };
          }
          providerSummary[provider].missingInLocal++;
        } else {
          const unknownProvider = "Unknown Provider (Details Missing)";
          if (!providerSummary[unknownProvider]) {
            providerSummary[unknownProvider] = {
              totalRemote: 0,
              missingInLocal: 0,
            };
          }
          providerSummary[unknownProvider].missingInLocal++;
        }
      }

      const partiallyMissingProviders: string[] = [];
      const completelyMissingProviders: string[] = [];
      const allPresentProviders: string[] = [];
      const sortedProviderNames = Object.keys(providerSummary).sort();

      for (const provider of sortedProviderNames) {
        const summary = providerSummary[provider];
        if (summary.missingInLocal > 0) {
          if (summary.missingInLocal < summary.totalRemote) {
            partiallyMissingProviders.push(provider);
          } else {
            completelyMissingProviders.push(provider);
          }
        } else {
          allPresentProviders.push(provider);
        }
      }

      if (partiallyMissingProviders.length > 0) {
        console.log("\n--- Providers with Some Models Missing ---");
        for (const provider of partiallyMissingProviders) {
          const summary = providerSummary[provider];
          console.log(
            `${provider}: ${summary.missingInLocal} missing out of ${summary.totalRemote} total remote models.`,
          );
        }
      }

      if (completelyMissingProviders.length > 0) {
        console.log("\n--- Providers with All Models Missing ---");
        for (const provider of completelyMissingProviders) {
          const summary = providerSummary[provider];
          console.log(
            `${provider}: All ${summary.missingInLocal} of ${summary.totalRemote} remote models are missing.`,
          );
        }
      }

      if (allPresentProviders.length > 0) {
        console.log("\n--- Providers with All Models Present ---");
        for (const provider of allPresentProviders) {
          const summary = providerSummary[provider];
          console.log(
            `${provider}: All ${summary.totalRemote} remote models present locally.`,
          );
        }
      }

      if (missingInLocal.length === 0) {
        console.log(
          "\nAll models from the remote list are present in the local model_list.json.",
        );
      } else if (
        partiallyMissingProviders.length === 0 &&
        completelyMissingProviders.length === 0
      ) {
        // This implies missingInLocal > 0 but they didn't fit categories,
        // possibly due to provider filtering or no provider info.
        console.log(
          "\nSome models are missing. If a provider filter was used, they might be outside that scope or have no provider information.",
        );
        if (!argv.provider)
          console.log(
            "Run without --summarize to see individual missing models.",
          );
      }
    } else {
      if (missingInLocal.length > 0) {
        if (argv.provider) {
          console.log(
            `\nModels for provider '${argv.provider}' present in remote but missing in local:`,
          );
        } else {
          console.log(
            "\nModels present in remote but missing in local model_list.json:",
          );
        }
        missingInLocal.forEach((modelName) => {
          const detail = consideredRemoteModels[modelName];
          const translated = translateToBraintrust(
            modelName,
            detail?.litellm_provider,
          );
          console.log(
            `${modelName} (Provider: ${
              detail?.litellm_provider || "N/A"
            }, Translated: ${translated})`,
          );
        });
      } else {
        console.log(
          "\nAll models from the remote list (matching filter if any) are present in the local model_list.json.",
        );
      }
    }
  } catch (error) {
    console.error("Error during find-missing command:", error);
    process.exit(1);
  }
}

async function updateModelsCommand(argv: any) {
  try {
    console.log("Fetching remote models for model update...");
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models for model update...");
    const normalizedLocalData = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    );
    const localModels = normalizedLocalData.models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const updatedLocalModels = JSON.parse(
      JSON.stringify(localModels),
    ) as LocalModelList;
    let madeChanges = false;

    console.log("\n--- Model Update Report ---");
    if (argv.provider) {
      console.log(`(Filtered for provider: ${argv.provider})`);
    }
    let discrepanciesFound = 0;

    const modelsToCompare: Array<{
      localModelName: string;
      localModelDetail: LocalModelDetail;
      remoteModelName: string;
      remoteModelDetail: LiteLLMModelDetail;
      mergedProviders: string[];
    }> = [];

    const resolvedRemote = resolveRemoteModels(remoteModels, argv.provider);

    if (argv.provider) {
      for (const [
        translatedRemoteModelName,
        { remoteModelName, remoteModel: remoteModelDetail, mergedProviders },
      ] of resolvedRemote) {
        if (localModels[translatedRemoteModelName]) {
          modelsToCompare.push({
            localModelName: translatedRemoteModelName,
            localModelDetail: localModels[translatedRemoteModelName],
            remoteModelName,
            remoteModelDetail,
            mergedProviders,
          });
        }
      }
    } else {
      for (const localModelName in localModels) {
        const localModelDetail = localModels[localModelName];
        const resolvedEntry = resolvedRemote.get(localModelName);
        if (resolvedEntry) {
          modelsToCompare.push({
            localModelName,
            localModelDetail,
            remoteModelName: resolvedEntry.remoteModelName,
            remoteModelDetail: resolvedEntry.remoteModel,
            mergedProviders: resolvedEntry.mergedProviders,
          });
        }
      }
    }

    for (const item of modelsToCompare) {
      const {
        localModelName,
        localModelDetail,
        remoteModelName: originalRemoteModelName,
        remoteModelDetail,
        mergedProviders,
      } = item;
      const modelInUpdatedList = updatedLocalModels[localModelName];

      const localInputCost = localModelDetail.input_cost_per_mil_tokens;
      const localOutputCost = localModelDetail.output_cost_per_mil_tokens;
      const localCacheReadCost =
        localModelDetail.input_cache_read_cost_per_mil_tokens;
      const localCacheWriteCost =
        localModelDetail.input_cache_write_cost_per_mil_tokens;

      const remoteInputCostPerToken = remoteModelDetail.input_cost_per_token;
      const remoteOutputCostPerToken = remoteModelDetail.output_cost_per_token;
      const remoteCacheReadCostPerToken =
        remoteModelDetail.cache_read_input_token_cost;
      const remoteCacheWriteCostPerToken =
        remoteModelDetail.cache_creation_input_token_cost;

      let modelReportedThisIteration = false;

      const reportModelIfNeeded = () => {
        if (!modelReportedThisIteration) {
          console.log(
            argv.write
              ? `\n[WRITE] Updating model for: ${localModelName} (Remote: ${originalRemoteModelName})`
              : `\nModel: ${localModelName} (Remote: ${originalRemoteModelName})`,
          );
          modelReportedThisIteration = true;
        }
      };

      const checkAndUpdateCost = (
        costType: string,
        localCost: number | undefined | null,
        remoteCostPerToken: number | undefined,
        localFieldName: keyof ModelSpec,
      ) => {
        const normalizedRemoteCostPerToken =
          getNonZeroNumber(remoteCostPerToken);
        if (normalizedRemoteCostPerToken !== undefined) {
          const remoteCostPerMil = normalizedRemoteCostPerToken * 1_000_000;
          const roundedRemoteCostPerMil = parseFloat(
            remoteCostPerMil.toFixed(8),
          );

          if (
            localCost === null ||
            typeof localCost !== "number" ||
            Math.abs(localCost - remoteCostPerMil) > 1e-9
          ) {
            if (!argv.write) {
              reportModelIfNeeded();
              console.log(
                `  ${costType} Cost Mismatch/Missing: Local: ${
                  localCost ?? "Not available"
                }, Remote (calc): ${remoteCostPerMil} (would write: ${roundedRemoteCostPerMil}) (from ${normalizedRemoteCostPerToken}/token)`,
              );
            }
            discrepanciesFound++;
            if (argv.write) {
              Reflect.set(
                modelInUpdatedList,
                localFieldName,
                roundedRemoteCostPerMil,
              );
              madeChanges = true;
              reportModelIfNeeded();
              console.log(
                `  [WRITE] Updated ${costType} Cost to: ${roundedRemoteCostPerMil}`,
              );
            }
          }
        } else if (typeof localCost === "number") {
          if (!argv.write) {
            reportModelIfNeeded();
            console.log(
              `  ${costType} Cost: Local: ${localCost}, Remote: Not available`,
            );
          }
        }
      };

      const checkAndUpdateTokenLimit = (
        limitType: string,
        localLimit: number | undefined | null,
        remoteLimit: number | undefined,
        localFieldName: keyof ModelSpec,
      ) => {
        const normalizedRemoteLimit = getNonZeroNumber(remoteLimit);
        if (normalizedRemoteLimit !== undefined) {
          if (
            localLimit === null ||
            typeof localLimit !== "number" ||
            localLimit !== normalizedRemoteLimit
          ) {
            if (!argv.write) {
              reportModelIfNeeded();
              console.log(
                `  ${limitType} Token Limit Mismatch/Missing: Local: ${
                  localLimit ?? "Not available"
                }, Remote: ${normalizedRemoteLimit}`,
              );
            }
            discrepanciesFound++;
            if (argv.write) {
              Reflect.set(
                modelInUpdatedList,
                localFieldName,
                normalizedRemoteLimit,
              );
              madeChanges = true;
              reportModelIfNeeded();
              console.log(
                `  [WRITE] Updated ${limitType} Token Limit to: ${normalizedRemoteLimit}`,
              );
            }
          }
        } else if (typeof localLimit === "number") {
          if (!argv.write) {
            reportModelIfNeeded();
            console.log(
              `  ${limitType} Token Limit: Local: ${localLimit}, Remote: Not available`,
            );
          }
        }
      };

      const checkAndUpdateDeprecationDate = (
        localDeprecationDate: string | undefined | null,
        remoteDeprecationDate: string | undefined,
      ) => {
        if (typeof remoteDeprecationDate === "string") {
          if (
            localDeprecationDate === null ||
            typeof localDeprecationDate !== "string" ||
            localDeprecationDate !== remoteDeprecationDate
          ) {
            if (!argv.write) {
              reportModelIfNeeded();
              console.log(
                `  Deprecation Date Mismatch/Missing: Local: ${
                  localDeprecationDate ?? "Not available"
                }, Remote: ${remoteDeprecationDate}`,
              );
            }
            discrepanciesFound++;
            if (argv.write) {
              Reflect.set(
                modelInUpdatedList,
                "deprecation_date",
                remoteDeprecationDate,
              );
              madeChanges = true;
              reportModelIfNeeded();
              console.log(
                `  [WRITE] Updated Deprecation Date to: ${remoteDeprecationDate}`,
              );
            }
          }
        } else if (typeof localDeprecationDate === "string") {
          if (!argv.write) {
            reportModelIfNeeded();
            console.log(
              `  Deprecation Date: Local: ${localDeprecationDate}, Remote: Not available`,
            );
          }
        }
      };

      checkAndUpdateCost(
        "Input",
        localInputCost,
        remoteInputCostPerToken,
        "input_cost_per_mil_tokens",
      );
      checkAndUpdateCost(
        "Output",
        localOutputCost,
        remoteOutputCostPerToken,
        "output_cost_per_mil_tokens",
      );
      checkAndUpdateCost(
        "Cache Read",
        localCacheReadCost,
        remoteCacheReadCostPerToken,
        "input_cache_read_cost_per_mil_tokens",
      );
      checkAndUpdateCost(
        "Cache Write",
        localCacheWriteCost,
        remoteCacheWriteCostPerToken,
        "input_cache_write_cost_per_mil_tokens",
      );

      // Check and update token limits
      const localMaxInputTokens = localModelDetail.max_input_tokens;
      const localMaxOutputTokens = localModelDetail.max_output_tokens;
      const remoteMaxInputTokens = remoteModelDetail.max_input_tokens;
      const remoteMaxOutputTokens = remoteModelDetail.max_output_tokens;

      // Check and update deprecation date
      const localDeprecationDate = localModelDetail.deprecation_date;
      const remoteDeprecationDate = remoteModelDetail.deprecation_date;

      checkAndUpdateTokenLimit(
        "Max Input",
        localMaxInputTokens,
        remoteMaxInputTokens,
        "max_input_tokens",
      );
      checkAndUpdateTokenLimit(
        "Max Output",
        localMaxOutputTokens,
        remoteMaxOutputTokens,
        "max_output_tokens",
      );

      // Check and update deprecation date
      checkAndUpdateDeprecationDate(
        localDeprecationDate,
        remoteDeprecationDate,
      );

      // Set available_providers from remote (using merged providers across all colliding remote entries)
      const remoteProviders = getUpdatedAvailableProviders(
        Array.isArray(modelInUpdatedList.available_providers)
          ? modelInUpdatedList.available_providers
          : undefined,
        mergedProviders,
        Boolean(argv.provider),
      );
      if (remoteProviders.length > 0) {
        const currentProviders = (modelInUpdatedList as any)
          .available_providers;
        const same =
          Array.isArray(currentProviders) &&
          currentProviders.length === remoteProviders.length &&
          currentProviders.every(
            (p: string, i: number) => p === remoteProviders[i],
          );
        if (!same) {
          (modelInUpdatedList as any).available_providers = remoteProviders;
          discrepanciesFound++;
          madeChanges = true;
          if (!modelReportedThisIteration) {
            console.log(
              `\n[WRITE] Updating model for: ${localModelName} (Remote: ${originalRemoteModelName})`,
            );
            modelReportedThisIteration = true;
          }
          console.log(
            `  [WRITE] Updated available_providers to: ${JSON.stringify(remoteProviders)}`,
          );
        }
      }
    }

    // Only sync Vertex regions for models that were actually in scope for this
    // run (i.e. the provider-filtered set), not the entire local model list.
    // This prevents `update-models --provider openai` from touching unrelated
    // Vertex Gemini entries.
    const modelsInScope = modelsToCompare.map((item) => item.localModelName);
    const shouldSyncVertexRegions = modelsInScope.some((name) =>
      updatedLocalModels[name]?.available_providers?.includes("vertex"),
    );

    if (shouldSyncVertexRegions) {
      console.log(
        `\nFetching Vertex supported regions from: ${GOOGLE_VERTEX_LOCATIONS_URL}`,
      );
      const supportedRegionsByModel = await fetchVertexSupportedRegions();
      const updatedVertexModels = syncVertexSupportedRegions(
        updatedLocalModels,
        supportedRegionsByModel,
      );
      if (updatedVertexModels.size > 0) {
        discrepanciesFound += updatedVertexModels.size;
        madeChanges = true;
        for (const [modelName, supportedRegions] of updatedVertexModels) {
          const regions = supportedRegions.length
            ? supportedRegions.join(", ")
            : "(cleared)";
          console.log(
            `  ${argv.write ? "[WRITE]" : "[DRY RUN]"} Updating supported_regions for ${modelName}: ${regions}`,
          );
        }
      }
    }

    if (argv.write) {
      if (madeChanges) {
        await writeLocalModels(updatedLocalModels);
        await normalizeProviderMappingsFile();
        console.log(
          `\nLocal model_list.json has been updated with new model information (pricing, token limits) and keys ordered according to schema.`,
        );
      } else {
        console.log(
          "\nNo model updates were necessary for local model_list.json.",
        );
      }
    } else {
      if (discrepanciesFound === 0) {
        console.log(
          "\nNo model discrepancies found for models present in both lists (or matching filter).",
        );
      } else {
        console.log(
          `\nFound ${discrepanciesFound} model discrepancies/missing local data that could be updated from remote.`,
        );
      }
    }
  } catch (error) {
    console.error("Error during update-models command:", error);
    process.exit(1);
  }
}

async function addModelsCommand(argv: any) {
  try {
    console.log("Fetching remote models from:", REMOTE_MODEL_URL);
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const normalizedLocalData = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    );
    const localModels = normalizedLocalData.models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const localModelNames = new Set(Object.keys(localModels));
    const missingInLocal: Array<{
      remoteModelName: string;
      translatedName: string;
      remoteModel: LiteLLMModelDetail;
      mergedProviders: string[];
    }> = [];

    // Find missing models, deduplicating by translated name and merging providers
    const resolvedRemote = resolveRemoteModels(remoteModels, argv.provider);
    for (const [
      translatedModelName,
      { remoteModelName, remoteModel: modelDetail, mergedProviders },
    ] of resolvedRemote) {
      if (argv.filter) {
        const lowerFilter = argv.filter.toLowerCase();
        if (
          !translatedModelName.toLowerCase().includes(lowerFilter) &&
          !remoteModelName.toLowerCase().includes(lowerFilter)
        ) {
          continue;
        }
      }

      const equivalentLocalNames =
        getEquivalentLocalModelNames(translatedModelName);
      if (!equivalentLocalNames.some((name) => localModelNames.has(name))) {
        missingInLocal.push({
          remoteModelName,
          translatedName: translatedModelName,
          remoteModel: modelDetail,
          mergedProviders,
        });
      }
    }

    if (missingInLocal.length === 0) {
      console.log("No missing models found to add.");

      // Check if we need to update provider mappings for existing models
      if (argv.updateProviders) {
        console.log("Checking for missing provider mappings...");
        const schemaContent = await fs.promises.readFile(
          SCHEMA_INDEX_PATH,
          "utf-8",
        );

        // Check which grok models are missing from provider mappings
        const allGrokModels = Object.keys(localModels).filter((name) =>
          name.includes("grok"),
        );
        const missingProviderMappings = [];

        for (const model of allGrokModels) {
          if (!schemaContent.includes(`"${model}": ["xAI"]`)) {
            missingProviderMappings.push({
              name: model,
              providers: ["xAI"],
              remoteModel: { litellm_provider: "xai" },
            });
          }
        }

        if (missingProviderMappings.length > 0) {
          console.log(
            `Found ${missingProviderMappings.length} models missing provider mappings`,
          );
          await updateProviderMapping(
            missingProviderMappings,
            Object.keys(localModels),
          );
        } else {
          console.log("All models have provider mappings");
        }
      }

      return;
    }

    console.log(`\nFound ${missingInLocal.length} missing models:`);
    missingInLocal.forEach(({ remoteModelName, translatedName }) => {
      console.log(`  ${remoteModelName} -> ${translatedName}`);
    });

    // Convert remote models to local format
    const modelsToAdd = missingInLocal.map(
      ({ remoteModelName, translatedName, remoteModel, mergedProviders }) => {
        const model = convertRemoteToLocalModel(remoteModelName, remoteModel);
        // Override with merged providers (may include providers from colliding remote entries)
        if (mergedProviders.length > 0) {
          model.available_providers =
            mergedProviders as ModelSpec["available_providers"];
        }
        return { name: translatedName, model };
      },
    );

    const newModelNames = modelsToAdd.map((m) => m.name);

    // Prepare provider mapping data
    const providerMappingData = missingInLocal.map(
      ({ translatedName, remoteModel, mergedProviders }) => ({
        name: translatedName,
        providers: mergedProviders,
        remoteModel: remoteModel,
      }),
    );

    // Get complete optimal ordering
    console.log("\nDetermining optimal model ordering...");
    let completeModelOrder;

    if (process.env.USE_CLAUDE === "true") {
      console.log("Using Claude Code for ordering (USE_CLAUDE=true)");
      completeModelOrder = await getOptimalModelOrderingFromClaude(
        modelsToAdd,
        localModels,
      );
    } else {
      console.log("Using smart fallback ordering");
      completeModelOrder = getFallbackCompleteOrdering(
        Object.keys(localModels),
        newModelNames,
      );
    }

    // Rebuild the entire model list in the optimal order
    const updatedModels: LocalModelList = {};

    for (const modelName of completeModelOrder) {
      if (localModels[modelName]) {
        // Existing model - keep original
        updatedModels[modelName] = localModels[modelName];
      } else {
        // New model - add from modelsToAdd
        const modelToAdd = modelsToAdd.find((m) => m.name === modelName);
        if (modelToAdd) {
          updatedModels[modelName] = modelToAdd.model;
          console.log(`Added ${modelName}`);
        }
      }
    }

    // Only sync Vertex regions for the newly added models, not all pre-existing
    // models in updatedModels. This prevents `add-models -p openai` from
    // rewriting unrelated pre-existing Vertex Gemini records.
    const shouldSyncVertexRegions = modelsToAdd.some((m) =>
      m.model.available_providers?.includes("vertex"),
    );

    if (shouldSyncVertexRegions) {
      console.log(
        `\nFetching Vertex supported regions from: ${GOOGLE_VERTEX_LOCATIONS_URL}`,
      );
      const supportedRegionsByModel = await fetchVertexSupportedRegions();
      const updatedVertexModels = syncVertexSupportedRegions(
        updatedModels,
        supportedRegionsByModel,
      );
      for (const [modelName, supportedRegions] of updatedVertexModels) {
        const regions = supportedRegions.length
          ? supportedRegions.join(", ")
          : "(cleared)";
        console.log(
          `  ${argv.write ? "[WRITE]" : "[DRY RUN]"} Updating supported_regions for ${modelName}: ${regions}`,
        );
      }
    }

    if (argv.write) {
      await writeLocalModels(updatedModels);
      console.log(
        `\n✅ Successfully added ${missingInLocal.length} models to ${LOCAL_MODEL_LIST_PATH}`,
      );

      // Update provider mappings in schema/index.ts
      console.log("\nUpdating provider mappings...");
      await updateProviderMapping(providerMappingData, completeModelOrder);
    } else {
      console.log(`\n📋 To actually add these models, run with --write flag`);
      console.log(
        `   Example: npx tsx packages/proxy/scripts/sync_models.ts add-models -p ${
          argv.provider || "PROVIDER"
        } --write`,
      );
    }
  } catch (error) {
    console.error("Error during add-models command:", error);
    process.exit(1);
  }
}

async function normalizeLocalModelsCommand(argv: any) {
  try {
    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const normalizedLocalData = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    );
    const renamedKeys = normalizedLocalData.renamedKeys;

    if (renamedKeys.length === 0) {
      console.log("No local model keys needed normalization.");
      if (argv.write) {
        await normalizeProviderMappingsFile();
      }
      return;
    }

    console.log(`Found ${renamedKeys.length} local model keys to normalize:`);
    for (const { from, to } of renamedKeys) {
      console.log(`  ${from} -> ${to}`);
    }

    if (!argv.write) {
      console.log(
        "\n📋 To actually rewrite the local catalog, run with --write flag",
      );
      return;
    }

    await writeLocalModels(normalizedLocalData.models);
    await normalizeProviderMappingsFile();
    console.log(`\n✅ Normalized ${renamedKeys.length} local model keys.`);
  } catch (error) {
    console.error("Error during normalize-local-models command:", error);
    process.exit(1);
  }
}

async function main() {
  await yargs(hideBin(process.argv))
    .command(
      "normalize-local-models",
      "Normalize legacy local model ids to their canonical form",
      (y) => {
        return y.option("write", {
          type: "boolean",
          description: "Write normalized local model ids back to disk",
          default: false,
        });
      },
      async (argv) => {
        await normalizeLocalModelsCommand(argv);
      },
    )
    .command(
      "find-missing",
      "Find models in the remote list that are missing locally",
      (y) => {
        return y
          .option("summarize", {
            alias: "s",
            type: "boolean",
            description: "Summarize missing models by provider",
            default: false,
          })
          .option("provider", {
            alias: "p",
            type: "string",
            description: "Filter models by a specific provider",
          });
      },
      async (argv) => {
        await findMissingCommand(argv);
      },
    )
    .command(
      "update-models",
      "Update local models with pricing, token limits, and other attributes from remote models",
      (y) => {
        return y
          .option("provider", {
            alias: "p",
            type: "string",
            description: "Filter models by a specific provider for updating",
          })
          .option("write", {
            type: "boolean",
            description:
              "Write updated model information back to the local model_list.json file",
            default: false,
          });
      },
      async (argv) => {
        await updateModelsCommand(argv);
      },
    )
    .command(
      "add-models",
      "Add missing models from remote to local model list with smart ordering",
      (y) => {
        return y
          .option("provider", {
            alias: "p",
            type: "string",
            description: "Filter models by a specific provider for adding",
          })
          .option("filter", {
            alias: "f",
            type: "string",
            description: "Filter models by name substring (e.g., 'gpt-5')",
          })
          .option("write", {
            type: "boolean",
            description:
              "Write the new models to the local model_list.json file",
            default: false,
          })
          .option("updateProviders", {
            type: "boolean",
            description:
              "Update provider mappings in schema/index.ts for existing models",
            default: false,
          });
      },
      async (argv) => {
        await addModelsCommand(argv);
      },
    )
    .demandCommand(
      1,
      "You need to specify a command (e.g., find-missing, update-models, or add-models).",
    )
    .help()
    .alias("help", "h")
    .strict().argv;
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main();
}
