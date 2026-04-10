import https from "https";
import { ModelSpec } from "../schema/models";

export const GOOGLE_VERTEX_LOCATIONS_URL =
  "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations";

// Sorts alphabetically, but prioritizes "global", "us-central1", then
// "us-east5".
function sortRegionsDeterministically(regions: string[]): string[] {
  const uniqueRegions = Array.from(new Set(regions));
  return uniqueRegions.sort((a, b) => {
    for (const region of ["global", "us-central1", "us-east5"]) {
      if (a === region && b !== region) {
        return -1;
      }
      if (a !== region && b === region) {
        return 1;
      }
    }
    return a.localeCompare(b);
  });
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Failed to fetch ${url}: HTTP ${res.statusCode}`));
            return;
          }
          resolve(data);
        });
      })
      .on("error", (err) => {
        reject(new Error(`Failed to fetch ${url}: ${err.message}`));
      });
  });
}

function stripPublisherGooglePrefix(modelName: string): string {
  return modelName.replace(/^publishers\/google\/models\//, "");
}

function isPublisherModel(modelName: string): boolean {
  return modelName.startsWith("publishers/");
}

/**
 * Accumulate supported regions for a model into the map, merging across
 * multiple geographic tabs.
 */
function addRegions(
  map: Map<string, string[]>,
  key: string,
  regions: string[],
) {
  const existing = map.get(key) ?? [];
  map.set(key, sortRegionsDeterministically([...existing, ...regions]));
}

/**
 * Parse one section of the page (a geographic tab) whose rows have model IDs
 * in <code> tags, calling keyFn to convert the raw code text to a map key.
 * Rows where keyFn returns null are skipped.
 */
function parseSectionWithCodeTags(
  tableHtml: string,
  regionCodes: string[],
  keyFn: (codeText: string) => string | null,
  out: Map<string, string[]>,
) {
  for (const rowMatch of tableHtml.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
    const rowHtml = rowMatch[0];
    const codeText = rowHtml.match(/<code[^>]*>\(([^)<]+)\)<\/code>/)?.[1];
    if (!codeText) {
      continue;
    }
    const key = keyFn(codeText);
    if (!key) {
      continue;
    }
    const cells = Array.from(rowHtml.matchAll(/<td\b[\s\S]*?<\/td>/g)).slice(1);
    const supported = cells.flatMap((cellMatch, index) => {
      const cellHtml = cellMatch[0];
      return cellHtml.includes('aria-label="Supported"') ||
        cellHtml.includes("compare-yes")
        ? [regionCodes[index]]
        : [];
    });
    if (supported.length > 0) {
      addRegions(out, key, supported);
    }
  }
}

/**
 * Parse one section of the page (a geographic tab) whose rows have only
 * display names (no <code> tags), matching via displayNameToModelId.
 */
function parseSectionWithDisplayNames(
  tableHtml: string,
  regionCodes: string[],
  displayNameToModelId: ReadonlyMap<string, string>,
  out: Map<string, string[]>,
) {
  for (const rowMatch of tableHtml.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
    const rowHtml = rowMatch[0];
    if (rowHtml.includes("vertex-ai-table-heading")) {
      continue;
    }
    const firstTd = rowHtml.match(/<td>([\s\S]*?)<\/td>/);
    if (!firstTd) {
      continue;
    }
    const displayName = firstTd[1].replace(/<[^>]+>/g, "").trim();
    const modelId = displayNameToModelId.get(displayName);
    if (!modelId) {
      continue;
    }
    const cells = Array.from(rowHtml.matchAll(/<td\b[\s\S]*?<\/td>/g)).slice(1);
    const supported = cells.flatMap((cellMatch, index) => {
      const cellHtml = cellMatch[0];
      return cellHtml.includes('aria-label="Supported"') ||
        cellHtml.includes("compare-yes")
        ? [regionCodes[index]]
        : [];
    });
    if (supported.length > 0) {
      addRegions(out, modelId, supported);
    }
  }
}

/**
 * Iterate over every geographic-tab <section> within an h2 block and call
 * the appropriate parse function for each table.
 */
function parseH2Block(
  html: string,
  h2Id: string,
  callback: (tableHtml: string, regionCodes: string[]) => void,
) {
  const blockStart = html.indexOf(`<h2 id="${h2Id}"`);
  if (blockStart === -1) {
    return;
  }
  const blockEnd = html.indexOf("<h2 ", blockStart + 1);
  const blockHtml =
    blockEnd === -1 ? html.slice(blockStart) : html.slice(blockStart, blockEnd);

  for (const sectionMatch of blockHtml.matchAll(
    /<section><h3[^>]*>[\s\S]*?<\/h3>([\s\S]*?)<\/section>/g,
  )) {
    const tableHtml = sectionMatch[1].match(/<table>[\s\S]*?<\/table>/)?.[0];
    if (!tableHtml) {
      continue;
    }
    const regionCodes = Array.from(
      tableHtml.matchAll(
        /<th class="vertex-ai-table-cell">[\s\S]*?\(([a-z0-9-]+)\)<\/th>/g,
      ),
      (m) => m[1],
    );
    if (regionCodes.length === 0) {
      continue;
    }
    callback(tableHtml, regionCodes);
  }
}

/**
 * Parse region support from the Google Vertex AI locations page.
 *
 * Returns a map keyed by:
 * - Short gemini model name (e.g. "gemini-2.5-pro") for Google models
 *   (genai-google-models section, matched via <code> tags).
 * - Model slug (e.g. "qwen3-235b-a22b-instruct-2507-maas") for open models
 *   (genai-open-models section, matched via <code> tags).
 * - Full publisher model ID (e.g. "publishers/anthropic/models/claude-opus-4")
 *   for partner/open models that lack <code> tags (Anthropic, Mistral, Llama),
 *   resolved via displayNameToModelId.
 */
export function parseVertexSupportedRegionsFromLocationsPage(
  html: string,
  displayNameToModelId: ReadonlyMap<string, string> = new Map(),
): Map<string, string[]> {
  const modelRegions = new Map<string, string[]>();

  if (html.indexOf('<h2 id="google-models"') === -1) {
    throw new Error("Could not find Google model endpoint locations section.");
  }

  // --- Google Gemini models: keyed by short name, only "Gemini models" rows ---
  parseH2Block(html, "google-models", (tableHtml, regionCodes) => {
    let inGeminiSection = false;
    for (const rowMatch of tableHtml.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
      const rowHtml = rowMatch[0];
      const headingText = rowHtml.match(
        /<td[^>]*class="vertex-ai-table-heading"[^>]*>\s*([\s\S]*?)\s*<\/td>/,
      )?.[1];
      if (headingText) {
        inGeminiSection = headingText.includes("Gemini models");
        continue;
      }
      if (!inGeminiSection) {
        continue;
      }
      const modelName = rowHtml.match(
        /<code[^>]*>\((gemini[^)<]*)\)<\/code>/,
      )?.[1];
      if (!modelName) {
        continue;
      }
      const cells = Array.from(
        rowHtml.matchAll(/<td\b[\s\S]*?<\/td>/g),
      ).slice(1);
      const supported = cells.flatMap((cellMatch, index) => {
        const cellHtml = cellMatch[0];
        return cellHtml.includes('aria-label="Supported"') ||
          cellHtml.includes("compare-yes")
          ? [regionCodes[index]]
          : [];
      });
      if (supported.length > 0) {
        addRegions(modelRegions, modelName, supported);
      }
    }
  });

  // --- Open models: <code> tags → keyed by slug; display-name rows → via map ---
  parseH2Block(html, "genai-open-models", (tableHtml, regionCodes) => {
    parseSectionWithCodeTags(tableHtml, regionCodes, (slug) => slug, modelRegions);
    parseSectionWithDisplayNames(
      tableHtml,
      regionCodes,
      displayNameToModelId,
      modelRegions,
    );
  });

  // --- Partner models (Anthropic, Mistral): display names only ---
  parseH2Block(html, "genai-partner-models", (tableHtml, regionCodes) => {
    parseSectionWithDisplayNames(
      tableHtml,
      regionCodes,
      displayNameToModelId,
      modelRegions,
    );
  });

  return modelRegions;
}

/**
 * Maps the display name used on the Vertex AI locations page to the
 * corresponding publisher model ID in model_list.json.
 *
 * Used for models in the partner/open sections that lack <code> model ID tags.
 * Update this map whenever new partner models are added to the page.
 */
export const PARTNER_MODEL_PAGE_NAME_TO_ID: ReadonlyMap<string, string> =
  new Map([
    // Anthropic
    ["Claude Opus 4.6", "publishers/anthropic/models/claude-opus-4-6"],
    ["Claude Opus 4.5", "publishers/anthropic/models/claude-opus-4-5@20251101"],
    ["Claude Opus 4.1", "publishers/anthropic/models/claude-opus-4-1@20250805"],
    ["Claude Opus 4", "publishers/anthropic/models/claude-opus-4"],
    ["Claude Sonnet 4.6", "publishers/anthropic/models/claude-sonnet-4-6"],
    ["Claude Sonnet 4.5", "publishers/anthropic/models/claude-sonnet-4-5"],
    ["Claude Sonnet 4", "publishers/anthropic/models/claude-sonnet-4"],
    ["Claude Haiku 4.5", "publishers/anthropic/models/claude-haiku-4-5"],
    [
      "Anthropic's Claude 3.7 Sonnet",
      "publishers/anthropic/models/claude-3-7-sonnet",
    ],
    [
      "Anthropic's Claude 3.5 Haiku",
      "publishers/anthropic/models/claude-3-5-haiku",
    ],
    [
      "Anthropic's Claude 3 Haiku (deprecated)",
      "publishers/anthropic/models/claude-3-haiku",
    ],
    // Mistral
    ["Mistral Large (24.07)", "publishers/mistralai/models/mistral-large-2411"],
    ["Codestral 2", "publishers/mistralai/models/codestral-2501"],
    // Llama
    ["Llama 3.3 70B", "publishers/meta/models/llama-3.3-70b-instruct-maas"],
  ]);

export async function fetchVertexSupportedRegions(): Promise<
  Map<string, string[]>
> {
  const html = await fetchText(GOOGLE_VERTEX_LOCATIONS_URL);
  return parseVertexSupportedRegionsFromLocationsPage(
    html,
    PARTNER_MODEL_PAGE_NAME_TO_ID,
  );
}

export function syncVertexSupportedRegions<T extends Record<string, ModelSpec>>(
  localModels: T,
  supportedRegionsByModel: Map<string, string[]>,
): Map<string, string[]> {
  const updates = new Map<string, string[]>();

  // Step 1: build a slug→fullKey index for open models
  // (e.g. "qwen3-235b-a22b-instruct-2507-maas" → "publishers/qwen/models/qwen3-235b-a22b-instruct-2507-maas")
  const slugToPublisherKey = new Map<string, string>();
  for (const modelName of Object.keys(localModels)) {
    if (!isPublisherModel(modelName)) {
      continue;
    }
    const slug = modelName.split("/models/")[1];
    if (slug) {
      slugToPublisherKey.set(slug, modelName);
    }
  }

  // Step 2: resolve direct scraped entries for all publisher models.
  // - Gemini models: lookup key is short name (e.g. "gemini-2.5-pro")
  // - Partner models (Anthropic/Mistral/Llama): lookup key is full publisher ID
  // - Open models (Qwen/Kimi/etc.): lookup key is the slug
  const resolvedLocations = new Map<string, string[]>();
  for (const modelName of Object.keys(localModels)) {
    if (!isPublisherModel(modelName)) {
      continue;
    }
    let lookupKey: string;
    if (modelName.startsWith("publishers/google/models/gemini")) {
      lookupKey = stripPublisherGooglePrefix(modelName);
    } else {
      lookupKey = modelName;
    }
    // Try direct lookup first, then slug lookup for open models
    const regions =
      supportedRegionsByModel.get(lookupKey) ??
      supportedRegionsByModel.get(modelName.split("/models/")[1] ?? "");
    if (regions) {
      resolvedLocations.set(modelName, sortRegionsDeterministically(regions));
    }
  }

  // Step 3: propagate to versioned children (e.g. claude-opus-4@20250514).
  // Done as a separate pass so inheritance is order-independent with respect
  // to JSON key order.
  for (const [modelName, model] of Object.entries(localModels)) {
    if (
      !isPublisherModel(modelName) ||
      resolvedLocations.has(modelName) ||
      !model.parent
    ) {
      continue;
    }
    const parentRegions = resolvedLocations.get(model.parent);
    if (parentRegions) {
      resolvedLocations.set(modelName, parentRegions);
    }
  }

  // Step 4: determine which models are "scraper-owned" so we don't accidentally
  // clear static locations on models the scraper doesn't know about.
  const scrapedModelIds = new Set<string>();
  // Gemini models covered by the scraper
  for (const key of supportedRegionsByModel.keys()) {
    if (key.startsWith("gemini")) {
      scrapedModelIds.add(`publishers/google/models/${key}`);
    }
  }
  // Partner/open models covered by explicit mapping or slug lookup
  for (const modelId of PARTNER_MODEL_PAGE_NAME_TO_ID.values()) {
    scrapedModelIds.add(modelId);
  }
  for (const [slug, fullKey] of slugToPublisherKey) {
    if (supportedRegionsByModel.has(slug)) {
      scrapedModelIds.add(fullKey);
    }
  }
  // Versioned children of scraped models
  for (const [modelName, model] of Object.entries(localModels)) {
    if (model.parent && scrapedModelIds.has(model.parent)) {
      scrapedModelIds.add(modelName);
    }
  }

  // Step 5: apply updates.
  for (const [modelName, model] of Object.entries(localModels)) {
    if (!isPublisherModel(modelName)) {
      continue;
    }

    const nextRegions = resolvedLocations.get(modelName);
    const currentRegions = model.locations;

    if (!nextRegions) {
      if (currentRegions && scrapedModelIds.has(modelName)) {
        delete (model as Partial<ModelSpec>).locations;
        updates.set(modelName, []);
      }
      continue;
    }

    const same =
      Array.isArray(currentRegions) &&
      currentRegions.length === nextRegions.length &&
      currentRegions.every((region, index) => region === nextRegions[index]);

    if (!same) {
      model.locations = nextRegions;
      updates.set(modelName, nextRegions);
    }
  }

  return updates;
}
