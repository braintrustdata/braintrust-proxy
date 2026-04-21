import { describe, expect, it } from "vitest";
import {
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
});
