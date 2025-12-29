# Braintrust AI Proxy

The Braintrust AI proxy offers a unified way to access the world's leading AI models through a single API, including
models from [OpenAI](https://platform.openai.com/docs/models), [Anthropic](https://docs.anthropic.com/claude/reference/getting-started-with-the-api), [LLaMa 2](https://ai.meta.com/llama/),
[Mistral](https://mistral.ai/), and more. The benefits of using the proxy include:

- **Code Simplification**: Use a consistent API across different AI providers.
- **Cost Reduction**: The proxy automatically caches results, reusing them when possible.
- **Enhanced Observability**: Log requests automatically for better tracking and debugging. \[Coming soon\]

See the full list of supported models [here](https://www.braintrust.dev/docs/guides/proxy#supported-models).
To read more about why we launched the AI proxy, check out our [announcement blog post](https://braintrust.dev/blog/ai-proxy).

This repository contains the code for the proxy — both the underlying implementation and wrappers that allow you to
deploy it on [Vercel](https://vercel.com), [Cloudflare](https://developers.cloudflare.com/workers/),
[AWS Lambda](https://aws.amazon.com/lambda/), or an [Express](https://expressjs.com/) server.

## Just let me try it!

You can communicate with the proxy via the standard OpenAI drivers/API, and simply set the base url to
`https://api.braintrust.dev/v1/proxy`. Try running the following script in your favorite language, twice.

### TypeScript

```javascript copy
import { OpenAI } from "openai";
const client = new OpenAI({
  baseURL: "https://api.braintrust.dev/v1/proxy",
  apiKey: process.env.OPENAI_API_KEY, // Can use Braintrust, Anthropic, etc. keys here too
});

async function main() {
  const start = performance.now();
  const response = await client.chat.completions.create({
    model: "gpt-3.5-turbo", // // Can use claude-2, llama-2-13b-chat here too
    messages: [{ role: "user", content: "What is a proxy?" }],
    seed: 1, // A seed activates the proxy's cache
  });
  console.log(response.choices[0].message.content);
  console.log(`Took ${(performance.now() - start) / 1000}s`);
}

main();
```

### Python

```python copy
from openai import OpenAI
import os
import time

client = OpenAI(
  base_url="https://api.braintrust.dev/v1/proxy",
  api_key=os.environ["OPENAI_API_KEY"], # Can use Braintrust, Anthropic, etc. keys here too
)

start = time.time()
response = client.chat.completions.create(
	model="gpt-3.5-turbo", # Can use claude-2, llama-2-13b-chat here too
	messages=[{"role": "user", "content": "What is a proxy?"}],
	seed=1, # A seed activates the proxy's cache
)
print(response.choices[0].message.content)
print(f"Took {time.time()-start}s")
```

### cURL

```bash copy
time curl -i https://api.braintrust.dev/v1/proxy/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {
        "role": "user",
        "content": "What is a proxy?"
      }
    ],
    "seed": 1
  }' \
  -H "Authorization: Bearer $OPENAI_API_KEY" # Can use Braintrust, Anthropic, etc. keys here too
```

## Deploying

You can find the full documentation for using the proxy [here](https://www.braintrust.dev/docs/guides/proxy).
The proxy is hosted for you, with end-to-end encryption, at `https://api.braintrust.dev/v1/proxy`. However, you
can also deploy it yourself and customize its behavior.

To see docs for how to deploy on various platforms, see the READMEs in the corresponding folders:

- [Vercel](./apis/vercel)
- [Cloudflare](./apis/cloudflare)
- [AWS Lambda](./apis/node)
- [Express](./apis/node)

## Developing

To build the proxy, install [pnpm](https://pnpm.io/installation) and run:

```bash
pnpm install
pnpm build
```
