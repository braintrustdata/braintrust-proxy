import {
  createParser,
  type EventSourceParser,
  type ParsedEvent,
  type ReconnectInterval,
} from "eventsource-parser";
import {
  AvailableModels,
  MessageTypeToMessageType,
  EndpointProviderToBaseURL,
  translateParams,
  ModelFormat,
  APISecret,
} from "@schema";
import {
  ProxyBadRequestError,
  flattenChunks,
  flattenChunksArray,
  getRandomInt,
  isEmpty,
  isObject,
  parseAuthHeader,
} from "./util";
import {
  anthropicCompletionToOpenAICompletion,
  anthropicEventToOpenAIEvent,
  anthropicToolChoiceToOpenAIToolChoice,
  flattenAnthropicMessages,
  openAIContentToAnthropicContent,
  openAIToolCallsToAnthropicToolUse,
  openAIToolMessageToAnthropicToolCall,
  openAIToolsToAnthropicTools,
  upgradeAnthropicContentMessage,
} from "./providers/anthropic";
import { Meter, MeterProvider } from "@opentelemetry/api";
import { NOOP_METER_PROVIDER, nowMs } from "./metrics";
import {
  googleCompletionToOpenAICompletion,
  googleEventToOpenAIChatEvent,
  openAIMessagesToGoogleMessages,
  OpenAIParamsToGoogleParams,
} from "./providers/google";
import {
  Message,
  MessageRole,
  responseFormatSchema,
} from "@braintrust/core/typespecs";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  CompletionUsage,
  CreateEmbeddingResponse,
  ModerationCreateResponse,
} from "openai/resources";
import { fetchBedrockAnthropic, fetchConverse } from "./providers/bedrock";
import { Buffer } from "node:buffer";
import { ExperimentLogPartialArgs } from "@braintrust/core";
import { MessageParam } from "@anthropic-ai/sdk/resources";
import {
  getCurrentUnixTimestamp,
  parseOpenAIStream,
  isTempCredential,
  makeTempCredentials,
  verifyTempCredentials,
} from "utils";
import { openAIChatCompletionToChatEvent } from "./providers/openai";
import { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions";

type CachedData = {
  headers: Record<string, string>;
} & (
  | {
      // DEPRECATION_NOTICE: This can be removed in a couple weeks since writing (e.g. June 9 2024 onwards)
      body: string;
    }
  | {
      data: string;
    }
);

export const CACHE_HEADER = "x-bt-use-cache";
export const CREDS_CACHE_HEADER = "x-bt-use-creds-cache";
export const ORG_NAME_HEADER = "x-bt-org-name";
export const ENDPOINT_NAME_HEADER = "x-bt-endpoint-name";
export const FORMAT_HEADER = "x-bt-stream-fmt";

export const LEGACY_CACHED_HEADER = "x-cached";
export const CACHED_HEADER = "x-bt-cached";

export const USED_ENDPOINT_HEADER = "x-bt-used-endpoint";

const CACHE_MODES = ["auto", "always", "never"] as const;

// Options to control how the cache key is generated.
export interface CacheKeyOptions {
  excludeAuthToken?: boolean;
  excludeOrgName?: boolean;
}

export interface SpanLogger {
  setName: (name: string) => void;
  log: (args: ExperimentLogPartialArgs) => void;
  end: () => void;
}

// This is an isomorphic implementation of proxyV1, which is used by both edge functions
// in CloudFlare and by the node proxy (locally and in lambda).
export async function proxyV1({
  method,
  url,
  proxyHeaders,
  body,
  setHeader,
  setStatusCode,
  res,
  getApiSecrets,
  cacheGet,
  cachePut,
  digest,
  meterProvider = NOOP_METER_PROVIDER,
  cacheKeyOptions = {},
  decompressFetch = false,
  spanLogger,
}: {
  method: "GET" | "POST";
  url: string;
  proxyHeaders: Record<string, string>;
  body: string;
  setHeader: (name: string, value: string) => void;
  setStatusCode: (code: number) => void;
  res: WritableStream<Uint8Array>;
  getApiSecrets: (
    useCache: boolean,
    authToken: string,
    model: string | null,
    org_name?: string,
  ) => Promise<APISecret[]>;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>;
  digest: (message: string) => Promise<string>;
  meterProvider?: MeterProvider;
  cacheKeyOptions?: CacheKeyOptions;
  decompressFetch?: boolean;
  spanLogger?: SpanLogger;
}): Promise<void> {
  const meter = meterProvider.getMeter("proxy-metrics");

  const totalCalls = meter.createCounter("total_calls");
  const cacheHits = meter.createCounter("results_cache_hits");
  const cacheMisses = meter.createCounter("results_cache_misses");
  const cacheSkips = meter.createCounter("results_cache_skips");

  totalCalls.add(1);

  proxyHeaders = Object.fromEntries(
    Object.entries(proxyHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const headers = Object.fromEntries(
    Object.entries(proxyHeaders).filter(
      ([h, _]) =>
        !(
          h.startsWith("x-amzn") ||
          h.startsWith("x-bt") ||
          h.startsWith("sec-") ||
          h === "content-length" ||
          h === "origin" ||
          h === "priority" ||
          h === "referer" ||
          h === "user-agent"
        ),
    ),
  );

  const authToken = parseAuthHeader(proxyHeaders);
  if (!authToken) {
    throw new ProxyBadRequestError("Missing Authentication header");
  }

  // Caching is enabled by default, but let the user disable it
  const useCacheMode = parseEnumHeader(
    CACHE_HEADER,
    CACHE_MODES,
    proxyHeaders[CACHE_HEADER],
  );
  const useCredentialsCacheMode = parseEnumHeader(
    CACHE_HEADER,
    CACHE_MODES,
    proxyHeaders[CREDS_CACHE_HEADER],
  );
  const streamFormat = parseEnumHeader(
    FORMAT_HEADER,
    ["openai", "vercel-ai"] as const,
    proxyHeaders[FORMAT_HEADER],
  );

  let orgName: string | undefined = proxyHeaders[ORG_NAME_HEADER] ?? undefined;

  const pieces = url
    .split("/")
    .filter((p) => p.trim() !== "")
    .map((d) => decodeURIComponent(d));

  if (pieces.length > 2 && pieces[0].toLowerCase() === "btorg") {
    orgName = pieces[1];
    url = "/" + pieces.slice(2).map(encodeURIComponent).join("/");
  }

  const cacheableEndpoint =
    url === "/auto" ||
    url === "/embeddings" ||
    url === "/chat/completions" ||
    url === "/completions" ||
    url === "/moderations";

  let bodyData = null;
  if (
    url === "/auto" ||
    url === "/chat/completions" ||
    url === "/completions"
  ) {
    try {
      bodyData = JSON.parse(body);
    } catch (e) {
      console.warn("Failed to parse body. This doesn't really matter", e);
    }
  }

  if (url === "/credentials") {
    let readable: ReadableStream | null = null;
    try {
      const key = await makeTempCredentials({
        authToken,
        body: JSON.parse(body),
        orgName,
        cachePut,
      });

      setStatusCode(200);
      readable = writeToReadable(JSON.stringify({ key }));
    } catch (e) {
      setStatusCode(400);
      readable = writeToReadable(
        e instanceof Error ? e.message : JSON.stringify(e),
      );
    } finally {
      if (readable) {
        readable.pipeTo(res).catch(console.error);
      } else {
        res.close().catch(console.error);
      }
    }
    return;
  }

  // According to https://platform.openai.com/docs/api-reference, temperature is
  // a parameter for audio completions and chat completions, and defaults to
  // non-zero for completions, so unless it's set to zero, we can't cache it.
  //
  // OpenAI now allows you to set a seed, and if that is set, we should cache even
  // if temperature is non-zero.
  const temperatureNonZero =
    (url === "/chat/completions" ||
      url === "/completions" ||
      url === "/auto") &&
    bodyData &&
    bodyData.temperature !== 0 &&
    (bodyData.seed === undefined || bodyData.seed === null);

  const useCache =
    cacheableEndpoint &&
    useCacheMode !== "never" &&
    (useCacheMode === "always" || !temperatureNonZero);

  const endpointName = proxyHeaders[ENDPOINT_NAME_HEADER];

  // Data key is computed from the input data and used for both the cache key and as an input to the encryption key.
  const dataKey = await digest(
    JSON.stringify({
      url,
      body,
      authToken: cacheKeyOptions.excludeAuthToken || authToken,
      orgName: cacheKeyOptions.excludeOrgName || orgName,
      endpointName,
    }),
  );

  // We must hash the data key again to get the cache key, so that the cache key is not reversible to the data key.
  const cacheKey = `aiproxy/proxy/v2:${await digest(dataKey)}`;

  // The data key is used as the encryption key, so unless you have the actual incoming data, you can't decrypt the cache.
  const encryptionKey = await digest(`${dataKey}:${authToken}`);

  let startTime = getCurrentUnixTimestamp();
  let spanType: SpanType | undefined = undefined;
  const isStreaming = !!bodyData?.stream;

  let stream: ReadableStream<Uint8Array> | null = null;
  if (useCache) {
    const cached = await cacheGet(encryptionKey, cacheKey);

    if (cached !== null) {
      cacheHits.add(1);
      const cachedData: CachedData = JSON.parse(cached);

      for (const [name, value] of Object.entries(cachedData.headers)) {
        setHeader(name, value);
      }
      setHeader(LEGACY_CACHED_HEADER, "true");
      setHeader(CACHED_HEADER, "HIT");

      spanType = guessSpanType(url, bodyData?.model);
      if (spanLogger && spanType) {
        spanLogger.setName(spanTypeToName(spanType));
        logSpanInputs(bodyData, spanLogger, spanType);
        spanLogger.log({
          metrics: {
            cached: 1,
          },
        });
      }

      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if ("body" in cachedData && cachedData.body) {
            controller.enqueue(new TextEncoder().encode(cachedData.body));
          } else if ("data" in cachedData && cachedData.data) {
            const data = Buffer.from(cachedData.data, "base64");
            const uint8Array = new Uint8Array(data);
            controller.enqueue(uint8Array);
          }
          controller.close();
        },
      });
    } else {
      cacheMisses.add(1);
    }
  } else {
    cacheSkips.add(1);
  }

  let responseFailed = false;

  let overridenHeaders: string[] = [];
  const setOverriddenHeader = (name: string, value: string) => {
    overridenHeaders.push(name);
    setHeader(name, value);
  };

  if (stream === null) {
    let bodyData = null;
    try {
      bodyData = JSON.parse(body);
    } catch (e) {
      console.warn(
        "Failed to parse body. Will fall back to default (OpenAI)",
        e,
      );
    }

    if (streamFormat === "vercel-ai" && !isStreaming) {
      throw new ProxyBadRequestError(
        "Vercel AI format requires the stream parameter to be set to true",
      );
    }

    const {
      modelResponse: { response: proxyResponse, stream: proxyStream },
      secretName,
    } = await fetchModelLoop(
      meter,
      method,
      url,
      headers,
      bodyData,
      setOverriddenHeader,
      async (model) => {
        // First, try to use temp credentials, because then we'll get access
        // to the model.
        let cachedAuthToken: string | undefined;
        if (
          useCredentialsCacheMode !== "never" &&
          isTempCredential(authToken)
        ) {
          const { credentialCacheValue, jwtPayload } =
            await verifyTempCredentials({
              jwt: authToken,
              cacheGet,
            });
          // Unwrap the API key here to avoid a duplicate call to
          // `verifyTempCredentials` inside `getApiSecrets`. That call will
          // use Redis which is not available in Cloudflare.
          cachedAuthToken = credentialCacheValue.authToken;
          if (jwtPayload.bt.logging) {
            console.warn(
              `Logging was requested, but not supported on ${method} ${url}`,
            );
          }
          if (jwtPayload.bt.model && jwtPayload.bt.model !== model) {
            console.warn(
              `Temp credential allows model "${jwtPayload.bt.model}", but "${model}" was requested`,
            );
            return [];
          }
        }

        const secrets = await getApiSecrets(
          useCredentialsCacheMode !== "never",
          cachedAuthToken || authToken,
          model,
          orgName,
        );
        if (endpointName) {
          return secrets.filter((s) => s.name === endpointName);
        } else {
          return secrets;
        }
      },
      spanLogger,
      (st) => {
        spanType = st;
      },
    );
    stream = proxyStream;

    if (!proxyResponse.ok) {
      setStatusCode(proxyResponse.status);
      responseFailed = true;
    }

    const proxyResponseHeaders: Record<string, string> = {};
    proxyResponse.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (
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
        lowerName === "access-control-allow-headers" ||
        (decompressFetch && lowerName === "content-encoding") ||
        overridenHeaders.includes(lowerName)
      ) {
        return;
      }
      proxyResponseHeaders[name] = value;
    });
    if (secretName) {
      setHeader(USED_ENDPOINT_HEADER, secretName);
      proxyResponseHeaders[USED_ENDPOINT_HEADER] = secretName;
    }

    for (const [name, value] of Object.entries(proxyResponseHeaders)) {
      setHeader(name, value);
    }
    setHeader(LEGACY_CACHED_HEADER, "false"); // We're moving to x-bt-cached
    setHeader(CACHED_HEADER, "MISS");

    if (stream && proxyResponse.ok && useCache) {
      const allChunks: Uint8Array[] = [];
      const cacheStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          allChunks.push(chunk);
          controller.enqueue(chunk);
        },
        async flush(controller) {
          const data = flattenChunksArray(allChunks);
          const dataB64 = Buffer.from(data).toString("base64");
          await cachePut(
            encryptionKey,
            cacheKey,
            JSON.stringify({ headers: proxyResponseHeaders, data: dataB64 }),
          );
          controller.terminate();
        },
      });

      stream = stream.pipeThrough(cacheStream);
    }
  }

  if (spanLogger && stream) {
    let first = true;
    const allChunks: Uint8Array[] = [];

    // These parameters are for the streaming case
    let role: string | undefined = undefined;
    let content: string | undefined = undefined;
    let tool_calls: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined =
      undefined;
    let finish_reason: string | undefined = undefined;
    const eventSourceParser: EventSourceParser | undefined = !isStreaming
      ? undefined
      : createParser((event: ParsedEvent | ReconnectInterval) => {
          if (
            ("data" in event &&
              event.type === "event" &&
              event.data === "[DONE]") ||
            // Replicate doesn't send [DONE] but does send a 'done' event
            // @see https://replicate.com/docs/streaming
            (event as any).event === "done"
          ) {
            return;
          }

          try {
            if ("data" in event) {
              const result = JSON.parse(event.data) as ChatCompletionChunk;
              if (result) {
                if (result.usage) {
                  spanLogger.log({
                    metrics: {
                      tokens: result.usage.total_tokens,
                      prompt_tokens: result.usage.prompt_tokens,
                      completion_tokens: result.usage.completion_tokens,
                    },
                  });
                }

                const choice = result.choices?.[0];
                const delta = choice?.delta;

                if (!choice || !delta) {
                  return;
                }

                if (!role && delta.role) {
                  role = delta.role;
                }

                if (choice.finish_reason) {
                  finish_reason = choice.finish_reason;
                }

                if (delta.content) {
                  content = (content || "") + delta.content;
                }

                if (delta.tool_calls) {
                  if (!tool_calls) {
                    tool_calls = [
                      {
                        index: 0,
                        id: delta.tool_calls[0].id,
                        type: delta.tool_calls[0].type,
                        function: delta.tool_calls[0].function,
                      },
                    ];
                  } else if (tool_calls[0].function) {
                    tool_calls[0].function.arguments =
                      (tool_calls[0].function.arguments ?? "") +
                      (delta.tool_calls[0].function?.arguments ?? "");
                  }
                }
              }
            }
          } catch (e) {
            spanLogger.log({
              error: e,
            });
          }
        });

    const loggingStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (
          first &&
          spanType &&
          (["completion", "chat"] as SpanType[]).includes(spanType)
        ) {
          first = false;
          spanLogger.log({
            metrics: {
              time_to_first_token: getCurrentUnixTimestamp() - startTime,
            },
          });
        }
        if (isStreaming) {
          eventSourceParser?.feed(new TextDecoder().decode(chunk));
        } else {
          allChunks.push(chunk);
        }
        controller.enqueue(chunk);
      },
      async flush(controller) {
        if (isStreaming) {
          spanLogger.log({
            output: [
              {
                index: 0,
                message: {
                  role,
                  content,
                  tool_calls,
                },
                logprobs: null,
                finish_reason,
              },
            ],
          });
        } else {
          const dataRaw = JSON.parse(
            new TextDecoder().decode(flattenChunksArray(allChunks)),
          );

          switch (spanType) {
            case "chat":
            case "completion": {
              const data = dataRaw as ChatCompletion;
              spanLogger.log({
                output: data.choices,
                metrics: {
                  tokens: data.usage?.total_tokens,
                  prompt_tokens: data.usage?.prompt_tokens,
                  completion_tokens: data.usage?.completion_tokens,
                },
              });
              break;
            }
            case "embedding":
              {
                const data = dataRaw as CreateEmbeddingResponse;
                spanLogger.log({
                  output: { embedding_length: data.data[0].embedding.length },
                  metrics: {
                    tokens: data.usage?.total_tokens,
                    prompt_tokens: data.usage?.prompt_tokens,
                  },
                });
              }
              break;
            case "moderation":
              {
                const data = dataRaw as ModerationCreateResponse;
                spanLogger.log({
                  output: data.results,
                });
              }
              break;
          }
        }

        spanLogger.end();
        controller.terminate();
      },
    });

    stream = stream.pipeThrough(loggingStream);
  }

  if (stream && streamFormat === "vercel-ai" && !responseFailed) {
    const textDecoder = new TextDecoder();
    let eventSourceParser: EventSourceParser;

    const parser = parseOpenAIStream();
    const parseStream = new TransformStream({
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
              return;
            }

            if ("data" in event) {
              const parsedMessage = parser(event.data);
              if (parsedMessage) {
                controller.enqueue(new TextEncoder().encode(parsedMessage));
              }
            }
          },
        );
      },
      async flush(controller): Promise<void> {
        controller.terminate();
      },

      transform(chunk, controller) {
        eventSourceParser.feed(textDecoder.decode(chunk));
      },
    });

    stream = stream.pipeThrough(parseStream);
  }

  if (stream) {
    stream.pipeTo(res).catch((e) => {
      console.error("Error piping stream to response", e);
    });
  } else {
    res.close().catch((e) => {
      console.error("Error closing response", e);
    });
  }
}

interface ModelResponse {
  stream: ReadableStream<Uint8Array> | null;
  response: Response;
}

const RATE_LIMIT_ERROR_CODE = 429;
const RATE_LIMIT_MAX_WAIT_MS = 45 * 1000; // Wait up to 45 seconds while retrying
const BACKOFF_EXPONENT = 2;

const TRY_ANOTHER_ENDPOINT_ERROR_CODES = [
  // 404 means the model or endpoint doesn't exist. We may want to propagate these errors, or
  // report them elsewhere, but for now round robin.
  404,

  // 429 is rate limiting. We may want to track stats about this and potentially handle more
  // intelligently, eg if all APIs are rate limited, back off and try something else.
  RATE_LIMIT_ERROR_CODE,
];

let loopIndex = 0;
async function fetchModelLoop(
  meter: Meter,
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  bodyData: any | null,
  setHeader: (name: string, value: string) => void,
  getApiSecrets: (model: string | null) => Promise<APISecret[]>,
  spanLogger: SpanLogger | undefined,
  setSpanType: (spanType: SpanType) => void,
): Promise<{ modelResponse: ModelResponse; secretName?: string | null }> {
  const requestId = ++loopIndex;

  const endpointCalls = meter.createCounter("endpoint_calls");
  const endpointFailures = meter.createCounter("endpoint_failures");
  const endpointRetryableErrors = meter.createCounter(
    "endpoint_retryable_errors",
  );
  const retriesPerCall = meter.createHistogram("retries_per_call", {
    advice: {
      explicitBucketBoundaries: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
  });
  const llmTtft = meter.createHistogram("llm_ttft");
  const llmLatency = meter.createHistogram("llm_latency");

  let model: string | null = null;

  if (
    method === "POST" &&
    (url === "/auto" ||
      url === "/chat/completions" ||
      url === "/completions") &&
    isObject(bodyData) &&
    bodyData.model
  ) {
    model = bodyData.model;
  }

  // TODO: Make this smarter. For now, just pick a random one.
  const secrets = await getApiSecrets(model);
  const initialIdx = getRandomInt(secrets.length);
  let proxyResponse: ModelResponse | null = null;
  let secretName: string | null | undefined = null;
  let lastException = null;
  let loggableInfo: Record<string, any> = {};

  let i = 0;
  let delayMs = 50;
  let totalWaitedTime = 0;

  for (; i < secrets.length; i++) {
    const idx = (initialIdx + i) % secrets.length;
    const secret = secrets[idx];

    const modelSpec =
      (model !== null
        ? secret.metadata?.customModels?.[model] ?? AvailableModels[model]
        : null) ?? null;

    let endpointUrl = url;
    if (endpointUrl === "/auto") {
      switch (modelSpec?.flavor) {
        case "chat":
          endpointUrl = "/chat/completions";
          break;
        case "completion":
          endpointUrl = "/completions";
          break;
        default:
          throw new ProxyBadRequestError(
            `Unsupported model ${model} (must be chat or completion for /auto endpoint)`,
          );
      }
    }

    const spanType = guessSpanType(endpointUrl, bodyData?.model);
    if (spanLogger && spanType) {
      setSpanType(spanType);
      spanLogger.setName(spanTypeToName(spanType));
      logSpanInputs(bodyData, spanLogger, spanType);
    }

    loggableInfo = {
      model,
      endpoint_id: secret.id,
      type: secret.type,
      format: modelSpec?.format,
    };

    if (
      !isEmpty(model) &&
      !isEmpty(secret?.metadata) &&
      !isEmpty(secret?.metadata?.models) &&
      !(secret.metadata.models || []).includes(model)
    ) {
      continue;
    }

    const additionalHeaders = secret.metadata?.additionalHeaders || {};

    let httpCode = undefined;
    let httpHeaders = new Headers();
    endpointCalls.add(1, loggableInfo);
    try {
      proxyResponse = await fetchModel(
        modelSpec?.format ?? "openai",
        method,
        endpointUrl,
        { ...headers, ...additionalHeaders },
        secret,
        bodyData,
        setHeader,
      );
      secretName = secret.name;
      if (
        proxyResponse.response.ok ||
        (proxyResponse.response.status >= 400 &&
          proxyResponse.response.status < 500 &&
          !TRY_ANOTHER_ENDPOINT_ERROR_CODES.includes(
            proxyResponse.response.status,
          ))
      ) {
        break;
      } else {
        console.warn(
          "Received retryable error. Will try the next endpoint",
          proxyResponse.response.status,
          proxyResponse.response.statusText,
        );
        httpCode = proxyResponse.response.status;
        httpHeaders = proxyResponse.response.headers;
      }
    } catch (e) {
      lastException = e;
      if (e instanceof TypeError) {
        if ("cause" in e && e.cause && isObject(e.cause)) {
          if ("statusCode" in e.cause) {
            httpCode = e.cause.statusCode;
          }
          if ("headers" in e.cause) {
            httpHeaders = new Headers(e.cause.headers);
          }
        }
        if (!httpCode) {
          console.log(
            "Failed to fetch with a generic error (could be an invalid URL or an unhandled network error)",
            secret.id,
            e,
          );
        }
      } else {
        endpointFailures.add(1, loggableInfo);
        throw e;
      }
    }

    // If we hit a rate-limit error, and we're at the end of the
    // loop, and we haven't waited the maximum allotted time, then
    // sleep for a bit, and reset the loop.
    if (
      httpCode === RATE_LIMIT_ERROR_CODE &&
      i === secrets.length - 1 &&
      totalWaitedTime < RATE_LIMIT_MAX_WAIT_MS
    ) {
      const limitReset = tryParseRateLimitReset(httpHeaders);
      delayMs = Math.max(
        // Make sure we sleep at least 10ms. Sometimes the random backoff logic can get wonky.
        Math.min(
          // If we have a rate limit reset time, use that. Otherwise, use a random backoff.
          // Sometimes, limitReset is 0 (errantly), so fall back to the random backoff in that case too.
          // And never sleep longer than 10 seconds or the remaining budget.
          limitReset || delayMs * (BACKOFF_EXPONENT - Math.random()),
          10 * 1000,
          RATE_LIMIT_MAX_WAIT_MS - totalWaitedTime,
        ),
        10,
      );
      console.warn(
        `Ran out of endpoints and hit rate limit errors, so sleeping for ${delayMs}ms`,
        loopIndex,
      );
      await new Promise((r) => setTimeout(r, delayMs));

      totalWaitedTime += delayMs;
      i = -1; // Reset the loop variable
    }

    endpointRetryableErrors.add(1, {
      ...loggableInfo,
      http_code: httpCode,
    });
  }

  retriesPerCall.record(i, loggableInfo);

  if (!proxyResponse) {
    if (lastException) {
      throw lastException;
    } else {
      throw new ProxyBadRequestError(
        `No API keys found (for ${model}). You can configure API secrets at https://www.braintrust.dev/app/settings?subroute=secrets`,
      );
    }
  }

  let stream = proxyResponse.stream;
  if (!proxyResponse.response.ok) {
    endpointFailures.add(1, loggableInfo);
  } else if (stream) {
    let first = true;
    const timingStart = nowMs();
    const timingStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (first) {
          llmTtft.record(nowMs() - timingStart, loggableInfo);
          first = false;
        }
        controller.enqueue(chunk);
      },
      async flush(controller) {
        const duration = nowMs() - timingStart;
        llmLatency.record(duration, loggableInfo);
        controller.terminate();
      },
    });
    stream = stream.pipeThrough(timingStream);
  }
  return {
    modelResponse: {
      stream,
      response: proxyResponse.response,
    },
    secretName,
  };
}

async function fetchModel(
  format: ModelFormat,
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  secret: APISecret,
  bodyData: null | any,
  setHeader: (name: string, value: string) => void,
): Promise<ModelResponse> {
  switch (format) {
    case "openai":
      return await fetchOpenAI(
        method,
        url,
        headers,
        bodyData,
        secret,
        setHeader,
      );
    case "anthropic":
      console.assert(method === "POST");
      return await fetchAnthropic("POST", url, headers, bodyData, secret);
    case "google":
      console.assert(method === "POST");
      return await fetchGoogle("POST", url, headers, bodyData, secret);
    case "converse":
      console.assert(method === "POST");
      return await fetchConverse({
        secret,
        body: bodyData,
      });
    default:
      throw new ProxyBadRequestError(`Unsupported model provider ${format}`);
  }
}

async function fetchOpenAI(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  bodyData: null | any,
  secret: APISecret,
  setHeader: (name: string, value: string) => void,
): Promise<ModelResponse> {
  if (secret.type === "bedrock") {
    throw new ProxyBadRequestError(`Bedrock does not support OpenAI format`);
  }

  let baseURL =
    (secret.metadata &&
      "api_base" in secret.metadata &&
      secret.metadata.api_base) ||
    EndpointProviderToBaseURL[secret.type];
  if (baseURL === null) {
    throw new ProxyBadRequestError(
      `Unsupported provider ${secret.name} (${secret.type}) (must specify base url)`,
    );
  }

  if (secret.type === "azure") {
    if (secret.metadata?.deployment) {
      baseURL = `${baseURL}openai/deployments/${encodeURIComponent(
        secret.metadata.deployment,
      )}`;
    } else if (bodyData?.model || bodyData?.engine) {
      const model = bodyData.model || bodyData.engine;
      baseURL = `${baseURL}openai/deployments/${encodeURIComponent(
        model.replace("gpt-3.5", "gpt-35"),
      )}`;
    } else {
      throw new ProxyBadRequestError(
        `Azure provider ${secret.id} must have a deployment or model specified`,
      );
    }
  } else if (secret.type === "lepton") {
    baseURL = baseURL.replace("<model>", bodyData.model);
  }

  if (secret.type === "mistral" || secret.type === "fireworks") {
    delete bodyData["stream_options"];
  }

  if (secret.type === "mistral") {
    delete bodyData["parallel_tool_calls"];
  }

  const fullURL = new URL(baseURL + url);
  headers["host"] = fullURL.host;
  headers["authorization"] = "Bearer " + secret.secret;

  if (secret.type === "azure" && secret.metadata?.api_version) {
    fullURL.searchParams.set("api-version", secret.metadata.api_version);
    headers["api-key"] = secret.secret;
    delete bodyData["seed"];
  } else if (secret.type === "openai" && secret.metadata?.organization_id) {
    headers["OpenAI-Organization"] = secret.metadata.organization_id;
  }

  if (secret.type === "cerebras") {
    headers["User-Agent"] = "braintrust-proxy";
  }

  // TODO: Ideally this is encapsulated as some advanced per-model config
  // or mapping, but for now, let's just map it manually.
  const isO1Like =
    typeof bodyData.model === "string" &&
    (bodyData.model.startsWith("o1") || bodyData.model.startsWith("o3-mini"));
  if (isO1Like) {
    if (!isEmpty(bodyData.max_tokens)) {
      bodyData.max_completion_tokens = bodyData.max_tokens;
      delete bodyData.max_tokens;
      delete bodyData.temperature;
    }

    // o1, even if it supports tool calls, doesn't support parallel tool calls. But o3 does.
    if (!bodyData.model.startsWith("o3-mini")) {
      delete bodyData.parallel_tool_calls;
    }

    // Only remove system messages for old O1 models.
    if (
      bodyData.messages &&
      ["o1-preview", "o1-mini", "o1-preview-2024-09-12"].includes(
        bodyData.model,
      )
    ) {
      bodyData.messages = bodyData.messages.map((m: any) => ({
        ...m,
        role: m.role === "system" ? "user" : m.role,
      }));
    } else if (["o1", "o1-2024-12-17"].includes(bodyData.model)) {
      // o1 itself does not support streaming yet
      return fetchOpenAIFakeStream({
        method,
        fullURL,
        headers,
        bodyData,
        setHeader,
      });
    }
  }

  if (secret.metadata?.supportsStreaming === false) {
    return fetchOpenAIFakeStream({
      method,
      fullURL,
      headers,
      bodyData,
      setHeader,
    });
  }

  let isManagedStructuredOutput = false;
  const responseFormatParsed = responseFormatSchema.safeParse(
    bodyData.response_format,
  );
  if (responseFormatParsed.success) {
    switch (responseFormatParsed.data.type) {
      case "text":
        // Together does not like response_format to be explicitly set to text.
        // We delete it everywhere, since text is the default.
        delete bodyData.response_format;
        break;
      case "json_schema":
        if (
          bodyData.model.startsWith("gpt") ||
          bodyData.model.startsWith("o1") ||
          bodyData.model.startsWith("o3") ||
          secret.type === "fireworks"
        ) {
          // Supports structured output, so we do not need to manage it.
          break;
        }
        if (bodyData.tools || bodyData.function_call || bodyData.tool_choice) {
          throw new ProxyBadRequestError(
            "Tools are not supported with structured output",
          );
        }
        isManagedStructuredOutput = true;
        bodyData.tools = [
          {
            type: "function",
            function: {
              name: "json",
              description: "Output the result in JSON format",
              parameters: responseFormatParsed.data.json_schema.schema,
              strict: responseFormatParsed.data.json_schema.strict,
            },
          },
        ];
        bodyData.tool_choice = { type: "function", function: { name: "json" } };
        delete bodyData.response_format;
        break;
    }
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
        },
  );

  let stream = proxyResponse.body;
  if (isManagedStructuredOutput && stream) {
    if (bodyData.stream) {
      stream = stream.pipeThrough(
        createEventStreamTransformer((data) => {
          const chunk: ChatCompletionChunk = JSON.parse(data);
          const choice = chunk.choices[0];
          if (choice.delta.tool_calls) {
            if (
              choice.delta.tool_calls[0].function &&
              choice.delta.tool_calls[0].function.arguments
            ) {
              choice.delta.content =
                choice.delta.tool_calls[0].function.arguments;
            }
            delete choice.delta.tool_calls;
          }

          if (choice.finish_reason === "tool_calls") {
            choice.finish_reason = "stop";
          }
          return {
            data: JSON.stringify(chunk),
            finished: false,
          };
        }),
      );
    } else {
      const chunks: Uint8Array[] = [];
      stream = stream.pipeThrough(
        new TransformStream({
          transform(chunk, _controller) {
            chunks.push(chunk);
          },
          flush(controller) {
            const data: ChatCompletion = JSON.parse(flattenChunks(chunks));
            const choice = data.choices[0];
            choice.message.content =
              choice.message.tool_calls![0].function.arguments;
            choice.finish_reason = "stop";
            delete choice.message.tool_calls;
            controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));
            controller.terminate();
          },
        }),
      );
    }
  }

  return {
    stream,
    response: proxyResponse,
  };
}

async function fetchOpenAIFakeStream({
  method,
  fullURL,
  headers,
  bodyData,
  setHeader,
}: {
  method: "GET" | "POST";
  fullURL: URL;
  headers: Record<string, string>;
  bodyData: null | any;
  setHeader: (name: string, value: string) => void;
}): Promise<ModelResponse> {
  let isStream = false;
  if (bodyData) {
    isStream = !!bodyData["stream"];
    delete bodyData["stream"];
    delete bodyData["stream_options"];
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
        },
  );

  let responseChunks: Uint8Array[] = [];
  const responseToStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (proxyResponse.ok) {
        responseChunks.push(chunk);
      } else {
        controller.enqueue(chunk);
      }
    },
    flush(controller) {
      if (!proxyResponse.ok) {
        controller.terminate();
        return;
      }
      const decoder = new TextDecoder();
      const responseText = responseChunks
        .map((c) => decoder.decode(c))
        .join("");
      let responseJson: ChatCompletion = {
        id: "invalid",
        choices: [],
        created: 0,
        model: "invalid",
        object: "chat.completion",
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
      try {
        responseJson = JSON.parse(responseText);
      } catch (e) {
        console.error("Failed to parse response as JSON", responseText);
      }
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify(openAIChatCompletionToChatEvent(responseJson))}\n\n`,
        ),
      );
      controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
      controller.terminate();
    },
  });

  if (isStream) {
    setHeader("content-type", "text/event-stream; charset=utf-8");
  }

  return {
    stream:
      isStream && proxyResponse.ok
        ? proxyResponse.body?.pipeThrough(responseToStream) ||
          createEmptyReadableStream()
        : proxyResponse.body,
    response: proxyResponse,
  };
}

async function fetchAnthropic(
  method: "POST",
  url: string,
  headers: Record<string, string>,
  bodyData: null | any,
  secret: APISecret,
): Promise<ModelResponse> {
  console.assert(url === "/chat/completions");

  // https://docs.anthropic.com/claude/reference/complete_post
  headers["accept"] = "application/json";
  headers["anthropic-version"] = "2023-06-01";
  const fullURL = new URL(EndpointProviderToBaseURL.anthropic + "/messages");
  headers["host"] = fullURL.host;
  headers["x-api-key"] = secret.secret;

  if (isEmpty(bodyData)) {
    throw new ProxyBadRequestError(
      "Anthropic request must have a valid JSON-parsable body",
    );
  }

  const {
    messages: oaiMessages,
    seed, // extract seed so that it's not sent to Anthropic (we just use it for the cache)
    ...oaiParams
  } = bodyData;

  let messages: Array<MessageParam> = [];
  let system = undefined;
  for (const m of oaiMessages as Message[]) {
    let role: MessageRole = m.role;
    let content: any = await openAIContentToAnthropicContent(m.content);
    if (m.role === "system") {
      system = content;
      continue;
    } else if (
      m.role === "function" ||
      ("function_call" in m && !isEmpty(m.function_call))
    ) {
      throw new ProxyBadRequestError(
        "Anthropic does not support function messages or function_calls",
      );
    } else if (m.role === "tool") {
      role = "user";
      content = openAIToolMessageToAnthropicToolCall(m);
    } else if (m.role === "assistant" && m.tool_calls) {
      content = upgradeAnthropicContentMessage(content);
      content.push(...openAIToolCallsToAnthropicToolUse(m.tool_calls));
    }

    const translatedRole = MessageTypeToMessageType[role];
    if (
      !translatedRole ||
      !(translatedRole === "user" || translatedRole === "assistant")
    ) {
      throw new ProxyBadRequestError(`Unsupported Anthropic role ${role}`);
    }

    messages.push({
      role: translatedRole,
      content,
    });
  }

  messages = flattenAnthropicMessages(messages);
  const params: Record<string, unknown> = {
    max_tokens: 1024, // Required param
    ...translateParams("anthropic", oaiParams),
  };

  const isFunction = !!params.functions;
  if (params.tools || params.functions) {
    headers["anthropic-beta"] = "tools-2024-05-16";
    params.tools = openAIToolsToAnthropicTools(
      params.tools ||
        (params.functions as Array<ChatCompletionCreateParams.Function>).map(
          (f: any) => ({
            type: "function",
            function: f,
          }),
        ),
    );

    delete params.functions;
  }

  if (params.tool_choice) {
    params.tool_choice = anthropicToolChoiceToOpenAIToolChoice(
      params.tool_choice as ChatCompletionCreateParamsBase["tool_choice"],
    );
  }

  let isStructuredOutput = false;
  const parsed = responseFormatSchema.safeParse(oaiParams.response_format);
  if (parsed.success && parsed.data.type === "json_schema") {
    isStructuredOutput = true;
    if (params.tools || params.tool_choice) {
      throw new ProxyBadRequestError(
        "Structured output is not supported with tools",
      );
    }
    params.tools = [
      {
        name: "json",
        description: "Output the result in JSON format",
        input_schema: parsed.data.json_schema.schema,
      },
    ];
    params.tool_choice = { type: "tool", name: "json" };
  }

  if (secret.type === "bedrock") {
    return fetchBedrockAnthropic({
      secret,
      body: {
        ...params,
        messages,
        system,
      },
      isFunction,
      isStructuredOutput,
    });
  }

  const proxyResponse = await fetch(fullURL.toString(), {
    method,
    headers,
    body: JSON.stringify({
      messages,
      system,
      ...params,
    }),
    keepalive: true,
  });

  let stream = proxyResponse.body || createEmptyReadableStream();
  if (proxyResponse.ok) {
    if (params.stream) {
      let idx = 0;
      let usage: Partial<CompletionUsage> = {};
      stream = stream.pipeThrough(
        createEventStreamTransformer((data) => {
          const ret = anthropicEventToOpenAIEvent(
            idx,
            usage,
            JSON.parse(data),
            isStructuredOutput,
          );
          idx += 1;
          return {
            data: ret.event && JSON.stringify(ret.event),
            finished: ret.finished,
          };
        }),
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
                JSON.stringify(
                  anthropicCompletionToOpenAICompletion(
                    data,
                    isFunction,
                    isStructuredOutput,
                  ),
                ),
              ),
            );
            controller.terminate();
          },
        }),
      );
    }
  }
  return {
    stream,
    response: proxyResponse,
  };
}

function pruneSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const allowedFields = [
    "type",
    "format",
    "description",
    "nullable",
    "items",
    "enum",
    "properties",
    "required",
    "example",
  ];

  const result: any = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!allowedFields.includes(key)) {
      continue;
    }

    if (key === "properties") {
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, any>).map(([k, v]) => [
          k,
          pruneSchema(v),
        ]),
      );
    } else if (key === "items") {
      result[key] = pruneSchema(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function googleTools(params: ChatCompletionCreateParams) {
  if (params.tools || params.functions) {
    params.tools =
      params.tools ||
      (params.functions as Array<ChatCompletionCreateParams.Function>).map(
        (f: any) => ({
          type: "function",
          function: f,
        }),
      );
  }
  let tool_config: any = undefined;
  if (params.tool_choice) {
    switch (params.tool_choice) {
      case "required":
        tool_config = {
          function_calling_config: {
            mode: "ANY",
          },
        };
        break;
      case "none":
        tool_config = {
          function_calling_config: {
            mode: "NONE",
          },
        };
        break;
      case "auto":
        tool_config = {
          function_calling_config: {
            mode: "AUTO",
          },
        };
        break;
      default:
        tool_config = {
          function_calling_config: {
            mode: "ANY",
            allowed_function_names: [params.tool_choice.function.name],
          },
        };
        break;
    }
  }
  let out = {
    tools: params.tools
      ? [
          {
            function_declarations: params.tools.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              parameters: pruneSchema(t.function.parameters),
            })),
          },
        ]
      : undefined,
    tool_config,
  };
  delete params.tools;
  delete params.tool_choice;
  return out;
}

async function fetchGoogle(
  method: "POST",
  url: string,
  headers: Record<string, string>,
  bodyData: null | any,
  secret: APISecret,
): Promise<ModelResponse> {
  console.assert(url === "/chat/completions");
  if (secret.type !== "google") {
    throw new ProxyBadRequestError(
      `Unsupported credentials for Google: ${secret.type}`,
    );
  }

  if (isEmpty(bodyData)) {
    throw new ProxyBadRequestError(
      "Google request must have a valid JSON-parsable body",
    );
  }

  const {
    model,
    stream: streamingMode,
    messages: oaiMessages,
    seed, // extract seed so that it's not sent to Google (we just use it for the cache)
    ...oaiParams
  } = bodyData;
  const content = await openAIMessagesToGoogleMessages(oaiMessages);
  const params = Object.fromEntries(
    Object.entries(translateParams("google", oaiParams))
      .map(([key, value]) => {
        const translatedKey = OpenAIParamsToGoogleParams[key];
        if (translatedKey === null) {
          // These are unsupported params
          return [null, null];
        }
        return [translatedKey ?? key, value];
      })
      .filter(([k, _]) => k !== null),
  );

  const fullURL = new URL(
    EndpointProviderToBaseURL.google! +
      `/models/${encodeURIComponent(model)}:${
        streamingMode ? "streamGenerateContent" : "generateContent"
      }`,
  );
  fullURL.searchParams.set("key", secret.secret);
  if (streamingMode) {
    fullURL.searchParams.set("alt", "sse");
  }

  delete headers["authorization"];
  headers["content-type"] = "application/json";

  if (
    oaiParams.response_format?.type === "json_object" ||
    oaiParams.response_format?.type === "json_schema"
  ) {
    params.response_mime_type = "application/json";
  }
  if (oaiParams.response_format?.type === "json_schema") {
    params.response_schema = pruneSchema(
      oaiParams.response_format.json_schema.schema,
    );
  }
  const body = JSON.stringify({
    contents: content,
    generationConfig: params,
    ...googleTools(params),
  });

  const proxyResponse = await fetch(fullURL.toString(), {
    method,
    headers,
    body,
    keepalive: true,
  });

  let stream = proxyResponse.body || createEmptyReadableStream();
  if (proxyResponse.ok) {
    if (streamingMode) {
      let idx = 0;
      stream = stream.pipeThrough(
        createEventStreamTransformer((data) => {
          const ret = googleEventToOpenAIChatEvent(model, JSON.parse(data));
          idx += 1;
          return {
            data: ret.event && JSON.stringify(ret.event),
            finished: ret.finished,
          };
        }),
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
                JSON.stringify(googleCompletionToOpenAICompletion(model, data)),
              ),
            );
            controller.terminate();
          },
        }),
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
  customParser: AIStreamParser,
): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder();
  let eventSourceParser: EventSourceParser;

  let finished = false;
  const finish = async (
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (finished) {
      return;
    }
    finished = true;
    controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    // This ensures that controller.terminate is not in the same stack frame as start()/transform()
    await new Promise((resolve) => setTimeout(resolve, 0));
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
            finish(controller).catch((e) => {
              console.error("Error finishing stream", e);
            });
            return;
          }

          if ("data" in event) {
            let parsedMessage;
            try {
              parsedMessage = customParser(event.data);
            } catch (e) {
              console.warn(
                `Error parsing event: ${JSON.stringify(event)}\n${e}`,
              );
              controller.enqueue(
                new TextEncoder().encode(
                  "data: " + `${JSON.stringify(`${e}`)}` + "\n\n",
                ),
              );
              finish(controller).catch((e) => {
                console.error("Error finishing stream", e);
              });
              return;
            }
            if (parsedMessage.data !== null) {
              controller.enqueue(
                new TextEncoder().encode(
                  "data: " + parsedMessage.data + "\n\n",
                ),
              );
            }
            if (parsedMessage.finished) {
              finish(controller).catch((e) => {
                console.error("Error finishing stream", e);
              });
            }
          }
        },
      );
    },

    transform(chunk) {
      eventSourceParser.feed(textDecoder.decode(chunk));
    },
  });
}
// --------------------------------------------------

function parseEnumHeader<T>(
  headerName: string,
  headerTypes: readonly T[],
  value?: string,
): (typeof headerTypes)[number] {
  const header = value && value.toLowerCase();
  if (header && !headerTypes.includes(header as T)) {
    throw new ProxyBadRequestError(
      `Invalid ${headerName} header '${header}'. Must be one of ${headerTypes.join(
        ", ",
      )}`,
    );
  }
  return (header || headerTypes[0]) as (typeof headerTypes)[number];
}

function tryParseRateLimitReset(headers: Headers): number | null {
  const reset =
    headers.get("x-ratelimit-reset") ??
    headers.get("x-ratelimit-reset-requests");
  if (reset) {
    // reset is time-formatted, i.e. Xms or Xs
    const match = reset.match(/(\d+)(ms|s)/);
    if (match) {
      const [_, num, unit] = match;
      const parsed = parseInt(num);
      if (!isNaN(parsed)) {
        return unit === "ms" ? parsed : parsed * 1000;
      }
    }
  }
  return null;
}

export type SpanType = "chat" | "completion" | "embedding" | "moderation";

function spanTypeToName(spanType: SpanType): string {
  switch (spanType) {
    case "chat":
      return "Chat Completion";
    case "completion":
      return "Completion";
    case "embedding":
      return "Embedding";
    case "moderation":
      return "Moderation";
  }
}

export function guessSpanType(
  url: string,
  model: string | undefined,
): SpanType | undefined {
  const spanName =
    url === "/chat/completions"
      ? "chat"
      : url === "/completions"
        ? "completion"
        : url === "/embeddings"
          ? "embedding"
          : url === "/moderations"
            ? "moderation"
            : undefined;
  if (spanName) {
    return spanName;
  }

  const flavor = model && AvailableModels[model]?.flavor;
  if (flavor === "chat") {
    return "chat";
  } else if (flavor === "completion") {
    return "completion";
  } else if (url === "/moderations") {
    return "moderation";
  } else {
    return undefined;
  }
}

function logSpanInputs(
  bodyData: any,
  spanLogger: SpanLogger,
  maybeSpanType: SpanType | undefined,
) {
  const spanType = maybeSpanType || "chat";
  switch (spanType) {
    case "chat": {
      const { messages, ...rest } = bodyData;
      spanLogger.log({
        input: messages,
        metadata: rest,
      });
      break;
    }
    case "completion": {
      const { prompt, ...rest } = bodyData;
      spanLogger.log({
        input: prompt,
        metadata: rest,
      });
      break;
    }
    case "embedding":
    case "moderation": {
      const { input, ...rest } = bodyData;
      spanLogger.log({
        input: bodyData,
        metadata: rest,
      });
      break;
    }
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
