import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { APISecret, BedrockMetadata } from "@schema";
import {
  anthropicCompletionToOpenAICompletion,
  anthropicEventToOpenAIEvent,
} from "./anthropic";

const brt = new BedrockRuntimeClient({});
export async function fetchBedrockAnthropic({
  secret,
  body,
  isFunction,
}: {
  secret: APISecret;
  body: Record<string, unknown>;
  isFunction: boolean;
}) {
  if (secret.type !== "bedrock") {
    throw new Error("Bedrock: expected secret");
  }

  const { model, stream, ...rest } = body;
  if (!model || typeof model !== "string") {
    throw new Error("Bedrock: expected model");
  }

  const metadata = secret.metadata as BedrockMetadata;

  const brt = new BedrockRuntimeClient({
    region: metadata.region,
    credentials: {
      accessKeyId: metadata.access_key,
      secretAccessKey: secret.secret,
    },
  });

  const input = {
    body: new TextEncoder().encode(
      JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        ...rest,
      }),
    ),
    contentType: "application/json",
    modelId: model,
  };

  let responseStream;
  if (stream) {
    const command = new InvokeModelWithResponseStreamCommand(input);
    const response = await brt.send(command);
    if (!response.body) {
      throw new Error("Bedrock: empty response body");
    }
    const bodyStream = response.body;
    const iterator = bodyStream[Symbol.asyncIterator]();
    let idx = 0;
    responseStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) {
          // Close the stream when no more data is available
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        } else {
          // Enqueue the next piece of data into the stream
          if (value.chunk?.bytes) {
            const valueData = JSON.parse(
              new TextDecoder().decode(value.chunk.bytes),
            );
            idx += 1;
            const parsed = anthropicEventToOpenAIEvent(idx, valueData);
            if (parsed.event) {
              controller.enqueue(
                new TextEncoder().encode(
                  "data: " + JSON.stringify(parsed.event) + "\n\n",
                ),
              );
            } else {
              // Cloudflare seems to freak out unless we send something
              controller.enqueue(new TextEncoder().encode(""));
            }
          }
        }
      },
      async cancel() {
        // Optional: Handle any cleanup if necessary when the stream is canceled
        if (typeof iterator.return === "function") {
          await iterator.return();
        }
      },
    });
  } else {
    const command = new InvokeModelCommand(input);
    const response = await brt.send(command);
    responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(response.body);
        controller.close();
      },
    });
  }

  return {
    stream: responseStream,
    response: new Response(null, {
      status: 200,
    }),
  };
}
