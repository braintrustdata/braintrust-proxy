import fs from "fs";
import { pathToFileURL } from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type ModelList = Record<string, unknown>;

export function collectChangedModelIds(
  before: ModelList,
  after: ModelList,
): string[] {
  return Object.keys(after).filter(
    (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]),
  );
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
    .strict()
    .help()
    .parseAsync();

  const before = JSON.parse(
    await fs.promises.readFile(argv.before, "utf8"),
  ) as ModelList;
  const after = JSON.parse(
    await fs.promises.readFile(argv.after, "utf8"),
  ) as ModelList;
  const changedModelIds = collectChangedModelIds(before, after);

  await fs.promises.writeFile(
    argv.output,
    JSON.stringify(changedModelIds, null, 2) + "\n",
  );

  if (argv.githubOutput) {
    await fs.promises.appendFile(
      argv.githubOutput,
      `count=${changedModelIds.length}\n`,
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
