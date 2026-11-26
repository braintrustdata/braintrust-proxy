import fs from "fs";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { StoredModelSpec } from "../schema/models";

type ModelList = Record<string, unknown>;

export function collectChangedModelIds(
  before: ModelList,
  after: ModelList,
): string[] {
  return Object.keys(after).filter(
    (name) => !isDeepStrictEqual(before[name], after[name]),
  );
}

type EnrichmentTask = {
  model: string;
  displayName: boolean;
  parent: boolean;
  pricingProviders: string[];
  verifyOpenAITokenLimits: boolean;
};

export function collectEnrichmentTasks(
  before: Record<string, StoredModelSpec>,
  after: Record<string, StoredModelSpec>,
): EnrichmentTask[] {
  const tasks: EnrichmentTask[] = [];
  for (const model of collectChangedModelIds(before, after)) {
    const entry = after[model];
    if (entry.retired) continue;
    const previous = before[model];
    const displayName =
      !model.startsWith("ft:") && (!previous || !entry.displayName);
    const parent = !previous;
    const standardPriceChanged = Object.keys({ ...previous, ...entry }).some(
      (field) =>
        /_cost_per_(?:second|(?:mil_)?tokens?)$/.test(field) &&
        entry[field as keyof StoredModelSpec] !==
          previous?.[field as keyof StoredModelSpec],
    );
    const providers = entry.available_providers ?? [];
    const pricingProviders = providers.filter(
      (provider) =>
        standardPriceChanged ||
        !previous?.available_providers?.includes(provider) ||
        !isDeepStrictEqual(
          entry.pricing?.[provider],
          previous.pricing?.[provider],
        ),
    );
    const verifyOpenAITokenLimits =
      providers.includes("openai") &&
      (!previous?.available_providers?.includes("openai") ||
        entry.max_input_tokens !== previous.max_input_tokens ||
        entry.max_output_tokens !== previous.max_output_tokens ||
        entry.providers?.openai?.max_input_tokens !==
          previous.providers?.openai?.max_input_tokens ||
        entry.providers?.openai?.max_output_tokens !==
          previous.providers?.openai?.max_output_tokens);
    if (
      displayName ||
      parent ||
      pricingProviders.length ||
      verifyOpenAITokenLimits
    ) {
      tasks.push({
        model,
        displayName,
        parent,
        pricingProviders,
        verifyOpenAITokenLimits,
      });
    }
  }
  return tasks;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option("before", {
      type: "string",
      demandOption: true,
      describe: "Path to the model list before changes",
    })
    .option("after", {
      type: "string",
      demandOption: true,
      describe: "Path to the model list after changes",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      describe: "Path to write the changed model id JSON array",
    })
    .option("github-output", {
      type: "string",
      demandOption: false,
      describe: "Optional path to the GitHub Actions output file",
    })
    .option("enrichment-output", {
      type: "string",
      describe: "Optional path for field-level enrichment tasks",
    })
    .strict()
    .help()
    .parseAsync();

  const before = JSON.parse(
    await fs.promises.readFile(argv.before, "utf8"),
  ) as Record<string, StoredModelSpec>;
  const after = JSON.parse(
    await fs.promises.readFile(argv.after, "utf8"),
  ) as Record<string, StoredModelSpec>;
  const changedModelIds = collectChangedModelIds(before, after);

  await fs.promises.writeFile(
    argv.output,
    JSON.stringify(changedModelIds, null, 2) + "\n",
  );

  const enrichmentTasks = argv.enrichmentOutput
    ? collectEnrichmentTasks(before, after)
    : [];
  if (argv.enrichmentOutput) {
    await fs.promises.writeFile(
      argv.enrichmentOutput,
      JSON.stringify(enrichmentTasks, null, 2) + "\n",
    );
  }

  if (argv.githubOutput) {
    await fs.promises.appendFile(
      argv.githubOutput,
      `count=${changedModelIds.length}\nenrichment_count=${enrichmentTasks.length}\n`,
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
