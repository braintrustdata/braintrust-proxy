import { RealtimeClient } from "@openai/realtime-api-beta";

declare global {
  interface Env {
    OPENAI_API_KEY: string;
  }
}

export async function handleRealtimeProxy(
  request: Request,
  proxyV1Prefix: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
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
  if (protocolHeader) {
    const requestedProtocols = protocolHeader.split(",").map((p) => p.trim());
    console.log(requestedProtocols);
    if (requestedProtocols.includes("realtime")) {
      // Not exactly sure why this protocol needs to be accepted
      responseHeaders.set("Sec-WebSocket-Protocol", "realtime");
    }

    for (const protocol of requestedProtocols) {
      if (protocol.startsWith("openai-insecure-api-key.")) {
        const apiKey = protocol.slice("openai-insecure-api-key.".length).trim();
        if (apiKey.length > 0 && apiKey !== "null") {
          console.log(`Using API key: ${apiKey}`);
        }
      }
    }
  }

  // Create RealtimeClient
  try {
    (globalThis as any).document = 1; // This tricks the OpenAI library into using new WebSocket
    realtimeClient = new RealtimeClient({
      apiKey: env.OPENAI_API_KEY,
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
    server.send(JSON.stringify(event));
  });

  realtimeClient.realtime.on("close", () => {
    server.close();
  });

  // Relay: Client -> OpenAI Realtime API Event
  const messageQueue: string[] = [];

  server.addEventListener("message", (event: MessageEvent) => {
    const messageHandler = (data: string) => {
      try {
        const parsedEvent = JSON.parse(data);
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
    realtimeClient.disconnect();
  });

  // Connect to OpenAI Realtime API
  try {
    console.log(`Connecting to OpenAI...`);
    await realtimeClient.connect();
    console.log(`Connected to OpenAI successfully!`);
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
