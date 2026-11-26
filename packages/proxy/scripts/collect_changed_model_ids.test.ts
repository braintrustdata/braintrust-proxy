import { describe, expect, it } from "vitest";
import type { StoredModelSpec } from "../schema/models";
import {
  collectChangedModelIds,
  collectEnrichmentTasks,
} from "./collect_changed_model_ids";

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

it("scopes enrichment to new metadata, affected pricing routes, and OpenAI token changes", () => {
  const base = {
    format: "openai",
    flavor: "chat",
    displayName: "Existing",
    max_output_tokens: 50,
    available_providers: ["openai"],
  } satisfies StoredModelSpec;
  const before = {
    "token-limit": base,
    "other-limit": { ...base, available_providers: ["groq"] },
    "new-provider": base,
    unchanged: base,
  } satisfies Record<string, StoredModelSpec>;
  const after = {
    "token-limit": { ...base, max_output_tokens: 100 },
    "other-limit": { ...before["other-limit"], max_output_tokens: 100 },
    "new-provider": { ...base, available_providers: ["openai", "openrouter"] },
    unchanged: {
      available_providers: ["openai"],
      max_output_tokens: 50,
      displayName: "Existing",
      flavor: "chat",
      format: "openai",
    },
    "new-model": base,
  } satisfies Record<string, StoredModelSpec>;
  expect(collectEnrichmentTasks(before, after)).toEqual([
    {
      model: "token-limit",
      displayName: false,
      parent: false,
      pricingProviders: [],
      verifyOpenAITokenLimits: true,
    },
    {
      model: "new-provider",
      displayName: false,
      parent: false,
      pricingProviders: ["openrouter"],
      verifyOpenAITokenLimits: false,
    },
    {
      model: "new-model",
      displayName: true,
      parent: true,
      pricingProviders: ["openai"],
      verifyOpenAITokenLimits: true,
    },
  ]);
});
