import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkModelCapabilities,
  checkModelPrices,
  checkModelResearch,
  providerCapabilityLookup,
} from "./check_model_research";

const success = { type: "result", subtype: "success", is_error: false };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("checkModelPrices", () => {
  const model = "databricks-inkling-2-small";
  const field = "input_cost_per_mil_tokens";
  const after = { [model]: { [field]: 0.3 } };
  const mappings = {
    before: "",
    after: `export const AvailableEndpointTypes = {
      "${model}": ["databricks"],
};`,
  };
  const evidence = {
    model,
    provider: "databricks",
    surface: "Mosaic AI Model Serving",
    field,
    value: 0.3,
    source: "https://docs.databricks.com/pricing-example",
    quote: "Example rate: $0.30 per million input tokens",
  };

  it("rejects copied Fireworks pricing even if its source is labeled Databricks", () => {
    const source = "https://fireworks.ai/models/fireworks/inkling-2-small";
    expect(() =>
      checkModelPrices(
        {},
        after,
        [
          {
            ...evidence,
            model: "accounts/fireworks/models/inkling-2-small",
            provider: "fireworks",
            source,
          },
          { ...evidence, source },
          { ...evidence, value: 0.29 },
        ],
        mappings,
      ),
    ).toThrow("missing exact-provider pricing evidence");
  });

  it("accepts an exact source or omission, but does not inherit prices onto new routes", () => {
    expect(() =>
      checkModelPrices({}, after, [evidence], mappings),
    ).not.toThrow();
    expect(() =>
      checkModelPrices({}, { [model]: {} }, [], mappings),
    ).not.toThrow();
    expect(() =>
      checkModelPrices(after, after, [], {
        before: mappings.after,
        after: mappings.after,
      }),
    ).not.toThrow();
    expect(() => checkModelPrices(after, after, [], mappings)).toThrow(
      "missing exact-provider pricing evidence",
    );
  });
});

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
    quote: `${model} supports image input on Fireworks Serverless.`,
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
      const negativeQuote = `${model} does not support image input on Fireworks Serverless.`;
      vi.stubGlobal("fetch", async () => new Response(negativeQuote));
      await expect(
        checkModelCapabilities(
          {},
          after,
          structuredNegative
            ? [claim]
            : [claim, { ...claim, supported: false, quote: negativeQuote }],
          async () => (structuredNegative ? false : true),
        ),
      ).rejects.toThrow("multimodal is unsupported");
    },
  );

  it("accepts exact-provider evidence, structured metadata, or unchanged claims", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          `<p><code>${model}</code>\n supports image input on Fireworks Serverless.</p>`,
        ),
    );
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

  it.each([
    { source: "https://openrouter.ai/models/inkling-2-small" },
    { body: "This source does not mention the quoted claim." },
    {
      body: `accounts/fireworks/models/inkling-2-small-fast supports image input on Fireworks Serverless.`,
    },
    {
      body: `${model} supports image input on Fireworks Serverless only on dedicated deployments.`,
    },
    { quote: `${model} supports reasoning on Fireworks Serverless.` },
    { quote: `${model} does not support image input on Fireworks Serverless.` },
    { quote: `${model} supports image input on Fireworks Dedicated.` },
  ])(
    "rejects relabeled, fabricated, or unrelated source evidence: %j",
    async ({ source, body, quote }) => {
      vi.stubGlobal(
        "fetch",
        async () => new Response(body ?? quote ?? claim.quote),
      );
      await expect(
        checkModelCapabilities(
          {},
          after,
          [
            {
              ...claim,
              source: source ?? claim.source,
              quote: quote ?? claim.quote,
            },
          ],
          async () => undefined,
        ),
      ).rejects.toThrow("missing exact-provider evidence for multimodal");
    },
  );

  it("does not follow redirects outside the claimed provider's domains", async () => {
    const fetch = vi.fn(async () => Response.redirect("https://example.com/"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      checkModelCapabilities({}, after, [claim], async () => undefined),
    ).rejects.toThrow("missing exact-provider evidence for multimodal");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let an unverified negative override structured support", async () => {
    vi.stubGlobal("fetch", async () => new Response(claim.quote));
    await expect(
      checkModelCapabilities(
        {},
        after,
        [
          {
            ...claim,
            supported: false,
            quote: `${model} does not support image input on Fireworks Serverless.`,
          },
        ],
        async () => true,
      ),
    ).resolves.toBeUndefined();
  });

  it("resolves index-only companions and still rejects claims with no route", async () => {
    const companion = "publishers/anthropic/models/claude-opus-5-5";
    const catalog = { [companion]: { reasoning: true } };
    const vertexClaim = {
      ...claim,
      model: companion,
      provider: "vertex",
      surface: "Vertex AI Model Garden",
      capability: "reasoning",
      source:
        "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude",
      quote: `${companion} supports extended thinking.`,
    };
    vi.stubGlobal("fetch", async () => new Response(vertexClaim.quote));
    const index = `export const AvailableEndpointTypes = {
      "${companion}": ["vertex"],
};`;
    await expect(
      checkModelCapabilities(
        {},
        catalog,
        [vertexClaim],
        async () => undefined,
        {
          before: "",
          after: index,
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      checkModelCapabilities(catalog, catalog, [], async () => undefined, {
        before: index,
        after: index,
      }),
    ).resolves.toBeUndefined();
    await expect(
      checkModelCapabilities({}, catalog, [vertexClaim], async () => undefined),
    ).rejects.toThrow("no provider to verify reasoning against");
  });
});

describe("providerCapabilityLookup", () => {
  it.each([
    [
      "openrouter",
      "https://openrouter.ai/api/v1/models",
      undefined,
      {
        data: [
          {
            id: "test/model",
            architecture: { input_modalities: ["text"] },
            supported_parameters: ["reasoning_effort"],
          },
        ],
      },
    ],
    [
      "cerebras",
      "https://api.cerebras.ai/public/v1/models",
      undefined,
      {
        data: [
          {
            id: "test/model",
            capabilities: { vision: false, reasoning: true },
          },
        ],
      },
    ],
    [
      "groq",
      "https://api.groq.com/openai/v1/models",
      "GROQ_API_KEY",
      {
        data: [
          {
            id: "test/model",
            input_modalities: ["text"],
            supported_features: ["reasoning"],
          },
        ],
      },
    ],
    [
      "baseten",
      "https://inference.baseten.co/v1/models",
      "BASETEN_API_KEY",
      {
        data: [
          {
            id: "test/model",
            input_modalities: ["text"],
            supported_features: ["reasoning"],
          },
        ],
      },
    ],
    [
      "xAI",
      "https://api.x.ai/v1/language-models",
      "XAI_API_KEY",
      { models: [{ id: "test/model", input_modalities: ["text"] }] },
    ],
  ] as const)(
    "checks exact %s model metadata once per validation",
    async (provider, url, key, body) => {
      const fetch = vi.fn(async () => Response.json(body));
      vi.stubGlobal("fetch", fetch);
      if (key) vi.stubEnv(key, "test-key");
      const lookup = providerCapabilityLookup();
      await expect(lookup("test/model", provider, "multimodal")).resolves.toBe(
        false,
      );
      await expect(lookup("test/model", provider, "reasoning")).resolves.toBe(
        provider === "xAI" ? undefined : true,
      );
      await expect(
        lookup("test/model-fast", provider, "multimodal"),
      ).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        url,
        expect.objectContaining({
          headers: key ? { Authorization: "Bearer test-key" } : {},
        }),
      );
    },
  );
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
