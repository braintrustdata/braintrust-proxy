import { describe, expect, it } from "vitest";
import { APISecretSchema } from "./secrets";

describe("APISecretSchema passthrough compatibility", () => {
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

  it("still rejects schema violations", () => {
    const result = APISecretSchema.safeParse({
      type: "openai",
      metadata: {},
    });
    expect(result.success).toBe(false);
  });
});
