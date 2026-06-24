import { afterEach, describe, expect, it, vi } from "vitest";
import { convertMediaToBase64 } from "./util";

const dnsMocks = vi.hoisted(() => {
  const resolve4 = vi.fn(async (): Promise<string[]> => ["93.184.216.34"]);
  const resolve6 = vi.fn(async (): Promise<string[]> => []);

  class MockResolver {
    resolve4(hostname: string) {
      return resolve4(hostname);
    }

    resolve6(hostname: string) {
      return resolve6(hostname);
    }
  }

  return {
    Resolver: MockResolver,
    resolve4,
    resolve6,
  };
});

vi.mock("node:dns/promises", () => ({
  Resolver: dnsMocks.Resolver,
}));

function mockFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("convertMediaToBase64", () => {
  afterEach(() => {
    vi.clearAllMocks();
    dnsMocks.resolve4.mockResolvedValue(["93.184.216.34"]);
    dnsMocks.resolve6.mockResolvedValue([]);
    vi.unstubAllGlobals();
  });

  it("rejects non-http media URLs before fetching", async () => {
    const fetchMock = mockFetch(new Response());

    await expect(
      convertMediaToBase64({
        media: "file:///etc/passwd",
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL must use http or https");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects localhost media URLs before fetching", async () => {
    const fetchMock = mockFetch(new Response());

    await expect(
      convertMediaToBase64({
        media: "http://localhost/image.png",
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL resolves to a blocked address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects private IP media URLs before fetching", async () => {
    const fetchMock = mockFetch(new Response());

    await expect(
      convertMediaToBase64({
        media: "https://169.254.169.254/latest/meta-data",
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL resolves to a blocked address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 localhost URLs before fetching", async () => {
    const fetchMock = mockFetch(new Response());

    await expect(
      convertMediaToBase64({
        media: "http://[::ffff:127.0.0.1]/image.png",
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL resolves to a blocked address");
    await expect(
      convertMediaToBase64({
        media: "http://[::ffff:7f00:1]/image.png",
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL resolves to a blocked address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private addresses before fetching", async () => {
    dnsMocks.resolve4.mockResolvedValueOnce(["10.0.0.5"]);
    const fetchMock = mockFetch(new Response());

    await expect(
      convertMediaToBase64({
        media: "https://example.com/image.png",
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL resolves to a blocked address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches public hostname media with Cloudflare Worker fetch", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const fetchMock = mockFetch(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      convertMediaToBase64({
        media: "https://example.com/image.png",
        allowedMediaTypes: ["image/png"],
        maxMediaBytes: 3,
      }),
    ).resolves.toEqual({
      media_type: "image/png",
      data: "AQID",
    });
    expect(dnsMocks.resolve4).toHaveBeenCalledWith("example.com");
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/image.png", {
      method: "GET",
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects private hostname resolutions before Cloudflare Worker fetch", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    dnsMocks.resolve4.mockResolvedValueOnce(["10.0.0.5"]);
    const fetchMock = mockFetch(new Response());

    await expect(
      convertMediaToBase64({
        media: "https://example.com/image.png",
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL resolves to a blocked address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts base64 data URLs without remote fetching", async () => {
    const fetchMock = mockFetch(new Response());

    await expect(
      convertMediaToBase64({
        media: "data:image/png;base64,AQID",
        allowedMediaTypes: ["image/png"],
        maxMediaBytes: 3,
      }),
    ).resolves.toEqual({
      media_type: "image/png",
      data: "AQID",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
