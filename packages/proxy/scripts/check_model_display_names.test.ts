import { describe, expect, it } from "vitest";
import { checkModelDisplayNames } from "./check_model_display_names";

describe("checkModelDisplayNames", () => {
  it("fails for new missing, null or blank names but skips fine-tune templates", () => {
    const result = checkModelDisplayNames(
      {},
      {
        missing: {},
        nullish: { displayName: null },
        blank: { displayName: " \t" },
        named: { displayName: "Verified name" },
        "ft:pricing-template": {},
      },
    );

    expect(result.passed).toBe(false);
    expect(result.markdown).toContain("**Action required:**");
    expect(result.markdown).toContain("- `missing`\n- `nullish`\n- `blank`");
    expect(result.markdown).not.toContain("ft:pricing-template");
    expect(result.markdown).not.toContain("`named`");
  });

  it("warns only for touched unnamed entries without blocking the check", () => {
    const result = checkModelDisplayNames(
      {
        changed: { price: 1 },
        removedName: { displayName: "Previously named" },
        reordered: { price: 1, provider: "openai" },
        removed: {},
      },
      {
        changed: { price: 2 },
        removedName: {},
        reordered: { provider: "openai", price: 1 },
      },
    );

    expect(result.passed).toBe(true);
    expect(result.markdown).toContain("Warning: existing models");
    expect(result.markdown).toContain("- `changed`\n- `removedName`");
    expect(result.markdown).not.toContain("`reordered`");
    expect(result.markdown).not.toContain("`removed`");
  });

  it("accepts exact reviewed exceptions with a nonblank reason", () => {
    const exceptions = { template: "Pricing-only entry", blankReason: " " };
    const valid = checkModelDisplayNames({}, { template: {} }, exceptions);
    expect(valid.passed).toBe(true);
    expect(valid.markdown).toContain("- `template`: Pricing-only entry");

    const invalid = checkModelDisplayNames(
      {},
      { "template-variant": {}, blankReason: {} },
      exceptions,
    );
    expect(invalid.passed).toBe(false);
    expect(invalid.markdown).toContain("- `template-variant`\n- `blankReason`");
  });
});
