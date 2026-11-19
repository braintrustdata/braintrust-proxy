import { describe, expect, it } from "vitest";
import { buildModelTestPrompt, groupAddedModels } from "./model_test_prompt";

describe("groupAddedModels", () => {
  it("groups companions under the model that lists them as fallbacks", () => {
    const after = {
      "anthropic.claude-x": { format: "converse", flavor: "chat" },
      "claude-x": {
        format: "anthropic",
        flavor: "chat",
        fallback_models: ["anthropic.claude-x", "us.anthropic.claude-x"],
      },
      "us.anthropic.claude-x": {
        format: "converse",
        flavor: "chat",
        parent: "anthropic.claude-x",
      },
      "gpt-y": { format: "openai", flavor: "chat" },
    };

    expect(groupAddedModels(Object.keys(after), after)).toEqual([
      {
        id: "claude-x",
        companions: ["anthropic.claude-x", "us.anthropic.claude-x"],
      },
      { id: "gpt-y", companions: [] },
    ]);
  });

  it("groups parent-linked models without fallbacks", () => {
    const after = {
      "model-z": { format: "openai", flavor: "chat" },
      "model-z-2026-01-01": {
        format: "openai",
        flavor: "chat",
        parent: "model-z",
      },
    };

    expect(groupAddedModels(Object.keys(after), after)).toEqual([
      { id: "model-z", companions: ["model-z-2026-01-01"] },
    ]);
  });
});

describe("buildModelTestPrompt", () => {
  it("returns null when the catalog did not change", () => {
    const models = { "gpt-y": { format: "openai", flavor: "chat" } };

    expect(buildModelTestPrompt({ before: models, after: models })).toBeNull();
  });

  it("describes new models and lists changed models", () => {
    const before = {
      "gpt-old": { format: "openai", flavor: "chat" },
    };
    const after = {
      "gpt-old": {
        format: "openai",
        flavor: "chat",
        input_cost_per_mil_tokens: 1,
      },
      "claude-x": {
        format: "anthropic",
        flavor: "chat",
        displayName: "Claude X",
        multimodal: true,
        reasoning: true,
        max_input_tokens: 1_000_000,
        max_output_tokens: 128_000,
        input_cost_per_mil_tokens: 5,
        output_cost_per_mil_tokens: 25,
        parent: "claude-w",
        available_providers: ["anthropic", "bedrock"],
        fallback_models: ["anthropic.claude-x"],
      },
      "anthropic.claude-x": { format: "converse", flavor: "chat" },
      "embed-x": { format: "openai", flavor: "embedding" },
    };

    const prompt = buildModelTestPrompt({
      before,
      after,
      branch: "chore/sync-new-models",
    });

    expect(prompt).toContain("Validation prompt (3 new, 1 changed)");
    expect(prompt).toContain(
      "the `chore/sync-new-models` branch of `braintrustdata/braintrust-proxy`",
    );
    expect(prompt).toContain(
      "- `claude-x` (Claude X): format `anthropic`; flavor `chat`; providers anthropic, bedrock; multimodal, reasoning; limits 1,000,000 in / 128,000 out; $5 / $25 per 1M in/out; parent `claude-w`",
    );
    expect(prompt).toContain("  - Companions: `anthropic.claude-x`");
    expect(prompt).toContain(
      "- `embed-x`: format `openai`; flavor `embedding`; no token pricing",
    );
    expect(prompt).toContain("## Existing models with changed metadata");
    expect(prompt).toContain("- `gpt-old`");
    expect(prompt).toContain(
      "Call `embedding` models through `/v1/embeddings`.",
    );
    expect(prompt).toContain("migration or upgrade guide");
  });

  it("caps detailed models and lists the remainder by id", () => {
    const after = Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [
        `model-${index}`,
        { format: "openai", flavor: "chat" },
      ]),
    );

    const prompt = buildModelTestPrompt({
      before: {},
      after,
      maxDetailedModels: 2,
    });

    expect(prompt).toContain("- `model-1`: format");
    expect(prompt).not.toContain("- `model-2`: format");
    expect(prompt).toContain("- 2 more new models");
    expect(prompt).toContain("`model-2`, `model-3`");
  });
});
