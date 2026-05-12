import { afterEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { convertMediaToBase64 } from "./util";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const publicImageUrl = "https://93.184.216.34/image.png";

function mockFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("convertMediaToBase64", () => {
  afterEach(() => {
    vi.clearAllMocks();
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

  it("rejects hostnames that resolve to private addresses before fetching", async () => {
    const lookupMock = vi.mocked(lookup);
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
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

  it("revalidates redirect locations", async () => {
    const fetchMock = mockFetch(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/image.png" },
      }),
    );

    await expect(
      convertMediaToBase64({
        media: publicImageUrl,
        allowedMediaTypes: null,
        maxMediaBytes: null,
      }),
    ).rejects.toThrow("Media URL resolves to a blocked address");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("enforces the byte cap while reading the response body", async () => {
    mockFetch(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      convertMediaToBase64({
        media: publicImageUrl,
        allowedMediaTypes: ["image/png"],
        maxMediaBytes: 2,
      }),
    ).rejects.toThrow("Media size exceeds");
  });

  it("converts valid remote media responses", async () => {
    mockFetch(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png; charset=utf-8" },
      }),
    );

    await expect(
      convertMediaToBase64({
        media: publicImageUrl,
        allowedMediaTypes: ["image/png"],
        maxMediaBytes: 3,
      }),
    ).resolves.toEqual({
      media_type: "image/png",
      data: "AQID",
    });
  });
});
