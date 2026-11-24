import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  effectiveProviders,
  parseIndexEndpointTypes,
} from "./reconcile_provider_models";

const capability = z.enum([
  "multimodal",
  "o1_like",
  "reasoning",
  "reasoning_budget",
  "supports_streaming",
  "supports_decisions",
  "streaming_only",
]);
const evidenceSchema = z.array(
  z.object({
    model: z.string().min(1),
    provider: z.string().min(1),
    surface: z.string().trim().min(1),
    capability,
    supported: z.boolean(),
    source: z.string().url().startsWith("https://"),
    quote: z.string().trim().min(1),
  }),
);
type Capability = z.infer<typeof capability>;
type Catalog = Record<
  string,
  Partial<Record<Capability, boolean | null>> & {
    available_providers?: string[] | null;
  }
>;

export async function checkModelCapabilities(
  before: Catalog,
  after: Catalog,
  rawEvidence: unknown,
  structuredSupport: (
    model: string,
    provider: string,
    capability: Capability,
  ) => Promise<boolean | undefined>,
  providerMappings: { before: string; after: string } = {
    before: "",
    after: "",
  },
): Promise<void> {
  const evidence = evidenceSchema.parse(rawEvidence);
  const beforeIndex = parseIndexEndpointTypes(providerMappings.before);
  const afterIndex = parseIndexEndpointTypes(providerMappings.after);
  for (const [model, entry] of Object.entries(after)) {
    const previous = before[model];
    const previousProviders = effectiveProviders(
      model,
      { available_providers: previous?.available_providers ?? undefined },
      beforeIndex,
    );
    const providers = effectiveProviders(
      model,
      { available_providers: entry.available_providers ?? undefined },
      afterIndex,
    );
    for (const flag of capability.options) {
      if (entry[flag] !== true) continue;
      for (const provider of providers) {
        if (previous?.[flag] === true && previousProviders.includes(provider)) {
          continue;
        }
        const claims = evidence.filter(
          (claim) =>
            claim.model === model &&
            claim.provider === provider &&
            claim.capability === flag &&
            (provider !== "fireworks" ||
              claim.surface.toLowerCase() === "serverless"),
        );
        const structured = await structuredSupport(model, provider, flag);
        if (structured === false || claims.some((claim) => !claim.supported)) {
          throw new Error(`${model} @ ${provider}: ${flag} is unsupported`);
        }
        if (structured !== true && !claims.some((claim) => claim.supported)) {
          throw new Error(
            `${model} @ ${provider}: missing exact-provider evidence for ${flag}`,
          );
        }
      }
      if (
        providers.length === 0 &&
        (previous?.[flag] !== true || previousProviders.length > 0)
      ) {
        throw new Error(`${model}: no provider to verify ${flag} against`);
      }
    }
  }
}

async function providerCapability(
  model: string,
  provider: string,
  flag: Capability,
): Promise<boolean | undefined> {
  if (
    provider !== "fireworks" ||
    flag !== "multimodal" ||
    !/^accounts\/[^/]+\/models\/[^/]+$/.test(model)
  ) {
    return undefined;
  }
  const path = model.split("/").map(encodeURIComponent).join("/");
  const key = process.env.FIREWORKS_API_KEY;
  if (key) {
    const response = await fetch(`https://api.fireworks.ai/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const metadata = z
        .object({ supportsImageInput: z.boolean().optional() })
        .parse(await response.json());
      if (metadata.supportsImageInput !== undefined) {
        return metadata.supportsImageInput;
      }
    }
  }
  const [, account, , slug] = path.split("/");
  const card = await fetch(`https://fireworks.ai/models/${account}/${slug}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!card.ok) return undefined;
  const html = await card.text();
  if (!html.includes(`"modelApiName\\":\\"${model}\\"`)) return undefined;
  const imageInput =
    /Supporting image input<\/span><\/div><div[^>]*><span[^>]*>(Supported|Not Supported)<\/span>/.exec(
      html,
    );
  return imageInput ? imageInput[1] === "Supported" : undefined;
}

const executionSchema = z.array(
  z.object({
    type: z.string(),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    error: z.unknown().optional(),
    message: z
      .object({
        content: z.union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              is_error: z.boolean().optional(),
            }),
          ),
        ]),
      })
      .optional(),
  }),
);

export function checkModelResearch(execution: unknown): void {
  const messages = executionSchema.parse(execution);
  for (const message of messages) {
    if (
      message.is_error ||
      message.error ||
      (Array.isArray(message.message?.content) &&
        message.message.content.some((block) => block.is_error))
    ) {
      throw new Error(
        "Model research encountered an API or tool error; inspect the Claude execution report before retrying.",
      );
    }
  }
  const result = messages.find((message) => message.type === "result");
  if (result?.subtype !== "success" || result.is_error !== false) {
    throw new Error("Model research did not complete successfully.");
  }
}

async function main(): Promise<void> {
  const executionFile = process.env.EXECUTION_FILE;
  if (!executionFile) {
    throw new Error(
      "Missing Claude execution file; cannot verify model research.",
    );
  }
  checkModelResearch(JSON.parse(readFileSync(executionFile, "utf8")));
  const evidenceFile = process.env.CAPABILITY_EVIDENCE_FILE;
  if (evidenceFile) {
    const catalog = "packages/proxy/schema/model_list.json";
    const index = "packages/proxy/schema/index.ts";
    const readHead = (path: string) =>
      execFileSync("git", ["show", `HEAD:${path}`], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
    await checkModelCapabilities(
      JSON.parse(readHead(catalog)),
      JSON.parse(readFileSync(catalog, "utf8")),
      JSON.parse(readFileSync(evidenceFile, "utf8")),
      providerCapability,
      { before: readHead(index), after: readFileSync(index, "utf8") },
    );
  }
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
