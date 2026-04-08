import https from "https";
import { ModelSpec } from "../schema/models";

export const GOOGLE_VERTEX_LOCATIONS_URL =
  "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations";

// Puts "global" first, then sorts the rest alphabetically
function sortRegionsDeterministically(regions: string[]): string[] {
  const uniqueRegions = Array.from(new Set(regions));
  return uniqueRegions.sort((a, b) => {
    if (a === "global" && b !== "global") {
      return -1;
    }
    if (a !== "global" && b === "global") {
      return 1;
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

function isVertexGoogleModel(modelName: string, model?: ModelSpec): boolean {
  const normalizedName = stripPublisherGooglePrefix(modelName);
  const isGoogleModel = normalizedName.startsWith("gemini");
  const hasVertexProvider =
    model?.available_providers?.includes("vertex") ||
    model?.endpoint_types?.includes("vertex");
  return isGoogleModel && !!hasVertexProvider;
}

export function parseVertexSupportedRegionsFromLocationsPage(
  html: string,
): Map<string, string[]> {
  const googleModelsStart = html.indexOf('<h2 id="google-models"');
  if (googleModelsStart === -1) {
    throw new Error("Could not find Google model endpoint locations section.");
  }

  const partnerModelsStart = html.indexOf(
    '<h2 id="genai-partner-models"',
    googleModelsStart,
  );
  const sectionHtml =
    partnerModelsStart === -1
      ? html.slice(googleModelsStart)
      : html.slice(googleModelsStart, partnerModelsStart);

  const modelRegions = new Map<string, string[]>();
  const sectionRegex =
    /<section><h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)<\/section>/g;
  for (const sectionMatch of sectionHtml.matchAll(sectionRegex)) {
    const tableHtml = sectionMatch[2].match(/<table>[\s\S]*?<\/table>/)?.[0];
    if (!tableHtml) {
      continue;
    }

    const regionCodes = Array.from(
      tableHtml.matchAll(
        /<th class="vertex-ai-table-cell">[\s\S]*?\(([a-z0-9-]+)\)<\/th>/g,
      ),
      (match) => match[1],
    );

    if (regionCodes.length === 0) {
      continue;
    }

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

      const cells = Array.from(rowHtml.matchAll(/<td\b[\s\S]*?<\/td>/g)).slice(
        1,
      );
      if (cells.length === 0) {
        continue;
      }

      const supportedRegions = cells.flatMap((cellMatch, index) => {
        const cellHtml = cellMatch[0];
        return cellHtml.includes('aria-label="Supported"') ||
          cellHtml.includes("compare-yes")
          ? [regionCodes[index]]
          : [];
      });

      if (supportedRegions.length > 0) {
        const existingRegions = modelRegions.get(modelName) ?? [];
        modelRegions.set(
          modelName,
          sortRegionsDeterministically([
            ...existingRegions,
            ...supportedRegions,
          ]),
        );
      }
    }
  }

  return modelRegions;
}

export async function fetchVertexSupportedRegions(): Promise<
  Map<string, string[]>
> {
  const html = await fetchText(GOOGLE_VERTEX_LOCATIONS_URL);
  return parseVertexSupportedRegionsFromLocationsPage(html);
}

export function syncVertexSupportedRegions<T extends Record<string, ModelSpec>>(
  localModels: T,
  supportedRegionsByModel: Map<string, string[]>,
): Map<string, string[]> {
  const updates = new Map<string, string[]>();

  for (const [modelName, model] of Object.entries(localModels)) {
    if (!isVertexGoogleModel(modelName, model)) {
      continue;
    }

    const normalizedName = stripPublisherGooglePrefix(modelName);
    const supportedRegions = supportedRegionsByModel.get(normalizedName);
    const currentRegions = model.supported_regions;

    if (!supportedRegions) {
      if (currentRegions) {
        delete (model as Partial<ModelSpec>).supported_regions;
        updates.set(modelName, []);
      }
      continue;
    }

    const nextRegions = sortRegionsDeterministically(supportedRegions);
    const same =
      Array.isArray(currentRegions) &&
      currentRegions.length === nextRegions.length &&
      currentRegions.every((region, index) => region === nextRegions[index]);

    if (!same) {
      model.supported_regions = nextRegions;
      updates.set(modelName, nextRegions);
    }
  }

  return updates;
}
