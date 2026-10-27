import { describe, expect, it } from "vitest";
import {
  customApiKeyAuthHeader,
  customApiKeyAuthSettings,
} from "./custom-api-key-auth";

const metadata = {
  api_base: "https://gateway.example/v1",
  api_key_header: "ApiKey",
};

describe("custom API-key authentication", () => {
  it.each([
    { auth_prefix: "Token" },
    { auth_header: "apikey" },
    { auth_header: "apikey", auth_prefix: "" },
  ])(
    "leaves legacy Gateway authentication settings unchanged: %j",
    (metadata) => {
      expect(customApiKeyAuthSettings(metadata, "openai")).toBeUndefined();
      expect(customApiKeyAuthSettings(metadata, "mistral")).toBeUndefined();
    },
  );
  it("keeps existing authentication when settings are absent", () => {
    expect(customApiKeyAuthSettings(undefined)).toBeUndefined();
    expect(
      customApiKeyAuthSettings({ api_key_header: "", api_key_prefix: "" }),
    ).toBeUndefined();
  });

  it("uses the current key without changing metadata", () => {
    const before = JSON.stringify(metadata);
    for (const key of ["first-key+/=&<>\"'", "replacement-key+/=&"]) {
      expect(customApiKeyAuthHeader(metadata, "openai", key)).toEqual([
        "apikey",
        key,
      ]);
      expect(JSON.stringify(metadata)).toEqual(before);
    }
  });

  it.each([
    { api_key_header: "bad header" },
    { api_key_header: "apikey\r\nother" },
    { api_key_header: 12 },
    { api_key_prefix: " Bearer" },
    { api_key_prefix: "Bearer " },
    { api_key_prefix: "Bearer\r\n" },
    { api_key_prefix: 12 },
    { api_base: undefined },
    { auth_type: "oauth_bearer" },
    { auth_type: "workload_identity_federation" },
    { additionalHeaders: { APIKEY: "duplicate" } },
    { additionalHeaders: { Authorization: "duplicate" } },
  ])("rejects invalid settings: %j", (overrides) => {
    expect(() =>
      customApiKeyAuthSettings({ ...metadata, ...overrides }, "openai"),
    ).toThrow();
  });

  it("rejects other provider types", () => {
    expect(() => customApiKeyAuthSettings(metadata, "azure")).toThrow(
      "OpenAI-compatible",
    );
  });

  it.each([null, "", "invalid\r\ncredential", " padded-key "])(
    "rejects missing or invalid credentials without including the value",
    (key) => {
      expect(() =>
        customApiKeyAuthHeader(metadata, "openai", key),
      ).toThrowError(
        new Error(
          "Custom authentication requires a nonempty API key containing valid header characters",
        ),
      );
    },
  );
});

it("does not echo invalid authentication setting values", () => {
  expect(() =>
    customApiKeyAuthSettings(
      { ...metadata, api_key_prefix: "private-value\r\n" },
      "openai",
    ),
  ).toThrowError(new Error("Invalid authentication prefix"));
});
