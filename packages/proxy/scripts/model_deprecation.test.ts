import { describe, expect, it } from "vitest";
import { classifyProbe } from "./model_probe";
import {
  addToSyncExcluded,
  applyDeprecations,
  rewriteIndexEntry,
} from "./apply_deprecations";

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
});

describe("applyDeprecations", () => {
  const baseIndex = `export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {
  "model-a": ["together", "baseten"],
  "model-b": ["xAI"],
  "model-c": ["openai", "azure"],
};
`;
  const baseSync = `export const SYNC_EXCLUDED_MODELS: ReadonlySet<string> = new Set([
  "claude-opus-4-7-20260416",
]);
`;

  it("narrows providers when a model survives on another provider", () => {
    const catalog = {
      "model-a": { available_providers: ["together", "baseten"] },
    };
    const out = applyDeprecations(catalog, baseIndex, baseSync, [
      { model: "model-a", provider: "baseten", reason: "probe not-found" },
    ]);
    expect(out.catalog["model-a"].available_providers).toEqual(["together"]);
    expect(out.indexContent).toContain('"model-a": ["together"],');
    expect(out.result.removedModels).toEqual([]);
    expect(out.result.narrowedModels[0]).toMatchObject({
      model: "model-a",
      dropped: ["baseten"],
      remaining: ["together"],
    });
  });

  it("removes a model and excludes it when it loses all providers", () => {
    const catalog = { "model-b": { available_providers: ["xAI"] } };
    const out = applyDeprecations(catalog, baseIndex, baseSync, [
      { model: "model-b", provider: "xAI", reason: "probe not-found" },
    ]);
    expect(out.catalog["model-b"]).toBeUndefined();
    expect(out.indexContent).not.toContain('"model-b"');
    expect(out.indexContent).toContain('"model-a"'); // others intact
    expect(out.result.removedModels).toEqual(["model-b"]);
    expect(out.syncContent).toContain('"model-b"');
  });

  it("is a no-op for a provider the model does not have", () => {
    const catalog = { "model-c": { available_providers: ["openai", "azure"] } };
    const out = applyDeprecations(catalog, baseIndex, baseSync, [
      { model: "model-c", provider: "groq", reason: "x" },
    ]);
    expect(out.catalog["model-c"].available_providers).toEqual([
      "openai",
      "azure",
    ]);
    expect(out.result.removedModels).toEqual([]);
    expect(out.result.narrowedModels).toEqual([]);
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

  it("inserts ids into SYNC_EXCLUDED_MODELS without duplicates", () => {
    const sync = `export const SYNC_EXCLUDED_MODELS: ReadonlySet<string> = new Set([\n  "a",\n]);\n`;
    const out = addToSyncExcluded(sync, ["b", "a"]);
    expect(out).toContain('"b"');
    expect(out.match(/"a"/g)?.length).toBe(1); // not duplicated
  });
});
