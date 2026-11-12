import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import {
  getAvailableModels,
  ModelSchema,
  refreshModels,
  StoredModelSchema,
  type PricingRate,
  type StoredModelSpec,
} from "./models";

const rates: PricingRate[] = [
  {
    input_cost_per_mil_tokens: 4,
    output_cost_per_mil_tokens: 20,
    input_cache_write_30m_cost_per_mil_tokens: 5,
    endpoints: ["provider.example"],
    inference_geo: "us",
    max_input_tokens: 100000,
    valid_until: "2026-11-30",
  },
  {
    input_cost_per_mil_tokens: 8,
    input_cache_write_12h_cost_per_mil_tokens: 20,
    min_input_tokens: 100001,
    valid_from: "2026-12-01",
  },
];

const stored: StoredModelSpec = {
  format: "openai",
  flavor: "chat",
  pricing: {
    openai: { priority: { alias: "fast" }, fast: rates },
    fireworks: { priority: [{ input_cost_per_mil_tokens: 6 }], fast: rates },
  },
};

it("preserves stored aliases and resolves every target rate and condition", () => {
  expect(StoredModelSchema.parse(stored)).toEqual(stored);
  const resolved = ModelSchema.parse(stored);
  expect(resolved.pricing).toEqual({
    openai: { priority: rates, fast: rates },
    fireworks: { priority: [{ input_cost_per_mil_tokens: 6 }], fast: rates },
  });
  expect(stored.pricing!.openai!.priority).toEqual({ alias: "fast" });
  expectTypeOf(resolved.pricing?.openai?.priority).toEqualTypeOf<
    PricingRate[] | undefined
  >();
});

it("resolves aliases regardless of key order or the target tier name", () => {
  const model = ModelSchema.parse({
    ...stored,
    pricing: { openai: { batch: rates, flex: { alias: "batch" } } },
  });
  expect(model.pricing!.openai!.flex).toEqual(rates);
});

it.each([
  {
    name: "missing target",
    pricing: { openai: { priority: { alias: "fast" } } },
  },
  {
    name: "self-reference",
    pricing: { openai: { priority: { alias: "priority" } } },
  },
  {
    name: "cycle",
    pricing: {
      openai: { priority: { alias: "fast" }, fast: { alias: "priority" } },
    },
  },
  {
    name: "chain",
    pricing: {
      openai: {
        priority: { alias: "fast" },
        fast: { alias: "ultrafast" },
        ultrafast: rates,
      },
    },
  },
  {
    name: "cross-provider target",
    pricing: {
      openai: { priority: { alias: "fast" } },
      openrouter: { fast: rates },
    },
  },
  {
    name: "unknown tier",
    pricing: { openai: { priority: { alias: "unknown" } } },
  },
  {
    name: "empty target",
    pricing: { openai: { priority: { alias: "fast" }, fast: [] } },
  },
  {
    name: "alias with overrides",
    pricing: {
      openai: {
        priority: { alias: "fast", endpoints: ["another.example"] },
        fast: rates,
      },
    },
  },
])("rejects $name in stored and resolved schemas", ({ pricing }) => {
  const model = { ...stored, pricing };
  expect(StoredModelSchema.safeParse(model).success).toBe(false);
  expect(ModelSchema.safeParse(model).success).toBe(false);
});

it("reports the exact location of an invalid alias", () => {
  const result = StoredModelSchema.safeParse({
    format: "openai",
    flavor: "chat",
    pricing: { openai: { priority: { alias: "fast" } } },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0].path).toEqual([
      "pricing",
      "openai",
      "priority",
      "alias",
    ]);
  }
});

describe("dynamic model pricing", () => {
  beforeEach(() => {
    vi.stubGlobal("_proxy_availableModels", undefined);
    vi.stubGlobal("_proxy_cachedModels", null);
    vi.stubGlobal("_proxy_cacheTimestamp", null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves remote aliases before caching and preserves other remote metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          "remote-model": { ...stored, future_metadata: "preserved" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await refreshModels("https://control-plane.example");
    await refreshModels("https://control-plane.example");

    expect(getAvailableModels()["remote-model"]).toEqual({
      ...ModelSchema.parse(stored),
      future_metadata: "preserved",
    });
    expect(
      globalThis._proxy_cachedModels?.["remote-model"].pricing?.openai
        ?.priority,
    ).toEqual(rates);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the static catalog when a remote alias has no target", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            "remote-model": {
              ...stored,
              pricing: { openai: { priority: { alias: "fast" } } },
            },
          }),
        ),
      ),
    );

    await refreshModels("https://control-plane.example");

    expect(getAvailableModels()["remote-model"]).toBeUndefined();
    expect(
      getAvailableModels()["gpt-6.1-sol"].pricing?.openai?.priority,
    ).toEqual(getAvailableModels()["gpt-6.1-sol"].pricing?.openai?.fast);
    expect(globalThis._proxy_cachedModels).toBeNull();
    expect(globalThis._proxy_cacheTimestamp).toBeNull();
  });
});
