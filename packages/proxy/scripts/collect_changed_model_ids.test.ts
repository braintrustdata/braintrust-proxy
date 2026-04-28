import { describe, expect, it } from "vitest";
import { collectChangedModelIds } from "./collect_changed_model_ids";

describe("collectChangedModelIds", () => {
  it("returns added and modified model ids in after-file order", () => {
    const before = {
      "existing-unchanged": { format: "openai", flavor: "chat" },
      "existing-changed": { format: "openai", flavor: "chat" },
    };
    const after = {
      "existing-changed": {
        format: "openai",
        flavor: "chat",
        displayName: "Existing Changed",
      },
      "new-model": { format: "anthropic", flavor: "chat" },
      "existing-unchanged": { format: "openai", flavor: "chat" },
    };

    expect(collectChangedModelIds(before, after)).toEqual([
      "existing-changed",
      "new-model",
    ]);
  });

  it("ignores models that only existed in the before snapshot", () => {
    const before = {
      "removed-model": { format: "openai", flavor: "chat" },
    };
    const after = {};

    expect(collectChangedModelIds(before, after)).toEqual([]);
  });
});
