/* eslint-disable turbo/no-undeclared-env-vars */

import { TextDecoder } from "util";
import { Buffer } from "node:buffer";
import { proxyV1 } from "../src/proxy";
import { APISecret, AvailableModels, getModelEndpointTypes } from "@schema";
import { createParser, ParsedEvent, ParseEvent } from "eventsource-parser";
import { mergeDicts } from "@braintrust/core";
import { assert } from "vitest";

export function createResponseStream(): [
  WritableStream<Uint8Array>,
  Promise<Uint8Array[]>,
] {
  const chunks: Uint8Array[] = [];
  let resolveChunks: (chunks: Uint8Array[]) => void;
  let rejectChunks: (error: Error) => void;

  const chunksPromise = new Promise<Uint8Array[]>((resolve, reject) => {
    resolveChunks = resolve;
    rejectChunks = reject;
  });

  const writableStream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
    close() {
      resolveChunks(chunks);
    },
    abort(reason) {
      rejectChunks(new Error(`Stream aborted: ${reason}`));
    },
  });

  return [writableStream, chunksPromise];
}

export function createHeaderHandlers() {
  const headers: Record<string, string> = {};
  let statusCode = 200;

  const setHeader = (name: string, value: string) => {
    headers[name] = value;
  };

  const setStatusCode = (code: number) => {
    statusCode = code;
  };

  return { headers, statusCode, setHeader, setStatusCode };
}

export const getKnownApiSecrets: Parameters<
  typeof proxyV1
>[0]["getApiSecrets"] = async (
  useCache: boolean,
  authToken: string,
  model: string | null,
) => {
  const endpointTypes = model && getModelEndpointTypes(model);
  if (!endpointTypes?.length) throw new Error(`Unknown model: ${model}`);

  return [
    {
      type: "anthropic" as const,
      secret: process.env.ANTHROPIC_API_KEY || "",
      name: "anthropic",
    },
    {
      type: "google" as const,
      secret: process.env.VERTEX_AI_API_KEY || "",
      name: "google",
    },
    {
      type: "openai" as const,
      secret: process.env.OPENAI_API_KEY || "",
      name: "openai",
    },
  ].filter((secret) => !!secret.secret && endpointTypes.includes(secret.type));
};

export async function callProxyV1<Input extends object, Output extends object>({
  body,
  ...request
}: Partial<Omit<Parameters<typeof proxyV1>, "body">> & {
  body: Input;
}) {
  const [writableStream, chunksPromise] = createResponseStream();
  const { headers, statusCode, setHeader, setStatusCode } =
    createHeaderHandlers();

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<Uint8Array[]>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out after 30s`));
    }, 30000);
  });

  try {
    const requestBody = typeof body === "string" ? body : JSON.stringify(body);

    const proxyPromise = proxyV1({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {
        "content-type": "application/json",
        authorization: `Bearer dummy-token`,
      },
      setHeader,
      setStatusCode,
      res: writableStream,
      getApiSecrets: getKnownApiSecrets,
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message: string) =>
        Buffer.from(message).toString("base64"),
      ...request,
      body: requestBody,
    });

    await proxyPromise;

    const chunks = await Promise.race([chunksPromise, timeoutPromise]);
    const responseText = new TextDecoder().decode(Buffer.concat(chunks));

    return {
      chunks,
      headers,
      statusCode,
      responseText,
      events() {
        return chucksToEvents<Output>(chunks);
      },
      json() {
        try {
          return JSON.parse(responseText) as Output;
        } catch (e) {
          return null;
        }
      },
    };
  } catch (error) {
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

const chucksToEvents = <ChunkData extends object>(chunks: Uint8Array[]) => {
  const textDecoder = new TextDecoder();
  const results: (Omit<ParsedEvent, "data"> & { data: ChunkData })[] = [];

  const parser = createParser((event) => {
    if (event.type === "event" && event.data !== "[DONE]") {
      results.push({
        ...event,
        data: JSON.parse(event.data) as ChunkData,
      });
    }
  });

  for (const chunk of chunks) {
    parser.feed(textDecoder.decode(chunk));
  }

  return results;
};
