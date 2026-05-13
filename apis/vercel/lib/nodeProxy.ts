import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { proxyV1 } from "@braintrust/proxy";

type GetApiSecrets = (
  useCache: boolean,
  authToken: string,
  model: string | null,
  orgName?: string,
  projectId?: string,
) => Promise<
  {
    secret: string;
    type: string;
    org_name?: string | null;
    metadata?: Record<string, unknown> | null;
  }[]
>;

export async function readRawRequestBody(
  req: NodeJS.ReadableStream,
): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk),
    );
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function proxyV1ToNodeResponse({
  method,
  url,
  proxyHeaders,
  body,
  setHeader,
  setStatusCode,
  getApiSecrets,
  cacheGet,
  cachePut,
  digest,
  getRes,
  proxyImpl = proxyV1,
}: {
  method: "GET" | "POST";
  url: string;
  proxyHeaders: Record<string, string>;
  body: string;
  setHeader: (name: string, value: string) => void;
  setStatusCode: (code: number) => void;
  getApiSecrets: GetApiSecrets;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttlSeconds?: number,
  ) => Promise<void>;
  digest: (message: string) => Promise<string>;
  getRes: () => Writable;
  proxyImpl?: typeof proxyV1;
}) {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const nodeReadable = Readable.fromWeb(readable);
  const res = getRes();

  const proxyPromise = proxyImpl({
    method,
    url,
    proxyHeaders,
    body,
    setHeader,
    setStatusCode,
    res: writable,
    getApiSecrets,
    cacheGet,
    cachePut,
    digest,
  }).catch(async (error) => {
    await writable.abort(error).catch(() => {});
    throw error;
  });

  await Promise.all([proxyPromise, pipeline(nodeReadable, res)]);
}
