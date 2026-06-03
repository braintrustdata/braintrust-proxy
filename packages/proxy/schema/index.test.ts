import { MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/messages";
import { GenerateContentParameters } from "../types/google";
import { ChatCompletionCreateParams } from "openai/resources";
import { describe, expect, it } from "vitest";
import { APISecretSchema } from "./secrets";
import { ModelFormat } from "./index";
import { translateParams } from "./translate";

const examples: Record<
  string,
  {
    openai: ChatCompletionCreateParams;
  } & ( // NOTE: these are not strictly the API params.
    | { google: GenerateContentParameters }
    | { anthropic: MessageCreateParamsBase }
  )
> = {
  simple: {
    openai: {
      model: "gpt-4o",
      max_tokens: 1500,
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello, how are you?" },
      ],
      stream: true,
    },
    google: {
      maxOutputTokens: 1500,
      max_tokens: 1500,
      messages: [
        {
          content: "You are a helpful assistant.",
          role: "system",
        },
        {
          content: "Hello, how are you?",
          role: "user",
        },
      ],
      model: "gpt-4o",
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
    },
    anthropic: {
      max_tokens: 1500,
      messages: [
        {
          content: "You are a helpful assistant.",
          // @ts-expect-error -- TODO: shouldn't we have translated this to a non system role?
          role: "system",
        },
        {
          content: "Hello, how are you?",
          role: "user",
        },
      ],
      model: "gpt-4o",
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
    },
  },
  reasoning_effort: {
    openai: {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      max_tokens: 1000,
      reasoning_effort: "high",
      stream: false,
    },
    google: {
      model: "gpt-4o",
      // notice how this is still an intermediate param
      // google's api expects a content instead of messages, for example
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      thinkingConfig: {
        thinkingBudget: 800,
        includeThoughts: true,
      },
      maxOutputTokens: 1000,
      max_tokens: 1000,
      stream: false,
    },
    anthropic: {
      model: "gpt-4o",
      messages: [
        {
          // @ts-expect-error  -- we use the role to later manipulate the request
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 1,
      stream: false,
      max_tokens: 1536,
      thinking: {
        budget_tokens: 1024,
        type: "enabled",
      },
    },
  },
  "reasoning disable": {
    openai: {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      reasoning_enabled: false,
      reasoning_budget: 1024,
      stream: false,
    },
    google: {
      model: "gpt-4o",
      // notice how this is still an intermediate param
      // google's api expects a content instead of messages, for example
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      thinkingConfig: {
        thinkingBudget: 0,
      },
      stream: false,
    },
    anthropic: {
      model: "gpt-4o",
      messages: [
        {
          // @ts-expect-error  -- we use the role to later manipulate the request
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      stream: false,
      max_tokens: 4096,
      thinking: {
        type: "disabled",
      },
    },
  },
  "reasoning budget": {
    openai: {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      reasoning_enabled: true,
      reasoning_budget: 4096,
      stream: false,
    },
    google: {
      model: "gpt-4o",
      // notice how this is still an intermediate param
      // google's api expects a content instead of messages, for example
      messages: [
        {
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 0,
      thinkingConfig: {
        thinkingBudget: 4096,
        includeThoughts: true,
      },
      stream: false,
    },
    anthropic: {
      model: "gpt-4o",
      messages: [
        {
          // @ts-expect-error  -- we use the role to later manipulate the request
          role: "system",
          content: "You are a detailed reasoning assistant.",
        },
        {
          role: "user",
          content: "Explain how to solve 2x + 4 = 12 step by step.",
        },
      ],
      temperature: 1,
      stream: false,
      max_tokens: 6144,
      thinking: {
        budget_tokens: 4096,
        type: "enabled",
      },
    },
  },
};

Object.entries(examples).forEach(([example, { openai, ...providers }]) => {
  Object.entries(providers).forEach(([provider, expected]) => {
    it(`[${example}] translate openai to ${provider} params`, () => {
      const result = translateParams(
        provider as ModelFormat,
        openai as unknown as Record<string, unknown>,
      );
      try {
        expect(result).toEqual(expected);
      } catch (error) {
        console.warn(
          `Exact openai -> ${provider} translation failed. Found:`,
          JSON.stringify(result, null, 2),
        );
        expect.soft(result).toEqual(expected);
      }
    });
  });
});

describe("model-specific Anthropic params", () => {
  it("omits temperature for Claude Opus 4.7", () => {
    const result = translateParams("anthropic", {
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
      reasoning_enabled: true,
      max_tokens: 4096,
    });

    expect(result).not.toHaveProperty("temperature");
    expect(result).toMatchObject({
      model: "claude-opus-4-7",
      thinking: {
        type: "enabled",
      },
    });
  });
});

describe("APISecretSchema compatibility", () => {
  it("accepts and preserves unknown metadata keys", () => {
    const parsed = APISecretSchema.parse({
      secret: "provider-secret",
      type: "openai",
      metadata: {
        api_base: "https://api.openai.com",
        endpoint_path: "/v1/chat/completions",
        auth_format: "api_key",
        future_field: "future-value",
      },
    });

    expect(parsed.type).toBe("openai");
    expect(parsed.metadata).toMatchObject({
      endpoint_path: "/v1/chat/completions",
      auth_format: "api_key",
      future_field: "future-value",
    });
  });

  it("accepts and preserves unknown top-level keys", () => {
    const parsed = APISecretSchema.parse({
      secret: "provider-secret",
      type: "openai",
      metadata: {},
      future_top_level: { enabled: true },
    });

    expect(parsed).toMatchObject({
      future_top_level: { enabled: true },
    });
  });

  it("accepts Anthropic OAuth bearer metadata", () => {
    const parsed = APISecretSchema.parse({
      secret: "anthropic-access-token",
      type: "anthropic",
      metadata: {
        auth_type: "oauth_bearer",
        auth_source: "anthropic_workload_identity_federation",
        future_field: "future-value",
      },
    });

    expect(parsed.type).toBe("anthropic");
    expect(parsed.metadata).toMatchObject({
      auth_type: "oauth_bearer",
      auth_source: "anthropic_workload_identity_federation",
      future_field: "future-value",
    });
  });

  it("accepts resolved OpenAI OAuth bearer metadata", () => {
    const parsed = APISecretSchema.parse({
      secret: "openai-access-token",
      type: "openai",
      metadata: {
        auth_type: "oauth_bearer",
        auth_source: "openai_workload_identity_federation",
        future_field: "future-value",
      },
    });

    expect(parsed.type).toBe("openai");
    expect(parsed.metadata).toMatchObject({
      auth_type: "oauth_bearer",
      auth_source: "openai_workload_identity_federation",
      future_field: "future-value",
    });
  });

  it("rejects raw OpenAI workload identity metadata", () => {
    const result = APISecretSchema.safeParse({
      secret: "__OPENAI_WIF__",
      type: "openai",
      metadata: {
        auth_type: "workload_identity_federation",
        identity_provider_id: "wip-test",
        service_account_id: "svc-test",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts resolved Vertex OAuth bearer metadata", () => {
    const parsed = APISecretSchema.parse({
      secret: "google-access-token",
      type: "vertex",
      metadata: {
        authType: "oauth_bearer",
        auth_source: "google_workload_identity_federation",
        connection_id: 123,
        project: "vertex-project",
        future_field: "future-value",
      },
    });

    expect(parsed.type).toBe("vertex");
    expect(parsed.metadata).toMatchObject({
      authType: "oauth_bearer",
      connection_id: 123,
      auth_source: "google_workload_identity_federation",
      future_field: "future-value",
      project: "vertex-project",
    });
  });

  it("accepts raw Vertex workload identity metadata", () => {
    const parsed = APISecretSchema.parse({
      secret: "__VERTEX_WIF__",
      type: "vertex",
      metadata: {
        authType: "workload_identity_federation",
        project: "vertex-project",
        workload_identity_provider: "//iam.googleapis.com/projects/123",
      },
    });

    expect(parsed.type).toBe("vertex");
    expect(parsed.metadata).toMatchObject({
      authType: "workload_identity_federation",
      project: "vertex-project",
      workload_identity_provider: "//iam.googleapis.com/projects/123",
    });
  });

  it("validates OIDC metadata only for raw Vertex workload identity metadata", () => {
    const result = APISecretSchema.safeParse({
      secret: "__VERTEX_WIF__",
      type: "vertex",
      metadata: {
        authType: "workload_identity_federation",
        project: "vertex-project",
        connection_id: 123,
      },
    });

    expect(result.success).toBe(false);
  });

  it("defaults Anthropic auth metadata to api_key", () => {
    const parsed = APISecretSchema.parse({
      secret: "anthropic-api-key",
      type: "anthropic",
      metadata: {},
    });

    expect(parsed.type).toBe("anthropic");
    expect(parsed.metadata?.auth_type).toBe("api_key");
  });

  it("still rejects schema violations", () => {
    const result = APISecretSchema.safeParse({
      type: "openai",
      metadata: {},
    });
    expect(result.success).toBe(false);
  });

  it("preserves passthrough behavior for legacy Ollama api_base values", () => {
    const cases: Array<{ name: string; api_base: unknown }> = [
      { name: "invalid url string", api_base: "not a url" },
      { name: "bare hostname", api_base: "localhost" },
      { name: "number", api_base: 12345 },
      { name: "boolean", api_base: true },
      { name: "object", api_base: { nested: 1 } },
    ];

    for (const { name, api_base } of cases) {
      const parsed = APISecretSchema.parse({
        secret: "ollama-secret",
        type: "ollama",
        metadata: { api_base },
      });
      if (parsed.type !== "ollama") {
        throw new Error(`Expected ollama secret for case '${name}'`);
      }
      expect(
        parsed.metadata?.api_base,
        `case '${name}' should coerce to undefined to preserve runtime fallback`,
      ).toBeUndefined();
    }
  });
});
