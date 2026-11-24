import { describe, expect, it } from "vitest";
import {
  checkModelCapabilities,
  checkModelResearch,
} from "./check_model_research";

const success = { type: "result", subtype: "success", is_error: false };

describe("checkModelCapabilities", () => {
  const model = "accounts/fireworks/models/inkling-2-small";
  const after = {
    [model]: { multimodal: true, available_providers: ["fireworks"] },
  };
  const claim = {
    model,
    provider: "fireworks",
    surface: "Serverless",
    capability: "multimodal",
    supported: true,
    source: "https://fireworks.ai/models/fireworks/inkling-2-small",
    quote: "Image input supported",
  };

  it("rejects image support from a different provider or model", async () => {
    await expect(
      checkModelCapabilities(
        {},
        after,
        [
          { ...claim, provider: "openrouter" },
          { ...claim, model: "accounts/fireworks/models/inkling" },
          { ...claim, surface: "Dedicated" },
        ],
        async () => undefined,
      ),
    ).rejects.toThrow("missing exact-provider evidence for multimodal");
  });

  it.each([true, false])(
    "lets a provider negative win over a positive (structured: %s)",
    async (structuredNegative) => {
      await expect(
        checkModelCapabilities(
          {},
          after,
          structuredNegative
            ? [claim]
            : [claim, { ...claim, supported: false }],
          async () => (structuredNegative ? false : true),
        ),
      ).rejects.toThrow("multimodal is unsupported");
    },
  );

  it("accepts exact-provider evidence, structured metadata, or unchanged claims", async () => {
    await expect(
      checkModelCapabilities({}, after, [claim], async () => undefined),
    ).resolves.toBeUndefined();
    await expect(
      checkModelCapabilities({}, after, [], async () => true),
    ).resolves.toBeUndefined();
    await expect(
      checkModelCapabilities(after, after, [], async () => false),
    ).resolves.toBeUndefined();
  });
});

describe("checkModelResearch", () => {
  it("accepts successful research, including a verified no-change outcome", () => {
    expect(() => checkModelResearch([success])).not.toThrow();
  });

  it.each(["WebFetch", "WebSearch", "Agent"])(
    "blocks a failed %s even when the agent reports success",
    (tool) => {
      expect(() =>
        checkModelResearch([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", name: tool, id: "research" }],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "research",
                  is_error: true,
                  content:
                    'HTTP 400: To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.',
                },
              ],
            },
          },
          success,
        ]),
      ).toThrow("API or tool error");
    },
  );

  it("blocks delegated API errors", () => {
    expect(() =>
      checkModelResearch([
        {
          type: "assistant",
          error: "invalid_request",
          parent_tool_use_id: "agent",
        },
        success,
      ]),
    ).toThrow("API or tool error");
  });

  it.each([
    [],
    [{ type: "result", subtype: "error_max_turns", is_error: true }],
    [{ type: "result", subtype: "success", is_error: true }],
    [{ type: "result", subtype: "success" }],
  ])("blocks incomplete or failed execution: %j", (...messages) => {
    expect(() => checkModelResearch(messages)).toThrow();
  });

  it("rejects malformed transcripts", () => {
    expect(() => checkModelResearch({})).toThrow();
  });
});
