# Braintrust AI Proxy

The Braintrust AI proxy is the easiest way to access the world's best AI models with a single API, including
all of [OpenAI's](https://platform.openai.com/docs/models) models, [Anthropic](https://docs.anthropic.com/claude/reference/getting-started-with-the-api) models, [LLaMa 2](https://ai.meta.com/llama/),
[Mistral](https://mistral.ai/), and others. The proxy:

- **Simplifies your code** by providing a single API across AI providers.
- **Reduces your costs** by automatically caching results and reusing them when possible.
- **Increases observability** by automatically logging your requests. \[Coming soon\]

To read more about why we launched the AI proxy, check out our [blog post](https://braintrustdata.com/blog/ai-proxy) announcing the feature.

This repository contains the code for the proxy — both the underlying implementation and wrappers that allow you to
deploy it on [Vercel](https://vercel.com), [Cloudflare](https://developers.cloudflare.com/workers/),
[AWS Lambda](https://aws.amazon.com/lambda/), or an [Express](https://expressjs.com/) server.

## Just let me try it!

You can communicate with the proxy via the standard OpenAI drivers/API, and simply set the base url to
`https://proxy.braintrustapi.com/v1`. Try running the following script in your favorite language, twice.

### Typescript

```javascript copy
import { OpenAI } from "openai";
const client = new OpenAI({
  baseURL: "https://proxy.braintrustapi.com/v1",
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
  base_url="https://proxy.braintrustapi.com/v1",
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
time curl -i https://proxy.braintrustapi.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo", # Can use claude-2, llama-2-13b-chat here too
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

## Docs

You can find the full documentation for the proxy [here](https://www.braintrustdata.com/docs/guides/proxy).

To see docs for how to deploy on each platform, see the READMEs in the corresponding folders:

- [Vercel](./apis/vercel)
- [Cloudflare](./apis/cloudflare)
- [AWS Lambda](./apis/node)
- [Express](./apis/node)

## Developing

To build the proxy, run:

```bash
pnpm install
pnpm build
```
