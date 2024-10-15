import { RealtimeClient } from "@openai/realtime-api-beta";
import { APISecret, fetchTempCredentials } from "@braintrust/proxy/schema";
import { ORG_NAME_HEADER } from "@braintrust/proxy";
import { initLogger, NOOP_SPAN } from "braintrust";
import { BraintrustRealtimeLogger, RealtimeMessage } from "./realtime-logger";

declare global {
  interface Env {
    OPENAI_API_KEY: string;
  }
}

const MODEL = "gpt-4o-realtime-preview-2024-10-01";

export async function handleRealtimeProxy({
  request,
  env,
  ctx,
  cacheGet,
  digest,
  getApiSecrets,
}: {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
  digest: (message: string) => Promise<string>;
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

  let realtimeClient: RealtimeClient | null = null;

  server.accept();

  // Copy protocol headers
  const responseHeaders = new Headers();
  const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
  let apiKey: string | undefined;
  if (protocolHeader) {
    const requestedProtocols = protocolHeader.split(",").map((p) => p.trim());
    if (requestedProtocols.includes("realtime")) {
      // Not exactly sure why this protocol needs to be accepted
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
  const model = url.searchParams.get("model") ?? MODEL;

  if (!apiKey) {
    return new Response("Missing API key", { status: 401 });
  }

  let braintrust_api_key: string | undefined;
  let project_name: string | undefined;
  let secrets: APISecret[] = [];

  // First, try to use temp credentials, because then we'll get access to the project name
  // for logging.
  const tempCredentials = await fetchTempCredentials({
    key: apiKey,
    cacheGet,
    digest,
  });
  if (tempCredentials !== "invalid" && tempCredentials !== "expired") {
    braintrust_api_key = tempCredentials.braintrust_api_key;
    project_name = tempCredentials.project_name;
    secrets = tempCredentials.secrets;
  } else {
    secrets = await getApiSecrets(
      true,
      apiKey,
      model,
      request.headers.get(ORG_NAME_HEADER) ?? undefined,
    );
  }

  if (secrets.length === 0) {
    return new Response("No secrets found", { status: 401 });
  }

  const realtimeLogger = new BraintrustRealtimeLogger({
    apiKey: braintrust_api_key,
    appUrl: env.BRAINTRUST_APP_URL,
    projectName: project_name,
  });

  // Create RealtimeClient
  try {
    (globalThis as any).document = 1; // This tricks the OpenAI library into using `new WebSocket`
    console.log("Creating RealtimeClient");
    realtimeClient = new RealtimeClient({
      apiKey: secrets[0].secret,
      dangerouslyAllowAPIKeyInBrowser: true,
    });
    (globalThis as any).document = undefined; // Clean up after ourselves
  } catch (e) {
    console.error(`Error creating RealtimeClient: ${e}`);
    server.close();
    return new Response("Error creating RealtimeClient", { status: 500 });
  }

  // Relay: OpenAI Realtime API Event -> Client
  realtimeClient.realtime.on("server.*", (event: { type: string }) => {
    // console.log(`Relaying "${event.type}" to Client`);
    // TODO: We should deserialize the data to RealtimeMessage
    try {
      realtimeLogger.handleMessageServer(event as RealtimeMessage);
    } catch (e) {
      console.warn(`Error logging server event: ${event}`);
    }
    server.send(JSON.stringify(event));
  });

  realtimeClient.realtime.on("close", () => {
    console.log("Closing server-side because I received a close event");
    ctx.waitUntil(realtimeLogger.close());
    server.close();
  });

  // Relay: Client -> OpenAI Realtime API Event
  const messageQueue: string[] = [];

  server.addEventListener("message", (event: MessageEvent) => {
    const messageHandler = (data: string) => {
      try {
        const parsedEvent = JSON.parse(data);
        try {
          realtimeLogger.handleMessageClient(parsedEvent);
        } catch (e) {
          console.warn(`Error logging client event: ${parsedEvent}`);
        }
        // console.log(`Relaying "${event.type}" to OpenAI`);
        realtimeClient.realtime.send(parsedEvent.type, parsedEvent);
      } catch (e) {
        console.error(`Error parsing event from client: ${data}`);
      }
    };

    const data =
      typeof event.data === "string" ? event.data : event.data.toString();
    if (!realtimeClient.isConnected()) {
      messageQueue.push(data);
    } else {
      messageHandler(data);
    }
  });

  server.addEventListener("close", () => {
    console.log("Closing server-side because the client closed the connection");
    realtimeClient.disconnect();
    ctx.waitUntil(realtimeLogger.close());
  });

  // Connect to OpenAI Realtime API
  try {
    // TODO: Remove after https://github.com/openai/openai-realtime-api-beta/pull/37 merges.
    (globalThis as any).document = 1; // This tricks the OpenAI library into using `new WebSocket`
    console.log(`Connecting to OpenAI...`);
    await realtimeClient.connect();
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
