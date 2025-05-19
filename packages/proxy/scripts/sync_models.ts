import fs from "fs";
import https from "https";
import path from "path";
import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ModelSchema, ModelSpec } from "../schema/models";

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
          `[DEBUG] Remote: ${modelName} (Provider: ${consideredRemoteModels[modelName]?.litellm_provider || "N/A"}) -> Translated: ${translatedModelName}`,
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
            `${modelName} (Provider: ${detail?.litellm_provider || "N/A"}, Translated: ${translated})`,
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

async function checkPricesCommand(argv: any) {
  try {
    console.log("Fetching remote models for price check...");
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models for price check...");
    const localModels = await readLocalModels(LOCAL_MODEL_LIST_PATH);
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const updatedLocalModels = JSON.parse(
      JSON.stringify(localModels),
    ) as LocalModelList;
    let madeChanges = false;

    console.log("\n--- Price Discrepancy Report ---");
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
                `  ${costType} Cost Mismatch/Missing: Local: ${localCost ?? "Not available"}, Remote (calc): ${remoteCostPerMil} (would write: ${roundedRemoteCostPerMil}) (from ${remoteCostPerToken}/token)`,
              );
            discrepanciesFound++;
            if (argv.write) {
              (modelInUpdatedList as any)[localFieldName] =
                roundedRemoteCostPerMil;
              madeChanges = true;
              if (!modelReportedThisIteration) {
                console.log(
                  `\n[WRITE] Updating prices for Model: ${localModelName} (Remote: ${originalRemoteModelName})`,
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
          `\nLocal model_list.json has been updated with new pricing information and keys ordered according to schema.`, // Updated message
        );
      } else {
        console.log(
          "\nNo pricing updates were necessary for local model_list.json.",
        );
      }
    } else {
      if (discrepanciesFound === 0) {
        console.log(
          "\nNo pricing discrepancies found for models present in both lists (or matching filter).",
        );
      } else {
        console.log(
          `\nFound ${discrepanciesFound} pricing discrepancies/missing local prices that could be updated from remote.`,
        );
      }
    }
  } catch (error) {
    console.error("Error during check-prices command:", error);
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
      "check-prices",
      "Check for pricing discrepancies between local and remote models",
      (y) => {
        return y
          .option("provider", {
            alias: "p",
            type: "string",
            description:
              "Filter models by a specific provider for price checking",
          })
          .option("write", {
            type: "boolean",
            description:
              "Write updated pricing information back to the local model_list.json file",
            default: false,
          });
      },
      async (argv) => {
        await checkPricesCommand(argv);
      },
    )
    .demandCommand(
      1,
      "You need to specify a command (e.g., find-missing or check-prices).",
    )
    .help()
    .alias("help", "h")
    .strict().argv;
}

void main();
