import bsearch from "binary-search";
import { Env } from "./env";
import { ModelEndpointType, APISecret } from "@braintrust/proxy/schema";

export async function lookupApiSecret(
  useCache: boolean,
  loginToken: string,
  types: ModelEndpointType[],
  org_name?: string,
) {
  const cacheKey = `${loginToken}:${org_name ?? ""}:${types.join(",")}`;
  const cached = useCache ? loginTokenToApiKey.get(cacheKey) : undefined;
  if (cached !== undefined) {
    return cached;
  }

  let secrets: APISecret[] = [];
  try {
    const response = await fetch(`${Env.braintrustApiUrl}/api/secret`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        types,
        org_name,
        mode: "full",
      }),
    });
    if (response.ok) {
      secrets = (await response.json()).filter(
        (row: APISecret) => Env.orgName === "*" || row.org_name === Env.orgName,
      );
    } else {
      throw new Error(await response.text());
    }
  } catch (e) {
    throw new Error(`Failed to lookup api key: ${e}`);
  }

  if (secrets.length === 0) {
    return [];
  }

  // This is somewhat arbitrary. Cache the API key for an hour.
  loginTokenToApiKey.insert(
    cacheKey,
    secrets,
    Number(new Date()) / 1000 + 3600,
  );

  return secrets;
}

function fixIndex(i: number) {
  return i >= 0 ? i : -i - 1;
}

class TTLCache<V> {
  maxSize: number;
  cache: { [key: string]: { value: V; expiration: number } };
  expirations: { expiration: number; key: string }[];

  constructor(maxSize = 128) {
    this.maxSize = maxSize;
    this.cache = {};
    this.expirations = [];
  }

  insert(key: string, value: V, expiration: number) {
    while (Object.keys(this.cache).length >= this.maxSize) {
      const first = this.expirations.shift();
      delete this.cache[first!.key];
    }

    this.cache[key] = { value, expiration };
    let pos = fixIndex(
      bsearch(
        this.expirations,
        { expiration, key },
        (a, b) => a.expiration - b.expiration,
      ),
    );
    if (pos < 0) {
      pos = -pos - 1;
    }
    this.expirations = this.expirations
      .slice(0, pos)
      .concat({ expiration, key })
      .concat(this.expirations.slice(pos));
  }

  get(key: string) {
    const now = Date.now() / 1000;
    this._garbageCollect(now);
    const entry = this.cache[key];
    if (entry === undefined) {
      return undefined;
    } else if (entry.expiration < now) {
      delete this.cache[key];
      return undefined;
    } else {
      return entry.value;
    }
  }

  _garbageCollect(now: number) {
    let last_expired = fixIndex(
      bsearch(
        this.expirations,
        { expiration: now, key: "" },
        (a, b) => a.expiration - b.expiration,
      ),
    );

    if (
      last_expired >= this.expirations.length ||
      this.expirations[last_expired].expiration >= now
    ) {
      last_expired -= 1;
    }

    if (last_expired >= 0) {
      for (let i = 0; i < last_expired + 1; i++) {
        delete this.cache[this.expirations[i].key];
      }
      this.expirations = this.expirations.slice(last_expired + 1);
    }
  }
}

const dbTokenCache = new TTLCache<string>(128);
const loginTokenToApiKey = new TTLCache<APISecret[]>(128);
