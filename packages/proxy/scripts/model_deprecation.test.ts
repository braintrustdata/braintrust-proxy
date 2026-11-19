import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import * as braintrustSecrets from "./braintrust_secrets";
import {
  classifyProbe,
  parseOpenRouterRetirementDates,
  PROVIDER_APIS,
  REPORT_ONLY_PROVIDERS,
} from "./model_probe";
import {
  effectiveProviders,
  NEVER_DEPRECATE_MODELS,
  parseIndexEndpointTypes,
  isRetired,
  retirementUpdatesFromDates,
  runAudit,
  stillServedAfterRetirement,
} from "./reconcile_provider_models";
import {
  addToDeprecatedIds,
  applyDeprecations,
  applyRetirements,
  buildSummaryMarkdown,
  markRetired,
  retirementReviewNotes,
  rewriteIndexEntry,
} from "./apply_deprecations";

it("reports Azure for manual review without looking up OpenAI credentials", async () => {
  const fetchSecrets = vi
    .spyOn(braintrustSecrets, "fetchProviderSecrets")
    .mockResolvedValue(new Map());

  try {
    const report = await runAudit({
      braintrustApiKey: "",
      catalog: { "gpt-4.1-nano": { available_providers: ["openai", "azure"] } },
      indexContent: "",
      concurrency: 1,
      providerFilter: ["azure"],
    });

    expect(report.reportOnly).toEqual([{ provider: "azure", modelCount: 1 }]);
    expect(report.deprecations).toEqual([]);
    expect(report.retirements).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(fetchSecrets).not.toHaveBeenCalled();
  } finally {
    fetchSecrets.mockRestore();
  }
});

describe("openrouter deprecation adapter", () => {
  it("is registered as an authoritative, list-only, non-report-only provider", () => {
    const api = PROVIDER_APIS.openrouter;
    expect(api).toBeDefined();
    // Absence from OpenRouter's public directory alone marks a model deprecated
    // (proactive removal), so the list is authoritative and there is no probe.
    expect(api.listIsAuthoritative).toBe(true);
    expect(api.probeModel).toBeNull();
    expect(api.listModels).not.toBeNull();
    // Must NOT be report-only, or deprecations would never be applied.
    expect(REPORT_ONLY_PROVIDERS.has("openrouter")).toBe(false);
    // The /api/v1/models directory is public, so the audit must run even when
    // the org has no openrouter secret (otherwise openrouter-only entries would
    // go unaudited). Public lists are only valid together with probeModel: null.
    expect(api.listRequiresSecret).toBe(false);
    expect(api.probeModel).toBeNull();
  });
});

describe("cohere deprecation adapter", () => {
  it("is registered as an authoritative, list-only, non-report-only provider", () => {
    const api = PROVIDER_APIS.cohere;
    expect(api).toBeDefined();
    // Absence from Cohere's /v1/models alone marks a model deprecated (Cohere
    // hosts only its own models), so the list is authoritative and there is no
    // probe. This is what prunes models Cohere removes but LiteLLM still lists.
    expect(api.listIsAuthoritative).toBe(true);
    expect(api.probeModel).toBeNull();
    expect(api.listModels).not.toBeNull();
    // Must NOT be report-only, or deprecations would never be applied.
    expect(REPORT_ONLY_PROVIDERS.has("cohere")).toBe(false);
  });
});

describe("classifyProbe", () => {
  it("treats 2xx as active", () => {
    expect(classifyProbe(200, "{}")).toBe("active");
  });

  it("treats 404 / 410 and not-found bodies as deprecated", () => {
    expect(classifyProbe(404, "")).toBe("deprecated");
    expect(classifyProbe(410, "deprecated")).toBe("deprecated");
    expect(classifyProbe(400, '{"error":"Model not found: grok-2"}')).toBe(
      "deprecated",
    );
    expect(
      classifyProbe(
        400,
        '{"message":"Invalid model: foo","type":"invalid_model"}',
      ),
    ).toBe("deprecated");
    expect(classifyProbe(400, "The model `x` has been decommissioned")).toBe(
      "deprecated",
    );
  });

  it("treats rate-limit / overload as transient, never deprecated", () => {
    expect(classifyProbe(429, "")).toBe("transient");
    expect(classifyProbe(503, "")).toBe("transient");
    expect(classifyProbe(529, "overloaded")).toBe("transient");
    expect(classifyProbe(200, "")).not.toBe("transient");
  });

  it("treats unrelated 400 / auth errors as unknown (not deprecated)", () => {
    expect(
      classifyProbe(400, '{"error":"max_tokens must be at least 16"}'),
    ).toBe("unknown");
    expect(classifyProbe(401, '{"error":"invalid x-api-key"}')).toBe("unknown");
  });

  it("treats a probe that cannot distinguish missing models from missing access as inconclusive", () => {
    expect(
      classifyProbe(
        404,
        "The model does not exist or you do not have access to it.",
      ),
    ).toBe("unknown");
    expect(
      classifyProbe(
        404,
        "The model does not exist or your team does not have access to it.",
      ),
    ).toBe("unknown");
  });

  it("does not deprecate existing non-chat models (wrong endpoint / modality)", () => {
    expect(
      classifyProbe(
        404,
        "This is not a chat model and thus not supported in the v1/chat/completions endpoint. Did you mean to use v1/completions?",
      ),
    ).toBe("unknown");
    expect(
      classifyProbe(400, '{"error":"This model only supports streaming"}'),
    ).toBe("unknown");
  });

  it("does not deprecate reasoning models that reject max_tokens (param error, model exists)", () => {
    expect(
      classifyProbe(
        400,
        '{"error":{"message":"Unsupported parameter: \'max_tokens\' is not supported with this model. Use \'max_completion_tokens\' instead.","type":"invalid_request_error","param":"max_tokens"}}',
      ),
    ).toBe("unknown");
  });
});

describe("applyDeprecations", () => {
  const baseIndex = `export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {
  "model-a": ["together", "baseten"],
  "model-b": ["xAI"],
  "model-c": ["openai", "azure"],
};
`;
  const baseDeprecatedIds: string[] = ["claude-opus-4-7-20260416"];

  it("narrows providers when a model survives on another provider", () => {
    const catalog = {
      "model-a": { available_providers: ["together", "baseten"] },
    };
    const out = applyDeprecations(catalog, baseIndex, baseDeprecatedIds, [
      { model: "model-a", provider: "baseten", reason: "probe not-found" },
    ]);
    expect(out.catalog["model-a"].available_providers).toEqual(["together"]);
    expect(out.indexContent).toContain('"model-a": ["together"],');
    expect(out.result.retiredModels).toEqual([]);
    expect(out.result.narrowedModels[0]).toMatchObject({
      model: "model-a",
      dropped: ["baseten"],
      remaining: ["together"],
    });
  });

  it("keeps a model as retired and excludes it when it loses all providers", () => {
    const catalog: Record<string, Record<string, unknown>> = {
      "model-b": { available_providers: ["xAI"] },
    };
    const out = applyDeprecations(
      catalog,
      baseIndex,
      baseDeprecatedIds,
      [{ model: "model-b", provider: "xAI", reason: "probe not-found" }],
      new Date("2026-11-17T12:00:00Z"),
    );
    expect(out.catalog["model-b"]).toEqual({
      available_providers: ["xAI"],
      retired: true,
      retirement_date: "2026-11-17",
    });
    expect(out.indexContent).toContain('"model-b": ["xAI"],');
    expect(out.result.retiredModels).toEqual(["model-b"]);
    expect(out.result.removedRoutes).toEqual([]);
    expect(out.deprecatedIds).toContain("model-b");
  });

  it("keeps a past retirement_date and drops a later deprecation_date", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const past: Record<string, unknown> = {
      available_providers: ["xAI"],
      retirement_date: "2026-10-01",
    };
    markRetired(past, now);
    expect(past).toMatchObject({
      retired: true,
      retirement_date: "2026-10-01",
    });

    const early: Record<string, unknown> = {
      available_providers: ["xAI"],
      deprecation_date: "2026-12-01",
      retirement_date: "2027-03-01",
    };
    markRetired(early, now);
    expect(early).toEqual({
      available_providers: ["xAI"],
      retired: true,
      retirement_date: "2026-11-17",
    });
  });

  it("cleans removed fallback references while retaining surviving targets and order", () => {
    const catalog = {
      "model-a": {
        available_providers: ["together"],
        fallback_models: ["model-b", "model-c"],
      },
      "model-b": { available_providers: ["xAI"] },
      "model-c": {
        available_providers: ["openai", "azure"],
        fallback_models: ["model-b"],
      },
    };
    const out = applyDeprecations(catalog, baseIndex, baseDeprecatedIds, [
      { model: "model-b", provider: "xAI", reason: "not found" },
      { model: "model-c", provider: "azure", reason: "not found" },
    ]);
    expect(out.catalog["model-a"].fallback_models).toEqual(["model-c"]);
    expect(out.catalog["model-c"].fallback_models).toBeUndefined();
  });

  it("is a no-op for a provider the model does not have", () => {
    const catalog = { "model-c": { available_providers: ["openai", "azure"] } };
    const out = applyDeprecations(catalog, baseIndex, baseDeprecatedIds, [
      { model: "model-c", provider: "groq", reason: "x" },
    ]);
    expect(out.catalog["model-c"].available_providers).toEqual([
      "openai",
      "azure",
    ]);
    expect(out.result.retiredModels).toEqual([]);
    expect(out.result.narrowedModels).toEqual([]);
  });

  it("retires an index-only model (no available_providers) routed via index.ts", () => {
    // model-b is mapped only in index.ts (["xAI"]) with no available_providers.
    const catalog = { "model-b": { format: "openai" } };
    const out = applyDeprecations(catalog, baseIndex, baseDeprecatedIds, [
      { model: "model-b", provider: "xAI", reason: "probe not-found" },
    ]);
    expect(out.catalog["model-b"]).toMatchObject({ retired: true });
    expect(out.indexContent).toContain('"model-b": ["xAI"],');
    expect(out.result.retiredModels).toEqual(["model-b"]);
    expect(out.deprecatedIds).toContain("model-b");
  });

  it("removes an index.ts route that has no catalog entry", () => {
    const out = applyDeprecations({}, baseIndex, baseDeprecatedIds, [
      { model: "model-b", provider: "xAI", reason: "probe not-found" },
    ]);
    expect(out.indexContent).not.toContain('"model-b"');
    expect(out.indexContent).toContain('"model-a"');
    expect(out.result.removedRoutes).toEqual(["model-b"]);
    expect(out.result.retiredModels).toEqual([]);
  });
});

describe("parseIndexEndpointTypes / effectiveProviders", () => {
  const index = `export const DefaultEndpointTypes = {
  openai: ["openai", "azure"],
};

export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {
  "meta-llama/Llama-3-70b-chat-hf": ["together"],
  "model-x": ["openai", "azure"],
};
`;

  it("parses only the AvailableEndpointTypes block", () => {
    const map = parseIndexEndpointTypes(index);
    expect(map.get("meta-llama/Llama-3-70b-chat-hf")).toEqual(["together"]);
    expect(map.get("model-x")).toEqual(["openai", "azure"]);
    expect(map.has("openai")).toBe(false); // not from DefaultEndpointTypes
  });

  it("unions model_list providers with index.ts mappings", () => {
    const map = parseIndexEndpointTypes(index);
    // index-only model: no available_providers, provider comes from index.ts
    expect(
      effectiveProviders("meta-llama/Llama-3-70b-chat-hf", {}, map),
    ).toEqual(["together"]);
    // union of both sources
    expect(
      effectiveProviders("model-x", { available_providers: ["openai"] }, map),
    ).toEqual(["openai", "azure"]);
  });
});

describe("rewriteIndexEntry / addToSyncExcluded", () => {
  it("rewrites and deletes index entries, preserving neighbors", () => {
    const idx = `export const AvailableEndpointTypes = {
  "x": ["a", "b"],
  "y": ["c"],
};
`;
    expect(rewriteIndexEntry(idx, "x", ["a"])).toContain('"x": ["a"],');
    expect(rewriteIndexEntry(idx, "y", [])).not.toContain('"y"');
    expect(rewriteIndexEntry(idx, "y", [])).toContain('"x"');
  });

  it("rewrites and removes complete multiline index arrays", async () => {
    const source = `export const AvailableEndpointTypes = {
  "vertex-model": [
    "vertex",
    "openai",
  ],
  "neighbor": ["openai"],
};
`;
    const narrowed = rewriteIndexEntry(source, "vertex-model", ["vertex"]);
    expect(narrowed).toContain('"vertex-model": ["vertex"],');
    expect(narrowed).not.toContain('    "openai",');
    const removed = rewriteIndexEntry(source, "vertex-model", []);
    expect(removed).not.toContain('"vertex"');
    expect(removed).toContain('"neighbor": ["openai"],');
    const { format } = await import("prettier");
    await expect(
      format(narrowed, { parser: "typescript" }),
    ).resolves.toBeDefined();
    await expect(
      format(removed, { parser: "typescript" }),
    ).resolves.toBeDefined();
  });

  it("adds ids to the deprecated-ids list, sorted and de-duplicated", () => {
    expect(addToDeprecatedIds(["a"], ["b", "a"])).toEqual(["a", "b"]);
    expect(addToDeprecatedIds(["m"], ["c", "z"])).toEqual(["c", "m", "z"]);
  });
});

describe("NEVER_DEPRECATE_MODELS (don't-deprecate list)", () => {
  const readJson = (rel: string) =>
    JSON.parse(fs.readFileSync(path.resolve(__dirname, rel), "utf-8"));

  it("keeps the gated OpenAI GPT-5.6 preview family", () => {
    for (const id of [
      "gpt-5.6-cyber",
      "daybreak-blue-latest",
      "daybreak-red-latest",
    ]) {
      expect(NEVER_DEPRECATE_MODELS.has(id)).toBe(true);
    }
  });

  it("never lists a preserved model as deprecated (no contradiction)", () => {
    const deprecated: string[] = readJson("./deprecated_model_ids.json");
    for (const id of NEVER_DEPRECATE_MODELS) {
      expect(deprecated).not.toContain(id);
    }
  });

  it("keeps every preserved model present in the catalog", () => {
    const catalog: Record<string, unknown> = readJson(
      "../schema/model_list.json",
    );
    for (const id of NEVER_DEPRECATE_MODELS) {
      expect(catalog[id]).toBeDefined();
    }
  });
});

describe("lifecycle dates from the audit", () => {
  it("reads OpenRouter expiration_date keyed by slug", () => {
    const dates = parseOpenRouterRetirementDates({
      data: [
        { id: "z-ai/glm-4.5", expiration_date: "2026-12-31" },
        { id: "openai/gpt-5", expiration_date: null },
        { id: "vendor/bad-date", expiration_date: "soon" },
        { id: "vendor/no-date" },
      ],
    });
    expect([...dates]).toEqual([["z-ai/glm-4.5", "2026-12-31"]]);
  });

  it("only proposes retirement for models the provider alone serves", () => {
    const catalog = {
      "z-ai/glm-4.5": { available_providers: ["openrouter"] },
      "shared/model": { available_providers: ["openrouter", "together"] },
      "already/dated": {
        available_providers: ["openrouter"],
        retirement_date: "2026-11-20",
      },
      "index/only": {},
    };
    const updates = retirementUpdatesFromDates({
      provider: "openrouter",
      models: Object.keys(catalog),
      catalog,
      indexMap: new Map([["index/only", ["openrouter", "baseten"]]]),
      dates: new Map([
        ["z-ai/glm-4.5", "2026-12-31"],
        ["shared/model", "2026-12-31"],
        ["already/dated", "2026-11-20"],
        ["index/only", "2026-12-31"],
      ]),
    });
    expect(updates.map((u) => [u.model, u.retirement_date])).toEqual([
      ["z-ai/glm-4.5", "2026-12-31"],
    ]);
    expect(updates[0].previous_retirement_date).toBeNull();
  });

  it("flags models still listed after their retirement_date", () => {
    const notes = stillServedAfterRetirement({
      provider: "together",
      models: ["live/past", "live/future", "gone/past"],
      catalog: {
        "live/past": { retirement_date: "2026-10-16" },
        "live/future": { retirement_date: "2027-01-01" },
        "gone/past": { retirement_date: "2026-10-16" },
      },
      liveList: new Set(["live/past", "live/future"]),
      now: new Date("2026-11-17T00:00:00Z"),
    });
    expect(notes.map((n) => n.model)).toEqual(["live/past"]);
  });

  it("sets retirement_date and flags surprising removals", () => {
    const catalog: Record<string, Record<string, unknown>> = {
      "z-ai/glm-4.5": { available_providers: ["openrouter"] },
      "early/removal": {
        available_providers: ["openai"],
        retirement_date: "2027-02-01",
      },
      "undated/removal": { available_providers: ["openai"] },
      "expected/removal": {
        available_providers: ["openai"],
        retirement_date: "2026-10-23",
      },
    };
    const applied = applyRetirements(catalog, [
      {
        model: "z-ai/glm-4.5",
        provider: "openrouter",
        retirement_date: "2026-12-31",
        previous_retirement_date: null,
        source: "openrouter",
      },
    ]);
    expect(applied).toEqual(["z-ai/glm-4.5"]);
    expect(catalog["z-ai/glm-4.5"].retirement_date).toBe("2026-12-31");

    const notes = retirementReviewNotes(
      catalog,
      ["early/removal", "undated/removal", "expected/removal"],
      new Date("2026-11-17T00:00:00Z"),
    );
    expect(notes.map((n) => [n.model, n.note])).toEqual([
      [
        "early/removal",
        "retired by the audit on 2026-11-17, before its retirement_date 2027-02-01",
      ],
      [
        "undated/removal",
        "retired by the audit on 2026-11-17 with no retirement_date on record; check the provider's notice",
      ],
    ]);
    expect(
      buildSummaryMarkdown({ retirements: [], reviewNotes: notes }),
    ).toContain("### Needs review");
  });
});

describe("isRetired", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  it("is true for retired: true or a retirement_date on or before today", () => {
    expect(isRetired({ retired: true }, now)).toBe(true);
    expect(isRetired({ retirement_date: "2026-11-17" }, now)).toBe(true);
    expect(isRetired({ retirement_date: "2026-11-18" }, now)).toBe(false);
    expect(isRetired({}, now)).toBe(false);
    expect(isRetired(undefined, now)).toBe(false);
  });
});
