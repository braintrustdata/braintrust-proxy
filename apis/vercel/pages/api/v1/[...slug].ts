import { kv } from "@vercel/kv";
import { NextFetchEvent, NextRequest } from "next/server";
import {
  proxyV1,
  ModelEndpointType,
  SecretRow,
  isEmpty,
  EncryptedMessage,
  decryptMessage,
  encryptMessage,
} from "@braintrust/proxy";

export const config = {
  runtime: "edge",
};

export default async function handler(
  request: NextRequest,
  ctx: NextFetchEvent
) {
  return await handleProxyV1(
    request,
    {
      BRAINTRUST_API_URL:
        process.env.BRAINTRUST_API_URL || "https://www.braintrustdata.com",
    },
    ctx
  );
}

interface Env {
  BRAINTRUST_API_URL: string;
}

async function handleProxyV1(
  request: Request,
  env: Env,
  ctx: NextFetchEvent
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const params = url.searchParams.getAll("slug");
  const relativeURL = "/" + params.map(encodeURIComponent).join("/");

  // Create an identity TransformStream (a.k.a. a pipe).
  // The readable side will become our new response body.
  let { readable, writable } = new TransformStream();

  let status = 200;

  let headers: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,OPTIONS,POST",
  };

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
    authToken: string,
    types: ModelEndpointType[],
    org_name?: string
  ): Promise<SecretRow[]> => {
    const cacheKey = await digestMessage(
      `${types.join("/")}/${org_name ? org_name + "/" : ""}${authToken}`
    );

    const response = await encryptedGet(cacheKey, cacheKey);
    if (response) {
      console.log("API KEY CACHE HIT");
      return JSON.parse(response);
    } else {
      console.log("API KEY CACHE MISS");
    }

    let secrets: SecretRow[] = [];
    // Only cache API keys for 60 seconds. This reduces the load on the database but ensures
    // that changes roll out quickly enough too.
    let ttl = 60;
    try {
      const response = await fetch(`${env.BRAINTRUST_API_URL}/api/secret`, {
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
      });
      if (response.ok) {
        secrets = await response.json();
      } else {
        console.warn("Failed to lookup api key", await response.text());
      }
    } catch (e) {
      console.warn("Failed to lookup api key. Falling back to provided key", e);
    }

    if (secrets.length === 0) {
      secrets.push({
        secret: authToken,
        type: types[0],
      });
    }

    ctx.waitUntil(
      encryptedPut(cacheKey, cacheKey, JSON.stringify(secrets), {
        ttl,
      })
    );

    return secrets;
  };

  const cachePut = async (
    encryptionKey: string,
    key: string,
    value: string
  ) => {
    ctx.waitUntil(
      encryptedPut(encryptionKey, key, value, {
        // 1 week
        ttl: 60 * 60 * 24 * 7,
      })
    );
  };

  const digestMessage = async (message: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Buffer.from(hash).toString("base64");
  };

  try {
    await proxyV1(
      request.method,
      relativeURL,
      proxyHeaders,
      await request.text(),
      setHeader,
      setStatus,
      writable,
      fetchApiSecrets,
      encryptedGet,
      cachePut,
      digestMessage
    );
  } catch (e) {
    return new Response(`${e}`, {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response(readable, {
    status,
    headers,
  });
}

// We rely on the fact that Upstash will automatically serialize and deserialize things for us
async function encryptedGet(encryptionKey: string, key: string) {
  const message = await kv.get<EncryptedMessage>(key);
  if (isEmpty(message)) {
    return null;
  }

  return await decryptMessage(encryptionKey, message.iv, message.data);
}

async function encryptedPut(
  encryptionKey: string,
  key: string,
  value: string,
  options?: { ttl?: number }
) {
  options = options || {};

  const encryptedValue = await encryptMessage(encryptionKey, value);
  const setOptions =
    options.ttl !== undefined
      ? {
          ex: options.ttl,
        }
      : {};
  await kv.set(key, JSON.stringify(encryptedValue), setOptions);
}
