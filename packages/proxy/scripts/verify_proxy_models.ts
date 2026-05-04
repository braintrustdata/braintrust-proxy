import fs from "fs";
import { pathToFileURL } from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type ModelEndpointType =
  | "openai"
  | "braintrust"
  | "anthropic"
  | "google"
  | "mistral"
  | "bedrock"
  | "vertex"
  | "together"
  | "fireworks"
  | "baseten"
  | "perplexity"
  | "xAI"
  | "groq"
  | "azure"
  | "databricks"
  | "lepton"
  | "cerebras"
  | "ollama"
  | "replicate"
  | "js";

type ModelFormat =
  | "openai"
  | "anthropic"
  | "google"
  | "window"
  | "js"
  | "converse";

type VerificationModelSpec = {
  available_providers?: ModelEndpointType[];
  endpoint_types?: ModelEndpointType[];
  format?: ModelFormat;
};

type ModelCatalog = Record<string, VerificationModelSpec>;

type VerificationRequest = {
  endpoint: string;
  body: Record<string, unknown>;
};

type VerificationResult = {
  endpoint: string;
  error?: string;
  model: string;
  ok: boolean;
  responseBody: string;
  status?: number;
};

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readModelIdsFromFile(path: string): string[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
  if (
    !Array.isArray(parsed) ||
    !parsed.every((value) => typeof value === "string")
  ) {
    throw new Error(`Model file must be a JSON array of strings: ${path}`);
  }
  return parsed;
}

function defaultModelCatalogPath(): string {
  return new URL("../schema/model_list.json", import.meta.url).pathname;
}

function readModelCatalog(path?: string): ModelCatalog {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path ?? defaultModelCatalogPath(), "utf8"),
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Model catalog must be a JSON object keyed by model id: ${path ?? defaultModelCatalogPath()}`,
    );
  }

  return parsed as ModelCatalog;
}

function uniqueModelIds(modelIds: string[]): string[] {
  return Array.from(
    new Set(modelIds.map((modelId) => modelId.trim()).filter(Boolean)),
  );
}

export function resolveBraintrustApiKey(explicitApiKey?: string): string {
  const apiKey = explicitApiKey ?? process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing API key. Pass --api-key or set BRAINTRUST_API_KEY.",
    );
  }
  return apiKey;
}

const endpointTypeToApiKeyEnvVars: Partial<
  Record<ModelEndpointType, string[]>
> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  baseten: ["BASETEN_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  google: ["GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  lepton: ["LEPTON_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  replicate: ["REPLICATE_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  xAI: ["XAI_API_KEY"],
};

const defaultEndpointTypesByFormat: Record<ModelFormat, ModelEndpointType[]> = {
  anthropic: ["anthropic"],
  converse: ["bedrock"],
  google: ["google"],
  js: ["js"],
  openai: ["openai", "azure"],
  window: ["js"],
};

export function getModelEndpointTypesForVerification(
  model: string,
  modelCatalog: ModelCatalog = readModelCatalog(),
): ModelEndpointType[] {
  const modelSpec = modelCatalog[model];
  if (!modelSpec) {
    return [];
  }

  return (
    modelSpec.available_providers ??
    modelSpec.endpoint_types ??
    defaultEndpointTypesByFormat[modelSpec.format] ??
    []
  );
}

export function resolveApiKeyForModel(
  model: string,
  explicitApiKey?: string,
  modelCatalog: ModelCatalog = readModelCatalog(),
): string {
  if (explicitApiKey) {
    return explicitApiKey;
  }

  for (const endpointType of getModelEndpointTypesForVerification(
    model,
    modelCatalog,
  )) {
    for (const envVarName of endpointTypeToApiKeyEnvVars[endpointType] ?? []) {
      const providerApiKey = process.env[envVarName];
      if (providerApiKey) {
        return providerApiKey;
      }
    }
  }

  return resolveBraintrustApiKey();
}

export function resolveVercelProtectionBypassSecret(
  explicitSecret?: string,
): string {
  const secret = explicitSecret ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) {
    throw new Error(
      "Missing preview bypass secret. Pass --vercel-protection-bypass or set VERCEL_AUTOMATION_BYPASS_SECRET.",
    );
  }
  return secret;
}

export function buildVerificationRequest(model: string): VerificationRequest {
  return {
    endpoint: "chat/completions",
    body: {
      messages: [
        {
          content: "ok",
          role: "user",
        },
      ],
      model,
    },
  };
}

export function extractErrorMessage(responseBody: string): string {
  if (responseBody.length === 0) {
    return "Empty response body";
  }

  try {
    const parsed: unknown = JSON.parse(responseBody);
    if (isRecord(parsed) && typeof parsed.message === "string") {
      return parsed.message;
    }

    const errorValue = isRecord(parsed) ? parsed.error : undefined;
    if (isRecord(errorValue) && typeof errorValue.message === "string") {
      return errorValue.message;
    }
  } catch (_error) {
    return responseBody;
  }

  return responseBody;
}

async function verifyModel(args: {
  apiKey: string;
  model: string;
  proxyBaseUrl: string;
  timeoutMs: number;
  vercelProtectionBypassSecret: string;
}): Promise<VerificationResult> {
  const request = buildVerificationRequest(args.model);
  const url = new URL(request.endpoint, withTrailingSlash(args.proxyBaseUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await fetch(url, {
      body: JSON.stringify(request.body),
      headers: {
        authorization: `Bearer ${args.apiKey}`,
        "content-type": "application/json",
        "x-bt-use-cache": "never",
        "x-bt-use-creds-cache": "never",
        "x-vercel-protection-bypass": args.vercelProtectionBypassSecret,
      },
      method: "POST",
      signal: controller.signal,
    });
    const responseBody = await response.text();

    return {
      endpoint: request.endpoint,
      model: args.model,
      ok: response.ok,
      responseBody,
      status: response.status,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      endpoint: request.endpoint,
      error: message,
      model: args.model,
      ok: false,
      responseBody: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option("api-key", {
      describe:
        "API key to send to the proxy for every model. When omitted, the script prefers provider-specific env vars from the proxy schema and falls back to BRAINTRUST_API_KEY.",
      type: "string",
    })
    .option("github-output", {
      describe: "Optional path to the GitHub Actions output file",
      type: "string",
    })
    .option("max-attempts", {
      default: 3,
      describe: "How many attempts to make per model before failing",
      type: "number",
    })
    .option("model", {
      array: true,
      describe: "Model id to verify. Can be passed multiple times.",
      type: "string",
    })
    .option("model-file", {
      describe: "Path to a JSON file containing a string array of model ids",
      type: "string",
    })
    .option("model-catalog-file", {
      describe:
        "Path to a JSON file containing a model catalog keyed by model id. Defaults to packages/proxy/schema/model_list.json.",
      type: "string",
    })
    .option("output", {
      describe: "Optional path to write the verification results JSON",
      type: "string",
    })
    .option("proxy-base-url", {
      demandOption: true,
      describe:
        "Proxy base URL, for example https://preview.example.com/api/v1",
      type: "string",
    })
    .option("vercel-protection-bypass", {
      describe:
        "Vercel deployment protection bypass secret. Defaults to VERCEL_AUTOMATION_BYPASS_SECRET.",
      type: "string",
    })
    .option("retry-delay-ms", {
      default: 5000,
      describe: "Delay between verification attempts for the same model",
      type: "number",
    })
    .option("timeout-ms", {
      default: 30000,
      describe: "Timeout for each verification request",
      type: "number",
    })
    .strict()
    .help()
    .parseAsync();
  const vercelProtectionBypassSecret = resolveVercelProtectionBypassSecret(
    argv["vercel-protection-bypass"],
  );

  const fileModels = argv["model-file"]
    ? readModelIdsFromFile(argv["model-file"])
    : [];
  const cliModels = argv.model ?? [];
  const modelIds = uniqueModelIds([...cliModels, ...fileModels]);
  if (modelIds.length === 0) {
    throw new Error("No models provided. Pass --model and/or --model-file.");
  }
  const modelCatalog = readModelCatalog(argv["model-catalog-file"]);

  const results: VerificationResult[] = [];

  for (const model of modelIds) {
    const apiKey = resolveApiKeyForModel(model, argv["api-key"], modelCatalog);
    let result: VerificationResult | null = null;
    for (let attempt = 1; attempt <= argv["max-attempts"]; attempt++) {
      result = await verifyModel({
        apiKey,
        model,
        proxyBaseUrl: argv["proxy-base-url"],
        timeoutMs: argv["timeout-ms"],
        vercelProtectionBypassSecret,
      });
      if (result.ok) {
        break;
      }

      if (attempt < argv["max-attempts"]) {
        await new Promise((resolve) =>
          setTimeout(resolve, argv["retry-delay-ms"]),
        );
      }
    }

    if (result) {
      results.push(result);
    }
  }

  if (argv.output) {
    await fs.promises.writeFile(
      argv.output,
      JSON.stringify(results, null, 2) + "\n",
    );
  }

  const failed = results.filter((result) => !result.ok);
  const verified = results.length - failed.length;

  if (argv["github-output"]) {
    await fs.promises.appendFile(
      argv["github-output"],
      `verified_count=${verified}\nfailed_count=${failed.length}\n`,
    );
  }

  for (const result of results) {
    if (result.ok) {
      console.log(
        `Verified ${result.model} via ${result.endpoint} (${result.status ?? "unknown status"})`,
      );
      continue;
    }

    const detail = result.error ?? extractErrorMessage(result.responseBody);
    console.error(
      `Failed ${result.model} via ${result.endpoint} (${result.status ?? "request error"}): ${detail}`,
    );
  }

  if (failed.length > 0) {
    throw new Error(
      `Failed to verify ${failed.length} model${failed.length === 1 ? "" : "s"}: ${failed
        .map((result) => result.model)
        .join(", ")}`,
    );
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
