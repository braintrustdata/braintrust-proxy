import { describe, expect, it } from "vitest";
import {
  addSlugQueryParams,
  buildVerificationRequest,
  extractErrorMessage,
  resolveBraintrustApiKey,
  resolveVercelProtectionBypassSecret,
} from "./verify_proxy_models";

describe("buildVerificationRequest", () => {
  it("builds a chat completion verification request for chat models", () => {
    expect(
      buildVerificationRequest("gpt-4o", {
        flavor: "chat",
        format: "openai",
      }),
    ).toEqual({
      body: {
        messages: [
          {
            content: "ok",
            role: "user",
          },
        ],
        model: "gpt-4o",
      },
      endpoint: "chat/completions",
    });
  });

  it("uses chat completions for completion models too", () => {
    expect(
      buildVerificationRequest("gpt-3.5-turbo-instruct", {
        flavor: "completion",
        format: "openai",
      }),
    ).toEqual({
      body: {
        messages: [
          {
            content: "ok",
            role: "user",
          },
        ],
        model: "gpt-3.5-turbo-instruct",
      },
      endpoint: "chat/completions",
    });
  });

  it("uses chat completions for embedding models too", () => {
    expect(
      buildVerificationRequest("text-embedding-3-small", {
        flavor: "embedding",
        format: "openai",
      }),
    ).toEqual({
      body: {
        messages: [
          {
            content: "ok",
            role: "user",
          },
        ],
        model: "text-embedding-3-small",
      },
      endpoint: "chat/completions",
    });
  });
});

describe("extractErrorMessage", () => {
  it("returns nested OpenAI-style error messages", () => {
    expect(
      extractErrorMessage(
        JSON.stringify({
          error: {
            message: "Unsupported model",
          },
        }),
      ),
    ).toBe("Unsupported model");
  });

  it("returns top-level messages", () => {
    expect(
      extractErrorMessage(
        JSON.stringify({
          message: "No API keys found",
        }),
      ),
    ).toBe("No API keys found");
  });

  it("falls back to raw text", () => {
    expect(extractErrorMessage("plain text error")).toBe("plain text error");
  });
});

describe("addSlugQueryParams", () => {
  it("adds slug query params for the endpoint path", () => {
    const url = addSlugQueryParams(
      new URL("https://example.com/api/v1/chat/completions"),
      "chat/completions",
    );

    expect(url.toString()).toBe(
      "https://example.com/api/v1/chat/completions?slug=chat&slug=completions",
    );
  });
});

describe("resolveBraintrustApiKey", () => {
  it("uses an explicit key when present", () => {
    expect(resolveBraintrustApiKey("braintrust-key")).toBe("braintrust-key");
  });

  it("falls back to BRAINTRUST_API_KEY", () => {
    process.env.BRAINTRUST_API_KEY = "braintrust-env-key";

    expect(resolveBraintrustApiKey()).toBe("braintrust-env-key");

    delete process.env.BRAINTRUST_API_KEY;
  });

  it("throws when no Braintrust key exists", () => {
    delete process.env.BRAINTRUST_API_KEY;

    expect(() => resolveBraintrustApiKey()).toThrow("Missing API key");
  });
});

describe("resolveVercelProtectionBypassSecret", () => {
  it("uses an explicit secret when present", () => {
    expect(resolveVercelProtectionBypassSecret("bypass-secret")).toBe(
      "bypass-secret",
    );
  });

  it("falls back to VERCEL_AUTOMATION_BYPASS_SECRET", () => {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass-env-secret";

    expect(resolveVercelProtectionBypassSecret()).toBe("bypass-env-secret");

    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  });

  it("throws when no bypass secret exists", () => {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

    expect(() => resolveVercelProtectionBypassSecret()).toThrow(
      "Missing preview bypass secret",
    );
  });
});
