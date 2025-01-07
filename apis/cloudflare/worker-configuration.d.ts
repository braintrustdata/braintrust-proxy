interface Env {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  REPLICATE_API_KEY: string;
  FIREWORKS_API_KEY: string;
  GOOGLE_API_KEY: string;
  XAI_API_KEY: string;

  TOGETHER_API_KEY: string;
  LEPTON_API_KEY: string;
  MISTRAL_API_KEY: string;
  OLLAMA_API_KEY: string;
  GROQ_API_KEY: string;
  CEREBRAS_API_KEY: string;

  BEDROCK_SECRET_KEY: string;
  BEDROCK_ACCESS_KEY: string;
  BEDROCK_REGION: string;

  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;
  //
  // Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
  // MY_SERVICE: Fetcher;
  //
  // Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
  // MY_QUEUE: Queue;
}
