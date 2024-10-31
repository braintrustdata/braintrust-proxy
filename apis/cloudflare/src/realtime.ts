import { RealtimeAPI } from "@openai/realtime-api-beta";
import { APISecret, ProxyLoggingParam } from "@braintrust/proxy/schema";
import { ORG_NAME_HEADER } from "@braintrust/proxy";
import {
  isTempCredential,
  verifyTempCredentials,
} from "@braintrust/proxy/utils";
import { OpenAiRealtimeLogger } from "./realtime-logger";
import { braintrustAppUrl } from "./env";

const MODEL = "gpt-4o-realtime-preview-2024-10-01";

export async function handleRealtimeProxy({
  request,
  env,
  ctx,
  cacheGet,
  getApiSecrets,
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
}): Promise<Response> {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  let realtimeApi: RealtimeAPI | null = null;

  server.accept();

  const responseHeaders = new Headers();
  const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
  let apiKey: string | undefined;
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

  let loggingParams: ProxyLoggingParam | undefined;
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
  }

  const orgName = request.headers.get(ORG_NAME_HEADER) ?? undefined;

  secrets = await getApiSecrets(true, apiKey, model, orgName);

  if (secrets.length === 0) {
    return new Response("No secrets found", { status: 401 });
  }

  const realtimeLogger: OpenAiRealtimeLogger | undefined =
    loggingParams &&
    new OpenAiRealtimeLogger({
      apiKey,
      appUrl: braintrustAppUrl(env).toString(),
      loggingParams,
    });

  // Create RealtimeClient
  try {
    (globalThis as any).document = 1; // This tricks the OpenAI library into using `new WebSocket`
    console.log("Creating RealtimeClient");
    realtimeApi = new RealtimeAPI({
      apiKey: secrets[0].secret,
      dangerouslyAllowAPIKeyInBrowser: true,
    });
    (globalThis as any).document = undefined; // Clean up after ourselves
  } catch (e) {
    console.error(`Error connecting to OpenAI: ${e}`);
    server.close();
    return new Response("Error connecting to OpenAI", { status: 502 });
  }

  // Relay: OpenAI Realtime API Event -> Client
  realtimeApi.on("server.*", (event: { type: string }) => {
    server.send(JSON.stringify(event));
    try {
      realtimeLogger?.handleMessageServer(event);
    } catch (e) {
      console.warn(`Error logging server event: ${e} ${event.type}`);
    }
  });

  realtimeApi.on("close", () => {
    console.log("Closing server-side because I received a close event");
    server.close();
    if (realtimeLogger) {
      ctx.waitUntil(realtimeLogger.close());
    }
  });

  // Relay: Client -> OpenAI Realtime API Event
  const messageQueue: string[] = [];

  server.addEventListener("message", (event: MessageEvent) => {
    const messageHandler = (data: string) => {
      try {
        const parsedEvent = JSON.parse(data);
        realtimeApi.send(parsedEvent.type, parsedEvent);
        try {
          realtimeLogger?.handleMessageClient(parsedEvent);
        } catch (e) {
          console.warn(`Error logging client event: ${e} ${parsedEvent.type}`);
        }
      } catch (e) {
        console.error(`Error parsing event from client: ${data}`);
      }
    };

    const data =
      typeof event.data === "string" ? event.data : event.data.toString();
    if (!realtimeApi.isConnected()) {
      messageQueue.push(data);
    } else {
      messageHandler(data);
    }
  });

  server.addEventListener("close", () => {
    console.log("Closing server-side because the client closed the connection");
    realtimeApi.disconnect();
    if (realtimeLogger) {
      ctx.waitUntil(realtimeLogger.close());
    }
  });

  // Connect to OpenAI Realtime API
  try {
    // TODO: Remove after https://github.com/openai/openai-realtime-api-beta/pull/37 merges.
    (globalThis as any).document = 1; // This tricks the OpenAI library into using `new WebSocket`
    console.log(`Connecting to OpenAI...`);
    await realtimeApi.connect();
    console.log(`Connected to OpenAI successfully!`);
    (globalThis as any).document = undefined; // Clean up after ourselves
    while (messageQueue.length) {
      const message = messageQueue.shift();
      if (message) {
        server.send(message);
      }
    }
  } catch (e) {
    if (e instanceof Error) {
      console.error(`Error connecting to OpenAI: ${e.message}`);
    } else {
      console.error(`Error connecting to OpenAI: ${e}`);
    }
    return new Response("Error connecting to OpenAI", { status: 500 });
  }

  return new Response(null, {
    status: 101,
    headers: responseHeaders,
    webSocket: client,
  });
}
