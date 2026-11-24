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
// (model, provider) pairs are no longer served. Account-scoped 404s
// require corroboration from a public lifecycle source.

const LOCAL_MODEL_LIST_PATH = path.resolve(
  __dirname,
  "../schema/model_list.json",
);

type ModelSpec = {
  available_providers?: string[];
  retired?: boolean | null;
  retirement_date?: string | null;
};
type Catalog = Record<string, ModelSpec>;

export type Deprecation = {
  model: string;
  provider: string;
  reason: string;
  status?: number;
  detail?: string;
};

// A provider-published retirement date for a model only that provider serves.
export type RetirementUpdate = {
  model: string;
  provider: string;
  retirement_date: string;
  previous_retirement_date: string | null;
  source: string;
};

// Something a human should look at before merging the audit PR: the catalog's
// retirement_date disagrees with what the provider is doing.
export type ReviewNote = {
  model: string;
  provider: string;
  note: string;
};

export type AuditReport = {
  deprecations: Deprecation[];
  retirements: RetirementUpdate[];
  reviewNotes: ReviewNote[];
  reportOnly: { provider: string; modelCount: number }[];
  skipped: { provider: string; reason: string }[];
};

// "Don't deprecate" list: model ids the audit must never flag for removal, even
// when a provider returns not-found/absent for them. Use this for early-access /
// preview models that are gated per-account, where the audit's CI credentials
// get a false 404 that does not reflect a real deprecation. The deprecation job
// filters its results against this set (see auditCatalog). Add an id here to
// keep it in the catalog regardless of audit results.
export const NEVER_DEPRECATE_MODELS: ReadonlySet<string> = new Set<string>([
  // OpenAI GPT-5.6 preview family (Sol / Cyber / Daybreak Blue / Daybreak Red)
  // — early-access, gated per OpenAI account, so the CI audit credentials probe
  // 404 them even though they are live for entitled accounts. Keep until GA or
  // a confirmed removal.
  "gpt-5.6-cyber",
  "daybreak-blue-latest",
  "daybreak-red-latest",
  "gpt-daybreak-blue-latest",
  "gpt-daybreak-red-latest",
  // Claude Mythos 5.1 and 5.2 — gated previews whose CI probes 404 despite being live for
  // entitled accounts. Keep until GA or a confirmed removal.
  "claude-mythos-5-1",
  "claude-mythos-5-2",
]);

const ANTHROPIC_LIFECYCLE_URL =
  "https://docs.claude.com/en/docs/about-claude/model-deprecations.md";

async function publicRetiredModels(provider: string): Promise<Set<string>> {
  if (provider !== "anthropic") return new Set();
  try {
    const response = await fetch(ANTHROPIC_LIFECYCLE_URL, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const retired = new Set<string>();
    for (const line of (await response.text()).split("\n")) {
      const row = /^\|\s*`?([\w.-]+)`?\s*\|\s*Retired\s*\|/.exec(line);
      if (row) retired.add(row[1]);
    }
    return retired;
  } catch (error) {
    console.warn(
      `  ${provider}: public lifecycle evidence unavailable: ${error}`,
    );
    return new Set();
  }
}

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

const RETIREMENT_SOURCES: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/models (expiration_date)",
};

// A model already retired in the catalog (by hand or by a past
// retirement_date). The audit keeps these entries, so it must not re-report
// them as new deprecations every day.
export function isRetired(spec: ModelSpec | undefined, now: Date): boolean {
  if (!spec) return false;
  if (spec.retired) return true;
  const today = now.toISOString().slice(0, 10);
  return !!spec.retirement_date && spec.retirement_date <= today;
}

// Proposes retirement_date updates from a provider's published dates, only for
// models that provider alone serves: a model is not retired while another
// provider still serves it.
export function retirementUpdatesFromDates(args: {
  provider: string;
  models: string[];
  catalog: Catalog;
  indexMap: Map<string, string[]>;
  dates: Map<string, string>;
}): RetirementUpdate[] {
  const updates: RetirementUpdate[] = [];
  for (const model of args.models) {
    const date = args.dates.get(model);
    if (!date) continue;
    const spec = args.catalog[model];
    const providers = effectiveProviders(model, spec, args.indexMap);
    if (providers.length !== 1 || providers[0] !== args.provider) continue;
    if (spec?.retirement_date === date) continue;
    updates.push({
      model,
      provider: args.provider,
      retirement_date: date,
      previous_retirement_date: spec?.retirement_date ?? null,
      source: RETIREMENT_SOURCES[args.provider] ?? args.provider,
    });
  }
  return updates;
}

// Flags models a provider still lists even though the catalog says it retired
// them, so a wrong retirement_date does not silently hide a live model.
export function stillServedAfterRetirement(args: {
  provider: string;
  models: string[];
  catalog: Catalog;
  liveList: Set<string>;
  now: Date;
}): ReviewNote[] {
  const today = args.now.toISOString().slice(0, 10);
  return args.models
    .filter((model) => {
      const date = args.catalog[model]?.retirement_date;
      return !!date && date < today && args.liveList.has(model);
    })
    .map((model) => ({
      model,
      provider: args.provider,
      note: `still listed by ${args.provider} after retirement_date ${args.catalog[model]?.retirement_date}`,
    }));
}

async function auditProvider(
  provider: string,
  models: string[],
  secrets: Map<string, ProviderSecret>,
  concurrency: number,
  catalog: Catalog,
  indexMap: Map<string, string[]>,
): Promise<{
  deprecations: Deprecation[];
  retirements: RetirementUpdate[];
  reviewNotes: ReviewNote[];
  skipped?: { provider: string; reason: string };
}> {
  const empty = { retirements: [], reviewNotes: [] };
  const api = PROVIDER_APIS[provider];
  const secret = secrets.get(provider);
  if (!api) {
    return {
      deprecations: [],
      ...empty,
      skipped: { provider, reason: "no adapter" },
    };
  }
  // A provider whose list endpoint is public (listRequiresSecret === false, e.g.
  // OpenRouter) can be audited even when the Braintrust org has no secret for it;
  // every other provider needs a secret for the list / probe.
  if (!secret && api.listRequiresSecret !== false) {
    return {
      deprecations: [],
      ...empty,
      skipped: { provider, reason: "no secret in Braintrust org" },
    };
  }
  // listModels/probeModel take a ProviderSecret; for a public list with no
  // configured secret, pass a placeholder the adapter ignores.
  const effectiveSecret: ProviderSecret = secret ?? {
    type: provider,
    secret: "",
    metadata: {},
  };

  // Step 1: narrow to suspects via the live list when one exists.
  let liveList: Set<string> | null = null;
  if (api.listModels) {
    try {
      liveList = await api.listModels(effectiveSecret);
      console.log(`  ${provider}: live list has ${liveList.size} models`);
    } catch (error) {
      const message = (error as Error).message;
      // An auth failure on the list endpoint means the probe (same secret) will
      // fail too — every probe would come back 401/403 and classify as
      // "unknown", silently yielding zero deprecations. Surface it as a skip so
      // a stale/invalid provider secret is visible instead of looking like
      // "nothing to deprecate".
      if (
        /\b(401|403)\b|authentication|invalid x-api-key|unauthor|permission denied/i.test(
          message,
        )
      ) {
        return {
          deprecations: [],
          ...empty,
          skipped: {
            provider,
            reason: `cannot audit — ${provider} secret rejected (${message.slice(0, 80)})`,
          },
        };
      }
      console.warn(
        `  ${provider}: list endpoint failed (${message.slice(0, 100)}); falling back to probing all models`,
      );
    }
  }

  const lifecycle: {
    retirements: RetirementUpdate[];
    reviewNotes: ReviewNote[];
  } = {
    retirements: [],
    reviewNotes: [],
  };
  if (liveList !== null) {
    lifecycle.reviewNotes = stillServedAfterRetirement({
      provider,
      models,
      catalog,
      liveList,
      now: new Date(),
    });
  }
  if (api.listRetirementDates) {
    try {
      lifecycle.retirements = retirementUpdatesFromDates({
        provider,
        models,
        catalog,
        indexMap,
        dates: await api.listRetirementDates(effectiveSecret),
      });
    } catch (error) {
      console.warn(
        `  ${provider}: retirement dates unavailable (${(error as Error).message.slice(0, 100)})`,
      );
    }
  }

  const suspects =
    liveList !== null ? models.filter((m) => !liveList!.has(m)) : models;
  if (suspects.length === 0) {
    return { deprecations: [], ...lifecycle };
  }

  // Step 2a: authoritative list (e.g. Databricks) — absence == deprecated.
  if (api.listIsAuthoritative && liveList !== null) {
    return {
      deprecations: suspects.map((model) => ({
        model,
        provider,
        reason: "absent from provider model list",
      })),
      ...lifecycle,
    };
  }

  // Step 2b: confirm each suspect with a direct provider probe.
  if (!api.probeModel) {
    return {
      deprecations: [],
      ...lifecycle,
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
        const { status, body } = await probe(effectiveSecret, model);
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
  const publicRetired = outcomes.some(
    (o) => o.outcome === "deprecated" && o.status === 404,
  )
    ? await publicRetiredModels(provider)
    : new Set<string>();
  for (const o of outcomes) {
    if (o.outcome === "deprecated") {
      if (o.status === 404 && !publicRetired.has(o.model)) {
        lifecycle.reviewNotes.push({
          model: o.model,
          provider,
          note: "account-scoped probe returned HTTP 404; no public retirement confirmation",
        });
        continue;
      }
      deprecations.push({
        model: o.model,
        provider,
        reason:
          o.status === 404
            ? `probe not-found + public retirement confirmation (${ANTHROPIC_LIFECYCLE_URL})`
            : liveList !== null
              ? "absent from list + probe not-found"
              : "probe not-found",
        status: o.status,
        detail: o.detail,
      });
    }
  }
  return { deprecations, ...lifecycle };
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

  const report: AuditReport = {
    deprecations: [],
    retirements: [],
    reviewNotes: [],
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
    // Fetch the secret fresh right before auditing this provider: some provider
    // secrets are short-lived OAuth tokens (e.g. anthropic/openai workload
    // identity, ~5 min) that would expire if all were fetched up front.
    const secrets = await fetchProviderSecrets(args.braintrustApiKey, [
      provider,
    ]);
    const { deprecations, retirements, reviewNotes, skipped } =
      await auditProvider(
        provider,
        models,
        secrets,
        args.concurrency,
        args.catalog,
        indexMap,
      );
    report.retirements.push(
      ...retirements.filter((r) => !NEVER_DEPRECATE_MODELS.has(r.model)),
    );
    report.reviewNotes.push(...reviewNotes);
    for (const deprecation of deprecations) {
      if (isRetired(args.catalog[deprecation.model], new Date())) {
        continue;
      }
      if (NEVER_DEPRECATE_MODELS.has(deprecation.model)) {
        console.log(
          `  [PRESERVED] ${deprecation.provider}/${deprecation.model} is in NEVER_DEPRECATE_MODELS — not deprecating`,
        );
        continue;
      }
      report.deprecations.push(deprecation);
    }
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
  for (const r of report.retirements) {
    console.log(
      `  RETIRE ${r.model} @ ${r.provider} on ${r.retirement_date} (was ${r.previous_retirement_date ?? "unset"})`,
    );
  }
  for (const n of report.reviewNotes) {
    console.log(`  REVIEW ${n.model} @ ${n.provider}: ${n.note}`);
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
      `deprecation_count=${report.deprecations.length}\n` +
        `retirement_count=${report.retirements.length}\n` +
        `review_count=${report.reviewNotes.length}\n` +
        `change_count=${report.deprecations.length + report.retirements.length + report.reviewNotes.length}\n`,
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
