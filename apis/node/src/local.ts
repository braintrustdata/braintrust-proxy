import fs from "fs";
import express, { Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { pipeline } from "stream/promises";

import { completion } from "./ai";
import { nodeProxyV1 } from "./node-proxy";
import { Env, resetEnv } from "./env";

import { CacheKeyOptions } from "@braintrust/proxy";

dotenv.config({ path: ".env.local" });
resetEnv();

const app = express();
app.use(express.text({ type: "*/*", limit: "50mb" }));
app.use(cors());

const host = "localhost";
const port = 8001;

function processError(res: Response, err: any) {
  res.write("!");
  res.write(`${err}`);
}

function isTestingMode() {
  return Env.localCachePath.length > 0;
}

let _testingCache: Record<string, string> | null = null;
async function loadTestingCache() {
  if (_testingCache === null) {
    const contents = await fs.promises.readFile(Env.localCachePath, {
      encoding: "utf-8",
    });
    _testingCache = JSON.parse(contents) as Record<string, string>;
  }
  return _testingCache;
}

async function dumpTestingCache() {
  if (_testingCache !== null) {
    await fs.promises.writeFile(
      Env.localCachePath,
      JSON.stringify(_testingCache),
      { encoding: "utf-8" },
    );
  }
}

async function testingCacheGet(_encryptionKey: string, key: string) {
  const cache = await loadTestingCache();
  return cache[key] ?? null;
}

async function testingCachePut(
  _encryptionKey: string,
  key: string,
  value: string,
) {
  const cache = await loadTestingCache();
  cache[key] = value;
}

const TESTING_CACHE_KEY_OPTIONS: CacheKeyOptions = {
  excludeAuthToken: true,
  excludeOrgName: true,
};

app.post("/stream/completion", async (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  const body = JSON.parse(req.body);
  try {
    const aiStream = (await completion(
      req.headers,
      body,
    )) as unknown as NodeJS.ReadableStream;

    res.write("[");
    await pipeline(aiStream, res, { end: true });
  } catch (e: any) {
    processError(res, e);
  }
  return res.end();
});

app.get("/proxy/v1/*", async (req, res) => {
  const url = req.url.slice("/proxy/v1".length);
  try {
    await nodeProxyV1({
      method: "GET",
      url,
      proxyHeaders: req.headers,
      body: null,
      setHeader: res.setHeader.bind(res),
      setStatusCode: res.status.bind(res),
      getRes: () => res,
      cacheGet: isTestingMode() ? testingCacheGet : undefined,
      cachePut: isTestingMode() ? testingCachePut : undefined,
      cacheKeyOptions: isTestingMode() ? TESTING_CACHE_KEY_OPTIONS : undefined,
    });
  } catch (e: any) {
    console.error(e);
    throw e;
  }
});

app.post("/proxy/v1/*", async (req, res) => {
  const url = req.url.slice("/proxy/v1".length);
  try {
    await nodeProxyV1({
      method: "POST",
      url,
      proxyHeaders: req.headers,
      body: req.body,
      setHeader: res.setHeader.bind(res),
      setStatusCode: res.status.bind(res),
      getRes: () => res,
      cacheGet: isTestingMode() ? testingCacheGet : undefined,
      cachePut: isTestingMode() ? testingCachePut : undefined,
      cacheKeyOptions: isTestingMode() ? TESTING_CACHE_KEY_OPTIONS : undefined,
    });
  } catch (e: any) {
    console.error(e);
    throw e;
  }
});

app.get("/proxy/dump-testing-cache", async (_req, res) => {
  await dumpTestingCache();
  res.send(`Wrote testing cache to ${Env.localCachePath}`);
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://${host}:${port}`);
});
