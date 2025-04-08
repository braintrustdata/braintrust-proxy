import {
  createParser,
  type EventSourceParser,
  type ParsedEvent,
  type ReconnectInterval,
} from "eventsource-parser";
import { parse as cacheControlParse } from "cache-control-parser";
import {
  AvailableModels,
  MessageTypeToMessageType,
  EndpointProviderToBaseURL,
  translateParams,
  APISecret,
  VertexMetadataSchema,
  ModelSpec,
  AzureEntraSecretSchema,
  DatabricksOAuthSecretSchema,
} from "@schema";
import {
  ModelResponse,
  ProxyBadRequestError,
  flattenChunks,
  flattenChunksArray,
  getRandomInt,
  isEmpty,
  isObject,
  parseAuthHeader,
  parseNumericHeader,
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
  openAIContentToGoogleContent,
  openAIMessagesToGoogleMessages,
  OpenAIParamsToGoogleParams,
} from "./providers/google";
import {
  Message,
  MessageRole,
  responseFormatSchema,
} from "@braintrust/core/typespecs";
import { _urljoin, isArray } from "@braintrust/core";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  CompletionUsage,
  CreateEmbeddingResponse,
  ModerationCreateResponse,
} from "openai/resources";
import {
  ResponseCreateParams,
  ResponseInputContent,
  ResponseInputItem,
  Response as OpenAIResponse,
  ResponseOutputItem,
} from "openai/resources/responses/responses";
import {
  fetchBedrockAnthropic,
  fetchBedrockAnthropicMessages,
  fetchConverse,
} from "./providers/bedrock";
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
import { differenceInSeconds } from "date-fns";
import { makeFakeOpenAIStreamTransformer } from "./providers/openai";
import {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsBase,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import { getAzureEntraAccessToken } from "./providers/azure";
import { getDatabricksOAuthAccessToken } from "./providers/databricks";

type CachedMetadata = {
  cached_at: Date;
  ttl: number;
};
type CachedData = {
  headers: Record<string, string>;
  // XXX make this a required field once deployed and cache data is cycled for 1 week (previous max cache TTL)
  metadata?: CachedMetadata;
} & (
  | {
      // DEPRECATION_NOTICE: This can be removed in a couple weeks since writing (e.g. June 9 2024 onwards)
      body: string;
    }
  | {
      data: string;
    }
);

const MAX_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
export const CACHE_HEADER = "x-bt-use-cache";
export const CACHE_TTL_HEADER = "x-bt-cache-ttl";
export const CREDS_CACHE_HEADER = "x-bt-use-creds-cache";
export const ORG_NAME_HEADER = "x-bt-org-name";
export const ENDPOINT_NAME_HEADER = "x-bt-endpoint-name";
export const FORMAT_HEADER = "x-bt-stream-fmt";

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
  reportProgress: (progress: string) => void;
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
          h === "user-agent" ||
          h === "cache-control"
        ),
    ),
  );

  const authToken = parseAuthHeader(proxyHeaders);
  if (!authToken) {
    throw new ProxyBadRequestError("Missing Authentication header");
  }

  // Caching is enabled by default, but let the user disable it
  let useCacheMode = parseEnumHeader(
    CACHE_HEADER,
    CACHE_MODES,
    proxyHeaders[CACHE_HEADER],
  );
  const cacheTTL = Math.min(
    Math.max(
      1,
      parseNumericHeader(proxyHeaders, CACHE_TTL_HEADER) ?? DEFAULT_CACHE_TTL,
    ),
    MAX_CACHE_TTL,
  );
  const cacheControl = cacheControlParse(proxyHeaders["cache-control"] || "");
  const cacheMaxAge = cacheControl?.["max-age"];
  const noCache = !!cacheControl?.["no-cache"] || cacheMaxAge === 0;
  const noStore = !!cacheControl?.["no-store"];

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

  const isGoogleUrl = GOOGLE_URL_REGEX.test(url);

  const cacheableEndpoint =
    url === "/auto" ||
    url === "/embeddings" ||
    url === "/chat/completions" ||
    url === "/responses" ||
    url === "/completions" ||
    url === "/moderations" ||
    url === "/anthropic/messages" ||
    isGoogleUrl;

  let bodyData = null;
  if (
    url === "/auto" ||
    url === "/chat/completions" ||
    url === "/responses" ||
    url === "/completions" ||
    url === "/anthropic/messages" ||
    isGoogleUrl
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
  // TODO(sachin): Support caching for Google models.
  const temperatureNonZero =
    (url === "/chat/completions" ||
      url === "/completions" ||
      url === "/auto" ||
      url === "/responses" ||
      url === "/anthropic/messages" ||
      isGoogleUrl) &&
    bodyData &&
    bodyData.temperature !== 0 &&
    (bodyData.seed === undefined || bodyData.seed === null);

  const readFromCache =
    cacheableEndpoint &&
    useCacheMode !== "never" &&
    (useCacheMode === "always" || !temperatureNonZero) &&
    !noCache;

  const writeToCache =
    cacheableEndpoint &&
    useCacheMode !== "never" &&
    (useCacheMode === "always" || !temperatureNonZero) &&
    !noStore;

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
  if (readFromCache) {
    const cached = await cacheGet(encryptionKey, cacheKey);

    if (cached !== null) {
      const cachedData: CachedData = JSON.parse(cached);
      // XXX simplify once all cached data has a timestamp - assume existing data has age of 7 days
      const responseMaxAge = cachedData.metadata?.ttl ?? DEFAULT_CACHE_TTL;
      const age = cachedData.metadata
        ? differenceInSeconds(new Date(), cachedData.metadata.cached_at)
        : DEFAULT_CACHE_TTL;

      if (!cacheMaxAge || age <= cacheMaxAge) {
        cacheHits.add(1);
        for (const [name, value] of Object.entries(cachedData.headers)) {
          setHeader(name, value);
        }
        setHeader(CACHED_HEADER, "HIT");
        setHeader("cache-control", `max-age=${responseMaxAge}`);
        setHeader("age", `${age}`);

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
              let splits = cachedData.body.split("\n");
              for (let i = 0; i < splits.length; i++) {
                controller.enqueue(
                  new TextEncoder().encode(
                    splits[i] + (i < splits.length - 1 ? "\n" : ""),
                  ),
                );
              }
            } else if ("data" in cachedData && cachedData.data) {
              const data = Buffer.from(cachedData.data, "base64");
              let start = 0;
              for (let i = 0; i < data.length; i++) {
                if (data[i] === 10) {
                  // 10 is ASCII/UTF-8 code for \n
                  controller.enqueue(
                    new Uint8Array(data.subarray(start, i + 1)),
                  );
                  start = i + 1;
                }
              }
              if (start < data.length) {
                controller.enqueue(new Uint8Array(data.subarray(start)));
              }
            }

            controller.close();
          },
        });
      } else {
        cacheMisses.add(1);
      }
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
      digest,
      cacheGet,
      cachePut,
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
    setHeader(CACHED_HEADER, "MISS");
    if (writeToCache) {
      setHeader("cache-control", `max-age=${cacheTTL}`);
      setHeader("age", "0");
    }

    if (stream && proxyResponse.ok && writeToCache) {
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
            JSON.stringify({
              headers: proxyResponseHeaders,
              metadata: {
                cached_at: new Date(),
                ttl: cacheTTL,
              },
              data: dataB64,
            }),
            cacheTTL,
          );
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

const RATE_LIMIT_ERROR_CODE = 429;
const OVERLOADED_ERROR_CODE = 503;
const RATE_LIMIT_MAX_WAIT_MS = 45 * 1000; // Wait up to 45 seconds while retrying
const BACKOFF_EXPONENT = 2;

const TRY_ANOTHER_ENDPOINT_ERROR_CODES = [
  // 404 means the model or endpoint doesn't exist. We may want to propagate these errors, or
  // report them elsewhere, but for now round robin.
  404,

  // 429 is rate limiting. We may want to track stats about this and potentially handle more
  // intelligently, eg if all APIs are rate limited, back off and try something else.
  RATE_LIMIT_ERROR_CODE,

  // 503 is overloaded. We may want to track stats about this and potentially handle more
  // intelligently, eg if all APIs are overloaded, back off and try something else.
  OVERLOADED_ERROR_CODE,
];

const RATE_LIMITING_ERROR_CODES = [
  RATE_LIMIT_ERROR_CODE,
  OVERLOADED_ERROR_CODE,
];

const GOOGLE_URL_REGEX =
  /\/google\/(models\/[^:]+|publishers\/[^\/]+\/models\/[^:]+):([^\/]+)/;

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
  digest: (message: string) => Promise<string>,
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>,
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>,
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
      url === "/completions" ||
      url === "/responses" ||
      url === "/anthropic/messages") &&
    isObject(bodyData) &&
    bodyData.model
  ) {
    model = bodyData.model;
  } else if (method === "POST") {
    const m = url.match(GOOGLE_URL_REGEX);
    if (m) {
      model = m[1];
      // Hack since Gemini models are not registered with the models/ prefix.
      model = model.replace(/^models\//, "");
    }
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

  let retries = 0;
  console.log(`FOUND ${secrets.length} SECRETS`);
  for (; i < secrets.length; i++) {
    console.log(`TRYING ${i} of ${secrets.length}`);
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
        modelSpec,
        method,
        endpointUrl,
        { ...headers, ...additionalHeaders },
        secret,
        bodyData,
        setHeader,
        digest,
        cacheGet,
        cachePut,
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
        console.log("BREAKING");
        break;
      } else if (i < secrets.length - 1) {
        httpCode = proxyResponse.response.status;
        httpHeaders = proxyResponse.response.headers;
      }
    } catch (e) {
      console.log("ERROR", e);
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
      httpCode !== undefined &&
      RATE_LIMITING_ERROR_CODES.includes(httpCode) &&
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

      const sleepTime =
        delayMs > 1000
          ? Math.round(delayMs / 1000)
          : Number((delayMs / 1000).toFixed(1));
      spanLogger?.reportProgress(`Retrying (${++retries})...`);
      await new Promise((r) => setTimeout(r, delayMs));

      totalWaitedTime += delayMs;
      i = -1; // Reset the loop variable
    } else if (
      httpCode !== undefined &&
      i === secrets.length - 1 &&
      !proxyResponse
    ) {
      // Convert the HTTP code into a more reasonable error that is easier to parse
      // and display to the user.
      const headersString: string[] = [];
      httpHeaders.forEach((value, key) => {
        headersString.push(`${key}: ${value}`);
      });
      const errorText =
        `AI provider returned ${httpCode} error.\n\nHeaders:\n` +
        headersString.join("\n");
      proxyResponse = {
        response: new Response(null, { status: httpCode }),
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(errorText));
            controller.close();
          },
        }),
      };
    } else {
      console.warn(
        "Received retryable error. Will try the next endpoint",
        httpCode,
      );
      spanLogger?.reportProgress(`Retrying (${++retries})...`);
    }

    endpointRetryableErrors.add(1, {
      ...loggableInfo,
      http_code: httpCode,
    });
  }

  retriesPerCall.record(i, loggableInfo);
  spanLogger?.log({
    metrics: { retries },
  });

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
  modelSpec: ModelSpec | null,
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  secret: APISecret,
  bodyData: null | any,
  setHeader: (name: string, value: string) => void,
  digest: (message: string) => Promise<string>,
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>,
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>,
): Promise<ModelResponse> {
  const format = modelSpec?.format ?? "openai";
  switch (format) {
    case "openai":
      return await fetchOpenAI(
        modelSpec,
        method,
        url,
        headers,
        bodyData,
        secret,
        setHeader,
        digest,
        cacheGet,
        cachePut,
      );
    case "anthropic":
      console.assert(method === "POST");
      return await fetchAnthropic({
        url,
        modelSpec,
        headers,
        bodyData,
        secret,
      });
    case "google":
      console.assert(method === "POST");
      return await fetchGoogle({
        secret,
        modelSpec,
        url,
        headers,
        bodyData,
      });
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

function responseContentFromChatCompletionContent(
  content: ChatCompletionContentPart,
): ResponseInputContent {
  switch (content.type) {
    case "text":
      return {
        text: content.text,
        type: "input_text",
      };
    case "image_url":
      return {
        detail: content.image_url.detail ?? "auto",
        image_url: content.image_url.url,
        type: "input_image",
      };
    case "file":
      return {
        type: "input_file",
        file_data: content.file.file_data,
        file_id: content.file.file_id,
        filename: content.file.filename,
      };
    default:
      throw new ProxyBadRequestError(
        `Unsupported content type ${content.type}`,
      );
  }
}
function responseInputItemsFromChatCompletionMessage(
  message: ChatCompletionMessageParam,
): ResponseInputItem[] {
  switch (message.role) {
    case "developer":
    case "system":
    case "user":
      return [
        {
          content: isArray(message.content)
            ? message.content.map(responseContentFromChatCompletionContent)
            : message.content,
          role: message.role,
          type: "message",
        },
      ];
    case "assistant":
      return message.tool_calls
        ? message.tool_calls.map((t) => ({
            arguments: t.function.arguments,
            call_id: t.id,
            name: t.function.name,
            type: "function_call",
          }))
        : [
            {
              content: isArray(message.content)
                ? message.content
                    .filter((p) => p.type !== "refusal")
                    .map(responseContentFromChatCompletionContent)
                : message.content ?? "",
              role: "assistant",
              type: "message",
            },
          ];
    case "tool":
      return [
        {
          call_id: message.tool_call_id,
          output: isArray(message.content)
            ? message.content.map((c) => c.text).join("")
            : message.content,
          type: "function_call_output",
        },
      ];
    default:
      throw new ProxyBadRequestError(
        `Unsupported message role ${message.role}`,
      );
  }
}

function chatCompletionMessageFromResponseOutput(
  output: Array<ResponseOutputItem>,
): ChatCompletionMessage {
  const messages = output.filter((i) => i.type === "message");
  const text = messages
    .map((m) => m.content.filter((x) => x.type === "output_text"))
    .flat();
  const refusals = messages
    .map((m) => m.content.filter((x) => x.type === "refusal"))
    .flat();
  const toolCalls = output.filter((i) => i.type === "function_call");
  return {
    content: text.length > 0 ? text.map((t) => t.text).join("") : null,
    refusal:
      refusals.length > 0 ? refusals.map((r) => r.refusal).join("") : null,
    role: "assistant",
    tool_calls:
      toolCalls.length > 0
        ? toolCalls.map((t) => ({
            id: t.id ?? "",
            function: {
              arguments: t.arguments,
              name: t.name,
            },
            type: "function",
          }))
        : undefined,
  };
}

function chatCompletionFromResponse(response: OpenAIResponse): ChatCompletion {
  return {
    choices: [
      {
        finish_reason: response.output.some((i) => i.type === "function_call")
          ? "tool_calls"
          : "stop",
        index: 0,
        logprobs: null,
        message: chatCompletionMessageFromResponseOutput(response.output),
      },
    ],
    created: response.created_at,
    id: response.id,
    model: response.model,
    object: "chat.completion",
    usage: response.usage
      ? {
          completion_tokens: response.usage.output_tokens,
          prompt_tokens: response.usage.input_tokens,
          total_tokens: response.usage.total_tokens,
          completion_tokens_details: {
            reasoning_tokens:
              response.usage.output_tokens_details.reasoning_tokens,
          },
          prompt_tokens_details: {
            cached_tokens: response.usage.input_tokens_details.cached_tokens,
          },
        }
      : undefined,
  };
}

function responsesRequestFromChatCompletionsRequest(
  request: ChatCompletionCreateParams,
): ResponseCreateParams {
  return {
    input: request.messages.flatMap(
      responseInputItemsFromChatCompletionMessage,
    ),
    model: request.model,
    max_output_tokens: request.max_tokens,
    parallel_tool_calls: request.parallel_tool_calls,
    reasoning: request.reasoning_effort
      ? {
          effort: request.reasoning_effort,
        }
      : undefined,
    temperature: request.temperature,
    text: request.response_format
      ? (() => {
          const response_format = request.response_format;
          switch (response_format.type) {
            case "text":
            case "json_object":
              return {
                format: response_format,
              };
            case "json_schema":
              return {
                format: {
                  schema: response_format.json_schema.schema ?? {},
                  type: "json_schema",
                  description: response_format.json_schema.description,
                  name: response_format.json_schema.name,
                  strict: response_format.json_schema.strict,
                },
              };
          }
        })()
      : undefined,
    tool_choice: request.tool_choice
      ? (() => {
          const tool_choice = request.tool_choice;
          switch (tool_choice) {
            case "none":
            case "auto":
            case "required":
              return tool_choice;
            default:
              return {
                name: tool_choice.function.name,
                type: "function",
              };
          }
        })()
      : undefined,
    tools: request.tools?.map((tool) => ({
      name: tool.function.name,
      parameters: tool.function.parameters ?? {},
      strict: false,
      type: "function",
      description: tool.function.description,
    })),
    top_p: request.top_p,
  };
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<any> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combinedData = flattenChunks(chunks);
  return JSON.parse(combinedData);
}

async function fetchOpenAIResponsesTranslate({
  headers,
  body,
}: {
  headers: Record<string, string>;
  body: ChatCompletionCreateParams;
}): Promise<ModelResponse> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify(responsesRequestFromChatCompletionsRequest(body)),
  });
  let stream = response.body;
  if (response.ok && stream) {
    const oaiResponse: OpenAIResponse = await collectStream(stream);
    if (oaiResponse.error) {
      throw new Error(oaiResponse.error.message);
    }
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify(chatCompletionFromResponse(oaiResponse)),
          ),
        );
        controller.close();
      },
    });
    if (body.stream) {
      // Fake stream for now, since it looks like the entire text output is sent in one chunk,
      // so we don't see any UX improvement.
      stream = stream.pipeThrough(makeFakeOpenAIStreamTransformer());
    }
  }
  return {
    stream,
    response,
  };
}

async function fetchOpenAIResponses({
  headers,
  body,
}: {
  headers: Record<string, string>;
  body: ResponseCreateParams;
}): Promise<ModelResponse> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    stream: response.body,
    response,
  };
}

async function fetchOpenAI(
  modelSpec: ModelSpec | null,
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  bodyData: null | any,
  secret: APISecret,
  setHeader: (name: string, value: string) => void,
  digest: (message: string) => Promise<string>,
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>,
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>,
): Promise<ModelResponse> {
  if (secret.type === "bedrock") {
    throw new ProxyBadRequestError(`Bedrock does not support OpenAI format`);
  }

  let fullURL: URL | null | undefined = undefined;
  let bearerToken: string | null | undefined = undefined;

  if (secret.type === "vertex") {
    console.assert(url === "/chat/completions");
    const { project, authType, api_base } = VertexMetadataSchema.parse(
      secret.metadata,
    );
    const locations = modelSpec?.locations?.length
      ? modelSpec.locations
      : ["us-central1"];
    const location = locations[Math.floor(Math.random() * locations.length)];
    const baseURL = api_base || `https://${location}-aiplatform.googleapis.com`;
    if (bodyData.model.startsWith("publishers/meta")) {
      // Use the OpenAPI endpoint.
      fullURL = new URL(
        `${baseURL}/v1beta1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`,
      );
      bodyData.model = bodyData.model.replace(
        /^publishers\/(\w+)\/models\//,
        "$1/",
      );
    } else {
      // Use standard endpoint with RawPredict/StreamRawPredict.
      fullURL = new URL(
        `${baseURL}/v1/projects/${project}/locations/${location}/${bodyData.model}:${bodyData.stream ? "streamRawPredict" : "rawPredict"}`,
      );
      bodyData.model = bodyData.model.replace(/^publishers\/\w+\/models\//, "");
    }
    if (authType === "access_token") {
      bearerToken = secret.secret;
    } else {
      // authType === "service_account_key"
      bearerToken = await getGoogleAccessToken(secret.secret);
    }
  } else {
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

    if (secret.type === "azure" && !secret.metadata?.no_named_deployment) {
      if (secret.metadata?.deployment) {
        baseURL = _urljoin(
          baseURL,
          "openai/deployments",
          encodeURIComponent(secret.metadata.deployment),
        );
      } else if (bodyData?.model || bodyData?.engine) {
        const model = bodyData.model || bodyData.engine;
        baseURL = _urljoin(
          baseURL,
          "openai/deployments",
          encodeURIComponent(model.replace("gpt-3.5", "gpt-35")),
        );
      } else {
        throw new ProxyBadRequestError(
          `Azure provider ${secret.id} must have a deployment or model specified`,
        );
      }
    } else if (secret.type === "lepton") {
      baseURL = baseURL.replace("<model>", bodyData.model);
    }

    if (secret.type === "azure" && secret.metadata?.auth_type === "entra_api") {
      const azureEntrySecret = AzureEntraSecretSchema.parse(
        JSON.parse(secret.secret),
      );
      bearerToken = await getAzureEntraAccessToken({
        secret: azureEntrySecret,
        digest,
        cacheGet,
        cachePut,
      });
    } else if (
      secret.type === "databricks" &&
      secret.metadata?.auth_type === "service_principal_oauth"
    ) {
      bearerToken = await getDatabricksOAuthAccessToken({
        secret: DatabricksOAuthSecretSchema.parse(JSON.parse(secret.secret)),
        apiBase: baseURL,
        digest,
        cacheGet,
        cachePut,
      });
    } else {
      bearerToken = secret.secret;
    }

    if (secret.type === "databricks") {
      console.assert(url === "/chat/completions");
      fullURL = new URL(
        `${baseURL}/serving-endpoints/${bodyData.model}/invocations`,
      );
    } else {
      fullURL = new URL(baseURL + url);
    }
  }

  if (
    secret.type === "mistral" ||
    secret.type === "fireworks" ||
    secret.type === "databricks"
  ) {
    delete bodyData["stream_options"];
  }

  if (secret.type === "mistral" || secret.type === "databricks") {
    delete bodyData["parallel_tool_calls"];
  }

  headers["host"] = fullURL.host;
  headers["authorization"] = "Bearer " + bearerToken;

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

  if (url === "/responses") {
    return fetchOpenAIResponses({
      headers,
      body: bodyData,
    });
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
    delete bodyData.parallel_tool_calls;

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

  if (bodyData.model.startsWith("o1-pro")) {
    return fetchOpenAIResponsesTranslate({
      headers,
      body: bodyData,
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

  if (isStream) {
    setHeader("content-type", "text/event-stream; charset=utf-8");
  }
  return {
    stream:
      isStream && proxyResponse.ok
        ? proxyResponse.body?.pipeThrough(makeFakeOpenAIStreamTransformer()) ||
          createEmptyReadableStream()
        : proxyResponse.body,
    response: proxyResponse,
  };
}

interface VertexEndpointInfo {
  baseUrl: string;
  accessToken: string;
}

async function vertexEndpointInfo({
  secret: { secret, metadata },
  modelSpec,
  defaultLocation,
}: {
  secret: APISecret;
  modelSpec: ModelSpec | null;
  defaultLocation: string;
}): Promise<VertexEndpointInfo> {
  const { project, authType, api_base } = VertexMetadataSchema.parse(metadata);
  const locations = modelSpec?.locations?.length
    ? modelSpec.locations
    : [defaultLocation];
  const location = locations[Math.floor(Math.random() * locations.length)];
  const apiBase = api_base || `https://${location}-aiplatform.googleapis.com`;
  const accessToken =
    authType === "access_token" ? secret : await getGoogleAccessToken(secret);
  if (!accessToken) {
    throw new Error("Failed to get Google access token");
  }
  return {
    baseUrl: `${apiBase}/v1/projects/${project}/locations/${location}`,
    accessToken,
  };
}

async function fetchVertexAnthropicMessages({
  secret,
  modelSpec,
  body,
}: {
  secret: APISecret;
  modelSpec: ModelSpec | null;
  body: unknown;
}): Promise<ModelResponse> {
  const { baseUrl, accessToken } = await vertexEndpointInfo({
    secret,
    modelSpec,
    defaultLocation: "us-east5",
  });
  const { model, ...rest } = z
    .object({
      model: z.string(),
    })
    .passthrough()
    .parse(body);
  return await fetch(`${baseUrl}/${model}:streamRawPredict`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...rest,
      anthropic_version: "vertex-2023-10-16",
    }),
  }).then((resp) => ({
    stream: resp.body,
    response: resp,
  }));
}

async function fetchAnthropicMessages({
  secret,
  modelSpec,
  body,
}: {
  secret: APISecret;
  modelSpec: ModelSpec | null;
  body: unknown;
}): Promise<ModelResponse> {
  switch (secret.type) {
    case "anthropic":
      return await fetch(`${EndpointProviderToBaseURL.anthropic}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": secret.secret,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      }).then((resp) => ({
        stream: resp.body,
        response: resp,
      }));
    case "bedrock":
      return fetchBedrockAnthropicMessages({
        secret,
        body,
      });
    case "vertex":
      return fetchVertexAnthropicMessages({
        secret,
        modelSpec,
        body,
      });
    default:
      throw new ProxyBadRequestError(
        `Unsupported Anthropic secret type: ${secret.type}`,
      );
  }
}

async function fetchAnthropic({
  url,
  modelSpec,
  headers,
  bodyData,
  secret,
}: {
  url: string;
  modelSpec: ModelSpec | null;
  headers: Record<string, string>;
  bodyData: null | any;
  secret: APISecret;
}): Promise<ModelResponse> {
  switch (url) {
    case "/anthropic/messages":
      return fetchAnthropicMessages({
        secret,
        modelSpec,
        body: bodyData,
      });
    case "/chat/completions":
      return fetchAnthropicChatCompletions({
        modelSpec,
        headers,
        bodyData,
        secret,
      });
    default:
      throw new ProxyBadRequestError(`Unsupported Anthropic URL: ${url}`);
  }
}

async function fetchAnthropicChatCompletions({
  modelSpec,
  headers,
  bodyData,
  secret,
}: {
  modelSpec: ModelSpec | null;
  headers: Record<string, string>;
  bodyData: null | any;
  secret: APISecret;
}): Promise<ModelResponse> {
  // https://docs.anthropic.com/claude/reference/complete_post
  let fullURL = new URL(EndpointProviderToBaseURL.anthropic + "/messages");
  if (secret.type !== "vertex") {
    headers["accept"] = "application/json";
    headers["anthropic-version"] = "2023-06-01";
    headers["host"] = fullURL.host;
    headers["x-api-key"] = secret.secret;
  }

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

  const stop = z
    .union([z.string(), z.array(z.string())])
    .nullish()
    .parse(oaiParams.stop);
  params.stop_sequences = stop
    ? Array.isArray(stop)
      ? stop
      : [stop]
    : undefined;

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
  } else if (secret.type === "vertex") {
    const { baseUrl, accessToken } = await vertexEndpointInfo({
      secret,
      modelSpec,
      defaultLocation: "us-east5",
    });
    fullURL = new URL(
      `${baseUrl}/${params.model}:${params.stream ? "streamRawPredict" : "rawPredict"}`,
    );
    headers["authorization"] = `Bearer ${accessToken}`;
    params["anthropic_version"] = "vertex-2023-10-16";
    delete params.model;
  }

  const proxyResponse = await fetch(fullURL.toString(), {
    method: "POST",
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

function convertToNullable(obj: any) {
  const anyOf = obj.anyOf;
  if (anyOf) {
    if (anyOf.length !== 2) {
      throw new ProxyBadRequestError(
        "Google only supports Optional types for unions",
      );
    }
    const [a, b] = anyOf;
    if (a.type === "null") {
      Object.assign(obj, b);
    } else if (b.type === "null") {
      Object.assign(obj, a);
    } else {
      throw new ProxyBadRequestError(
        "Google only supports Optional types for unions",
      );
    }
    delete obj.anyOf;
    obj.nullable = true;
  }

  if (obj.properties) {
    for (const value of Object.values(obj.properties)) {
      convertToNullable(value);
    }
  }

  if (obj.items) {
    convertToNullable(obj.items);
  }
}

function stripFields(obj: any) {
  delete obj.title;
  delete obj.additionalProperties;
  delete obj.default;

  if (obj.properties) {
    for (const value of Object.values(obj.properties)) {
      stripFields(value);
    }
  }

  if (obj.items) {
    stripFields(obj.items);
  }
}

async function googleSchemaFromJsonSchema(schema: any): Promise<any> {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  await $RefParser.dereference(schema);
  delete schema.$defs;
  convertToNullable(schema);
  stripFields(schema);
  return schema;
}

async function openAIToolsToGoogleTools(params: ChatCompletionCreateParams) {
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
            function_declarations: await Promise.all(
              params.tools.map(async (t) => ({
                name: t.function.name,
                description: t.function.description,
                parameters: await googleSchemaFromJsonSchema(
                  t.function.parameters,
                ),
              })),
            ),
          },
        ]
      : undefined,
    tool_config,
  };
  delete params.tools;
  delete params.tool_choice;
  return out;
}

async function getGoogleAccessToken(secret: string): Promise<string> {
  const {
    private_key_id: kid,
    private_key: pk,
    client_email: email,
    token_uri: tokenUri,
  } = z
    .object({
      type: z.literal("service_account"),
      private_key_id: z.string(),
      private_key: z.string(),
      client_email: z.string(),
      token_uri: z.string(),
    })
    .parse(JSON.parse(secret));
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid })
    .setIssuer(email)
    .setAudience(tokenUri)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(await importPKCS8(pk, "RS256"));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  return z
    .object({
      access_token: z.string(),
      token_type: z.literal("Bearer"),
    })
    .parse(await res.json()).access_token;
}

async function fetchGoogleGenerateContent({
  secret,
  model,
  modelSpec,
  method,
  body,
}: {
  secret: APISecret;
  model: string;
  modelSpec: ModelSpec | null;
  method: string;
  body: unknown;
}): Promise<ModelResponse> {
  // Hack since Gemini models are not registered with the models/ prefix.
  model = model.replace(/^models\//, "");
  switch (secret.type) {
    case "google": {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`,
      );
      if (method === "streamGenerateContent") {
        url.searchParams.set("alt", "sse");
      }
      url.searchParams.set("key", secret.secret);
      return await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }).then((resp) => ({
        stream: resp.body,
        response: resp,
      }));
    }
    case "vertex": {
      const { baseUrl, accessToken } = await vertexEndpointInfo({
        secret,
        modelSpec,
        defaultLocation: "us-central1",
      });
      const url = new URL(`${baseUrl}/${model}:${method}`);
      if (method === "streamGenerateContent") {
        url.searchParams.set("alt", "sse");
      }
      return await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }).then((resp) => ({
        stream: resp.body,
        response: resp,
      }));
    }
    default:
      throw new ProxyBadRequestError(
        `Unsupported credentials for Google: ${secret.type}`,
      );
  }
}

async function fetchGoogle({
  secret,
  modelSpec,
  url,
  headers,
  bodyData,
}: {
  secret: APISecret;
  modelSpec: ModelSpec | null;
  url: string;
  headers: Record<string, string>;
  bodyData: null | any;
}): Promise<ModelResponse> {
  if (secret.type !== "google" && secret.type !== "vertex") {
    throw new ProxyBadRequestError(
      `Unsupported credentials for Google: ${secret.type}`,
    );
  }
  const m = url.match(GOOGLE_URL_REGEX);
  if (m) {
    return await fetchGoogleGenerateContent({
      secret,
      model: m[1],
      modelSpec,
      method: m[2],
      body: bodyData,
    });
  } else {
    return await fetchGoogleChatCompletions({
      secret,
      modelSpec,
      headers,
      bodyData,
    });
  }
}

async function fetchGoogleChatCompletions({
  secret,
  modelSpec,
  headers,
  bodyData,
}: {
  secret: APISecret;
  modelSpec: ModelSpec | null;
  headers: Record<string, string>;
  bodyData: null | any;
}): Promise<ModelResponse> {
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
  const systemMessage = oaiMessages.find((m: any) => m.role === "system");
  const content = await openAIMessagesToGoogleMessages(
    oaiMessages.filter((m: any) => m.role !== "system"),
  );
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

  let fullURL: URL;
  if (secret.type === "google") {
    fullURL = new URL(
      EndpointProviderToBaseURL.google! +
        `/models/${encodeURIComponent(model)}:${
          streamingMode ? "streamGenerateContent" : "generateContent"
        }`,
    );
    fullURL.searchParams.set("key", secret.secret);
    delete headers["authorization"];
  } else {
    // secret.type === "vertex"
    const { baseUrl, accessToken } = await vertexEndpointInfo({
      secret,
      modelSpec,
      defaultLocation: "us-central1",
    });
    fullURL = new URL(
      `${baseUrl}/${model}:${streamingMode ? "streamGenerateContent" : "generateContent"}`,
    );
    headers["authorization"] = `Bearer ${accessToken}`;
  }
  if (streamingMode) {
    fullURL.searchParams.set("alt", "sse");
  }

  headers["content-type"] = "application/json";

  if (
    oaiParams.response_format?.type === "json_object" ||
    oaiParams.response_format?.type === "json_schema"
  ) {
    params.response_mime_type = "application/json";
  }
  if (oaiParams.response_format?.type === "json_schema") {
    params.response_schema = await googleSchemaFromJsonSchema(
      oaiParams.response_format.json_schema.schema,
    );
  }
  const stop = z
    .union([z.string(), z.array(z.string())])
    .nullish()
    .parse(oaiParams.stop);
  params.stopSequences = stop
    ? Array.isArray(stop)
      ? stop
      : [stop]
    : undefined;

  const body = JSON.stringify({
    contents: content,
    systemInstruction: systemMessage
      ? {
          parts: await openAIContentToGoogleContent(systemMessage.content),
        }
      : undefined,
    generationConfig: params,
    ...(await openAIToolsToGoogleTools(params)),
  });

  const proxyResponse = await fetch(fullURL.toString(), {
    method: "POST",
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
    url === "/chat/completions" ||
    url === "/responses" ||
    url === "/anthropic/messages" ||
    GOOGLE_URL_REGEX.test(url)
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
