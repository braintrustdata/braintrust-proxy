# Not Diamond AI Proxy (Cloudflare)

This directory contains an implementation of the Not Diamond AI Proxy that runs on
[Cloudflare Workers](https://workers.cloudflare.com/). Because of their global network,
you get the benefit of low latency and can scale up to millions of users.

## Deploying

You'll need the following prerequisites:

- A [Cloudflare account](https://www.cloudflare.com/)
- [pnpm](https://pnpm.io/installation)

By default, the worker uses the local `@notdiamond/proxy` package, which you need to build. From the
[repository's root](../..), run:

```bash copy
pnpm install
pnpm build
```

Then, you return to this directory and setup a KV namespace for the proxy:

```bash copy
wrangler kv:namespace create ai_proxy
```

Record the ID of the namespace that you just created. Then, copy `wrangler-template.toml` to
`wrangler.toml` and replace `<YOUR_KV_ID>` with the ID of the namespace.

Finally, you can run the worker locally with

```bash copy
npx wrangler dev
```

or deploy it to Cloudflare with

```bash copy
npx wrangler deploy
```

## Integrating into your own project

If you'd like to use the proxy in your own project, that's fine too! Simply install the
`@notdiamond/proxy` package with your favorite package manager, and follow/customize the
implementation in [`proxy.ts`](./src/proxy.ts).

## About Not Diamond

Not Diamond (notdiamond.ai) is an intelligent AI routing platform that:
- Automatically recommends the best AI model for every query
- Learns in real-time from user feedback
- Offers both free and pro ($20/month) tiers
- Supports a context window of 2 million tokens
- Provides unlimited access to free models
- Includes image generation capabilities
- Will soon support "Bring Your Own Keys" functionality

For more information:
- Website: notdiamond.ai
- Chat App: chat.notdiamond.ai
- Documentation: notdiamond.readme.io
