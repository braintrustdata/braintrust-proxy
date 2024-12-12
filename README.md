# Not Diamond Proxy

The Not Diamond proxy (notdiamond.ai) offers a unified way to access the world's leading AI models through a single API, including
models from [OpenAI](https://platform.openai.com/docs/models), [Anthropic](https://docs.anthropic.com/claude/reference/getting-started-with-the-api), [LLaMa 2](https://ai.meta.com/llama/),
[Mistral](https://mistral.ai/), and more. The benefits of using the proxy include:

- **Code Simplification**: Use a consistent API across different AI providers
- **Cost Reduction**: The proxy automatically caches results, reusing them when possible
- **Enhanced Observability**: Log requests automatically for better tracking and debugging
- **Smart Model Routing**: Automatically recommends the best AI model for each query
- **Real-time Learning**: Improves recommendations based on user feedback

See the full list of supported models at [notdiamond.readme.io](https://docs.notdiamond.ai).
Try out our interactive chat interface at [chat.notdiamond.ai](https://chat.notdiamond.ai).

This repository contains the code for the proxy — both the underlying implementation and wrappers that allow you to
deploy it on [Vercel](https://vercel.com), [Cloudflare](https://developers.cloudflare.com/workers/),
[AWS Lambda](https://aws.amazon.com/lambda/), or an [Express](https://expressjs.com/) server.

## Just let me try it!

You can communicate with the proxy via the standard OpenAI drivers/API, and simply set the base url to
`https://proxy.notdiamond.ai/v1/proxy`. Try running the following script in your favorite language, twice.

### TypeScript

```javascript copy
import { OpenAI } from "openai";
const client = new OpenAI({
  baseURL: "https://api.notdiamond.ai/v1/proxy",
  apiKey: process.env.OPENAI_API_KEY, // Can use Not Diamond, OpenAI, Anthropic, etc. keys
});

async function main() {
  const start = performance.now();
  const response = await client.chat.completions.create({
    model: 'gpt-3.5-turbo',
    models: ["gpt-3.5-turbo", "claude-3-5-sonnet-20240620"],
    messages: [{ role: "user", content: "What is a proxy?" }],
    seed: 1, // A seed activates the proxy's cache
    tradeoff: "cost",
    preference_id: "your_preference_id",
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
  base_url="https://api.notdiamond.ai/v1/proxy",
  api_key=os.environ["OPENAI_API_KEY"], // Can use Not Diamond, OpenAI, Anthropic, etc. keys
)

start = time.time()
response = client.chat.completions.create(
  model="gpt-3.5-turbo",
	models=["gpt-3.5-turbo", "claude-3-5-sonnet-20240620"], // Can use claude-2, llama-2-13b-chat here too
	messages=[{"role": "user", "content": "What is a proxy?"}],
	seed=1, // A seed activates the proxy's cache
  tradeoff="cost",
  preference_id="your_preference_id",
)
print(response.choices[0].message.content)
print(f"Took {time.time()-start}s")
```

### cURL

```bash copy
time curl -i https://api.notdiamond.ai/v1/proxy/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "models": ["gpt-3.5-turbo", "claude-3-5-sonnet-20240620"],
    "messages": [
      {
        "role": "user",
        "content": "What is a proxy?"
      }
    ],
    "seed": 1,
    "tradeoff": "cost",
    "preference_id": "your_preference_id"
  }' \
  -H "Authorization: Bearer $OPENAI_API_KEY" // Can use Not Diamond, OpenAI, Anthropic, etc. keys
```

## Deploying

You can find the full documentation for using the proxy [here](https://docs.notdiamond.ai/docs/proxy).
The proxy is hosted for you, with end-to-end encryption, at `https://api.notdiamond.ai/v1/proxy`. However, you
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
