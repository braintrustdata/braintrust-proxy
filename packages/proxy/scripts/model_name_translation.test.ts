import { describe, expect, it } from "vitest";
import {
  canonicalizeLocalModelName,
  getEquivalentLocalModelNames,
  isSupportedTranslatedModelName,
  translateToBraintrust,
} from "./model_name_translation";

describe("translateToBraintrust", () => {
  it("strips fireworks_ai prefixes from Fireworks model ids", () => {
    expect(
      translateToBraintrust(
        "fireworks_ai/accounts/fireworks/models/llama4-maverick-instruct-basic",
        "fireworks_ai",
      ),
    ).toBe("accounts/fireworks/models/llama4-maverick-instruct-basic");
  });

  it("strips fireworks prefixes from Fireworks model ids", () => {
    expect(
      translateToBraintrust(
        "fireworks/accounts/fireworks/models/qwen3-next-80b-a3b-instruct",
        "fireworks",
      ),
    ).toBe("accounts/fireworks/models/qwen3-next-80b-a3b-instruct");
  });

  it("strips baseten prefixes from Baseten model ids", () => {
    expect(
      translateToBraintrust("baseten/deepseek-ai/DeepSeek-V3-0324", "baseten"),
    ).toBe("deepseek-ai/DeepSeek-V3-0324");
  });

  it("rejects the Fireworks provider root path", () => {
    expect(
      isSupportedTranslatedModelName(
        "accounts/fireworks/models/",
        "fireworks_ai",
      ),
    ).toBe(false);
  });

  it("rejects Fireworks pricing bucket entries", () => {
    expect(
      isSupportedTranslatedModelName("fireworks-ai-default", "fireworks_ai"),
    ).toBe(false);
  });

  it("accepts concrete Fireworks model ids", () => {
    expect(
      isSupportedTranslatedModelName(
        "accounts/fireworks/models/llama4-maverick-instruct-basic",
        "fireworks_ai",
      ),
    ).toBe(true);
  });

  it("accepts concrete Baseten model ids after prefix stripping", () => {
    expect(
      isSupportedTranslatedModelName("deepseek-ai/DeepSeek-V3-0324", "baseten"),
    ).toBe(true);
  });

  it("canonicalizes legacy Fireworks local keys", () => {
    expect(
      canonicalizeLocalModelName(
        "fireworks_ai/accounts/fireworks/models/glm-4p5",
      ),
    ).toBe("accounts/fireworks/models/glm-4p5");
  });

  it("returns equivalent Fireworks local keys", () => {
    expect(
      getEquivalentLocalModelNames("accounts/fireworks/models/glm-4p5"),
    ).toEqual([
      "accounts/fireworks/models/glm-4p5",
      "fireworks_ai/accounts/fireworks/models/glm-4p5",
      "fireworks/accounts/fireworks/models/glm-4p5",
    ]);
  });
});
