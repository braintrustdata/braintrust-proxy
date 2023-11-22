import { ModelEndpointType } from "./schema";

export function parseAuthHeader(
  headers: Record<string, string | string[] | undefined>
) {
  const authHeader = headers["authorization"];
  let authValue = null;
  if (Array.isArray(authHeader)) {
    authValue = authHeader[authHeader.length - 1];
  } else {
    authValue = authHeader;
  }

  if (!authValue) {
    return null;
  }

  const parts = authValue.split(" ");
  if (parts.length !== 2) {
    return null;
  }
  return parts[1];
}

// This is duplicated from app/utils/object.ts
export function isObject(value: any): value is { [key: string]: any } {
  return value instanceof Object && !(value instanceof Array);
}

export function getTimestampInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function flattenChunks(allChunks: Uint8Array[]) {
  const flatArray = new Uint8Array(allChunks.reduce((a, b) => a + b.length, 0));
  for (let i = 0, offset = 0; i < allChunks.length; i++) {
    flatArray.set(allChunks[i], offset);
    offset += allChunks[i].length;
  }
  return new TextDecoder().decode(flatArray);
}

export function isEmpty(a: any): a is null | undefined {
  return a === undefined || a === null;
}

export function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

interface SecretRowBase {
  id?: string;
  org_name?: string;
  name?: string;
  secret: string;
  metadata?: Record<string, unknown>;
}

export type SecretRow = SecretRowBase &
  (
    | {
        type: Exclude<ModelEndpointType, "azure">;
        metadata?: {
          models?: string[];
        };
      }
    | {
        type: "azure";
        metadata?: {
          api_base: string;
          api_version: string;
          deployment?: string;
          models?: string[];
        };
      }
  );
