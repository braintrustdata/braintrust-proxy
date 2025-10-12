import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";
import {
  APISecret,
  EndpointProviderToBaseURL,
  ProxyLoggingParam,
} from "@braintrust/proxy/schema";
import { ORG_NAME_HEADER, parseAuthHeader } from "@braintrust/proxy";
import {
  isTempCredential,
  verifyTempCredentials,
} from "@braintrust/proxy/utils";
import { OpenAiRealtimeLogger } from "./realtime-logger";
import { braintrustAppUrl } from "./env";
import {
  BT_PARENT,
  resolveParentHeader,
  SpanComponentsV3,
  SpanObjectTypeV3,
} from "braintrust/util";
import { Cache as EdgeCache } from "@braintrust/proxy/edge";
import { Span, startSpan } from "braintrust";
import { cachedLogin } from "./tracing";

const MODEL = "gpt-4o-realtime-preview-2024-10-01";

export async function handleRealtimeProxy({
  request,
  env,
  ctx,
  cacheGet,
  getApiSecrets,
  credentialsCache,
  span,
}: {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  getApiSecrets: (
    useCache: boolean,
    authToken: string,
    model: string | null,
    org_name?: string,
  ) => Promise<APISecret[]>;
  credentialsCache: EdgeCache;
  span?: Span;
}): Promise<Response> {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  let apiKey: string | undefined;
  let loggingParams: ProxyLoggingParam | undefined;

  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    apiKey = parseAuthHeader({ authorization: authHeader }) ?? undefined;
  }

  const orgName = request.headers.get(ORG_NAME_HEADER) ?? undefined;

  const parentHeader = request.headers.get(BT_PARENT);
  if (parentHeader) {
    let parent;
    try {
      parent = resolveParentHeader(parentHeader);
    } catch (e) {
      return new Response(
        `Invalid parent header '${parentHeader}': ${
          e instanceof Error ? e.message : String(e)
        }`,
        { status: 400 },
      );
    }
    loggingParams = {
      parent: parent.toStr(),
      compress_audio: false,
    };
  }

  const compressAudioHeader = request.headers.get("x-bt-compress-audio");
  if (compressAudioHeader && loggingParams) {
    const normalized = compressAudioHeader.trim().toLowerCase();
    const compressAudio: boolean = normalized === "1" || normalized === "true";
    loggingParams.compress_audio = compressAudio;
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  let realtimeApi: OpenAIRealtimeWebSocket | null = null;

  server.accept();

  const responseHeaders = new Headers();
  const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
  if (protocolHeader) {
    const requestedProtocols = protocolHeader.split(",").map((p) => p.trim());
    if (requestedProtocols.includes("realtime")) {
      // Not exactly sure why this protocol needs to be accepted.
      responseHeaders.set("Sec-WebSocket-Protocol", "realtime");
    }

    for (const protocol of requestedProtocols) {
      if (protocol.startsWith("openai-insecure-api-key.")) {
        const parsedApiKey = protocol
          .slice("openai-insecure-api-key.".length)
          .trim();
        if (parsedApiKey.length > 0 && parsedApiKey !== "null") {
          apiKey = parsedApiKey;
        }
      }
    }
  }

  const url = new URL(request.url);
  let model = url.searchParams.get("model") ?? MODEL;

  if (!apiKey) {
    return new Response("Missing API key", { status: 401 });
  }

  let secrets: APISecret[] = [];

  // First, try to use temp credentials, because then we'll get access to the project name
  // for logging.
  if (isTempCredential(apiKey)) {
    const { credentialCacheValue, jwtPayload } = await verifyTempCredentials({
      jwt: apiKey,
      cacheGet,
    });
    // Unwrap the API key here to avoid a duplicate call to
    // `verifyTempCredentials` inside `getApiSecrets`. That call will use Redis
    // which is not available in Cloudflare.
    apiKey = credentialCacheValue.authToken;
    loggingParams = jwtPayload.bt.logging ?? undefined;
    model = jwtPayload.bt.model ?? MODEL;

    // Create a span if we have logging params but no span (temp credential case)
    if (loggingParams) {
      let parentStr: string;
      if (loggingParams.project_name) {
        // Construct SpanComponentsV3 from project_name
        const components = new SpanComponentsV3({
          object_type: SpanObjectTypeV3.PROJECT_LOGS,
          compute_object_metadata_args: {
            project_name: loggingParams.project_name,
          },
        });
        parentStr = await components.export();
      } else if (loggingParams.parent) {
        // Use existing parent
        const parent = resolveParentHeader(loggingParams.parent);
        parentStr = parent.toStr();
      } else {
        throw new Error(
          "loggingParams must provide either project_name or parent",
        );
      }

      span = startSpan({
        state: await cachedLogin({
          appUrl: braintrustAppUrl(env).toString(),
          apiKey,
          orgName,
          cache: credentialsCache,
        }),
        type: "llm",
        name: "LLM",
        parent: parentStr,
      });
    }
  }

  secrets = await getApiSecrets(true, apiKey, model, orgName);
  if (secrets.length === 0) {
    // As a hack, check for gpt-4o, because many of the gpt realtime models are not
    // registered in the model list yet.
    secrets = await getApiSecrets(true, apiKey, "gpt-4o", orgName);
  }

  if (secrets.length === 0) {
    return new Response("No secrets found", { status: 401 });
  }

  const realtimeLogger: OpenAiRealtimeLogger | undefined =
    span &&
    loggingParams &&
    (await OpenAiRealtimeLogger.make({
      span,
      loggingParams,
    }));

  const secret = secrets[0];

  let baseURL =
    (secret.metadata &&
      "api_base" in secret.metadata &&
      secret.metadata.api_base) ||
    EndpointProviderToBaseURL[secret.type] ||
    EndpointProviderToBaseURL["openai"]!;

  // Create RealtimeClient
  try {
    console.log("Creating RealtimeApi");
    realtimeApi = new OpenAIRealtimeWebSocket(
      { model },
      { apiKey: secret.secret, baseURL },
    );
  } catch (e) {
    console.error(`Error connecting to OpenAI: ${e}`);
    server.close();
    return new Response("Error connecting to OpenAI", { status: 502 });
  }

  // Relay: OpenAI Realtime API Event -> Client
  realtimeApi.on("event", (event) => {
    server.send(JSON.stringify(event));
    try {
      realtimeLogger?.handleMessageServer(event);
    } catch (e) {
      console.warn(`Error logging server event: ${e} ${event.type}`);
    }
  });

  // Listen to the underlying WebSocket close event
  realtimeApi.socket.addEventListener("close", () => {
    console.log("Closing server-side because I received a close event");
    server.close();
    if (realtimeLogger) {
      ctx.waitUntil(realtimeLogger.close());
    }
  });

  // Relay: Client -> OpenAI Realtime API Event
  const messageQueue: string[] = [];

  const messageHandler = (data: string) => {
    let parsedEvent;
    try {
      parsedEvent = JSON.parse(data);
    } catch (e) {
      console.error(`Error parsing event from client: ${data}`);
      return;
    }

    realtimeApi!.send(parsedEvent);

    try {
      realtimeLogger?.handleMessageClient(parsedEvent);
    } catch (e) {
      console.warn(`Error logging client event: ${e} ${parsedEvent.type}`);
    }

    console.log("Sent message to OpenAI", data);
  };

  server.addEventListener("message", (event: MessageEvent) => {
    console.log("Message from client", event.data);

    const data =
      typeof event.data === "string" ? event.data : event.data.toString();
    if (realtimeApi!.socket.readyState !== 1) {
      console.log("Queueing message because socket is not open yet");
      messageQueue.push(data);
    } else {
      console.log("Sending message to OpenAI");
      messageHandler(data);
    }
  });

  server.addEventListener("close", () => {
    console.log("Closing server-side because the client closed the connection");
    realtimeApi!.close();
    if (realtimeLogger) {
      ctx.waitUntil(realtimeLogger.close());
    }
  });

  // Wait for the WebSocket to be connected and send queued messages
  realtimeApi.socket.addEventListener("open", () => {
    console.log(`Connected to OpenAI successfully!`);
    while (messageQueue.length) {
      const message = messageQueue.shift();
      if (message) {
        messageHandler(message);
      }
    }
  });

  realtimeApi.socket.addEventListener("error", (e) => {
    console.error(`Error connecting to OpenAI:`, e);
    server.close();
  });

  return new Response(null, {
    status: 101,
    headers: responseHeaders,
    webSocket: client,
  });
}
