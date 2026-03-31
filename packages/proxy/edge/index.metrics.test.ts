import { afterEach, describe, expect, it, vi } from "vitest";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

const flushMetricsMock = vi.fn(async (_meterProvider: MeterProvider) => {});
const proxyV1Mock = vi.fn();

vi.mock("@lib/metrics", () => ({
  flushMetrics: flushMetricsMock,
}));

vi.mock("@lib/proxy", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/proxy")>("@lib/proxy");
  return {
    ...actual,
    proxyV1: proxyV1Mock,
  };
});

describe("EdgeProxyV1 metric flushing", () => {
  afterEach(() => {
    flushMetricsMock.mockClear();
    proxyV1Mock.mockReset();
    vi.restoreAllMocks();
  });

  it("flushes metrics after the response body completes", async () => {
    const { EdgeProxyV1 } = await import("./index");

    proxyV1Mock.mockImplementation(
      async ({ res }: { res: WritableStream<Uint8Array> }) => {
        const writer = res.getWriter();
        queueMicrotask(() => {
          void writer
            .write(new TextEncoder().encode("ok"))
            .then(() => writer.close());
        });
      },
    );

    const meterProvider = new MeterProvider();
    const waitUntilPromises: Promise<unknown>[] = [];
    const handler = EdgeProxyV1({
      getRelativeURL() {
        return "/chat/completions";
      },
      meterProvider,
    });

    const response = await handler(
      new Request("https://example.com/v1/chat/completions", {
        method: "POST",
        body: "{}",
        headers: {
          Authorization: "Bearer test-token",
        },
      }),
      {
        waitUntil(promise) {
          waitUntilPromises.push(promise);
        },
      },
    );

    expect(flushMetricsMock).not.toHaveBeenCalled();
    expect(waitUntilPromises).toHaveLength(0);

    await expect(response.text()).resolves.toBe("ok");

    expect(flushMetricsMock).toHaveBeenCalledWith(meterProvider);
    expect(waitUntilPromises).toHaveLength(1);
    await Promise.all(waitUntilPromises);
  });
});
