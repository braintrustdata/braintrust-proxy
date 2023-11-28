import stream from "stream";
import util from "util";

import { completion } from "./ai";
import { nodeProxyV1 } from "./node-proxy";

const pipeline = util.promisify(stream.pipeline);

function processError(res, err) {
  res.write("!");
  res.write(`${err}`);
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    // This flag allows the function to instantly return after the responseStream finishes, without waiting
    // for sockets (namely, Redis) to close.
    // See https://stackoverflow.com/questions/46793670/reuse-redis-connections-for-nodejs-lambda-function
    // and https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html
    context.callbackWaitsForEmptyEventLoop = false;

    // https://docs.aws.amazon.com/lambda/latest/dg/response-streaming-tutorial.html
    const metadata = {
      statusCode: 200,
      headers: {
        "content-type": "text/plain",
        "access-control-max-age": "86400",
      },
    };

    const wrap = () => {
      return awslambda.HttpResponseStream.from(responseStream, metadata);
    };

    if (event.requestContext.http.method === "OPTIONS") {
      responseStream = wrap();
      responseStream.end();
      return;
    }

    let aiStream = null;
    if (event.rawPath === "/") {
      await resetRedisInfo(); // XXX
      responseStream = wrap();
      responseStream.write("Hello World!");
      responseStream.end();
    } else if (event.rawPath === "/empty") {
      responseStream = wrap();
      responseStream.end();
    } else if (event.rawPath === "/stream/completion") {
      responseStream = wrap();
      try {
        aiStream = await completion(event.headers, event.body);

        // Write a starting character because Lambda 502s on empty responses
        responseStream.write("[");
        await pipeline(aiStream, responseStream);
      } catch (err) {
        console.error(err);
        processError(responseStream, err);
      }
      responseStream.end();
    } else if (event.rawPath.startsWith("/proxy/v1")) {
      console.log(event);
      console.log(context);
      try {
        await nodeProxyV1(
          event.requestContext.http.method,
          event.rawPath.slice("/proxy/v1".length),
          event.headers,
          event.body,
          (name, value) => {
            metadata.headers[name] = value;
          },
          (code) => {
            metadata.statusCode = code;
          },
          wrap,
        );
      } catch (err) {
        console.error(err);
        metadata.statusCode = 500;
        responseStream.write(`Internal Server Error: ${err}`);
        responseStream.end();
      }
    } else {
      metadata.statusCode = 404;
      responseStream = wrap();
      responseStream.write("Not Found");
      responseStream.end();
    }
  },
);
