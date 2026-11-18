import { afterEach, expect, it, vi } from "vitest";

const originalModels = globalThis._proxy_availableModels;

afterEach(() => {
  globalThis._proxy_availableModels = originalModels;
  vi.resetModules();
});

it.each(["canonical", "companion"])(
  "excludes a retired %s from both directions of the fallback graph",
  async (retired) => {
    vi.resetModules();
    globalThis._proxy_availableModels = {
      "claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        retired: retired === "canonical",
        fallback_models: [
          "anthropic.claude-sonnet-4-6",
          "publishers/anthropic/models/claude-sonnet-4-6",
        ],
      },
      "anthropic.claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        retirement_date: retired === "companion" ? "2000-01-01" : undefined,
        fallback_models: ["claude-sonnet-4-6"],
      },
      "publishers/anthropic/models/claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        fallback_models: ["claude-sonnet-4-6"],
      },
    };
    const { getDirectModelEndpointTypes, getModelEndpointTypes } = await import(
      "./index"
    );
    const retiredName =
      retired === "canonical"
        ? "claude-sonnet-4-6"
        : "anthropic.claude-sonnet-4-6";
    const retiredProvider = retired === "canonical" ? "anthropic" : "bedrock";

    expect(getDirectModelEndpointTypes(retiredName)).toContain(retiredProvider);
    expect(getModelEndpointTypes(retiredName)).toEqual(
      getDirectModelEndpointTypes(retiredName),
    );
    for (const name of Object.keys(globalThis._proxy_availableModels)) {
      if (name !== retiredName) {
        expect(getModelEndpointTypes(name)).not.toContain(retiredProvider);
      }
    }
    if (retired === "companion") {
      expect(getModelEndpointTypes("claude-sonnet-4-6")).toContain("vertex");
    }
  },
);
