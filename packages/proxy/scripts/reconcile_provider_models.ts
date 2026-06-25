import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { pathToFileURL } from "url";
import {
  fetchProviderSecrets,
  resolveBraintrustApiKey,
  type ProviderSecret,
} from "./braintrust_secrets";
import {
  classifyProbe,
  PROVIDER_APIS,
  REPORT_ONLY_PROVIDERS,
  type ProbeOutcome,
} from "./model_probe";

// Deprecation audit: for each provider, reconcile our catalog against the
// provider's live model list and/or a direct probe, and report which
// (model, provider) pairs are no longer served. A single definitive
// not-found / deprecated provider response is treated as authoritative.

const LOCAL_MODEL_LIST_PATH = path.resolve(
  __dirname,
  "../schema/model_list.json",
);

type ModelSpec = { available_providers?: string[] };
type Catalog = Record<string, ModelSpec>;

export type Deprecation = {
  model: string;
  provider: string;
  reason: string;
  status?: number;
  detail?: string;
};

export type AuditReport = {
  deprecations: Deprecation[];
  reportOnly: { provider: string; modelCount: number }[];
  skipped: { provider: string; reason: string }[];
};

// Azure OpenAI mirrors the OpenAI model ids, so audit azure models with the
// OpenAI list + probe (using the OpenAI secret) rather than a separate source.
const PROVIDER_AUDIT_ALIAS: Record<string, string> = { azure: "openai" };

// Models that cannot be validated with a chat/completions probe (image, audio,
// realtime, embedding, moderation), plus fine-tune placeholders (ft:* are id
// prefixes for user fine-tunes, not standalone models). The catalog marks many
// of these flavor: "chat" even though they are not, so we filter by id pattern.
// They are skipped from the audit rather than risk a false "invalid model"
// deprecation.
export const NON_CHAT_MODEL_PATTERN =
  /^ft:|^\d+-x-\d+\/|dall-e|gpt-image|imagen|stable-diffusion|playground-v|\bflux\b|\bsora\b|\/container\b|whisper|-tts\b|\btts-|-audio\b|-realtime\b|realtime-|-transcribe\b|text-embedding|-embedding\b|embed-|moderation|computer-use/i;

export function isChatProbeableModel(model: string): boolean {
  return !NON_CHAT_MODEL_PATTERN.test(model);
}

// Parse the AvailableEndpointTypes map from schema/index.ts into model ->
// providers. Some routed models keep their provider ONLY here (no
// available_providers in model_list.json), so the audit must include these.
export function parseIndexEndpointTypes(
  indexContent: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const start = indexContent.indexOf("AvailableEndpointTypes");
  if (start < 0) {
    return map;
  }
  const open = indexContent.indexOf("{", start);
  const close = indexContent.indexOf("\n};", open);
  if (open < 0 || close < 0) {
    return map;
  }
  const body = indexContent.slice(open, close);
  const lineRe = /^\s*"([^"]+)":\s*\[([^\]]*)\]/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) {
    const providers = Array.from(m[2].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
    if (providers.length > 0) {
      map.set(m[1], providers);
    }
  }
  return map;
}

// Effective providers for a model = the union of its model_list.json
// available_providers and any schema/index.ts AvailableEndpointTypes mapping.
export function effectiveProviders(
  model: string,
  spec: ModelSpec | undefined,
  indexMap: Map<string, string[]>,
): string[] {
  return Array.from(
    new Set([
      ...(spec?.available_providers ?? []),
      ...(indexMap.get(model) ?? []),
    ]),
  );
}

function catalogModelsByProvider(
  catalog: Catalog,
  indexMap: Map<string, string[]>,
): Map<string, string[]> {
  const byProvider = new Map<string, string[]>();
  for (const [model, spec] of Object.entries(catalog)) {
    if (!isChatProbeableModel(model)) {
      continue;
    }
    for (const provider of effectiveProviders(model, spec, indexMap)) {
      const list = byProvider.get(provider) ?? [];
      list.push(model);
      byProvider.set(provider, list);
    }
  }
  return byProvider;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

async function auditProvider(
  provider: string,
  models: string[],
  secrets: Map<string, ProviderSecret>,
  concurrency: number,
): Promise<{
  deprecations: Deprecation[];
  skipped?: { provider: string; reason: string };
}> {
  const adapterKey = PROVIDER_AUDIT_ALIAS[provider] ?? provider;
  const api = PROVIDER_APIS[adapterKey];
  const secret = secrets.get(adapterKey);
  if (!api) {
    return { deprecations: [], skipped: { provider, reason: "no adapter" } };
  }
  if (!secret) {
    return {
      deprecations: [],
      skipped: { provider, reason: "no secret in Braintrust org" },
    };
  }

  // Step 1: narrow to suspects via the live list when one exists.
  let liveList: Set<string> | null = null;
  if (api.listModels) {
    try {
      liveList = await api.listModels(secret);
      console.log(`  ${provider}: live list has ${liveList.size} models`);
    } catch (error) {
      console.warn(
        `  ${provider}: list endpoint failed (${(error as Error).message.slice(0, 100)}); falling back to probing all models`,
      );
    }
  }

  const suspects =
    liveList !== null ? models.filter((m) => !liveList!.has(m)) : models;
  if (suspects.length === 0) {
    return { deprecations: [] };
  }

  // Step 2a: authoritative list (e.g. Databricks) — absence == deprecated.
  if (api.listIsAuthoritative && liveList !== null) {
    return {
      deprecations: suspects.map((model) => ({
        model,
        provider,
        reason: "absent from provider model list",
      })),
    };
  }

  // Step 2b: confirm each suspect with a direct provider probe.
  if (!api.probeModel) {
    return {
      deprecations: [],
      skipped: {
        provider,
        reason: `${suspects.length} suspects but no probe available`,
      },
    };
  }
  const probe = api.probeModel;
  console.log(`  ${provider}: probing ${suspects.length} suspect(s)`);
  const outcomes = await mapWithConcurrency(
    suspects,
    concurrency,
    async (model) => {
      try {
        const { status, body } = await probe(secret, model);
        const outcome: ProbeOutcome = classifyProbe(status, body);
        return { model, outcome, status, detail: body.slice(0, 160) };
      } catch (error) {
        return {
          model,
          outcome: "transient" as ProbeOutcome,
          status: 0,
          detail: (error as Error).message.slice(0, 160),
        };
      }
    },
  );

  const deprecations: Deprecation[] = [];
  for (const o of outcomes) {
    if (o.outcome === "deprecated") {
      deprecations.push({
        model: o.model,
        provider,
        reason:
          liveList !== null
            ? "absent from list + probe not-found"
            : "probe not-found",
        status: o.status,
        detail: o.detail,
      });
    }
  }
  return { deprecations };
}

export async function runAudit(args: {
  braintrustApiKey: string;
  catalog: Catalog;
  indexContent: string;
  concurrency: number;
  providerFilter?: string[];
}): Promise<AuditReport> {
  const indexMap = parseIndexEndpointTypes(args.indexContent);
  const byProvider = catalogModelsByProvider(args.catalog, indexMap);
  const allProviders = Array.from(byProvider.keys())
    .filter((p) => !args.providerFilter || args.providerFilter.includes(p))
    .sort();

  // Fetch every provider secret we might need (including alias targets) up front.
  const secretTypes = new Set<string>();
  for (const p of allProviders) {
    secretTypes.add(PROVIDER_AUDIT_ALIAS[p] ?? p);
  }
  const secrets = await fetchProviderSecrets(
    args.braintrustApiKey,
    Array.from(secretTypes),
  );

  const report: AuditReport = {
    deprecations: [],
    reportOnly: [],
    skipped: [],
  };

  for (const provider of allProviders) {
    const models = byProvider.get(provider) ?? [];
    if (REPORT_ONLY_PROVIDERS.has(provider)) {
      report.reportOnly.push({ provider, modelCount: models.length });
      console.log(
        `  ${provider}: report-only (no automated source) — ${models.length} models, manual review`,
      );
      continue;
    }
    const { deprecations, skipped } = await auditProvider(
      provider,
      models,
      secrets,
      args.concurrency,
    );
    report.deprecations.push(...deprecations);
    if (skipped) {
      report.skipped.push(skipped);
    }
  }

  report.deprecations.sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
  );
  return report;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option("api-key", {
      describe: "Braintrust API key (defaults to BRAINTRUST_CI_API_KEY)",
      type: "string",
    })
    .option("model-catalog-file", {
      describe: "Path to model_list.json",
      type: "string",
    })
    .option("provider", {
      array: true,
      describe: "Restrict the audit to specific providers",
      type: "string",
    })
    .option("concurrency", {
      default: 8,
      describe: "Max concurrent provider probes",
      type: "number",
    })
    .option("output", {
      describe: "Path to write the deprecation report JSON",
      type: "string",
    })
    .option("github-output", {
      describe: "Path to the GitHub Actions output file",
      type: "string",
    })
    .strict()
    .help()
    .parseAsync();

  const braintrustApiKey = resolveBraintrustApiKey(argv["api-key"]);
  const catalog: Catalog = JSON.parse(
    fs.readFileSync(
      argv["model-catalog-file"] ?? LOCAL_MODEL_LIST_PATH,
      "utf8",
    ),
  );
  const indexContent = fs.readFileSync(
    path.resolve(__dirname, "../schema/index.ts"),
    "utf8",
  );

  const report = await runAudit({
    braintrustApiKey,
    catalog,
    indexContent,
    concurrency: argv.concurrency,
    providerFilter: argv.provider,
  });

  console.log(
    `\n=== ${report.deprecations.length} deprecation(s) across ${
      new Set(report.deprecations.map((d) => d.provider)).size
    } provider(s) ===`,
  );
  for (const d of report.deprecations) {
    console.log(
      `  DEPRECATE ${d.model} @ ${d.provider} (${d.reason}${d.status ? `, HTTP ${d.status}` : ""})`,
    );
  }
  if (report.skipped.length > 0) {
    console.log("\nSkipped providers:");
    for (const s of report.skipped) {
      console.log(`  ${s.provider}: ${s.reason}`);
    }
  }

  if (argv.output) {
    await fs.promises.writeFile(
      argv.output,
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  if (argv["github-output"]) {
    await fs.promises.appendFile(
      argv["github-output"],
      `deprecation_count=${report.deprecations.length}\n`,
    );
  }
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
