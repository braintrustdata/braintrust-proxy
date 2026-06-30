import { describe, expect, it } from "vitest";
import {
  applyAvailableEndpointTypeMappings,
  buildUpdatedLocalModel,
  isDateWithinDays,
  UPCOMING_DEPRECATION_WINDOW_DAYS,
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
      // Must NOT inject locations: ["global"] — Anthropic-on-Vertex omits it so
      // the proxy uses the customer's region. Injecting it triggers the Codex
      // P1 + revert loop that emptied the daily batch PR.
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
});
