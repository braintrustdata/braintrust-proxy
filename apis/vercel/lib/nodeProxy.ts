import { once } from "node:events";
import { PassThrough } from "node:stream";

function errorFromUnknown(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function passThroughToReadableStream(
  passThrough: PassThrough,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      passThrough.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passThrough.on("end", () => {
        controller.close();
      });
      passThrough.on("error", (error) => {
        controller.error(error);
      });
    },
    cancel(reason) {
      passThrough.destroy(errorFromUnknown(reason));
    },
  });
}

export async function nodeStreamingResponseViaPassThrough({
  runProxy,
  getStatus,
  getHeaders,
  waitUntil,
}: {
  runProxy: (res: WritableStream<Uint8Array>) => Promise<void>;
  getStatus: () => number;
  getHeaders: () => Record<string, string>;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const passThrough = new PassThrough();

  let signalReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });

  let signalDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    signalDone = resolve;
  });

  let proxyError: unknown = undefined;

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      if (!passThrough.write(chunk)) {
        await once(passThrough, "drain");
      }
      signalReady();
    },
    close() {
      passThrough.end();
      signalReady();
      signalDone();
    },
    abort(reason) {
      passThrough.destroy(errorFromUnknown(reason));
      signalReady();
      signalDone();
    },
  });

  const proxyPromise = runProxy(writable).catch(async (error) => {
    proxyError = error;
    await writable.abort(error).catch(() => {});
  });

  const lifetimePromise = Promise.all([proxyPromise, done]);
  waitUntil?.(lifetimePromise);

  await Promise.race([ready, proxyPromise]);

  if (proxyError !== undefined) {
    return new Response(`${proxyError}`, {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response(passThroughToReadableStream(passThrough), {
    status: getStatus(),
    headers: getHeaders(),
  });
}
