import contentDisposition from "content-disposition";
export interface ModelResponse {
  stream: ReadableStream<Uint8Array> | null;
  response: Response;
}

export function parseAuthHeader(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const authHeader = headers["authorization"];
  let authValue = null;
  if (Array.isArray(authHeader)) {
    authValue = authHeader[authHeader.length - 1];
  } else {
    authValue = authHeader;
  }

  if (authValue) {
    const parts = authValue.split(" ");
    if (parts.length !== 2) {
      return null;
    }
    return parts[1];
  }

  // Anthropic uses x-api-key instead of authorization.
  const apiKeyHeader = headers["x-api-key"];
  if (apiKeyHeader) {
    return Array.isArray(apiKeyHeader)
      ? apiKeyHeader[apiKeyHeader.length - 1]
      : apiKeyHeader;
  }

  return null;
}

export function parseNumericHeader(
  headers: Record<string, string | string[] | undefined>,
  headerKey: string,
): number | null {
  let value = headers[headerKey];
  if (Array.isArray(value)) {
    value = value[value.length - 1];
  }

  if (value !== undefined) {
    try {
      return parseInt(value, 10);
    } catch (e) {}
  }

  return null;
}

// This is duplicated from app/utils/object.ts
export function isObject(value: any): value is { [key: string]: any } {
  return value instanceof Object && !(value instanceof Array);
}

export function getTimestampInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function flattenChunksArray(allChunks: Uint8Array[]): Uint8Array {
  const flatArray = new Uint8Array(allChunks.reduce((a, b) => a + b.length, 0));
  for (let i = 0, offset = 0; i < allChunks.length; i++) {
    flatArray.set(allChunks[i], offset);
    offset += allChunks[i].length;
  }
  return flatArray;
}

export function flattenChunks(allChunks: Uint8Array[]) {
  const flatArray = flattenChunksArray(allChunks);
  return new TextDecoder().decode(flatArray);
}

export function isEmpty(a: any): a is null | undefined {
  return a === undefined || a === null;
}

export function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

export class ProxyBadRequestError extends Error {
  constructor(public message: string) {
    super(message);
  }
}

export function parseFileMetadataFromUrl(
  url: string,
): { filename: string; contentType?: string; url: URL } | undefined {
  try {
    // Handle empty string
    if (!url || url.trim() === "") {
      return undefined;
    }

    // Use URL to parse complex URLs rather than string splitting
    let parsedUrl: URL | undefined;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return undefined;
    }

    // If the URL is not http(s), file cannot be accessed
    // If pathname is empty or ends with "/", there's no filename to extract
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return undefined;
    } else if (
      !parsedUrl.pathname ||
      parsedUrl.pathname === "/" ||
      parsedUrl.pathname.endsWith("/")
    ) {
      return undefined;
    }

    // Get the last segment of the path
    let filename = parsedUrl.pathname.split("/").pop();
    if (!filename) {
      return undefined;
    }

    let contentType = undefined;

    // Handle case where this is an S3 pre-signed URL
    if (parsedUrl.searchParams.get("X-Amz-Expires") !== null) {
      const disposition = contentDisposition.parse(
        parsedUrl.searchParams.get("response-content-disposition") || "",
      );
      filename = disposition.parameters.filename
        ? decodeURIComponent(disposition.parameters.filename)
        : filename;
      contentType =
        parsedUrl.searchParams.get("response-content-type") ?? undefined;
    }

    try {
      filename = decodeURIComponent(filename);
    } catch (e) {
      // If the filename is not valid UTF-8, we'll just return the original filename
    }

    return { filename, contentType, url: parsedUrl };
  } catch (e) {
    return undefined;
  }
}

export const writeToReadable = (response: string) => {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(response));
      controller.close();
    },
  });
};

export function _urljoin(...parts: string[]): string {
  return parts
    .map((x, i) =>
      x.replace(/^\//, "").replace(i < parts.length - 1 ? /\/$/ : "", ""),
    )
    .filter((x) => x.trim() !== "")
    .join("/");
}

export type ExperimentLogPartialArgs = Partial<{
  output: unknown;
  expected: unknown;
  error: unknown;
  tags: string[];
  scores: Record<string, number | null>;
  metadata: Record<string, unknown>;
  metrics: Record<string, unknown>;
  datasetRecordId: string;
  span_attributes: Record<string, unknown>;
}>;
