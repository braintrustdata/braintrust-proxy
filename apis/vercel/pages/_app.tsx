import type { AppProps } from "next/app";
import { getLayout, Head, type LayoutProps } from "@vercel/examples-ui";
import "@vercel/examples-ui/globals.css";

export default function MyApp({ Component, pageProps }: AppProps) {
  const Layout = getLayout<LayoutProps>(Component);

  return (
    <>
      <Head title="API Rate Limiting with Vercel KV" />
      <Layout
        path="edge-functions/api-rate-limit"
        deployButton={{
          customDeployUrl:
            'https://vercel.com/new/clone?repository-url=https://github.com/vercel/examples/tree/main/edge-functions/api-rate-limit?project-name=api-rate-limit&repository-name=api-rate-limit&stores=%5B%7B"type"%3A"kv"%7D%5D',
        }}
      >
        <Component {...pageProps} />
      </Layout>
    </>
  );
}
