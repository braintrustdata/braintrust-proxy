import express, { Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { pipeline } from "stream/promises";

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
  res.write(`!${err}`);
  res.end();
}

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
    });
  } catch (e: any) {
    console.error(e);
    processError(res, e);
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
    });
  } catch (e: any) {
    console.error(e);
    processError(res, e);
  }
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://${host}:${port}`);
});
