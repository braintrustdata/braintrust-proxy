import fs from "fs";
import https from "https";
import path from "path";
import { z } from "zod";

// Zod schema for individual model details
const searchContextCostPerQuerySchema = z
  .object({
    search_context_size_low: z.number().optional(),
    search_context_size_medium: z.number().optional(),
    search_context_size_high: z.number().optional(),
  })
  .optional();

const modelDetailSchema = z
  .object({
    max_tokens: z.union([z.number(), z.string()]).optional(), // LEGACY: Can be number or string
    max_input_tokens: z
      .preprocess(
        (val) => (typeof val === "string" ? parseInt(val, 10) : val),
        z.number(),
      )
      .optional(),
    max_output_tokens: z
      .preprocess(
        (val) => (typeof val === "string" ? parseInt(val, 10) : val),
        z.number(),
      )
      .optional(),
    input_cost_per_token: z.number().optional(),
    output_cost_per_token: z.number().optional(),
    output_cost_per_reasoning_token: z.number().optional(),
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
    // Adding known fields from local model_list.json that might not be in the remote spec
    format: z.string().optional(),
    flavor: z.string().optional(),
    multimodal: z.boolean().optional(),
    input_cost_per_mil_tokens: z.number().optional(),
    output_cost_per_mil_tokens: z.number().optional(),
    displayName: z.string().optional(),
    parent: z.string().optional(),
    experimental: z.boolean().optional(),
    deprecated: z.boolean().optional(),
    o1_like: z.boolean().optional(),
  })
  .passthrough(); // Allows other fields not explicitly defined

// Zod schema for the entire model list (a record of model details)
const modelListSchema = z.record(modelDetailSchema);

// Infer TypeScript types from Zod schemas
type ModelDetail = z.infer<typeof modelDetailSchema>;
type ModelList = z.infer<typeof modelListSchema>;

// Path to your local model list JSON file
const LOCAL_MODEL_LIST_PATH = path.resolve(
  __dirname,
  "../schema/model_list.json",
);
const REMOTE_MODEL_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/litellm/model_prices_and_context_window_backup.json";

async function fetchRemoteModels(url: string): Promise<ModelList> {
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

            // Remove sample_spec before parsing if it exists, as it's not a real model entry
            if (
              jsonData &&
              typeof jsonData === "object" &&
              "sample_spec" in jsonData
            ) {
              delete jsonData.sample_spec;
            }

            const parsedModels = modelListSchema.parse(jsonData);
            resolve(parsedModels);
          } catch (error) {
            if (error instanceof z.ZodError) {
              console.error("Zod validation errors:", error.errors);
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

async function readLocalModels(filePath: string): Promise<ModelList> {
  try {
    const fileContent = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(fileContent) as ModelList;
  } catch (error) {
    throw new Error(
      "Failed to read or parse local model list: " + (error as Error).message,
    );
  }
}

async function main() {
  try {
    console.log("Fetching remote models from:", REMOTE_MODEL_URL);
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const localModels = await readLocalModels(LOCAL_MODEL_LIST_PATH);
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const remoteModelNames = new Set(Object.keys(remoteModels));
    const localModelNames = new Set(Object.keys(localModels));

    const missingInLocal: string[] = [];
    for (const modelName of remoteModelNames) {
      if (!localModelNames.has(modelName)) {
        missingInLocal.push(modelName);
      }
    }

    if (missingInLocal.length > 0) {
      console.log(
        "\nModels present in remote but missing in local model_list.json:",
      );
      missingInLocal.forEach((modelName) => console.log(modelName));
    } else {
      console.log(
        "\nAll models from the remote list are present in the local model_list.json.",
      );
    }
  } catch (error) {
    console.error("Error during script execution:", error);
    process.exit(1);
  }
}

void main();
