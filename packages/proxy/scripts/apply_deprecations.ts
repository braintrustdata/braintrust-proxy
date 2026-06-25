import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { pathToFileURL } from "url";
import type { AuditReport, Deprecation } from "./reconcile_provider_models";

// Apply confirmed deprecations from the audit report to the catalog:
//   - drop the dead provider from a model's available_providers (+ index.ts)
//   - when a model loses ALL providers, remove the entry entirely and add it to
//     SYNC_EXCLUDED_MODELS so the LiteLLM sync does not re-add it.

const SCHEMA_DIR = path.resolve(__dirname, "../schema");
const MODEL_LIST_PATH = path.join(SCHEMA_DIR, "model_list.json");
const INDEX_PATH = path.join(SCHEMA_DIR, "index.ts");
const SYNC_MODELS_PATH = path.join(__dirname, "sync_models.ts");

type ModelSpec = { available_providers?: string[] } & Record<string, unknown>;
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
): string {
  const lineRe = new RegExp(`^  "${escapeRegex(model)}":[^\\n]*\\n`, "m");
  if (!lineRe.test(content)) {
    return content;
  }
  if (providers.length === 0) {
    return content.replace(lineRe, "");
  }
  const arr = `[${providers.map((p) => JSON.stringify(p)).join(", ")}]`;
  return content.replace(lineRe, `  "${model}": ${arr},\n`);
}

// Insert model ids into the SYNC_EXCLUDED_MODELS set literal (before its close).
export function addToSyncExcluded(content: string, models: string[]): string {
  if (models.length === 0) {
    return content;
  }
  const marker = "export const SYNC_EXCLUDED_MODELS";
  const start = content.indexOf(marker);
  if (start < 0) {
    throw new Error("Could not find SYNC_EXCLUDED_MODELS in sync_models.ts");
  }
  const close = content.indexOf("]);", start);
  if (close < 0) {
    throw new Error("Could not find end of SYNC_EXCLUDED_MODELS set");
  }
  const existing = content.slice(start, close);
  const toAdd = models.filter((m) => !existing.includes(`"${m}"`));
  if (toAdd.length === 0) {
    return content;
  }
  const insertion =
    `  // Auto-removed by the model deprecation audit (provider returned not-found).\n` +
    toAdd.map((m) => `  ${JSON.stringify(m)},`).join("\n") +
    "\n";
  return content.slice(0, close) + insertion + content.slice(close);
}

export type ApplyResult = {
  removedModels: string[];
  narrowedModels: { model: string; dropped: string[]; remaining: string[] }[];
};

export function applyDeprecations(
  catalog: Catalog,
  indexContent: string,
  syncContent: string,
  deprecations: Deprecation[],
): {
  catalog: Catalog;
  indexContent: string;
  syncContent: string;
  result: ApplyResult;
} {
  const deadByModel = new Map<string, Set<string>>();
  for (const d of deprecations) {
    const set = deadByModel.get(d.model) ?? new Set<string>();
    set.add(d.provider);
    deadByModel.set(d.model, set);
  }

  const removedModels: string[] = [];
  const narrowedModels: ApplyResult["narrowedModels"] = [];
  let nextIndex = indexContent;

  for (const [model, dead] of deadByModel) {
    const spec = catalog[model];
    if (!spec) {
      continue;
    }
    const current = spec.available_providers ?? [];
    const remaining = current.filter((p) => !dead.has(p));
    const dropped = current.filter((p) => dead.has(p));
    if (dropped.length === 0) {
      continue;
    }

    if (remaining.length === 0) {
      delete catalog[model];
      nextIndex = rewriteIndexEntry(nextIndex, model, []);
      removedModels.push(model);
    } else {
      spec.available_providers = remaining;
      // Keep index.ts in sync, but only narrow within what it already lists.
      const indexLine = new RegExp(
        `^  "${escapeRegex(model)}":\\s*\\[([^\\]]*)\\]`,
        "m",
      ).exec(nextIndex);
      if (indexLine) {
        const indexProviders = Array.from(
          indexLine[1].matchAll(/"([^"]+)"/g),
        ).map((m) => m[1]);
        const narrowed = indexProviders.filter((p) => !dead.has(p));
        nextIndex = rewriteIndexEntry(nextIndex, model, narrowed);
      }
      narrowedModels.push({ model, dropped, remaining });
    }
  }

  const syncOut = addToSyncExcluded(syncContent, removedModels);
  return {
    catalog,
    indexContent: nextIndex,
    syncContent: syncOut,
    result: { removedModels, narrowedModels },
  };
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option("report", {
      demandOption: true,
      describe: "Path to the audit report JSON produced by reconcile",
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
  const syncContent = fs.readFileSync(SYNC_MODELS_PATH, "utf8");

  const out = applyDeprecations(
    catalog,
    indexContent,
    syncContent,
    report.deprecations,
  );

  console.log(
    `Removed ${out.result.removedModels.length} model(s); narrowed providers on ${out.result.narrowedModels.length} model(s).`,
  );
  for (const m of out.result.removedModels) {
    console.log(`  REMOVE ${m}`);
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
  await fs.promises.writeFile(SYNC_MODELS_PATH, out.syncContent);
  console.log("\n✅ Applied deprecations.");
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
