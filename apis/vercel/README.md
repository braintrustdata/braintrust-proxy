# Braintrust AI Proxy (Vercel)

This directory contains an implementation of the Braintrust AI Proxy that runs on
[Vercel Edge Functions](https://vercel.com/docs/functions/edge-functions). Because
of their global network, you get the benefit of low latency and can scale up to millions
of users.

## Deploying

### Forking the repository

Vercel is tightly integrated with Git, so the best way to deploy is to fork this repository. Then,
create a new [Vercel project](https://vercel.com/new) and

- Connect your forked repository to the project
- Create a [KV storage](https://vercel.com/docs/storage/vercel-kv/quickstart) instance and connect it to the project

### Connecting to vercel

From this directory, link your project and pull down the KV configuration by running:

```bash copy
npx vercel link
npx vercel env pull
```

You should now have a file named `.env.local` with a bunch of `KV_` variables.

### Running locally

To build the proxy, you'll need to install [pnpm](https://pnpm.io/installation), and then from the
[repository's root](../..), run:

```bash copy
pnpm install
pnpm build
```

Then, back in this directory, you can run the proxy locally with

```bash copy
pnpm dev
```

### Deploying to Vercel

If you've integrated the proxy into Vercel via Git, then it will automatically deploy on every push.
