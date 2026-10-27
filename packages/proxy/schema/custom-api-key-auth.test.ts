import { describe, expect, it } from "vitest";
import {
  customApiKeyAuthHeader,
  customApiKeyAuthSettings,
} from "./custom-api-key-auth";

const metadata = {
  api_base: "https://gateway.example/v1",
  auth_header: "ApiKey",
};

describe("custom API-key authentication", () => {
  it("keeps existing authentication when settings are absent", () => {
    expect(customApiKeyAuthSettings(undefined)).toBeUndefined();
    expect(
      customApiKeyAuthSettings({ auth_header: "", auth_prefix: "" }),
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
    { auth_header: "bad header" },
    { auth_header: "apikey\r\nother" },
    { auth_header: 12 },
    { auth_prefix: " Bearer" },
    { auth_prefix: "Bearer " },
    { auth_prefix: "Bearer\r\n" },
    { auth_prefix: 12 },
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
      { ...metadata, auth_prefix: "private-value\r\n" },
      "openai",
    ),
  ).toThrowError(new Error("Invalid authentication prefix"));
});
