import { describe, expect, it } from "vitest";
import {
  applyAvailableEndpointTypeMappings,
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
          '  "openai/gpt-oss-120b": ["together","groq","baseten","cerebras"],',
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

      expect(updated).toContain('"openai/gpt-oss-20b": ["groq","cerebras"],');
    });
  });
});
