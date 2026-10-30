import { describe, expect, it } from "vitest";
import {
  ModelSchema,
  type ModelSpec,
  type PricingRate,
} from "../schema/models";
import {
  applyAvailableEndpointTypeMappings,
  buildModelsForIssue,
  buildUpdatedLocalModel,
  isDateWithinDays,
  UPCOMING_DEPRECATION_WINDOW_DAYS,
  parseIssue,
} from "./fix_bot_issue";

const ENDPOINT_TYPES_HEADER =
  "export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {";

function buildEndpointTypesFile(lines: string[]): string {
  return `${ENDPOINT_TYPES_HEADER}\n${lines.join("\n")}\n};\n`;
}

describe("fix_bot_issue", () => {
  it("treats deprecation dates inside the default window as actionable skips", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    expect(
      isDateWithinDays("2026-03-15", UPCOMING_DEPRECATION_WINDOW_DAYS, now),
    ).toBe(true);
    expect(
      isDateWithinDays("2026-05-01", UPCOMING_DEPRECATION_WINDOW_DAYS, now),
    ).toBe(false);
  });

  describe("applyAvailableEndpointTypeMappings", () => {
    it("replaces the entire multiline provider array and remains valid TypeScript", async () => {
      const original = buildEndpointTypesFile([
        '  "vertex-model": [',
        '    "vertex",',
        "  ],",
        '  "neighbor": ["openai"],',
      ]);
      const updated = applyAvailableEndpointTypeMappings(original, {
        "vertex-model": ["vertex"],
      });
      expect(updated).toBe(
        buildEndpointTypesFile([
          '  "vertex-model": ["vertex"],',
          '  "neighbor": ["openai"],',
        ]),
      );
      const { format } = await import("prettier");
      await expect(
        format(updated, { parser: "typescript" }),
      ).resolves.toBeDefined();
    });

    it("replaces a multi-provider array without orphaning the tail of the line", () => {
      const original = buildEndpointTypesFile([
        '  "openai/gpt-oss-120b": ["together", "groq", "baseten"],',
        '  "openai/gpt-oss-20b": ["groq"],',
      ]);

      const updated = applyAvailableEndpointTypeMappings(original, {
        "openai/gpt-oss-120b": ["together", "groq", "baseten", "cerebras"],
      });

      expect(updated).toBe(
        buildEndpointTypesFile([
          '  "openai/gpt-oss-120b": ["together", "groq", "baseten", "cerebras"],',
          '  "openai/gpt-oss-20b": ["groq"],',
        ]),
      );
      expect(updated).not.toMatch(/^\s*"groq", "baseten"/m);
    });

    it("preserves trailing line comments when replacing an entry", () => {
      const original = buildEndpointTypesFile([
        '  "openai/gpt-oss-20b": ["groq"], // NOTE: keep me',
      ]);

      const updated = applyAvailableEndpointTypeMappings(original, {
        "openai/gpt-oss-20b": ["groq", "cerebras"],
      });

      expect(updated).toContain('"openai/gpt-oss-20b": ["groq", "cerebras"],');
    });
  });

  describe("buildUpdatedLocalModel Vertex locations requirement", () => {
    it("updates a Vertex publishers entry that omits locations without demanding them", () => {
      const updated = buildUpdatedLocalModel(
        {
          provider: "vertex",
          models: ["publishers/anthropic/models/claude-sonnet-4-6"],
          metadata: { model_spec: { max_output_tokens: 128000 } },
          aliasTargets: {},
        },
        "publishers/anthropic/models/claude-sonnet-4-6",
        {
          format: "anthropic",
          flavor: "chat",
          available_providers: ["vertex"],
          max_output_tokens: 64000,
        },
      );

      expect(updated.max_output_tokens).toBe(128000);
      // Must not inject locations: ["global"] (would override the Vertex region).
      expect(updated.locations).toBeUndefined();
    });

    it("still rejects an update that would strip locations from an entry that had them", () => {
      expect(() =>
        buildUpdatedLocalModel(
          {
            provider: "vertex",
            models: ["publishers/google/models/gemini-3-pro"],
            metadata: { model_spec: { locations: [] } },
            aliasTargets: {},
          },
          "publishers/google/models/gemini-3-pro",
          {
            format: "google",
            flavor: "chat",
            available_providers: ["vertex"],
            max_output_tokens: 65536,
            locations: ["global", "us-central1"],
          },
        ),
      ).toThrow("without explicit location metadata");
    });
  });

  describe("provider/tier pricing patches", () => {
    const existingModel = {
      format: "openai",
      flavor: "chat",
      available_providers: ["openai"],
      input_cost_per_mil_tokens: 2.5,
      output_cost_per_mil_tokens: 15,
      input_cache_read_cost_per_mil_tokens: 0.25,
      pricing: {
        openai: {
          flex: [
            {
              input_cost_per_mil_tokens: 1.25,
              output_cost_per_mil_tokens: 7.5,
              endpoints: ["api.openai.com"],
              max_input_tokens: 272000,
            },
          ],
          batch: [{ input_cost_per_mil_tokens: 0.75 }],
        },
        openrouter: {
          flex: [
            { input_cost_per_mil_tokens: 1.25, endpoints: ["openai/flex"] },
          ],
        },
      },
    } satisfies ModelSpec;
    const flexRates: PricingRate[] = [
      {
        input_cost_per_mil_tokens: 1,
        output_cost_per_mil_tokens: 6,
        input_cache_write_5m_cost_per_mil_tokens: 1.25,
        endpoints: ["api.openai.com"],
        max_input_tokens: 272000,
      },
      {
        input_cost_per_mil_tokens: 2,
        output_cost_per_mil_tokens: 9,
        input_cache_write_1h_cost_per_mil_tokens: 4,
        endpoints: ["api.openai.com"],
        min_input_tokens: 272001,
        valid_from: "2026-10-01",
      },
    ];
    const priorityRates = [{ input_cost_per_mil_tokens: 3 }];

    it.each([
      {
        change: "replaces one tier's full rate array",
        pricing: { openai: { flex: flexRates } },
        expectedPricing: {
          ...existingModel.pricing,
          openai: { ...existingModel.pricing.openai, flex: flexRates },
        },
      },
      {
        change: "adds a tier",
        pricing: { openai: { priority: priorityRates } },
        expectedPricing: {
          ...existingModel.pricing,
          openai: { ...existingModel.pricing.openai, priority: priorityRates },
        },
      },
      {
        change: "adds a provider",
        pricing: { vertex: { priority: priorityRates } },
        expectedPricing: {
          ...existingModel.pricing,
          vertex: { priority: priorityRates },
        },
      },
      {
        change: "removes a tier",
        pricing: { openai: { flex: null } },
        expectedPricing: {
          ...existingModel.pricing,
          openai: { batch: existingModel.pricing.openai.batch },
        },
      },
      {
        change: "removes the last tier for a provider",
        pricing: { openrouter: { flex: null } },
        expectedPricing: { openai: existingModel.pricing.openai },
      },
      {
        change: "removes a provider",
        pricing: { openai: null },
        expectedPricing: { openrouter: existingModel.pricing.openrouter },
      },
      {
        change: "removes all tier prices",
        pricing: null,
        expectedPricing: undefined,
      },
      {
        change: "leaves omitted pairs unchanged",
        pricing: {},
        expectedPricing: existingModel.pricing,
      },
    ])(
      "$change without changing unrelated prices",
      ({ pricing, expectedPricing }) => {
        const before = structuredClone(existingModel);
        const parsed = parseIssue(
          "[BOT ISSUE] Update OpenAI gpt-5.4 pricing",
          "<!-- fix-bot-issue-metadata -->\n```json\n" +
            JSON.stringify({
              kind: "stale_metadata",
              provider: "openai",
              models: ["gpt-5.4"],
              model_spec: { pricing },
            }) +
            "\n```",
        );
        expect(parsed.metadata).not.toBeNull();
        const [updated] = buildModelsForIssue(parsed, "gpt-5.4", {
          "gpt-5.4": existingModel,
        });
        const expected: ModelSpec = { ...existingModel };
        if (expectedPricing === undefined) delete expected.pricing;
        else expected.pricing = expectedPricing;

        expect(updated.model).toEqual(expected);
        expect(ModelSchema.parse(updated.model)).toEqual(updated.model);
        expect(existingModel).toEqual(before);
      },
    );

    it("removes empty pricing maps after the final rate is removed", () => {
      const updated = buildUpdatedLocalModel(
        {
          provider: "openai",
          models: ["model"],
          metadata: { model_spec: { pricing: { openai: { flex: null } } } },
          aliasTargets: {},
        },
        "model",
        { ...existingModel, pricing: { openai: { flex: flexRates } } },
      );
      expect(updated.pricing).toBeUndefined();
      expect(updated.input_cost_per_mil_tokens).toBe(2.5);
    });

    it("preserves provider/tier metadata when only standard pricing changes", () => {
      const updated = buildUpdatedLocalModel(
        {
          provider: "openai",
          models: ["gpt-5.4"],
          metadata: { model_spec: { input_cost_per_mil_tokens: 2 } },
          aliasTargets: {},
        },
        "gpt-5.4",
        existingModel,
      );
      expect(updated).toEqual({
        ...existingModel,
        input_cost_per_mil_tokens: 2,
      });
    });

    it("resolves OpenRouter tier-pricing updates from model_specs", () => {
      const parsed = parseIssue(
        "[BOT ISSUE] Refresh OpenRouter gpt-5.4 pricing",
        "<!-- fix-bot-issue-metadata -->\n```json\n" +
          JSON.stringify({
            kind: "stale_metadata",
            provider: "openrouter",
            models: ["gpt-5.4"],
            model_specs: {
              "gpt-5.4": {
                pricing: { openrouter: { priority: priorityRates } },
              },
            },
          }) +
          "\n```",
      );
      expect(parsed.provider).toBe("openrouter");
      expect(
        buildModelsForIssue(parsed, "gpt-5.4", { "gpt-5.4": existingModel }),
      ).toEqual([
        {
          name: "gpt-5.4",
          model: {
            ...existingModel,
            pricing: {
              ...existingModel.pricing,
              openrouter: {
                ...existingModel.pricing.openrouter,
                priority: priorityRates,
              },
            },
          },
        },
      ]);
    });

    it.each([
      { pricing: undefined },
      { pricing: { openai: { priority: priorityRates } } },
    ])(
      "only adds explicitly verified tier prices to a new alias: %j",
      ({ pricing }) => {
        const [alias] = buildModelsForIssue(
          {
            provider: "openai",
            models: ["new-alias"],
            metadata: { model_spec: { pricing } },
            aliasTargets: { "new-alias": "gpt-5.4" },
          },
          "new-alias",
          { "gpt-5.4": existingModel },
        );
        expect(alias.model.pricing).toEqual(pricing);
        expect(alias.model.input_cost_per_mil_tokens).toBe(2.5);
        expect(existingModel.pricing.openai.flex).toHaveLength(1);
      },
    );

    it("adds verified tier pricing and provider mapping to a new OpenRouter model", () => {
      const pricing = {
        openrouter: {
          flex: flexRates,
          batch: [{ output_cost_per_mil_tokens: 0 }],
        },
      };
      const [model] = buildModelsForIssue(
        {
          provider: "openrouter",
          models: ["new-model"],
          metadata: { model_spec: { max_input_tokens: 100000, pricing } },
          aliasTargets: {},
        },
        "new-model",
        {},
      );
      expect(model.model).toEqual({
        format: "openai",
        flavor: "chat",
        available_providers: ["openrouter"],
        max_input_tokens: 100000,
        pricing,
      });
    });

    it.each([{ openai: { flex: [] } }, { openai: { flxe: [{}] } }])(
      "rejects invalid pricing patches: %j",
      (pricing) => {
        const parsed = parseIssue(
          "[BOT ISSUE] Update model pricing",
          "<!-- fix-bot-issue-metadata -->\n```json\n" +
            JSON.stringify({
              provider: "openai",
              models: ["gpt-5.4"],
              model_spec: { pricing },
            }) +
            "\n```",
        );
        expect(parsed.metadata).toBeNull();
      },
    );
  });
});
