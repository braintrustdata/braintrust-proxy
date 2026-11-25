import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { pathToFileURL } from "url";
import type {
  AuditReport,
  Deprecation,
  RetirementUpdate,
  ReviewNote,
} from "./reconcile_provider_models";
import { parseIndexEndpointTypes } from "./reconcile_provider_models";
import {
  summarizeModelProviders,
  type StoredModelSpec,
} from "../schema/models";

// Apply confirmed deprecations from the audit report to the catalog:
//   - drop the dead provider from a model's available_providers (+ index.ts)
//   - when a model loses ALL providers, keep the entry as retired (retired: true
//     plus a retirement_date), keep its provider mappings as a record of where
//     it was served, and add it to SYNC_EXCLUDED_MODELS so the LiteLLM sync
//     leaves it alone. Index-only routes with no catalog entry are removed.

const SCHEMA_DIR = path.resolve(__dirname, "../schema");
const MODEL_LIST_PATH = path.join(SCHEMA_DIR, "model_list.json");
const INDEX_PATH = path.join(SCHEMA_DIR, "index.ts");
const DEPRECATED_IDS_PATH = path.join(__dirname, "deprecated_model_ids.json");

type ModelSpec = {
  available_providers?: string[];
  fallback_models?: string[];
  deprecation_date?: string | null;
  retired?: boolean | null;
  retirement_date?: string | null;
  providers?: StoredModelSpec["providers"];
} & Record<string, unknown>;
type Catalog = Record<string, ModelSpec>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rewrite a model's AvailableEndpointTypes line to a new provider set, or delete
// the line when the set is empty. Returns the updated content.
export function rewriteIndexEntry(
  content: string,
  model: string,
  providers: string[],
  keepEmpty = false,
): string {
  const lineRe = new RegExp(
    `^  "${escapeRegex(model)}":\\s*\\[[^\\]]*\\],[^\\n]*\\n?`,
    "m",
  );
  if (!lineRe.test(content)) {
    return content;
  }
  if (providers.length === 0 && !keepEmpty) {
    return content.replace(lineRe, "");
  }
  const arr = `[${providers.map((p) => JSON.stringify(p)).join(", ")}]`;
  return content.replace(lineRe, `  "${model}": ${arr},\n`);
}

// Add model ids to the automation-managed deprecated-ids list (sorted, unique).
// sync_models.ts reads this JSON into SYNC_EXCLUDED_MODELS, so the audit never
// has to edit TypeScript source.
export function addToDeprecatedIds(
  current: string[],
  models: string[],
): string[] {
  return Array.from(new Set([...current, ...models])).sort();
}

// Set retirement_date from provider-published dates. The canonicalizer puts the
// key in its standard position afterwards.
export function applyRetirements(
  catalog: Catalog,
  retirements: RetirementUpdate[],
): string[] {
  const applied: string[] = [];
  for (const r of retirements) {
    const spec = catalog[r.model];
    if (!spec) continue;
    if (spec.providers) {
      const provider =
        spec.providers[r.provider as keyof typeof spec.providers];
      if (!provider || provider.retirement_date === r.retirement_date) continue;
      provider.retirement_date = r.retirement_date;
      Object.assign(spec, summarizeModelProviders(spec.providers));
    } else {
      if (spec.retirement_date === r.retirement_date) continue;
      spec.retirement_date = r.retirement_date;
    }
    applied.push(r.model);
  }
  return applied;
}

// Models the audit is about to retire whose catalog lifecycle data did not see
// it coming: no retirement_date at all, or one still in the future.
export function retirementReviewNotes(
  catalog: Catalog,
  retiredModels: string[],
  now: Date,
): ReviewNote[] {
  const today = now.toISOString().slice(0, 10);
  const notes: ReviewNote[] = [];
  for (const model of retiredModels) {
    const spec = catalog[model];
    if (!spec) continue;
    const provider = (spec.available_providers ?? []).join(", ");
    if (!spec.retirement_date) {
      notes.push({
        model,
        provider,
        note: `retired by the audit on ${today} with no retirement_date on record; check the provider's notice`,
      });
    } else if (spec.retirement_date > today) {
      notes.push({
        model,
        provider,
        note: `retired by the audit on ${today}, before its retirement_date ${spec.retirement_date}`,
      });
    }
  }
  return notes;
}

export function buildSummaryMarkdown(args: {
  retirements: RetirementUpdate[];
  reviewNotes: ReviewNote[];
}): string {
  const lines: string[] = [];
  if (args.retirements.length > 0) {
    lines.push(
      "### Retirement dates",
      "",
      "| Model | Provider | retirement_date | Previous | Source |",
      "|---|---|---|---|---|",
      ...args.retirements.map(
        (r) =>
          `| \`${r.model}\` | ${r.provider} | ${r.retirement_date} | ${r.previous_retirement_date ?? "unset"} | ${r.source} |`,
      ),
      "",
    );
  }
  if (args.reviewNotes.length > 0) {
    lines.push(
      "### Needs review",
      "",
      "The catalog's lifecycle dates disagree with what the provider is doing. Check the provider's deprecation notice before merging.",
      "",
      ...args.reviewNotes.map(
        (n) => `- \`${n.model}\` (${n.provider}): ${n.note}`,
      ),
      "",
    );
  }
  return lines.join("\n");
}

// Models applyDeprecations would retire, computed without mutating.
export function planRetirements(
  catalog: Catalog,
  indexContent: string,
  deprecations: Deprecation[],
): string[] {
  const copy: Catalog = JSON.parse(JSON.stringify(catalog));
  return applyDeprecations(copy, indexContent, [], deprecations).result
    .retiredModels;
}

// Mark verified removal without turning the audit observation into a date.
export function markRetired(spec: ModelSpec): void {
  spec.retired = true;
  if (
    spec.retirement_date &&
    spec.deprecation_date &&
    spec.deprecation_date > spec.retirement_date
  ) {
    delete spec.deprecation_date;
  }
}

export type ApplyResult = {
  retiredModels: string[];
  removedRoutes: string[];
  narrowedModels: { model: string; dropped: string[]; remaining: string[] }[];
};

export function applyDeprecations(
  catalog: Catalog,
  indexContent: string,
  deprecatedIds: string[],
  deprecations: Deprecation[],
): {
  catalog: Catalog;
  indexContent: string;
  deprecatedIds: string[];
  result: ApplyResult;
} {
  const deadByModel = new Map<string, Set<string>>();
  for (const d of deprecations) {
    const set = deadByModel.get(d.model) ?? new Set<string>();
    set.add(d.provider);
    deadByModel.set(d.model, set);
  }

  const retiredModels: string[] = [];
  const removedRoutes: string[] = [];
  const narrowedModels: ApplyResult["narrowedModels"] = [];
  let nextIndex = indexContent;
  const indexMap = parseIndexEndpointTypes(indexContent);

  for (const [model, dead] of deadByModel) {
    const spec = catalog[model];
    const avail = spec?.available_providers ?? [];
    const idx = indexMap.get(model) ?? [];
    // Effective providers come from BOTH model_list.json and index.ts; a model
    // routed only via index.ts has no available_providers but must still be
    // removable when its index mapping is the dead route.
    const effective = Array.from(new Set([...avail, ...idx]));
    const dropped = effective.filter((p) => dead.has(p));
    if (dropped.length === 0) {
      continue;
    }
    if (spec?.providers) {
      for (const name of dropped) {
        const provider = spec.providers[name as keyof typeof spec.providers];
        if (provider) provider.retired = true;
      }
      const summary = summarizeModelProviders(spec.providers);
      Object.assign(spec, summary);
      nextIndex = rewriteIndexEntry(
        nextIndex,
        model,
        idx.filter((p) => !dead.has(p)),
        true,
      );
      if (summary.retired) {
        markRetired(spec);
        retiredModels.push(model);
      } else {
        narrowedModels.push({
          model,
          dropped,
          remaining: summary.available_providers,
        });
      }
      continue;
    }

    const remaining = effective.filter((p) => !dead.has(p));

    if (remaining.length === 0) {
      if (spec) {
        markRetired(spec);
        retiredModels.push(model);
      } else {
        nextIndex = rewriteIndexEntry(nextIndex, model, []);
        removedRoutes.push(model);
      }
    } else {
      if (spec && avail.some((p) => dead.has(p))) {
        spec.available_providers = avail.filter((p) => !dead.has(p));
      }
      if (idx.some((p) => dead.has(p))) {
        nextIndex = rewriteIndexEntry(
          nextIndex,
          model,
          idx.filter((p) => !dead.has(p)),
        );
      }
      narrowedModels.push({ model, dropped, remaining });
    }
  }

  // Remove incoming fallback edges to models this audit retired or unrouted.
  const removed = new Set([...retiredModels, ...removedRoutes]);
  for (const spec of Object.values(catalog)) {
    if (!spec.fallback_models?.some((model) => removed.has(model))) continue;
    const surviving = spec.fallback_models.filter(
      (model) => !removed.has(model),
    );
    if (surviving.length > 0) {
      spec.fallback_models = surviving;
    } else {
      delete spec.fallback_models;
    }
  }

  const updatedDeprecatedIds = addToDeprecatedIds(deprecatedIds, [
    ...retiredModels,
    ...removedRoutes,
  ]);
  return {
    catalog,
    indexContent: nextIndex,
    deprecatedIds: updatedDeprecatedIds,
    result: { retiredModels, removedRoutes, narrowedModels },
  };
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option("report", {
      demandOption: true,
      describe: "Path to the audit report JSON produced by reconcile",
      type: "string",
    })
    .option("summary-output", {
      describe: "Path to write a markdown summary for the PR body",
      type: "string",
    })
    .option("write", {
      default: false,
      describe: "Write changes to disk",
      type: "boolean",
    })
    .strict()
    .help()
    .parseAsync();

  const report: AuditReport = JSON.parse(fs.readFileSync(argv.report, "utf8"));
  const catalog: Catalog = JSON.parse(fs.readFileSync(MODEL_LIST_PATH, "utf8"));
  const indexContent = fs.readFileSync(INDEX_PATH, "utf8");
  const deprecatedIds: string[] = JSON.parse(
    fs.readFileSync(DEPRECATED_IDS_PATH, "utf8"),
  );

  const now = new Date();
  const retirementNotes = retirementReviewNotes(
    catalog,
    planRetirements(catalog, indexContent, report.deprecations),
    now,
  );
  const retired = applyRetirements(catalog, report.retirements ?? []);
  const out = applyDeprecations(
    catalog,
    indexContent,
    deprecatedIds,
    report.deprecations,
  );
  const reviewNotes = [...(report.reviewNotes ?? []), ...retirementNotes];
  console.log(`Set retirement_date on ${retired.length} model(s).`);
  for (const n of reviewNotes) {
    console.log(`  REVIEW ${n.model}: ${n.note}`);
  }
  if (argv["summary-output"]) {
    await fs.promises.writeFile(
      argv["summary-output"],
      buildSummaryMarkdown({
        retirements: report.retirements ?? [],
        reviewNotes,
      }),
    );
  }

  console.log(
    `Retired ${out.result.retiredModels.length} model(s); removed ${out.result.removedRoutes.length} index-only route(s); narrowed providers on ${out.result.narrowedModels.length} model(s).`,
  );
  for (const m of out.result.retiredModels) {
    console.log(`  RETIRE ${m}`);
  }
  for (const m of out.result.removedRoutes) {
    console.log(`  REMOVE ROUTE ${m}`);
  }
  for (const n of out.result.narrowedModels) {
    console.log(
      `  NARROW ${n.model}: drop [${n.dropped.join(", ")}] keep [${n.remaining.join(", ")}]`,
    );
  }

  if (!argv.write) {
    console.log("\nDry run. Re-run with --write to apply.");
    return;
  }

  await fs.promises.writeFile(
    MODEL_LIST_PATH,
    JSON.stringify(out.catalog, null, 2) + "\n",
  );
  await fs.promises.writeFile(INDEX_PATH, out.indexContent);
  await fs.promises.writeFile(
    DEPRECATED_IDS_PATH,
    JSON.stringify(out.deprecatedIds, null, 2) + "\n",
  );
  console.log("\n✅ Applied deprecations.");
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
