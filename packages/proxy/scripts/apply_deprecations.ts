import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { pathToFileURL } from "url";
import type { AuditReport, Deprecation } from "./reconcile_provider_models";
import { parseIndexEndpointTypes } from "./reconcile_provider_models";

// Apply confirmed deprecations from the audit report to the catalog:
//   - drop the dead provider from a model's available_providers (+ index.ts)
//   - when a model loses ALL providers, remove the entry entirely and add it to
//     SYNC_EXCLUDED_MODELS so the LiteLLM sync does not re-add it.

const SCHEMA_DIR = path.resolve(__dirname, "../schema");
const MODEL_LIST_PATH = path.join(SCHEMA_DIR, "model_list.json");
const INDEX_PATH = path.join(SCHEMA_DIR, "index.ts");
const DEPRECATED_IDS_PATH = path.join(__dirname, "deprecated_model_ids.json");

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

// Add model ids to the automation-managed deprecated-ids list (sorted, unique).
// sync_models.ts reads this JSON into SYNC_EXCLUDED_MODELS, so the audit never
// has to edit TypeScript source.
export function addToDeprecatedIds(
  current: string[],
  models: string[],
): string[] {
  return Array.from(new Set([...current, ...models])).sort();
}

export type ApplyResult = {
  removedModels: string[];
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

  const removedModels: string[] = [];
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
    const remaining = effective.filter((p) => !dead.has(p));

    if (remaining.length === 0) {
      if (spec) {
        delete catalog[model];
      }
      nextIndex = rewriteIndexEntry(nextIndex, model, []);
      removedModels.push(model);
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

  const updatedDeprecatedIds = addToDeprecatedIds(deprecatedIds, removedModels);
  return {
    catalog,
    indexContent: nextIndex,
    deprecatedIds: updatedDeprecatedIds,
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
  const deprecatedIds: string[] = JSON.parse(
    fs.readFileSync(DEPRECATED_IDS_PATH, "utf8"),
  );

  const out = applyDeprecations(
    catalog,
    indexContent,
    deprecatedIds,
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
