import { describe, expect, it } from "vitest";
import {
  buildVerificationRequest,
  extractErrorMessage,
  getModelEndpointTypesForVerification,
  resolveApiKeyForModel,
  resolveBraintrustApiKey,
  resolveVercelProtectionBypassSecret,
} from "./verify_proxy_models";

describe("buildVerificationRequest", () => {
  it("builds a chat completion verification request", () => {
    expect(buildVerificationRequest("gpt-4o")).toEqual({
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

describe("resolveApiKeyForModel", () => {
  it("prefers a provider-specific key based on the model endpoint type", () => {
    process.env.GEMINI_API_KEY = "gemini-env-key";
    process.env.BRAINTRUST_API_KEY = "braintrust-env-key";

    expect(
      resolveApiKeyForModel("gemini-2.5-flash", undefined, {
        "gemini-2.5-flash": {
          available_providers: ["google", "vertex"],
          format: "google",
        },
      }),
    ).toBe("gemini-env-key");

    delete process.env.GEMINI_API_KEY;
    delete process.env.BRAINTRUST_API_KEY;
  });

  it("falls back to BRAINTRUST_API_KEY when no provider-specific key exists", () => {
    process.env.BRAINTRUST_API_KEY = "braintrust-env-key";

    expect(resolveApiKeyForModel("unknown-model")).toBe("braintrust-env-key");

    delete process.env.BRAINTRUST_API_KEY;
  });

  it("uses an explicit key when present", () => {
    process.env.GEMINI_API_KEY = "gemini-env-key";

    expect(
      resolveApiKeyForModel("gemini-2.5-flash", "explicit-key", {
        "gemini-2.5-flash": {
          available_providers: ["google", "vertex"],
          format: "google",
        },
      }),
    ).toBe("explicit-key");

    delete process.env.GEMINI_API_KEY;
  });
});

describe("getModelEndpointTypesForVerification", () => {
  it("prefers available providers from the static model list", () => {
    expect(
      getModelEndpointTypesForVerification("gemini-2.5-flash", {
        "gemini-2.5-flash": {
          available_providers: ["google", "vertex"],
          format: "google",
        },
      }),
    ).toEqual(["google", "vertex"]);
  });

  it("returns an empty array for unknown models", () => {
    expect(getModelEndpointTypesForVerification("unknown-model", {})).toEqual(
      [],
    );
  });

  it("uses the passed-in catalog for newly added models", () => {
    expect(
      getModelEndpointTypesForVerification("gemini-2.5-flash-image", {
        "gemini-2.5-flash-image": {
          available_providers: ["google"],
          format: "google",
        },
      }),
    ).toEqual(["google"]);
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
