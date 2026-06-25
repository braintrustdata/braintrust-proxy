import { describe, expect, it } from "vitest";
import { isProviderRateLimit } from "./tests";

describe("isProviderRateLimit", () => {
  it("detects rate-limit / overloaded status codes", () => {
    expect(isProviderRateLimit(429, "")).toBe(true);
    expect(isProviderRateLimit(503, "")).toBe(true); // proxy OVERLOADED_ERROR_CODE
    expect(isProviderRateLimit(529, "")).toBe(true); // Anthropic overloaded
  });

  it("detects the proxy's wrapped 'AI provider returned <code> error' text", () => {
    expect(
      isProviderRateLimit(
        200,
        "AI provider returned 503 error:\n\nupstream body\n\nHeaders:\n...",
      ),
    ).toBe(true);
    expect(isProviderRateLimit(200, "AI provider returned 429 error:")).toBe(
      true,
    );
  });

  it("detects rate-limit / overloaded error bodies", () => {
    expect(
      isProviderRateLimit(200, '{"error":{"type":"overloaded_error"}}'),
    ).toBe(true);
    expect(
      isProviderRateLimit(200, '{"error":{"type":"rate_limit_error"}}'),
    ).toBe(true);
    expect(isProviderRateLimit(200, "Too Many Requests")).toBe(true);
  });

  it("does not flag non-rate-limit failures", () => {
    expect(isProviderRateLimit(400, "invalid model identifier")).toBe(false);
    expect(
      isProviderRateLimit(401, '{"error":{"type":"authentication_error"}}'),
    ).toBe(false);
    expect(
      isProviderRateLimit(200, "AI provider returned 400 error: bad request"),
    ).toBe(false);
    expect(isProviderRateLimit(200, "")).toBe(false);
  });
});
