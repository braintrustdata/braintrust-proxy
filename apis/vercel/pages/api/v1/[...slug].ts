import { kv } from "@vercel/kv";
import { EdgeProxyV1, CacheSetOptions } from "@braintrust/proxy/edge";

export const config = {
  runtime: "edge",
};

const KVCache = {
  get: kv.get,
  set: async <T>(key: string, value: T, opts: CacheSetOptions) => {
    await kv.set(
      key,
      value,
      opts.ttl !== undefined
        ? {
            ex: opts.ttl,
          }
        : {},
    );
  },
};

export default EdgeProxyV1({
  getRelativeURL: (request) => {
    const url = new URL(request.url);
    const params = url.searchParams.getAll("slug");
    return "/" + params.join("/");
  },
  cors: true,
  credentialsCache: KVCache,
  completionsCache: KVCache,
  braintrustApiUrl: process.env.BRAINTRUST_API_URL,
});
