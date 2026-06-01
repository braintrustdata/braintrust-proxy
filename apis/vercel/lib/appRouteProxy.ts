import { proxyV1 } from "@braintrust/proxy";

type ProxyV1Args = Parameters<typeof proxyV1>[0];
type GetApiSecrets = ProxyV1Args["getApiSecrets"];

function normalizeError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  return new Error(String(reason));
}

export async function proxyV1ToAppRouteResponse({
  method,
  url,
  proxyHeaders,
  body,
  initialHeaders,
  getApiSecrets,
  cacheGet,
  cachePut,
  digest,
  proxyImpl = proxyV1,
}: {
  method: "GET" | "POST";
  url: string;
  proxyHeaders: Record<string, string>;
  body: string;
  initialHeaders?: HeadersInit;
  getApiSecrets: GetApiSecrets;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttlSeconds?: number,
  ) => Promise<void>;
  digest: (message: string) => Promise<string>;
  proxyImpl?: typeof proxyV1;
}): Promise<{
  response: Response;
  completed: Promise<void>;
}> {
  const headers = new Headers(initialHeaders);
  let status = 200;
  let proxyError: unknown = undefined;

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  let resolveCompleted: () => void = () => {};
  let rejectCompleted: (error: Error) => void = () => {};
  const completed = new Promise<void>((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = (error) => reject(error);
  });

  let readyScheduled = false;
  const scheduleReady = () => {
    if (readyScheduled) {
      return;
    }

    readyScheduled = true;
    queueMicrotask(resolveReady);
  };

  const abortController = new AbortController();

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          scheduleReady();
          controller.enqueue(chunk);
        },
        close() {
          scheduleReady();
          controller.close();
          resolveCompleted();
        },
        abort(reason) {
          scheduleReady();
          const error = normalizeError(reason);
          controller.error(error);
          rejectCompleted(error);
        },
      });

      void proxyImpl({
        method,
        url,
        proxyHeaders,
        body,
        setHeader(name, value) {
          headers.set(name, value);
        },
        setStatusCode(code) {
          status = code;
        },
        res: writable,
        getApiSecrets,
        cacheGet,
        cachePut,
        digest,
        decompressFetch: true,
        signal: abortController.signal,
      }).catch((error) => {
        proxyError = error;
        scheduleReady();
        const normalizedError = normalizeError(error);
        controller.error(normalizedError);
        rejectCompleted(normalizedError);
      });
    },
    cancel(reason) {
      abortController.abort(normalizeError(reason));
    },
  });

  await ready;

  if (proxyError !== undefined) {
    throw proxyError;
  }

  return {
    response: new Response(readable, {
      status,
      headers,
    }),
    completed,
  };
}
