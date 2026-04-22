import { describe, expect, it } from "vitest";
import {
  compareModelOrdering,
  getFallbackCompleteOrdering,
  getProviderMappingForModel,
  getRemoteAccessProvider,
  matchesProviderFilter,
} from "./sync_model_catalog";

describe("sync_model_catalog", () => {
  it("keeps provider filtering scoped to the access platform", () => {
    expect(
      matchesProviderFilter(
        "vertex_ai/claude-opus-4-7@default",
        { litellm_provider: "anthropic" },
        "anthropic",
      ),
    ).toBe(false);
    expect(
      matchesProviderFilter(
        "vertex_ai/claude-opus-4-7@default",
        { litellm_provider: "anthropic" },
        "vertex",
      ),
    ).toBe(true);
    expect(
      matchesProviderFilter(
        "anthropic.claude-opus-4-6-v1",
        { litellm_provider: "anthropic" },
        "anthropic",
      ),
    ).toBe(false);
    expect(
      matchesProviderFilter(
        "anthropic.claude-opus-4-6-v1",
        { litellm_provider: "anthropic" },
        "bedrock",
      ),
    ).toBe(true);
  });

  it("maps platform aliases to the access provider instead of the underlying vendor", () => {
    expect(
      getRemoteAccessProvider("vertex_ai/openai/gpt-oss-120b-maas", {
        litellm_provider: "openai",
      }),
    ).toBe("vertex");
    expect(
      getProviderMappingForModel("vertex_ai/openai/gpt-oss-120b-maas", {
        litellm_provider: "openai",
      }),
    ).toEqual(["vertex"]);
    expect(
      getProviderMappingForModel("openai.gpt-oss-120b-1:0", {
        litellm_provider: "openai",
      }),
    ).toEqual(["bedrock"]);
  });

  it("orders qwen3 models ahead of qwen2 models", () => {
    expect(
      compareModelOrdering(
        "accounts/fireworks/models/qwen3-14b",
        "accounts/fireworks/models/qwen2-72b-instruct",
      ),
    ).toBeLessThan(0);
  });

  it("orders qwen2.5 models ahead of qwen2 models", () => {
    expect(
      compareModelOrdering(
        "accounts/fireworks/models/qwen2p5-coder-32b-instruct",
        "accounts/fireworks/models/qwen2-72b-instruct",
      ),
    ).toBeLessThan(0);
  });

  it("orders dated claude snapshots after the undated stable alias for the same series", () => {
    expect(
      compareModelOrdering("claude-opus-4-6-20260205", "claude-opus-4-6"),
    ).toBeGreaterThan(0);
  });

  it("inserts newer family members before older ones in fallback ordering", () => {
    expect(
      getFallbackCompleteOrdering(
        [
          "accounts/fireworks/models/qwen2-72b-instruct",
          "accounts/fireworks/models/qwen2p5-coder-32b-instruct",
        ],
        [
          "accounts/fireworks/models/qwen3-14b",
          "accounts/fireworks/models/qwen3-next-80b-a3b-instruct",
        ],
      ),
    ).toEqual([
      "accounts/fireworks/models/qwen3-next-80b-a3b-instruct",
      "accounts/fireworks/models/qwen3-14b",
      "accounts/fireworks/models/qwen2p5-coder-32b-instruct",
      "accounts/fireworks/models/qwen2-72b-instruct",
    ]);
  });
});
