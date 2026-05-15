import { ProxyBadRequestError } from "@braintrust/proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { proxyV1ToAppRouteResponseMock } = vi.hoisted(() => {
  return {
    proxyV1ToAppRouteResponseMock: vi.fn(),
  };
});

vi.mock("next/server", () => ({
  after: (callback: () => void | Promise<void>) => {
    void callback();
  },
}));

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@braintrust/proxy/edge", () => ({
  digestMessage: vi.fn(async (message: string) => message),
  encryptedGet: vi.fn(async () => null),
  encryptedPut: vi.fn(async () => {}),
  getCorsHeaders: vi.fn(() => ({})),
  makeFetchApiSecrets: vi.fn(() => vi.fn(async () => [])),
}));

vi.mock("../../../../lib/appRouteProxy", () => ({
  proxyV1ToAppRouteResponse: proxyV1ToAppRouteResponseMock,
}));

describe("vercel app route proxy handler", () => {
  beforeEach(() => {
    proxyV1ToAppRouteResponseMock.mockReset();
  });

  it("returns 400 for proxy bad request errors without exposing internal details", async () => {
    proxyV1ToAppRouteResponseMock.mockRejectedValueOnce(
      new ProxyBadRequestError("Missing Authentication header"),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.com/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "caller-controlled",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-request-id")).not.toBe("caller-controlled");
    await expect(response.json()).resolves.toMatchObject({
      error: "Internal server error",
    });
  });

  it("returns 500 for unexpected proxy errors", async () => {
    proxyV1ToAppRouteResponseMock.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.com/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Internal server error",
    });
  });
});
