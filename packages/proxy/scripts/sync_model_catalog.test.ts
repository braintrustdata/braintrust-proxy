import { describe, expect, it } from "vitest";
import {
  compareModelOrdering,
  getFallbackCompleteOrdering,
  getProviderMappingForModel,
  getRemoteAccessProvider,
  matchesProviderFilter,
  orderModelsByProviderAndClass,
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

  it("orders separated date snapshots by full release date across year boundaries", () => {
    expect(
      compareModelOrdering("gpt-4.1-2025-01-31", "gpt-4.1-2024-11-20"),
    ).toBeLessThan(0);
    expect(
      compareModelOrdering("gpt-4o-2025-01-01", "gpt-4o-2024-11-20"),
    ).toBeLessThan(0);
    expect(
      compareModelOrdering(
        "gpt-image-1.5-2026-01-05",
        "gpt-image-1.5-2025-12-16",
      ),
    ).toBeLessThan(0);
  });

  it("orders atomic and separated date snapshots consistently within a class", () => {
    expect(
      compareModelOrdering(
        "claude-opus-4-5-20251101",
        "claude-opus-4-5-20250805",
      ),
    ).toBeLessThan(0);
    expect(
      ["gpt-4.1-2024-11-20", "gpt-4.1-2025-04-14", "gpt-4.1-2025-01-31"].sort(
        compareModelOrdering,
      ),
    ).toEqual([
      "gpt-4.1-2025-04-14",
      "gpt-4.1-2025-01-31",
      "gpt-4.1-2024-11-20",
    ]);
  });

  it("keeps the undated stable alias ahead of its dated snapshot after date collapsing", () => {
    expect(
      compareModelOrdering("claude-opus-4-6-2026-02-05", "claude-opus-4-6"),
    ).toBeGreaterThan(0);
  });

  it("interleaves anthropic families column-major by capability tier", () => {
    expect(
      orderModelsByProviderAndClass({
        "claude-haiku-4-5": { available_providers: ["anthropic"] },
        "claude-opus-4-8": { available_providers: ["anthropic"] },
        "claude-sonnet-4-6": { available_providers: ["anthropic"] },
        "claude-fable-5": { available_providers: ["anthropic"] },
        "claude-sonnet-5": { available_providers: ["anthropic"] },
        "claude-opus-4-7": { available_providers: ["anthropic"] },
      }),
    ).toEqual([
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-7",
      "claude-sonnet-4-6",
    ]);
  });

  it("glues a dated snapshot to its alias within the same interleave slot", () => {
    expect(
      orderModelsByProviderAndClass({
        "claude-opus-4-5": { available_providers: ["anthropic"] },
        "claude-opus-4-5-20251101": { available_providers: ["anthropic"] },
        "claude-opus-4-1": { available_providers: ["anthropic"] },
        "claude-sonnet-5": { available_providers: ["anthropic"] },
        "claude-sonnet-4-5": { available_providers: ["anthropic"] },
        "claude-sonnet-4-5-20250929": { available_providers: ["anthropic"] },
        "claude-haiku-4-5": { available_providers: ["anthropic"] },
      }),
    ).toEqual([
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-1",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
    ]);
  });

  it("keeps provider blocks contiguous in first-appearance order", () => {
    expect(
      orderModelsByProviderAndClass({
        "claude-haiku-4-5": { available_providers: ["anthropic"] },
        "gpt-4o": { available_providers: ["openai", "azure"] },
        "claude-opus-4-8": { available_providers: ["anthropic"] },
        "gpt-5.6": { available_providers: ["openai", "azure"] },
      }),
    ).toEqual(["claude-opus-4-8", "claude-haiku-4-5", "gpt-5.6", "gpt-4o"]);
  });

  it("orders tiered classes ahead of unlisted ones and leaves untabled providers untouched", () => {
    expect(
      orderModelsByProviderAndClass({
        o3: { available_providers: ["openai", "azure"] },
        "gpt-5.6": { available_providers: ["openai", "azure"] },
        "sora-2": { available_providers: ["openai", "azure"] },
        "dall-e-3": { available_providers: ["openai", "azure"] },
      }),
    ).toEqual(["gpt-5.6", "o3", "dall-e-3", "sora-2"]);
    expect(
      orderModelsByProviderAndClass({
        "amazon.titan-text-express": { available_providers: ["bedrock"] },
        "us.anthropic.claude-3-5-sonnet": {
          available_providers: ["bedrock"],
        },
      }),
    ).toEqual(["amazon.titan-text-express", "us.anthropic.claude-3-5-sonnet"]);
  });
});
