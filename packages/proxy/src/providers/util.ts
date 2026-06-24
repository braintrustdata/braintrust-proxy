import { Resolver } from "node:dns/promises";
import { type IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { arrayBufferToBase64 } from "utils";

const base64MediaPattern =
  /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/;
const maxRedirects = 3;
const mediaFetchTimeoutMs = 30_000;

export interface MediaBlock {
  media_type: string;
  data: string;
}

interface ValidatedMediaUrl {
  address: string;
  transport: "fetch" | "node";
  url: URL;
}

export function convertBase64Media(media: string): MediaBlock | null {
  const match = media.match(base64MediaPattern);
  if (!match) {
    return null;
  }

  const [, media_type, data] = match;
  return {
    media_type,
    data,
  };
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function parseIPv4Address(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let parsed = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }

    const value = Number(part);
    if (value < 0 || value > 255) {
      return null;
    }

    parsed = parsed * 256 + value;
  }

  return parsed;
}

function isIPv4InRange(address: number, base: number, prefixLength: number) {
  const mask =
    prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (address & mask) === (base & mask);
}

function isBlockedIPv4Address(address: string): boolean {
  const parsed = parseIPv4Address(address);
  if (parsed === null) {
    return false;
  }

  return [
    { base: "0.0.0.0", prefixLength: 8 },
    { base: "10.0.0.0", prefixLength: 8 },
    { base: "100.64.0.0", prefixLength: 10 },
    { base: "127.0.0.0", prefixLength: 8 },
    { base: "169.254.0.0", prefixLength: 16 },
    { base: "172.16.0.0", prefixLength: 12 },
    { base: "192.0.0.0", prefixLength: 24 },
    { base: "192.168.0.0", prefixLength: 16 },
    { base: "198.18.0.0", prefixLength: 15 },
    { base: "224.0.0.0", prefixLength: 4 },
    { base: "240.0.0.0", prefixLength: 4 },
  ].some(({ base, prefixLength }) => {
    const parsedBase = parseIPv4Address(base);
    return (
      parsedBase !== null && isIPv4InRange(parsed, parsedBase, prefixLength)
    );
  });
}

function parseFirstIPv6Segment(address: string): number | null {
  const firstSegment = address.split(":")[0];
  if (!/^[0-9a-f]{1,4}$/i.test(firstSegment)) {
    return null;
  }

  return Number.parseInt(firstSegment, 16);
}

function parseIPv4MappedIPv6Address(address: string): string | null {
  const mappedPrefix = "::ffff:";
  const normalized = normalizeHostname(address);
  if (!normalized.startsWith(mappedPrefix)) {
    return null;
  }

  const mappedAddress = normalized.slice(mappedPrefix.length);
  if (parseIPv4Address(mappedAddress) !== null) {
    return mappedAddress;
  }

  const parts = mappedAddress.split(":");
  if (parts.length !== 2) {
    return null;
  }

  const parsedParts = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return null;
    }
    return Number.parseInt(part, 16);
  });
  if (parsedParts.some((part) => part === null)) {
    return null;
  }

  const [high, low] = parsedParts;
  if (high === null || low === null) {
    return null;
  }

  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(
    ".",
  );
}

function isBlockedIPv6Address(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const mappedIPv4Address = parseIPv4MappedIPv6Address(normalized);
  if (mappedIPv4Address !== null) {
    return isBlockedIPv4Address(mappedIPv4Address);
  }

  const firstSegment = parseFirstIPv6Segment(normalized);
  if (firstSegment === null) {
    return false;
  }

  return (
    (firstSegment & 0xfe00) === 0xfc00 ||
    (firstSegment & 0xffc0) === 0xfe80 ||
    (firstSegment & 0xff00) === 0xff00
  );
}

function isBlockedIPAddress(address: string): boolean {
  return isBlockedIPv4Address(address) || isBlockedIPv6Address(address);
}

function shouldUseFetchTransport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

function dnsErrorCode(error: unknown): string | undefined {
  const code =
    error !== null && typeof error === "object"
      ? Object.getOwnPropertyDescriptor(error, "code")?.value
      : undefined;
  return typeof code === "string" ? code : undefined;
}

function dnsRecordNotFound(error: unknown): boolean {
  const code = dnsErrorCode(error);
  return code === "ENODATA" || code === "ENOTFOUND";
}

async function resolveHostnameAddresses(hostname: string): Promise<string[]> {
  const resolver = new Resolver();
  const results = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ]);
  const addresses: string[] = [];
  const errors: unknown[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      addresses.push(...result.value);
      continue;
    }

    if (!dnsRecordNotFound(result.reason)) {
      errors.push(result.reason);
    }
  }

  if (addresses.length > 0) {
    return addresses;
  }
  if (errors.length > 0) {
    throw errors[0];
  }
  return [];
}

function nodeHeadersToHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item);
      }
      continue;
    }
    result.set(name, value);
  }
  return result;
}

async function validateMediaUrl(url: URL): Promise<ValidatedMediaUrl> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Media URL must use http or https");
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname === "localhost" || isBlockedIPAddress(hostname)) {
    throw new Error("Media URL resolves to a blocked address");
  }

  // Cloudflare Workers reject media requests sent through the Node transport
  // even after DNS validation succeeds, while their native fetch path works.
  const transport = shouldUseFetchTransport() ? "fetch" : "node";
  if (parseIPv4Address(hostname) !== null || hostname.includes(":")) {
    return { address: hostname, transport, url };
  }

  const addresses = await resolveHostnameAddresses(hostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => isBlockedIPAddress(address))
  ) {
    throw new Error("Media URL resolves to a blocked address");
  }

  return {
    address: transport === "node" ? addresses[0] : hostname,
    transport,
    url,
  };
}

async function readResponseBytes(
  response: Response,
  maxMediaBytes: number | null,
): Promise<ArrayBuffer> {
  if (!response.body) {
    throw new Error("Failed to read media response body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (maxMediaBytes !== null && totalBytes > maxMediaBytes) {
      await reader.cancel();
      throw new Error(
        `Media size exceeds the ${maxMediaBytes / 1024 / 1024} MB limit`,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes.buffer;
}

async function fetchMediaUrl(
  url: URL,
  signal: AbortSignal,
  redirectCount = 0,
): Promise<Response> {
  const target = await validateMediaUrl(url);
  const response = await fetchValidatedMediaUrl(target, signal);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Media URL redirect missing location header");
    }
    if (redirectCount >= maxRedirects) {
      throw new Error("Media URL exceeded redirect limit");
    }

    return await fetchMediaUrl(
      new URL(location, url),
      signal,
      redirectCount + 1,
    );
  }

  return response;
}

async function fetchValidatedMediaUrl(
  { address, transport, url }: ValidatedMediaUrl,
  signal: AbortSignal,
): Promise<Response> {
  if (transport === "fetch") {
    return await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
    });
  }

  return await new Promise((resolve, reject) => {
    const hostname = normalizeHostname(url.hostname);
    const servername =
      parseIPv4Address(hostname) === null && !hostname.includes(":")
        ? url.hostname
        : undefined;
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        headers: {
          Host: url.host,
        },
        hostname: address,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        protocol: url.protocol,
        servername,
      },
      (response) => {
        resolve(
          new Response(Readable.toWeb(response), {
            headers: nodeHeadersToHeaders(response.headers),
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
          }),
        );
      },
    );

    request.on("error", reject);
    signal.addEventListener(
      "abort",
      () => {
        request.destroy(new Error("Media fetch aborted"));
      },
      { once: true },
    );
    request.end();
  });
}

async function convertMediaUrl({
  url,
  allowedMediaTypes,
  maxMediaBytes,
}: {
  url: string;
  allowedMediaTypes: string[] | null;
  maxMediaBytes: number | null;
}): Promise<MediaBlock> {
  const parsedUrl = new URL(url);
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    mediaFetchTimeoutMs,
  );
  try {
    const response = await fetchMediaUrl(parsedUrl, abortController.signal);
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType) {
      throw new Error("Failed to get content type of the media");
    }
    const baseContentType = contentType.split(";")[0].trim();
    if (
      allowedMediaTypes !== null &&
      !allowedMediaTypes.includes(baseContentType)
    ) {
      throw new Error(`Unsupported media type: ${baseContentType}`);
    }

    const arrayBuffer = await readResponseBytes(response, maxMediaBytes);

    const data = arrayBufferToBase64(arrayBuffer);

    return {
      media_type: baseContentType,
      data,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function convertMediaToBase64({
  media,
  allowedMediaTypes,
  maxMediaBytes,
}: {
  media: string;
  allowedMediaTypes: string[] | null;
  maxMediaBytes: number | null;
}): Promise<MediaBlock> {
  const mediaBlock = convertBase64Media(media);
  if (mediaBlock) {
    return mediaBlock;
  } else {
    return await convertMediaUrl({
      url: media,
      allowedMediaTypes,
      maxMediaBytes,
    });
  }
}

export function base64ToUrl(base64: MediaBlock): string {
  return `data:${base64.media_type};base64,${base64.data}`;
}
