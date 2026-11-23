import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { z } from "zod";

const modelListSchema = z.record(z.unknown());
type ModelList = z.infer<typeof modelListSchema>;

// Add reviewed exceptions here as exact model IDs with a reason.
const displayNameExceptions: Readonly<Record<string, string>> = {};

export function checkModelDisplayNames(
  before: ModelList,
  after: ModelList,
  exceptions = displayNameExceptions,
): { passed: boolean; markdown: string } {
  const added: string[] = [];
  const touched: string[] = [];
  const exempted: string[] = [];

  for (const [id, spec] of Object.entries(after)) {
    if (
      id.startsWith("ft:") ||
      (typeof spec === "object" &&
        spec !== null &&
        "displayName" in spec &&
        typeof spec.displayName === "string" &&
        spec.displayName.trim())
    ) {
      continue;
    }

    const label = `\`${JSON.stringify(id).slice(1, -1).replace(/`/g, "\\u0060")}\``;
    if (Object.prototype.hasOwnProperty.call(before, id)) {
      if (!isDeepStrictEqual(before[id], spec)) {
        touched.push(label);
      }
      continue;
    }

    const reason = Object.prototype.hasOwnProperty.call(exceptions, id)
      ? exceptions[id].trim()
      : "";
    if (reason) {
      exempted.push(`${label}: ${reason}`);
    } else {
      added.push(label);
    }
  }

  const sections = [
    "## Model display name check",
    added.length > 0
      ? "**Action required:** add verified display names or document reviewed exceptions before merging."
      : "No new models are missing a required display name.",
  ];
  for (const [heading, entries] of [
    ["New models missing a display name", added],
    ["Warning: existing models changed without a display name", touched],
    ["Reviewed exceptions for new models", exempted],
  ] satisfies [string, string[]][]) {
    if (entries.length > 0) {
      sections.push(
        `### ${heading}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}`,
      );
    }
  }
  return { passed: added.length === 0, markdown: sections.join("\n\n") + "\n" };
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("before", { type: "string", demandOption: true })
    .option("after", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .strict()
    .help()
    .parseAsync();

  const before = modelListSchema.parse(
    JSON.parse(readFileSync(argv.before, "utf8")),
  );
  const after = modelListSchema.parse(
    JSON.parse(readFileSync(argv.after, "utf8")),
  );
  const { passed, markdown } = checkModelDisplayNames(before, after);
  writeFileSync(argv.output, markdown);
  process.exitCode = passed ? 0 : 1;
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
