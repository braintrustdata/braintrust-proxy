import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkModelCapabilities,
  checkModelPrices,
  checkModelResearch,
  readEvidenceFile,
} from "./check_model_research";

const success = { type: "result", subtype: "success", is_error: false };

describe("checkModelPrices", () => {
  const model = "databricks-inkling-2-small";
  const field = "input_cost_per_mil_tokens";
  const after = { [model]: { [field]: 0.3, displayName: "Inkling 2 Small" } };
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
    quote:
      "Mosaic AI Model Serving: Inkling 2 Small, $0.30 per million input tokens",
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

  it.each([
    [
      "another model",
      "Mosaic AI Model Serving: Llama 3, $0.30 per million input tokens",
    ],
    [
      "a longer model ID",
      "Mosaic AI Model Serving: databricks-inkling-2-small-preview, $0.30 per million input tokens",
    ],
    [
      "another surface",
      "Provisioned Throughput: Inkling 2 Small, $0.30 per million input tokens",
    ],
    [
      "another rate",
      "Mosaic AI Model Serving: Inkling 2 Small, $10.30 per million input tokens",
    ],
    [
      "a rate with extra digits",
      "Mosaic AI Model Serving: Inkling 2 Small, $0.301 per million input tokens",
    ],
  ])("rejects a same-provider excerpt for %s", (_reason, quote) => {
    expect(() =>
      checkModelPrices({}, after, [{ ...evidence, quote }], mappings),
    ).toThrow("missing exact-provider pricing evidence");
  });

  it("requires evidence when direct sync adds a route but leaves its price unchanged", () => {
    const cwd = mkdtempSync(join(tmpdir(), "model-price-evidence-"));
    const write = (path: string, content: string) =>
      writeFileSync(join(cwd, path), content);
    const git = (...args: string[]) => execFileSync("git", args, { cwd });
    try {
      const schema = "packages/proxy/schema";
      const catalog = `${schema}/model_list.json`;
      const index = `${schema}/index.ts`;
      mkdirSync(join(cwd, schema), { recursive: true });
      git("init", "--quiet");
      const entry = { [field]: 0.3, available_providers: ["together"] };
      write(catalog, JSON.stringify({ "shared-model": entry }));
      write(index, "");
      git("add", catalog, index);
      git(
        "-c",
        "user.name=Pricing Test",
        "-c",
        "user.email=pricing-test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Base catalog",
      );

      write(
        catalog,
        JSON.stringify({
          "shared-model": {
            ...entry,
            available_providers: ["together", "groq"],
          },
        }),
      );
      write("execution.json", JSON.stringify([success]));
      write("price-evidence.json", "[]");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          fileURLToPath(new URL("./check_model_research.ts", import.meta.url)),
        ],
        {
          cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            EXECUTION_FILE: "execution.json",
            PRICE_EVIDENCE_FILE: "price-evidence.json",
            CAPABILITY_EVIDENCE_FILE: "",
          },
        },
      );
      expect(result.stderr).toContain(
        `shared-model @ groq: missing exact-provider pricing evidence for ${field}`,
      );
      expect(result.status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
      quote: "Supports extended thinking",
    };
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
