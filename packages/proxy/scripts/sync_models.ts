import fs from "fs";
import https from "https";
import path from "path";
import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { ModelSchema, ModelSpec } from "../schema/models";

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

function translateToBraintrust(modelName: string, provider?: string): string {
  if (provider === "xai" && modelName.startsWith("xai/")) {
    return modelName.substring(4); // "xai/"
  }

  if (provider === "gemini") {
    if (modelName.startsWith("gemini/gemini-gemma-")) {
      return "google/" + modelName.substring(14);
    }
    if (modelName.startsWith("gemini/gemma-")) {
      return "google/" + modelName.substring(7);
    }
    if (modelName.startsWith("gemini/")) {
      return modelName.substring(7);
    }
  }

  if (modelName.startsWith("google/")) {
    return modelName;
  }

  return modelName;
}

function getProviderMappingForModel(
  remoteModelName: string,
  remoteModel: LiteLLMModelDetail,
): string[] {
  // Helper function to map provider name to endpoint type
  const mapProviderName = (providerName: string | undefined): string[] => {
    if (!providerName) return [];

    const lowerProvider = providerName.toLowerCase();

    // Map provider names to our endpoint types
    if (lowerProvider === "xai" || lowerProvider.includes("xai")) {
      return ["xAI"];
    }
    if (lowerProvider === "anthropic" || lowerProvider.includes("anthropic")) {
      return ["anthropic"];
    }
    if (lowerProvider === "openai" || lowerProvider.includes("openai")) {
      return ["openai"];
    }
    if (
      lowerProvider === "google" ||
      lowerProvider === "gemini" ||
      lowerProvider.includes("google") ||
      lowerProvider.includes("gemini")
    ) {
      return ["google"];
    }
    if (lowerProvider === "mistral" || lowerProvider.includes("mistral")) {
      return ["mistral"];
    }
    if (lowerProvider === "together" || lowerProvider.includes("together")) {
      return ["together"];
    }
    if (lowerProvider === "groq" || lowerProvider.includes("groq")) {
      return ["groq"];
    }
    if (lowerProvider === "replicate" || lowerProvider.includes("replicate")) {
      return ["replicate"];
    }
    if (lowerProvider === "fireworks" || lowerProvider.includes("fireworks")) {
      return ["fireworks"];
    }
    if (
      lowerProvider === "perplexity" ||
      lowerProvider.includes("perplexity")
    ) {
      return ["perplexity"];
    }
    if (lowerProvider === "lepton" || lowerProvider.includes("lepton")) {
      return ["lepton"];
    }
    if (lowerProvider === "cerebras" || lowerProvider.includes("cerebras")) {
      return ["cerebras"];
    }
    if (lowerProvider === "baseten" || lowerProvider.includes("baseten")) {
      return ["baseten"];
    }

    return [];
  };

  // Try litellm_provider first
  const provider = remoteModel.litellm_provider;
  let result = mapProviderName(provider);

  // If no match, try model name prefix as fallback
  if (result.length === 0) {
    const modelNameProviderPart = remoteModelName.split("/")[0];
    result = mapProviderName(modelNameProviderPart);
  }

  if (result.length === 0) {
    console.warn(`Unknown provider: ${provider} for model ${remoteModelName}`);
  }

  return result;
}

async function updateProviderMapping(
  newModels: Array<{
    name: string;
    providers: string[];
    remoteModel: LiteLLMModelDetail;
  }>,
): Promise<void> {
  try {
    const schemaContent = await fs.promises.readFile(
      SCHEMA_INDEX_PATH,
      "utf-8",
    );

    // Generate new entries for the models
    const newEntries = newModels.map(
      ({ name, providers }) => `  "${name}": ${JSON.stringify(providers)},`,
    );

    // Find the line with "grok-beta": ["xAI"], and insert after it
    const grokBetaLine = schemaContent.indexOf('"grok-beta": ["xAI"],');
    if (grokBetaLine !== -1) {
      const lineEnd = schemaContent.indexOf("\n", grokBetaLine);
      const beforeInsertion = schemaContent.substring(0, lineEnd + 1);
      const afterInsertion = schemaContent.substring(lineEnd + 1);

      const updatedSchemaContent =
        beforeInsertion + newEntries.join("\n") + "\n" + afterInsertion;

      await fs.promises.writeFile(SCHEMA_INDEX_PATH, updatedSchemaContent);
      console.log(
        `✅ Updated provider mappings for ${newModels.length} models in schema/index.ts`,
      );
    } else {
      console.warn("Could not find grok-beta entry to use as insertion point");
    }
  } catch (error) {
    console.error("Failed to update provider mappings:", error);
  }
}

function convertRemoteToLocalModel(
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
  if (remoteModel.input_cost_per_token) {
    baseModel.input_cost_per_mil_tokens = roundCost(
      remoteModel.input_cost_per_token,
    );
  }
  if (remoteModel.output_cost_per_token) {
    baseModel.output_cost_per_mil_tokens = roundCost(
      remoteModel.output_cost_per_token,
    );
  }
  if (remoteModel.cache_read_input_token_cost) {
    baseModel.input_cache_read_cost_per_mil_tokens = roundCost(
      remoteModel.cache_read_input_token_cost,
    );
  }
  if (remoteModel.cache_creation_input_token_cost) {
    baseModel.input_cache_write_cost_per_mil_tokens = roundCost(
      remoteModel.cache_creation_input_token_cost,
    );
  }
  // Note: output_reasoning_cost_per_mil_tokens may not be in ModelSpec yet,
  // so we'll skip this for now to avoid type errors
  // if (remoteModel.output_cost_per_reasoning_token) {
  //   baseModel.output_reasoning_cost_per_mil_tokens = roundCost(remoteModel.output_cost_per_reasoning_token);
  // }

  // Add token limits
  if (remoteModel.max_input_tokens) {
    baseModel.max_input_tokens = remoteModel.max_input_tokens;
  }
  if (remoteModel.max_output_tokens) {
    baseModel.max_output_tokens = remoteModel.max_output_tokens;
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

function getFallbackCompleteOrdering(
  existingModelNames: string[],
  newModelNames: string[],
): string[] {
  // Create a complete list by intelligently inserting new models into existing order
  const allModels = [...existingModelNames];

  // Sort new models by their logical order first
  const sortedNewModels = newModelNames.sort((a, b) => {
    // Extract version numbers and variants for grok models
    const aMatch = a.match(/grok-(\d+)(?:-(.+))?/);
    const bMatch = b.match(/grok-(\d+)(?:-(.+))?/);

    if (aMatch && bMatch) {
      const aVersion = parseInt(aMatch[1]);
      const bVersion = parseInt(bMatch[1]);

      // Sort by version number (higher first)
      if (aVersion !== bVersion) {
        return bVersion - aVersion;
      }

      // Same version, sort by variant
      const aVariant = aMatch[2] || "";
      const bVariant = bMatch[2] || "";

      // Base model first, then latest, then others
      const variantOrder = [
        "",
        "latest",
        "beta",
        "mini",
        "mini-latest",
        "mini-beta",
        "mini-fast",
        "mini-fast-latest",
        "mini-fast-beta",
        "fast-beta",
        "fast-latest",
      ];
      const aIndex = variantOrder.indexOf(aVariant);
      const bIndex = variantOrder.indexOf(bVariant);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }

      return aVariant.localeCompare(bVariant);
    }

    // Fallback to alphabetical
    return a.localeCompare(b);
  });

  // Insert each new model at the appropriate position
  for (const newModel of sortedNewModels) {
    const insertionIndex = findInsertionIndex(allModels, newModel);
    allModels.splice(insertionIndex, 0, newModel);
  }

  return allModels;
}

function findInsertionIndex(
  existingModels: string[],
  newModel: string,
): number {
  // For grok models, find the right position based on version and variant
  const newMatch = newModel.match(/grok-(\d+)(?:-(.+))?/);
  if (!newMatch) {
    // Non-grok model, add at end
    return existingModels.length;
  }

  const newVersion = parseInt(newMatch[1]);
  const newVariant = newMatch[2] || "";

  // Find insertion point by comparing with existing models
  for (let i = 0; i < existingModels.length; i++) {
    const existingModel = existingModels[i];
    const existingMatch = existingModel.match(/grok-(\d+)(?:-(.+))?/);

    if (existingMatch) {
      const existingVersion = parseInt(existingMatch[1]);
      const existingVariant = existingMatch[2] || "";

      // Insert before models with lower version numbers
      if (newVersion > existingVersion) {
        return i;
      }

      // Same version - check variant ordering
      if (newVersion === existingVersion) {
        const variantOrder = [
          "",
          "latest",
          "beta",
          "mini",
          "mini-latest",
          "mini-beta",
          "mini-fast",
          "mini-fast-latest",
          "mini-fast-beta",
          "fast-beta",
          "fast-latest",
        ];
        const newVariantIndex = variantOrder.indexOf(newVariant);
        const existingVariantIndex = variantOrder.indexOf(existingVariant);

        if (newVariantIndex !== -1 && existingVariantIndex !== -1) {
          if (newVariantIndex < existingVariantIndex) {
            return i;
          }
        } else if (newVariant.localeCompare(existingVariant) < 0) {
          return i;
        }
      }
    }
  }

  // If we didn't find a position, add at the end
  return existingModels.length;
}

async function findMissingCommand(argv: any) {
  try {
    console.log("Fetching remote models from:", REMOTE_MODEL_URL);
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const localModels = await readLocalModels(LOCAL_MODEL_LIST_PATH);
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const localModelNames = new Set(Object.keys(localModels));
    const missingInLocal: string[] = [];
    const consideredRemoteModels: LiteLLMModelList = {};

    for (const remoteModelName in remoteModels) {
      const modelDetail = remoteModels[remoteModelName];

      if (argv.provider) {
        const lowerArgProvider = argv.provider.toLowerCase();
        const modelProvider = modelDetail.litellm_provider?.toLowerCase();
        const modelNameProviderPart = remoteModelName
          .split("/")[0]
          .toLowerCase();

        if (
          !modelProvider?.includes(lowerArgProvider) &&
          !modelNameProviderPart.includes(lowerArgProvider) &&
          !(modelProvider === lowerArgProvider) &&
          !(modelNameProviderPart === lowerArgProvider)
        ) {
          continue;
        }
      }
      consideredRemoteModels[remoteModelName] = modelDetail;
    }

    const remoteModelNamesFiltered = new Set(
      Object.keys(consideredRemoteModels),
    );

    for (const modelName of remoteModelNamesFiltered) {
      const translatedModelName = translateToBraintrust(
        modelName,
        consideredRemoteModels[modelName]?.litellm_provider,
      );
      if (argv.provider) {
        console.log(
          `[DEBUG] Remote: ${modelName} (Provider: ${
            consideredRemoteModels[modelName]?.litellm_provider || "N/A"
          }) -> Translated: ${translatedModelName}`,
        );
      }
      if (!localModelNames.has(translatedModelName)) {
        missingInLocal.push(modelName);
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

      for (const modelName in consideredRemoteModels) {
        const modelDetail = consideredRemoteModels[modelName];
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
    const localModels = await readLocalModels(LOCAL_MODEL_LIST_PATH);
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
    }> = [];

    if (argv.provider) {
      const lowerArgProvider = argv.provider.toLowerCase();
      for (const remoteModelName in remoteModels) {
        const remoteModelDetail = remoteModels[remoteModelName];
        const modelProvider = remoteModelDetail.litellm_provider?.toLowerCase();
        const modelNameProviderPart = remoteModelName
          .split("/")[0]
          .toLowerCase();

        const matchesProviderFilter =
          modelProvider?.includes(lowerArgProvider) ||
          modelNameProviderPart.includes(lowerArgProvider) ||
          modelProvider === lowerArgProvider ||
          modelNameProviderPart === lowerArgProvider;

        if (matchesProviderFilter) {
          const translatedRemoteModelName = translateToBraintrust(
            remoteModelName,
            remoteModelDetail.litellm_provider,
          );
          if (localModels[translatedRemoteModelName]) {
            modelsToCompare.push({
              localModelName: translatedRemoteModelName,
              localModelDetail: localModels[translatedRemoteModelName],
              remoteModelName: remoteModelName,
              remoteModelDetail: remoteModelDetail,
            });
          }
        }
      }
    } else {
      for (const localModelName in localModels) {
        const localModelDetail = localModels[localModelName];
        let foundRemoteDetail: LiteLLMModelDetail | undefined = undefined;
        let originalRemoteModelNameForLoop: string | undefined = undefined;
        for (const rName in remoteModels) {
          const rDetail = remoteModels[rName];
          const translatedName = translateToBraintrust(
            rName,
            rDetail.litellm_provider,
          );
          if (translatedName === localModelName) {
            foundRemoteDetail = rDetail;
            originalRemoteModelNameForLoop = rName;
            break;
          }
        }
        if (foundRemoteDetail && originalRemoteModelNameForLoop) {
          modelsToCompare.push({
            localModelName: localModelName,
            localModelDetail: localModelDetail,
            remoteModelName: originalRemoteModelNameForLoop,
            remoteModelDetail: foundRemoteDetail,
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

      const checkAndUpdateCost = (
        costType: string,
        localCost: number | undefined | null,
        remoteCostPerToken: number | undefined,
        localFieldName: keyof ModelSpec,
      ) => {
        if (typeof remoteCostPerToken === "number") {
          const remoteCostPerMil = remoteCostPerToken * 1_000_000;
          const roundedRemoteCostPerMil = parseFloat(
            remoteCostPerMil.toFixed(8),
          );

          if (
            localCost === null ||
            typeof localCost !== "number" ||
            Math.abs(localCost - remoteCostPerMil) > 1e-9
          ) {
            if (!argv.write && !modelReportedThisIteration) {
              console.log(
                `\nModel: ${localModelName} (Remote: ${originalRemoteModelName})`,
              );
              modelReportedThisIteration = true;
            }
            if (!argv.write)
              console.log(
                `  ${costType} Cost Mismatch/Missing: Local: ${
                  localCost ?? "Not available"
                }, Remote (calc): ${remoteCostPerMil} (would write: ${roundedRemoteCostPerMil}) (from ${remoteCostPerToken}/token)`,
              );
            discrepanciesFound++;
            if (argv.write) {
              (modelInUpdatedList as any)[localFieldName] =
                roundedRemoteCostPerMil;
              madeChanges = true;
              if (!modelReportedThisIteration) {
                console.log(
                  `\n[WRITE] Updating model for: ${localModelName} (Remote: ${originalRemoteModelName})`,
                );
                modelReportedThisIteration = true;
              }
              console.log(
                `  [WRITE] Updated ${costType} Cost to: ${roundedRemoteCostPerMil}`,
              );
            }
          }
        } else if (typeof localCost === "number") {
          if (!argv.write && !modelReportedThisIteration) {
            console.log(
              `\nModel: ${localModelName} (Remote: ${originalRemoteModelName})`,
            );
            modelReportedThisIteration = true;
          }
          if (!argv.write)
            console.log(
              `  ${costType} Cost: Local: ${localCost}, Remote: Not available`,
            );
        }
      };

      const checkAndUpdateTokenLimit = (
        limitType: string,
        localLimit: number | undefined | null,
        remoteLimit: number | undefined,
        localFieldName: keyof ModelSpec,
      ) => {
        if (typeof remoteLimit === "number") {
          if (
            localLimit === null ||
            typeof localLimit !== "number" ||
            localLimit !== remoteLimit
          ) {
            if (!argv.write && !modelReportedThisIteration) {
              console.log(
                `\nModel: ${localModelName} (Remote: ${originalRemoteModelName})`,
              );
              modelReportedThisIteration = true;
            }
            if (!argv.write)
              console.log(
                `  ${limitType} Token Limit Mismatch/Missing: Local: ${
                  localLimit ?? "Not available"
                }, Remote: ${remoteLimit}`,
              );
            discrepanciesFound++;
            if (argv.write) {
              (modelInUpdatedList as any)[localFieldName] = remoteLimit;
              madeChanges = true;
              if (!modelReportedThisIteration) {
                console.log(
                  `\n[WRITE] Updating model for: ${localModelName} (Remote: ${originalRemoteModelName})`,
                );
                modelReportedThisIteration = true;
              }
              console.log(
                `  [WRITE] Updated ${limitType} Token Limit to: ${remoteLimit}`,
              );
            }
          }
        } else if (typeof localLimit === "number") {
          if (!argv.write && !modelReportedThisIteration) {
            console.log(
              `\nModel: ${localModelName} (Remote: ${originalRemoteModelName})`,
            );
            modelReportedThisIteration = true;
          }
          if (!argv.write)
            console.log(
              `  ${limitType} Token Limit: Local: ${localLimit}, Remote: Not available`,
            );
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
    }

    if (argv.write) {
      if (madeChanges) {
        // Reorder keys according to ModelSchema before writing
        const orderedModelsToWrite: LocalModelList = {};
        const schemaKeys = Object.keys(ModelSchema.shape) as Array<
          keyof ModelSpec
        >;

        for (const modelName in updatedLocalModels) {
          const originalModel = updatedLocalModels[modelName];
          const orderedModel: Partial<ModelSpec> = {};

          // Add schema keys in their defined order
          for (const key of schemaKeys) {
            if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
              (orderedModel as any)[key] = originalModel[key];
            }
          }

          // Add any other keys not in ModelSchema (e.g., from passthrough or custom additions)
          for (const key in originalModel) {
            if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
              if (!schemaKeys.includes(key as keyof ModelSpec)) {
                (orderedModel as any)[key] = (originalModel as any)[key];
              }
            }
          }
          orderedModelsToWrite[modelName] = orderedModel as ModelSpec;
        }

        await fs.promises.writeFile(
          LOCAL_MODEL_LIST_PATH,
          JSON.stringify(orderedModelsToWrite, null, 2), // Use the reordered models
        );
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
    const localModels = await readLocalModels(LOCAL_MODEL_LIST_PATH);
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const localModelNames = new Set(Object.keys(localModels));
    const missingInLocal: Array<{
      remoteModelName: string;
      translatedName: string;
      remoteModel: LiteLLMModelDetail;
    }> = [];

    // Find missing models
    for (const remoteModelName in remoteModels) {
      const modelDetail = remoteModels[remoteModelName];

      if (argv.provider) {
        const lowerArgProvider = argv.provider.toLowerCase();
        const modelProvider = modelDetail.litellm_provider?.toLowerCase();
        const modelNameProviderPart = remoteModelName
          .split("/")[0]
          .toLowerCase();

        if (
          !modelProvider?.includes(lowerArgProvider) &&
          !modelNameProviderPart.includes(lowerArgProvider) &&
          !(modelProvider === lowerArgProvider) &&
          !(modelNameProviderPart === lowerArgProvider)
        ) {
          continue;
        }
      }

      const translatedModelName = translateToBraintrust(
        remoteModelName,
        modelDetail.litellm_provider,
      );

      if (!localModelNames.has(translatedModelName)) {
        missingInLocal.push({
          remoteModelName,
          translatedName: translatedModelName,
          remoteModel: modelDetail,
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
          await updateProviderMapping(missingProviderMappings);
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
      ({ translatedName, remoteModel }) => ({
        name: translatedName,
        model: convertRemoteToLocalModel(translatedName, remoteModel),
      }),
    );

    const newModelNames = modelsToAdd.map((m) => m.name);

    // Prepare provider mapping data
    const providerMappingData = missingInLocal.map(
      ({ translatedName, remoteModel }) => ({
        name: translatedName,
        providers: getProviderMappingForModel(translatedName, remoteModel),
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

    if (argv.write) {
      // Reorder keys according to ModelSchema and write
      const orderedModelsToWrite: LocalModelList = {};
      const schemaKeys = Object.keys(ModelSchema.shape) as Array<
        keyof ModelSpec
      >;

      for (const modelName in updatedModels) {
        const originalModel = updatedModels[modelName];
        const orderedModel: Partial<ModelSpec> = {};

        // Add schema keys in their defined order
        for (const key of schemaKeys) {
          if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
            (orderedModel as any)[key] = originalModel[key];
          }
        }

        // Add any other keys not in ModelSchema
        for (const key in originalModel) {
          if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
            if (!schemaKeys.includes(key as keyof ModelSpec)) {
              (orderedModel as any)[key] = (originalModel as any)[key];
            }
          }
        }
        orderedModelsToWrite[modelName] = orderedModel as ModelSpec;
      }

      await fs.promises.writeFile(
        LOCAL_MODEL_LIST_PATH,
        JSON.stringify(orderedModelsToWrite, null, 2),
      );
      console.log(
        `\n✅ Successfully added ${missingInLocal.length} models to ${LOCAL_MODEL_LIST_PATH}`,
      );

      // Update provider mappings in schema/index.ts
      console.log("\nUpdating provider mappings...");
      await updateProviderMapping(providerMappingData);
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

async function main() {
  await yargs(hideBin(process.argv))
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

void main();
