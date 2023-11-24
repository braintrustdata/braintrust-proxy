import {
  createParser,
  type EventSourceParser,
  type ParsedEvent,
  type ReconnectInterval,
} from "eventsource-parser";

import {
  AvailableModels,
  Message,
  MessageTypeToMessageType,
  EndpointProviderToBaseURL,
  buildAnthropicPrompt,
  translateParams,
  ModelEndpointType,
  getModelEndpointTypes,
  ModelFormat,
  APISecret,
} from "@schema";
import {
  flattenChunks,
  getRandomInt,
  isEmpty,
  isObject,
  parseAuthHeader,
} from "./util";
import {
  anthropicCompletionToOpenAICompletion,
  anthropicEventToOpenAIEvent,
} from "./providers/anthropic";

interface CachedData {
  headers: Record<string, string>;
  body: string;
}

const CACHE_HEADER = "x-bt-use-cache";
const CREDS_CACHE_HEADER = "x-bt-use-creds-cache";
const ORG_NAME_HEADER = "x-bt-org-name";
const ENDPOINT_NAME = "x-bt-endpoint-name";

// This is an isomorphic implementation of proxyV1, which is used by both edge functions
// in CloudFlare and by the node proxy (locally and in lambda).
export async function proxyV1(
  method: "GET" | "POST",
  url: string,
  proxyHeaders: Record<string, string>,
  body: string,
  setHeader: (name: string, value: string) => void,
  setStatusCode: (code: number) => void,
  res: WritableStream<Uint8Array>,
  getApiSecrets: (
    useCache: boolean,
    authToken: string,
    types: ModelEndpointType[],
    org_name?: string
  ) => Promise<APISecret[]>,
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>,
  cachePut: (encryptionKey: string, key: string, value: string) => void,
  digest: (message: string) => Promise<string>
): Promise<void> {
  proxyHeaders = Object.fromEntries(
    Object.entries(proxyHeaders).map(([k, v]) => [k.toLowerCase(), v])
  );
  const headers: Record<string, string> = {
    ...proxyHeaders,
  };
  for (const h of Object.keys(headers)) {
    const hLower = h.toLowerCase();
    if (
      hLower.startsWith("x-amzn") ||
      hLower == CACHE_HEADER ||
      hLower == CREDS_CACHE_HEADER ||
      hLower == "content-length"
    ) {
      delete headers[h];
    }
  }

  const authToken = parseAuthHeader(proxyHeaders);
  if (!authToken) {
    throw new Error("Missing Authentication header");
  }

  // Caching is enabled by default, but let the user disable it
  const useCacheModeHeader =
    proxyHeaders[CACHE_HEADER] && proxyHeaders[CACHE_HEADER].toLowerCase();
  if (
    useCacheModeHeader &&
    !(
      useCacheModeHeader === "auto" ||
      useCacheModeHeader === "always" ||
      useCacheModeHeader === "never"
    )
  ) {
    throw new Error(
      `Invalid ${CACHE_HEADER} header '${useCacheModeHeader}'. Must be one of auto, always, or never`
    );
  }
  const useCacheMode = parseCacheModeHeader(
    CACHE_HEADER,
    proxyHeaders[CACHE_HEADER]
  );
  const useCredentialsCacheMode = parseCacheModeHeader(
    CACHE_HEADER,
    proxyHeaders[CREDS_CACHE_HEADER]
  );

  const cacheableEndpoint =
    url === "/embeddings" ||
    url === "/chat/completions" ||
    url === "/completions";

  let bodyData = null;
  if (url === "/chat/completions" || url === "/completions") {
    try {
      bodyData = JSON.parse(body);
    } catch (e) {
      console.warn("Failed to parse body. This doesn't really matter", e);
    }
  }

  // According to https://platform.openai.com/docs/api-reference, temperature is
  // a parameter for audio completions and chat completions, and defaults to
  // non-zero for completions, so unless it's set to zero, we can't cache it.
  //
  // OpenAI now allows you to set a seed, and if that is set, we should cache even
  // if temperature is non-zero.
  const temperatureNonZero =
    bodyData &&
    bodyData.temperature !== 0 &&
    (bodyData.seed === undefined || bodyData.seed === null);

  const useCache =
    cacheableEndpoint &&
    useCacheMode !== "never" &&
    (useCacheMode === "always" || !temperatureNonZero);

  const orgName = headers[ORG_NAME_HEADER];
  const endpointName = headers[ENDPOINT_NAME];

  const cacheKey =
    "aiproxy/proxy/v1:" +
    (await digest(
      JSON.stringify({
        url,
        body,
        authToken,
        orgName,
        endpointName,
      })
    ));

  const encryptionKey = await digest(`${authToken}:${orgName || ""}`);

  let stream: ReadableStream<Uint8Array> | null = null;
  if (useCache) {
    const cached = await cacheGet(encryptionKey, cacheKey);
    if (cached !== null) {
      const cachedData: CachedData = JSON.parse(cached);

      for (const [name, value] of Object.entries(cachedData.headers)) {
        setHeader(name, value);
      }
      setHeader("x-cached", "true");

      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(cachedData.body));
          controller.close();
        },
      });
    }
  }

  if (stream === null) {
    const { response: proxyResponse, stream: proxyStream } =
      await fetchModelLoop(method, url, headers, body, async (types) => {
        const secrets = await getApiSecrets(
          useCredentialsCacheMode !== "never",
          authToken,
          types,
          orgName
        );
        if (endpointName) {
          return secrets.filter((s) => s.name === endpointName);
        } else {
          return secrets;
        }
      });
    stream = proxyStream;

    if (!proxyResponse.ok) {
      setStatusCode(proxyResponse.status);
    }

    const proxyResponseHeaders: Record<string, string> = {};
    proxyResponse.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (
        lowerName === "content-length" ||
        lowerName === "content-encoding" ||
        lowerName === "transfer-encoding" ||
        lowerName === "connection" ||
        lowerName === "keep-alive" ||
        lowerName === "date" ||
        lowerName === "server" ||
        lowerName === "vary" ||
        lowerName === "cache-control" ||
        lowerName === "pragma" ||
        lowerName === "expires" ||
        lowerName === "access-control-allow-origin" ||
        lowerName === "access-control-allow-credentials" ||
        lowerName === "access-control-expose-headers" ||
        lowerName === "access-control-max-age" ||
        lowerName === "access-control-allow-methods" ||
        lowerName === "access-control-allow-headers"
      ) {
        return;
      }
      proxyResponseHeaders[name] = value;
    });

    for (const [name, value] of Object.entries(proxyResponseHeaders)) {
      setHeader(name, value);
    }
    setHeader("x-cached", "false");

    if (stream && proxyResponse.ok && useCache) {
      const allChunks: Uint8Array[] = [];
      const cacheStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          allChunks.push(chunk);
          controller.enqueue(chunk);
        },
        async flush(controller) {
          const text = flattenChunks(allChunks);
          cachePut(
            encryptionKey,
            cacheKey,
            JSON.stringify({ headers: proxyResponseHeaders, body: text })
          );
        },
      });

      stream = stream.pipeThrough(cacheStream);
    }
  }

  if (stream) {
    stream.pipeTo(res);
  } else {
    res.close();
  }
}

interface ModelResponse {
  stream: ReadableStream<Uint8Array> | null;
  response: Response;
}

const RETRY_ERROR_CODES = [
  // 404 means the model or endpoint doesn't exist. We may want to propagate these errors, or
  // report them elsewhere, but for now round robin.
  404,

  // 429 is rate limiting. We may want to track stats about this and potentially handle more
  // intelligently, eg if all APIs are rate limited, back off and try something else.
  429,
];

async function fetchModelLoop(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body: string,
  getApiSecrets: (types: ModelEndpointType[]) => Promise<APISecret[]>
): Promise<ModelResponse> {
  let bodyData = null;
  try {
    bodyData = JSON.parse(body);
  } catch (e) {
    console.warn("Failed to parse body. Will fall back to default (OpenAI)", e);
  }

  let model = null;
  let format: ModelFormat = "openai";
  let types: ModelEndpointType[] = ["openai", "azure"];

  if (
    method === "POST" &&
    url == "/chat/completions" &&
    isObject(bodyData) &&
    bodyData.model
  ) {
    model = bodyData.model;
    format = AvailableModels[model]?.format || "openai";
    types = getModelEndpointTypes(model);
  }

  // TODO: Make this smarter. For now, just pick a random one.
  const secrets = await getApiSecrets(types);
  const initialIdx = getRandomInt(secrets.length);
  let proxyResponse = null;
  let lastException = null;

  for (let i = 0; i < secrets.length; i++) {
    const idx = (initialIdx + i) % secrets.length;
    const secret = secrets[idx];

    if (
      !isEmpty(model) &&
      !isEmpty(secret?.metadata) &&
      !isEmpty(secret?.metadata?.models) &&
      !(secret.metadata.models || []).includes(model)
    ) {
      continue;
    }

    try {
      proxyResponse = await fetchModel(
        format,
        method,
        url,
        headers,
        body,
        secret,
        bodyData
      );
      if (
        proxyResponse.response.ok ||
        (proxyResponse.response.status >= 400 &&
          proxyResponse.response.status < 500 &&
          !RETRY_ERROR_CODES.includes(proxyResponse.response.status))
      ) {
        break;
      } else {
        console.warn(
          "Received retryable error. Will try the next endpoint",
          proxyResponse.response.status,
          proxyResponse.response.statusText
        );
      }
    } catch (e) {
      lastException = e;
      if (e instanceof TypeError) {
        console.log(
          "Failed to fetch (most likely an invalid URL",
          secret.id,
          e
        );
        continue;
      }
      throw e;
    }
  }

  if (!proxyResponse) {
    if (lastException) {
      throw lastException;
    } else {
      throw new Error("No API keys found");
    }
  }

  return proxyResponse;
}

async function fetchModel(
  format: ModelFormat,
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body: string,
  secret: APISecret,
  bodyData: null | any
) {
  switch (format) {
    case "openai":
      return await fetchOpenAI(method, url, headers, bodyData, secret);
    case "anthropic":
      console.assert(method === "POST");
      return await fetchAnthropic("POST", url, headers, bodyData, secret);
    default:
      throw new Error(`Unsupported model provider ${format}`);
  }
}

async function fetchOpenAI(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  bodyData: null | any,
  secret: APISecret
): Promise<ModelResponse> {
  let baseURL =
    (secret.type === "azure" && secret.metadata?.api_base) ||
    EndpointProviderToBaseURL[secret.type];
  if (baseURL === null) {
    throw new Error(
      `Unsupported provider ${secret.name} (${secret.type}) (must specify base url)`
    );
  }

  if (secret.type === "azure") {
    if (secret.metadata?.deployment) {
      baseURL = `${baseURL}openai/deployments/${encodeURIComponent(
        secret.metadata.deployment
      )}`;
    } else if (bodyData?.model) {
      baseURL = `${baseURL}openai/deployments/${encodeURIComponent(
        bodyData.model.replace("gpt-3.5", "gpt-35")
      )}`;
    } else {
      throw new Error(
        `Azure provider ${secret.id} must have a deployment or model specified`
      );
    }
  }

  const fullURL = new URL(baseURL + url);
  headers["host"] = fullURL.host;
  headers["authorization"] = "Bearer " + secret.secret;

  if (secret.type === "azure" && secret.metadata?.api_version) {
    fullURL.searchParams.set("api-version", secret.metadata.api_version);
    headers["api-key"] = secret.secret;
    delete bodyData["seed"];
  } else if (
    secret.type === "openai" &&
    !isEmpty(secret.metadata?.organization_id)
  ) {
    headers["OpenAI-Organization"] = secret.metadata.organization_id;
  }

  const proxyResponse = await fetch(
    fullURL.toString(),
    method === "POST"
      ? {
          method,
          headers,
          body: isEmpty(bodyData) ? undefined : JSON.stringify(bodyData),
          keepalive: true,
        }
      : {
          method,
          headers,
          keepalive: true,
        }
  );

  return {
    stream: proxyResponse.body,
    response: proxyResponse,
  };
}

async function fetchAnthropic(
  method: "POST",
  url: string,
  headers: Record<string, string>,
  bodyData: null | any,
  secret: APISecret
): Promise<ModelResponse> {
  console.assert(url === "/chat/completions");

  // https://docs.anthropic.com/claude/reference/complete_post
  headers["accept"] = "application/json";
  headers["anthropic-version"] = "2023-06-01";
  const fullURL = new URL(
    (secret.metadata?.api_base || EndpointProviderToBaseURL.anthropic) +
      "/complete"
  );
  headers["host"] = fullURL.host;
  headers["x-api-key"] = secret.secret;

  if (isEmpty(bodyData)) {
    throw new Error("Anthropic request must have a valid JSON-parsable body");
  }

  const {
    messages: oaiMessages,
    seed, // extract seed so that it's not sent to Anthropic (we just use it for the cache)
    ...oaiParams
  } = bodyData;
  const messages = oaiMessages.map((m: Message) => ({
    ...m,
    role: MessageTypeToMessageType[m.role],
  }));
  const params: Record<string, unknown> = {
    max_tokens_to_sample: 256, // Required param
    ...translateParams("anthropic", oaiParams),
  };

  const proxyResponse = await fetch(fullURL.toString(), {
    method,
    headers,
    body: JSON.stringify({
      prompt: buildAnthropicPrompt(messages),
      ...params,
    }),
    keepalive: true,
  });

  let stream = proxyResponse.body || createEmptyReadableStream();
  if (proxyResponse.ok) {
    if (params.stream) {
      let idx = 0;
      stream = stream.pipeThrough(
        createEventStreamTransformer((data) => {
          const ret = anthropicEventToOpenAIEvent(idx, JSON.parse(data));
          idx += 1;
          return {
            data: ret.event && JSON.stringify(ret.event),
            finished: ret.finished,
          };
        })
      );
    } else {
      const allChunks: Uint8Array[] = [];
      stream = stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            allChunks.push(chunk);
          },
          async flush(controller) {
            const text = flattenChunks(allChunks);
            const data = JSON.parse(text);
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify(anthropicCompletionToOpenAICompletion(data))
              )
            );
            controller.terminate();
          },
        })
      );
    }
  }
  return {
    stream,
    response: proxyResponse,
  };
}

// The following functions are copied (with some modifications) from @vercel/ai
// git commit: e250e16806a856c186f650825b46a5af8f09bcf1
// --------------------------------------------------
function createEmptyReadableStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

export interface AIStreamParser {
  (data: string): { data: string | null; finished: boolean };
}

/**
 * Creates a TransformStream that parses events from an EventSource stream using a custom parser.
 * @param {AIStreamParser} customParser - Function to handle event data.
 * @returns {TransformStream<Uint8Array, Uint8Array>} TransformStream parsing events.
 */
export function createEventStreamTransformer(
  customParser: AIStreamParser
): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder();
  let eventSourceParser: EventSourceParser;

  const finish = (controller: TransformStreamDefaultController<Uint8Array>) => {
    controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    controller.terminate();
  };

  return new TransformStream({
    async start(controller): Promise<void> {
      eventSourceParser = createParser(
        (event: ParsedEvent | ReconnectInterval) => {
          if (
            ("data" in event &&
              event.type === "event" &&
              event.data === "[DONE]") ||
            // Replicate doesn't send [DONE] but does send a 'done' event
            // @see https://replicate.com/docs/streaming
            (event as any).event === "done"
          ) {
            finish(controller);
            return;
          }

          if ("data" in event) {
            const parsedMessage = customParser(event.data);
            if (parsedMessage.data !== null) {
              controller.enqueue(
                new TextEncoder().encode("data: " + parsedMessage.data + "\n\n")
              );
            }
            if (parsedMessage.finished) {
              finish(controller);
            }
          }
        }
      );
    },

    transform(chunk) {
      eventSourceParser.feed(textDecoder.decode(chunk));
    },
  });
}
// --------------------------------------------------

export function parseCacheModeHeader(headerName: string, value?: string) {
  const useCacheModeHeader = value && value.toLowerCase();
  if (
    useCacheModeHeader &&
    !(
      useCacheModeHeader === "auto" ||
      useCacheModeHeader === "always" ||
      useCacheModeHeader === "never"
    )
  ) {
    throw new Error(
      `Invalid ${headerName} header '${useCacheModeHeader}'. Must be one of auto, always, or never`
    );
  }
  return (useCacheModeHeader || "auto") as "auto" | "always" | "never";
}
