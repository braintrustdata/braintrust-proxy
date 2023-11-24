# Braintrust AI Proxy (Node, AWS Lambda)

This directory contains an implementation of the Braintrust AI Proxy that runs on
[Node.js](https://nodejs.org/) runtimes and can be bundled as an [Express server](https://expressjs.com/)
or [AWS Lambda function](https://aws.amazon.com/blogs/compute/introducing-aws-lambda-response-streaming/).

## Building

To build the proxy, you'll need to install [pnpm](https://pnpm.io/installation), and then from the
[repository's root](../..), run:

```bash copy
pnpm install
pnpm build
```

## Running locally (Express server)

To run the proxy locally, you need to connect to a [Redis](https://redis.io) instance. The easiest way to
run Redis locally is with [Docker](https://www.docker.com/). Once you have Docker installed, you can run
([full instructions](https://hub.docker.com/_/redis))

```bash copy
docker run --name some-redis -d redis
```

to run Redis on port 6379. Then, create a file named `.env.local` with the following contents:

```bash copy
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

Finally, you can run the proxy with

```bash copy
pnpm dev
```

## Running on AWS Lambda

To run on AWS, you'll need

- The [AWS CLI](https://aws.amazon.com/cli/)
- A [Lambda function](https://aws.amazon.com/pm/lambda) with a Node.js runtime
- A [function URL](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html) for your Lambda function

Once you've created and configured a Lambda function, you can deploy the proxy with

```bash copy
aws lambda update-function-code --function-name <YOUR_LAMBDA_FUNCTION> --zip-file fileb://$PWD/dist/index.zip
```

### CORS

If you're using the proxy to access Braintrust AI from a browser, you'll need to enable CORS on your Lambda
function. This is a tricky process, but the following function URL CORS settings should work:

- `Allow origin`: `*`
- `Expose headers`: `content-type, keep-alive, access-control-allow-credentials, access-control-allow-origin, access-control-allow-methods`
- `Allow headers`: `authorization`
- `Allow methods`: `POST, GET`
- `Max age`: `86400`
- `Allow credentials`: `true`
