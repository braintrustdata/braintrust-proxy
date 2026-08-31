import { describe, expect, it } from "vitest";
import {
  secretServesDefaultModels,
  selectProviderSecretsByType,
} from "./braintrust_secrets";

describe("secretServesDefaultModels", () => {
  it("treats a plain provider secret as serving default models", () => {
    expect(secretServesDefaultModels(undefined)).toBe(true);
    expect(secretServesDefaultModels(null)).toBe(true);
    expect(secretServesDefaultModels({})).toBe(true);
    expect(secretServesDefaultModels({ api_base: "https://example.com" })).toBe(
      true,
    );
  });

  it("treats a custom endpoint that still allows default models as eligible", () => {
    expect(
      secretServesDefaultModels({
        customModels: { "meta-model": { format: "openai", flavor: "chat" } },
      }),
    ).toBe(true);
    expect(
      secretServesDefaultModels({
        customModels: { "meta-model": { format: "openai", flavor: "chat" } },
        excludeDefaultModels: false,
      }),
    ).toBe(true);
  });

  it("treats a custom-only endpoint (excludeDefaultModels) as ineligible", () => {
    expect(
      secretServesDefaultModels({
        api_base: "https://meta.example.com/v1",
        customModels: { "meta-model": { format: "openai", flavor: "chat" } },
        excludeDefaultModels: true,
      }),
    ).toBe(false);
  });

  it("ignores excludeDefaultModels when there are no custom models", () => {
    expect(secretServesDefaultModels({ excludeDefaultModels: true })).toBe(true);
    expect(
      secretServesDefaultModels({ customModels: {}, excludeDefaultModels: true }),
    ).toBe(true);
  });
});

describe("selectProviderSecretsByType", () => {
  const realOpenai = {
    type: "openai",
    secret: "openai_key",
    metadata: {},
  };
  const customOnlyOpenai = {
    type: "openai",
    secret: "meta_key",
    metadata: {
      api_base: "https://meta.example.com/v1",
      customModels: { "meta-model": { format: "openai", flavor: "chat" } },
      excludeDefaultModels: true,
    },
  };

  it("skips a custom-only secret ordered before the real provider key", () => {
    // Regression: the AI-secret reordering surfaced this by putting a custom
    // openai-format provider first, which then falsely 404'd real OpenAI models
    // during the deprecation audit (mirrors braintrust #19487).
    const selected = selectProviderSecretsByType([customOnlyOpenai, realOpenai]);
    expect(selected.get("openai")?.secret).toBe("openai_key");
  });

  it("still prefers the real key when it comes first", () => {
    const selected = selectProviderSecretsByType([realOpenai, customOnlyOpenai]);
    expect(selected.get("openai")?.secret).toBe("openai_key");
  });

  it("leaves a type absent when only custom-only secrets exist", () => {
    const selected = selectProviderSecretsByType([customOnlyOpenai]);
    expect(selected.has("openai")).toBe(false);
  });

  it("keeps the first eligible secret and ignores entries without a secret", () => {
    const selected = selectProviderSecretsByType([
      { type: "openai", metadata: {} },
      { type: "openai", secret: "first_real", metadata: {} },
      { type: "openai", secret: "second_real", metadata: {} },
    ]);
    expect(selected.get("openai")?.secret).toBe("first_real");
  });
});
