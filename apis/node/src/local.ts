import express, { Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { pipeline } from "stream/promises";

import { completion } from "./ai";
import { nodeProxyV1 } from "./node-proxy";
import { resetEnv } from "./env";

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

app.post("/stream/completion", async (req, res, next) => {
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

app.get("/proxy/v1/*", async (req, res, next) => {
  const url = req.url.slice("/proxy/v1".length);
  try {
    await nodeProxyV1(
      "GET",
      url,
      req.headers,
      null,
      res.setHeader.bind(res),
      res.status.bind(res),
      () => res,
    );
  } catch (e: any) {
    console.error(e);
    throw e;
  }
});

app.post("/proxy/v1/*", async (req, res, next) => {
  const url = req.url.slice("/proxy/v1".length);
  try {
    await nodeProxyV1(
      "POST",
      url,
      req.headers,
      req.body,
      res.setHeader.bind(res),
      res.status.bind(res),
      () => res,
    );
  } catch (e: any) {
    console.error(e);
    throw e;
  }
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
