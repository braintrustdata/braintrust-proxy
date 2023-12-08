import { DEFAULT_BRAINTRUST_API_URL } from "@lib/constants";
import { decryptMessage, encryptMessage, EncryptedMessage } from "@lib/encrypt";
import { flushMetrics } from "@lib/metrics";
import { proxyV1 } from "@lib/proxy";
import { isEmpty } from "@lib/util";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

import { ModelEndpointType, APISecret } from "@schema";

export { FlushingExporter } from "./exporter";

export interface EdgeContext {
  waitUntil(promise: Promise<any>): void;
}

export interface CacheSetOptions {
  ttl?: number;
}
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>;
}

export interface ProxyOpts {
  getRelativeURL(request: Request): string;
  cors?: boolean;
  credentialsCache?: Cache;
  completionsCache?: Cache;
  braintrustApiUrl?: string;
  meterProvider?: MeterProvider;
}

export function EdgeProxyV1(opts: ProxyOpts) {
  const meterProvider = opts.meterProvider;
  return async (request: Request, ctx: EdgeContext) => {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const relativeURL = opts.getRelativeURL(request);

    // Create an identity TransformStream (a.k.a. a pipe).
    // The readable side will become our new response body.
    let { readable, writable } = new TransformStream();

    let status = 200;

    let headers: Record<string, string> = opts.cors
      ? {
          "access-control-allow-origin": "*",
          "access-control-allow-credentials": "true",
          "access-control-allow-methods": "GET,OPTIONS,POST",
        }
      : {};

    const setStatus = (code: number) => {
      status = code;
    };
    const setHeader = (name: string, value: string) => {
      headers[name] = value;
    };

    const proxyHeaders: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      proxyHeaders[name] = value;
    });

    const fetchApiSecrets = async (
      useCache: boolean,
      authToken: string,
      types: ModelEndpointType[],
      org_name?: string,
    ): Promise<APISecret[]> => {
      const cacheKey = await digestMessage(
        `${types.join(":")}/${org_name ? org_name + ":" : ""}${authToken}`,
      );

      const response =
        useCache &&
        opts.credentialsCache &&
        (await encryptedGet(opts.credentialsCache, cacheKey, cacheKey));
      if (response) {
        console.log("API KEY CACHE HIT");
        return JSON.parse(response);
      } else {
        console.log("API KEY CACHE MISS");
      }

      let secrets: APISecret[] = [];
      let lookupFailed = false;
      // Only cache API keys for 60 seconds. This reduces the load on the database but ensures
      // that changes roll out quickly enough too.
      let ttl = 60;
      try {
        const response = await fetch(
          `${opts.braintrustApiUrl || DEFAULT_BRAINTRUST_API_URL}/api/secret`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              types,
              org_name,
              mode: "full",
            }),
          },
        );
        if (response.ok) {
          secrets = await response.json();
        } else {
          lookupFailed = true;
          console.warn("Failed to lookup api key", await response.text());
        }
      } catch (e) {
        lookupFailed = true;
        console.warn(
          "Failed to lookup api key. Falling back to provided key",
          e,
        );
      }

      if (lookupFailed) {
        secrets.push({
          secret: authToken,
          type: types[0],
        });
      }

      if (opts.credentialsCache) {
        ctx.waitUntil(
          encryptedPut(
            opts.credentialsCache,
            cacheKey,
            cacheKey,
            JSON.stringify(secrets),
            {
              ttl,
            },
          ),
        );
      }

      return secrets;
    };

    const cacheGet = async (encryptionKey: string, key: string) => {
      if (opts.completionsCache) {
        return await encryptedGet(opts.completionsCache, encryptionKey, key);
      } else {
        return null;
      }
    };

    const cachePut = async (
      encryptionKey: string,
      key: string,
      value: string,
    ) => {
      if (opts.completionsCache) {
        ctx.waitUntil(
          encryptedPut(opts.completionsCache, encryptionKey, key, value, {
            // 1 week
            ttl: 60 * 60 * 24 * 7,
          }),
        );
      }
    };

    const digestMessage = async (message: string) => {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      const hash = await crypto.subtle.digest("SHA-256", data);
      return btoa(String.fromCharCode(...new Uint8Array(hash)));
    };

    try {
      await proxyV1({
        method: request.method,
        url: relativeURL,
        proxyHeaders,
        body: await request.text(),
        setHeader,
        setStatusCode: setStatus,
        res: writable,
        getApiSecrets: fetchApiSecrets,
        cacheGet,
        cachePut,
        digest: digestMessage,
        meterProvider,
      });
    } catch (e) {
      return new Response(`${e}`, {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });
    } finally {
      if (meterProvider) {
        ctx.waitUntil(flushMetrics(meterProvider));
      }
    }

    return new Response(readable, {
      status,
      headers,
    });
  };
}

// We rely on the fact that Upstash will automatically serialize and deserialize things for us
async function encryptedGet(cache: Cache, encryptionKey: string, key: string) {
  const message = await cache.get<EncryptedMessage>(key);
  if (isEmpty(message)) {
    return null;
  }

  return await decryptMessage(encryptionKey, message.iv, message.data);
}

async function encryptedPut(
  cache: Cache,
  encryptionKey: string,
  key: string,
  value: string,
  options?: { ttl?: number },
) {
  options = options || {};

  const encryptedValue = await encryptMessage(encryptionKey, value);
  await cache.set(key, encryptedValue, options);
}
