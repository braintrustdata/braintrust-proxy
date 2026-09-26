import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTypesafeModels,
  mergeTypesafeModels,
  parseTypesafePricing,
} from "./sync_typesafe";
import type { ModelSpec } from "../schema/models";

const documentation = `# Models

## Current models

| Jev 1.13 | \`jev-1.13.0\` |
| :--- | :--- |
| Price (per Btok / per Mtok) | \\$42 / \\$0.042 |
| Rate limits | 250,000 tokens per second |

Output tokens are free.

## Aliases

| Alias | Points to | Meaning |
| :--- | :--- | :--- |
| \`jev-latest\` | \`jev-1.13.0\` | Stable |
| \`jev-preview\` | \`jev-1.13.0\` | Preview |

## Listing models

An example mentioning \`unpriced-example\` is not a model definition.
`;

const apiModels = {
  models: [
    {
      name: "jev-latest",
      description: "Current Jev",
      release_date: "2026-09-10T18:38:01Z",
    },
    {
      name: "jev-preview",
      description: "Preview Jev",
      release_date: "2026-09-10T18:39:06Z",
    },
  ],
};

function stubTypesafeResponses(
  apiResponse: unknown = apiModels,
  docsResponse = documentation,
) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(apiResponse)))
    .mockResolvedValueOnce(new Response(docsResponse));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Typesafe documented pricing", () => {
  it("prices exact versioned IDs and both aliases using million-token units", () => {
    const models = parseTypesafePricing(documentation);
    expect(Object.keys(models)).toEqual([
      "jev-1.13.0",
      "jev-latest",
      "jev-preview",
    ]);
    for (const model of Object.values(models)) {
      expect(model).toMatchObject({
        format: "typesafe",
        flavor: "evaluation",
        available_providers: ["typesafe"],
        input_cost_per_mil_tokens: 0.042,
        output_cost_per_mil_tokens: 0,
      });
    }
  });

  it("prices new versions and aliases from their own tables", () => {
    const updated = documentation
      .replace(
        "## Aliases",
        `| Jev 1.14 | \`jev-1.14.0\` |
| :--- | :--- |
| Price (per Btok / per Mtok) | $60 / $0.06 |

## Aliases`,
      )
      .replace(
        "| `jev-preview` | `jev-1.13.0`",
        "| `jev-preview` | `jev-1.14.0`",
      );
    const models = parseTypesafePricing(updated);
    expect(models["jev-preview"].input_cost_per_mil_tokens).toBe(0.06);
    expect(models["jev-latest"].input_cost_per_mil_tokens).toBe(0.042);
  });

  it.each([
    documentation.replace("## Current models", "## New layout"),
    documentation.replace("Output tokens are free.", "Output pricing varies."),
    documentation.replace("0.042", "0.42"),
    documentation.replace("0.042", "unknown"),
    documentation.replace(
      "| `jev-preview` | `jev-1.13.0`",
      "| `jev-preview` | `unknown`",
    ),
    documentation.replace("`jev-preview`", "`jev-latest`"),
    documentation.replace(
      "| `jev-preview` | `jev-1.13.0`",
      "| `jev-preview` | pending",
    ),
  ])("rejects malformed or ambiguous documentation", (source) => {
    expect(() => parseTypesafePricing(source)).toThrow(
      "Typesafe documentation:",
    );
  });

  it("reports an unpriced model and its alias without assigning another model's rate", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const updated = documentation
      .replace(
        "## Aliases",
        `| Jev Future | \`jev-future\` |
| :--- | :--- |
| Rate limits | TBD |

## Aliases`,
      )
      .replace(
        "| `jev-preview` | `jev-1.13.0`",
        "| `jev-preview` | `jev-future`",
      );
    const models = parseTypesafePricing(updated);
    expect(models["jev-future"]).toBeUndefined();
    expect(models["jev-preview"]).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("Typesafe API discovery", () => {
  it("authenticates only to the API and retains documented versions absent from the API", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
    const fetchMock = stubTypesafeResponses();
    const models = await fetchTypesafeModels();
    expect(models["jev-1.13.0"]).toBeDefined();
    expect(models["jev-latest"].description).toBe("Current Jev");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.typesafe.ai/v1/models",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-typesafe-key",
          Accept: "application/json",
        },
        redirect: "error",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://docs.typesafe.ai/models.md",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("headers");
  });

  it("reports API-only models without guessing prices", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubTypesafeResponses({
      models: [
        ...apiModels.models,
        { ...apiModels.models[0], name: "future-model" },
      ],
    });
    expect(await fetchTypesafeModels()).not.toHaveProperty("future-model");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("future-model"));
  });

  it("requires credentials before making requests", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTypesafeModels()).rejects.toThrow("TYPESAFE_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500, 302])(
    "rejects API HTTP %i without exposing response data",
    async (status) => {
      vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("test-typesafe-key", { status }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(fetchTypesafeModels()).rejects.toThrow(
        "Could not fetch Typesafe model metadata",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects network errors without exposing their details", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("test-typesafe-key")),
    );
    await expect(fetchTypesafeModels()).rejects.toThrow(
      "Could not fetch Typesafe model metadata",
    );
  });

  it.each([{ data: [] }, { models: [] }, { models: [{ name: "jev-latest" }] }])(
    "rejects malformed API metadata",
    async (payload) => {
      vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
      stubTypesafeResponses(payload);
      await expect(fetchTypesafeModels()).rejects.toThrow("invalid model list");
    },
  );

  it("fails if the documentation cannot be fetched", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(apiModels)))
        .mockResolvedValueOnce(new Response("Unavailable", { status: 503 })),
    );
    await expect(fetchTypesafeModels()).rejects.toThrow(
      "Could not fetch Typesafe model metadata",
    );
  });
});

it("refreshes pricing while preserving historical entries, unrelated metadata, and input objects", () => {
  const remote = parseTypesafePricing(documentation);
  const existing: Record<string, ModelSpec> = {
    "jev-1.12.0": { ...remote["jev-1.13.0"], input_cost_per_mil_tokens: 0.03 },
    "jev-latest": {
      ...remote["jev-latest"],
      input_cost_per_mil_tokens: 99,
      displayName: "Jev",
      max_input_tokens: 32000,
    },
  };
  const original = structuredClone(existing);
  const result = mergeTypesafeModels(existing, remote);
  expect(result.models["jev-1.12.0"]).toEqual(original["jev-1.12.0"]);
  expect(result.models["jev-latest"]).toMatchObject({
    input_cost_per_mil_tokens: 0.042,
    output_cost_per_mil_tokens: 0,
    displayName: "Jev",
    max_input_tokens: 32000,
  });
  expect(existing).toEqual(original);
  expect(result.changed).toHaveLength(3);
  expect(mergeTypesafeModels(result.models, remote).changed).toEqual([]);
  // JSON property order may change when the shared catalog writer canonicalizes it.
  const reordered = Object.fromEntries(
    Object.entries(result.models).map(([id, model]) => [
      id,
      Object.fromEntries(Object.entries(model).reverse()),
    ]),
  ) as Record<string, ModelSpec>;
  expect(mergeTypesafeModels(reordered, remote).changed).toEqual([]);
});
