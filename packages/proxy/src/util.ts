export interface ModelResponse {
  stream: ReadableStream<Uint8Array> | null;
  response: Response;
}

export function parseAuthHeader(
  headers: Record<string, string | string[] | undefined>,
) {
  const authHeader = headers["authorization"];
  let authValue = null;
  if (Array.isArray(authHeader)) {
    authValue = authHeader[authHeader.length - 1];
  } else {
    authValue = authHeader;
  }

  if (!authValue) {
    return null;
  }

  const parts = authValue.split(" ");
  if (parts.length !== 2) {
    return null;
  }
  return parts[1];
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

export function parseFilenameFromUrl(url: string): string | undefined {
  try {
    // Handle empty string
    if (!url || url.trim() === "") {
      return undefined;
    }

    // Handle simple filenames without URLs directly
    if (!url.includes("/") && !url.includes("://")) {
      try {
        return decodeURIComponent(url);
      } catch (e) {
        return url;
      }
    }

    // For URLs without a protocol, add a dummy one to make URL parsing work
    const normalizedUrl = url.includes("://") ? url : `http://${url}`;

    // Use URL to parse complex URLs rather than string splitting
    const parsedUrl = new URL(normalizedUrl);

    // Extract the pathname
    const pathname = parsedUrl.pathname;

    // Special case: If hostname contains a file extension and path is empty or just "/"
    const hostnameMatch = parsedUrl.hostname.match(
      /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|json|xml|html?|zip|rar|gz|tar|7z)$/i,
    );
    if (hostnameMatch && (!pathname || pathname === "/")) {
      try {
        return decodeURIComponent(parsedUrl.hostname);
      } catch (e) {
        return parsedUrl.hostname;
      }
    }

    // If pathname is empty or just "/", there's no filename
    if (!pathname || pathname === "/") {
      return undefined;
    }

    // Get the last segment of the path and remove any query parameters
    const filename = pathname.split("/").pop();

    // Check if filename exists and remove fragment identifier if present
    if (filename) {
      try {
        return decodeURIComponent(filename.split("#")[0]);
      } catch (e) {
        return filename.split("#")[0];
      }
    }

    return undefined;
  } catch (error) {
    // If URL parsing fails (e.g., for invalid URLs), fall back to simple splitting
    if (!url || url.trim() === "") {
      return undefined;
    }

    if (!url.includes("/")) {
      try {
        return decodeURIComponent(url);
      } catch (e) {
        return url;
      }
    }

    const filename = url.split("/").pop()?.split("?")[0]?.split("#")[0];
    if (!filename) return undefined;

    try {
      return decodeURIComponent(filename);
    } catch (e) {
      return filename;
    }
  }
}
