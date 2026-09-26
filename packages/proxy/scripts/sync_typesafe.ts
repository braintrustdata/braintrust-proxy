import { isDeepStrictEqual } from "util";
import { z } from "zod";
import type { ModelSpec } from "../schema/models";

const TYPESAFE_MODELS_URL = "https://api.typesafe.ai/v1/models";
const TYPESAFE_DOCS_URL = "https://docs.typesafe.ai/models.md";
const TYPESAFE_PROVIDER = "typesafe" as const;

type ModelCatalog = Record<string, ModelSpec>;

const modelIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/);
const typesafeModelListSchema = z.object({
  models: z
    .array(
      z.object({
        name: modelIdSchema,
        description: z.string(),
        release_date: z.string(),
      }),
    )
    .min(1),
});

function parseMarkdownTables(section: string): string[][][] {
  return (section.match(/(?:^\|[^\n]*\n?)+/gm) ?? []).map((table) =>
    table
      .trim()
      .split("\n")
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      ),
  );
}

// Parse only the documented model tables, never prose examples or inferred IDs.
// An unrecognized layout fails the sync instead of silently retaining stale prices.
export function parseTypesafePricing(markdown: string): ModelCatalog {
  const sections = markdown.split(/^## /m);
  const current = sections.find((section) =>
    section.startsWith("Current models\n"),
  );
  const aliases = sections.find((section) => section.startsWith("Aliases\n"));
  if (!current || !aliases || !/\bOutput tokens are free\./.test(current)) {
    throw new Error(
      "Typesafe documentation: expected model tables, aliases, and explicit free output pricing.",
    );
  }

  const models: ModelCatalog = {};
  const knownModelIds = new Set<string>();
  for (const rows of parseMarkdownTables(current)) {
    const modelId = rows[0]?.[1]?.match(/^`([^`]+)`$/)?.[1];
    if (
      !modelId ||
      !modelIdSchema.safeParse(modelId).success ||
      knownModelIds.has(modelId)
    ) {
      throw new Error(
        "Typesafe documentation: invalid or duplicate model table.",
      );
    }
    knownModelIds.add(modelId);
    const priceRow = rows.find(
      ([label]) => label === "Price (per Btok / per Mtok)",
    );
    if (!priceRow) {
      console.warn(`Typesafe: skipping ${modelId}; no documented token price.`);
      continue;
    }
    const priceMatch = priceRow[1]
      ?.replace(/\\\$/g, "$")
      .match(/^\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*\$([0-9]+(?:\.[0-9]+)?)$/);
    if (!priceMatch) {
      throw new Error(
        "Typesafe documentation: invalid or inconsistent Btok/Mtok pricing.",
      );
    }
    const pricePerBillionTokens = Number(priceMatch[1]);
    const pricePerMillionTokens = Number(priceMatch[2]);
    if (
      !Number.isFinite(pricePerBillionTokens) ||
      Math.abs(pricePerBillionTokens / 1000 - pricePerMillionTokens) > 1e-10
    ) {
      throw new Error(
        "Typesafe documentation: invalid or inconsistent Btok/Mtok pricing.",
      );
    }
    models[modelId] = {
      format: "typesafe",
      flavor: "evaluation",
      input_cost_per_mil_tokens: pricePerMillionTokens,
      output_cost_per_mil_tokens: 0,
      displayName: rows[0][0],
      available_providers: [TYPESAFE_PROVIDER],
    };
  }
  if (Object.keys(models).length === 0) {
    throw new Error(
      "Typesafe documentation: no priced versioned models found.",
    );
  }

  const aliasTables = parseMarkdownTables(aliases);
  if (aliasTables.length !== 1) {
    throw new Error("Typesafe documentation: expected one alias table.");
  }
  const aliasRows = aliasTables[0];
  if (
    aliasRows[0]?.[0] !== "Alias" ||
    aliasRows[0]?.[1] !== "Points to" ||
    aliasRows.length < 3
  ) {
    throw new Error("Typesafe documentation: invalid alias table.");
  }
  for (const row of aliasRows.slice(2)) {
    const alias = row[0]?.match(/^`([^`]+)`$/)?.[1];
    const target = row[1]?.match(/^`([^`]+)`$/)?.[1];
    if (
      !alias ||
      !target ||
      !modelIdSchema.safeParse(alias).success ||
      knownModelIds.has(alias) ||
      !knownModelIds.has(target)
    ) {
      throw new Error(
        "Typesafe documentation: invalid, duplicate, or unresolved alias.",
      );
    }
    knownModelIds.add(alias);
    const version = models[target];
    if (!version) {
      console.warn(
        `Typesafe: skipping ${alias}; its target has no documented price.`,
      );
      continue;
    }
    models[alias] = { ...version, displayName: alias };
  }
  return models;
}

export async function fetchTypesafeModels(): Promise<ModelCatalog> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY environment variable is required to sync Typesafe models.",
    );
  }

  let apiData: unknown;
  let markdown: string;
  try {
    const response = await fetch(TYPESAFE_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Typesafe model API returned HTTP ${response.status}.`);
    }
    apiData = await response.json();
    const docs = await fetch(TYPESAFE_DOCS_URL, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!docs.ok) {
      throw new Error(
        `Typesafe model documentation returned HTTP ${docs.status}.`,
      );
    }
    markdown = await docs.text();
  } catch {
    // Do not print response bodies, request headers, or fetch exception causes.
    throw new Error(
      "Could not fetch Typesafe model metadata; check credentials and source availability.",
    );
  }

  const parsed = typesafeModelListSchema.safeParse(apiData);
  if (!parsed.success) {
    throw new Error("Typesafe model API returned an invalid model list.");
  }
  const models = parseTypesafePricing(markdown);
  for (const model of parsed.data.models) {
    if (!Object.prototype.hasOwnProperty.call(models, model.name)) {
      console.warn(
        `Typesafe: skipping ${model.name}; no verified pricing or alias target.`,
      );
      continue;
    }
    models[model.name] = {
      ...models[model.name],
      description: model.description,
    };
  }
  return models;
}

export function mergeTypesafeModels(
  localModels: ModelCatalog,
  remoteModels: ModelCatalog,
): { models: ModelCatalog; changed: string[] } {
  const models = { ...localModels };
  const changed: string[] = [];
  for (const [name, remote] of Object.entries(remoteModels)) {
    const existing = localModels[name];
    const next: ModelSpec = {
      ...remote,
      ...existing,
      input_cost_per_mil_tokens: remote.input_cost_per_mil_tokens,
      output_cost_per_mil_tokens: remote.output_cost_per_mil_tokens,
      available_providers: [
        ...new Set([
          ...(existing?.available_providers ?? []),
          TYPESAFE_PROVIDER,
        ]),
      ],
    };
    if (remote.description !== undefined) {
      next.description = remote.description;
    }
    if (!isDeepStrictEqual(existing, next)) {
      models[name] = next;
      changed.push(name);
    }
  }
  return { models, changed };
}
