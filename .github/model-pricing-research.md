# Batch and service-tier pricing research

Checked on 2026-11-12 against official provider documentation and public endpoint data.
This is an evidence snapshot for the catalog update, not a source of current prices for future jobs.
Recheck the linked sources using [the pricing instructions](model-pricing.md).

The update changes 399 provider/tier pairs across 149 existing catalog entries.
Standard prices, existing Flex rates, model IDs, and provider mappings are preserved.
Counts include both names where providers document aliases.
OpenAI and OpenRouter store rates under `fast` and use `priority: {"alias": "fast"}`; loaders resolve the reference to the same rates.
This replaces 77 duplicate arrays without changing their prices or conditions.

| Provider             | Batch | Priority | Fast | Ultrafast |
| -------------------- | ----: | -------: | ---: | --------: |
| OpenAI               |    27 |       21 |   21 |         2 |
| Anthropic            |    16 |        0 |    4 |         0 |
| Gemini Developer API |    14 |       12 |    0 |         0 |
| Vertex               |    26 |       26 |    0 |         0 |
| OpenRouter           |    80 |       56 |   56 |         4 |
| Fireworks            |     0 |       14 |    2 |         1 |
| Groq                 |     2 |        0 |    0 |         0 |
| xAI                  |     7 |        8 |    0 |         0 |

These are catalog rates, not new request-routing or batch-submission implementations.
Consumers must match the resolved provider, served tier, and every rate condition.
Missing prices remain unknown, including prices for unlisted providers, snapshots, and regions.

## OpenAI

The [pricing tables](https://developers.openai.com/api/docs/pricing) separately list Batch, Flex, Fast, and Ultrafast rates.
The catalog uses those rows directly, including the published $0.13 short-context Batch cache-read rate for GPT-5.4.
It does not derive Batch support from an existing Flex entry.
Short context includes 272,000 input tokens; long context starts at 272,001.
Rows with unavailable long-context prices stay bounded to short context.
GPT-5.6 Sol's published promotional rates expire on November 30, 2026; no later price is assumed.

| Model                      | Batch input / output | Fast input / output | Ultrafast input / output |
| -------------------------- | -------------------- | ------------------- | ------------------------ |
| GPT-6.1 Sol, short context | $1 / $5              | $4 / $20            | $12 / $60                |
| GPT-6 Astra, short context | $5 / $25             | $20 / $100          | $60 / $300               |

Prices are USD per million text tokens.
[Fast mode](https://developers.openai.com/api/docs/guides/fast-mode) accepts both `fast` and `priority`, but older models return `priority` and fallback can return `default`.
[Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) is documented for GPT-6 Astra and GPT-6.1 Sol only.
[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) distinguishes total 30-minute and 12-hour write prices, so the schema now preserves both TTLs.
The unsuffixed write price remains the default 30-minute rate.
Rates are scoped to `api.openai.com`; regional and FedRAMP uplifts are not silently applied to the global endpoint.

## Anthropic

[Pricing](https://platform.claude.com/docs/en/about-claude/pricing) verifies the 16 direct Claude model entries with Batch rates, including both Haiku 5.5 prompt-length bands.
Its cache-write and cache-read multipliers explicitly stack with Batch and geography pricing.
The update records total 5-minute and 1-hour writes, and distinct `inference_geo: "global"` and `"us"` rates where supported.
US-only inference costs 1.1 times the global rate.
Haiku 5.5 switches prices above 100,000 total input tokens, including cached tokens.

[Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) uses `speed: "fast"` for Fable 5.2, Opus 5.5, Opus 5, and Opus 4.8.
The respective input/output rates are $16/$80, $8/$40, $10/$50, and $10/$50 per million tokens, before geography modifiers.
Opus 5 requires preview access; Opus 4.8 Fast is removed on November 30, so its inclusive rate end date is November 29.
Fast does not combine with Batch.
Anthropic's [legacy Priority Tier](https://platform.claude.com/docs/en/api/service-tiers) is a separate capacity product; no `priority` rate is inferred from Fast.
Cloud availability and pricing are not inherited from the direct API.

## Google and Vertex

The [Gemini Developer API](https://aistudio.google.com/docs/pricing) and [Vertex](https://cloud.google.com/model-garden/pricing) tables were checked independently.
Vertex rates are recorded on both existing native and `publishers/google/models/…` catalog entries where that provider is listed.
The new Vertex rates cover the global scope only; they must not be used for non-global endpoints.
The tables do not always agree on cache rates: Gemini 3.1 Pro Preview Batch has $0.20/$0.40 cache reads on the Developer API, while Vertex's Batch table marks those cells unavailable.
The latter fields remain absent.

Gemini 4 Carbon and Argon prices change on December 1, 2026.
The Developer API gives dated token prices; Vertex describes its introductory reduction as credits back on spend.
Only Vertex's December 1 onward rates are added for these two models, because a credit-back promotion cannot be represented as an unconditional token rate.
Gemini 3.6/3.7/3.8 Flash prices change on January 1, 2027 where the provider documents them.
Prompt bands use inclusive bounds at 200,000 and 200,001 tokens.
Hourly cache storage, grounding fees, audio output, and image-generation charges are not written into text-token prices.
The custom-tools Gemini 3.1 Pro Preview ID is explicitly covered by the Developer API pricing section.

## OpenRouter

All 331 applicable, active chat entries with an OpenRouter model slug were checked through its public [model endpoints API](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model).
56 had Priority/Fast endpoints and four had Ultrafast endpoints, including OpenRouter's explicit `-pro` variants.
Evidence URLs have the form `https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints`.
The same 331 slugs were checked with `:batch` before `/endpoints`; 80 returned Batch endpoints.
The [Batch API](https://openrouter.ai/docs/guides/features/batch-api) uses the base slug in submitted jobs, while `:batch` identifies the separate pricing variant.
Its endpoints can have a null `service_tier`, so checking only synchronous endpoint tiers misses Batch prices.
For native OpenAI and Gemini catalog IDs, the API slug adds `openai/` or `google/`; existing provider-prefixed IDs use their exact slug.
Every added rate retains the returned endpoint `tag` and applicable prompt-length override.
Rates come from `pricing.prompt`, `completion`, and cache fields, converted from per-token to per-million units.

[Service-tier documentation](https://openrouter.ai/docs/guides/features/service-tiers) confirms that `fast` and `priority` are aliases, and that billing follows the served endpoint after fallback.
Ultrafast is independent and can fall back to Priority or Standard.
The endpoint API, not direct-provider pricing, supplies OpenRouter rates; it can expose different long-context availability.
[Gemini caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching#google-gemini) adds a storage surcharge to the input price, so the catalog records their sum as the total write price.
No batch discount or future OpenRouter price is inferred from another provider.
For example, OpenRouter publishes GPT-5.4 Batch cache reads at $0.125 per million tokens while the direct OpenAI table displays $0.13.
Batch cache prices and prompt-length overrides come from the Batch variant, not the synchronous endpoint.

## Fireworks, Groq, and xAI

[Fireworks prices](https://docs.fireworks.ai/serverless/pricing) explicitly distinguish Priority, Fast, and Ultra-fast.
[Mode documentation](https://docs.fireworks.ai/serverless/serverless-modes) requires router IDs for Kimi K3 Fast, GLM 5.3 Fast, and DeepSeek V4.1 Flash 1017 Ultra-fast.
Those IDs are stored in `model_id`; Priority remains a separate `service_tier` choice with its own prices.
[US-only serving](https://docs.fireworks.ai/serverless/us-only-serverless) uses a different host and router, with separate prices.
Fast and Priority are therefore not aliases for direct Fireworks requests.
The [Batch documentation](https://docs.fireworks.ai/guides/batch-inference) requires model-level compatibility beyond serverless availability; the generic discount alone was not used to add Batch rates.

[Groq Batch](https://console.groq.com/docs/batch) explicitly supports GPT-OSS 120B and 20B at half their [published standard input/output rates](https://console.groq.com/docs/models).
Batch does not stack with caching discounts, so cached Batch input uses the same price as uncached Batch input.

[xAI pricing](https://docs.x.ai/developers/pricing) lists seven current text models with a 20% Batch discount and a separate 2x Priority multiplier on all token categories.
The long-context band starts at exactly 200,000 tokens, unlike Google's strictly-greater-than boundary.
Rates are scoped to `api.x.ai`; regional endpoint uplifts are not folded into them.
Grok 4.7 Fast is restricted to Cursor and Grok Build and is not a public xAI API tier.

## Unresolved and excluded checks

- [Azure Priority](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing) documents model-version and deployment constraints, but the [public price page](https://azure.microsoft.com/en-us/pricing/details/azure-openai/) returned `$-` placeholders for the inspected prices.
  No direct OpenAI prices were copied to Azure.
- [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) documents different premiums, discounts, regions, and inference profiles by model.
  Exact new model/profile/region combinations were not established in this pass; existing Flex data is preserved and new Batch/Priority rates remain unresolved.
- [Together Batch](https://docs.together.ai/docs/inference/batch/overview) currently lists only Whisper for its 50% discount; other accepted models use standard rates.
  “Most serverless models” is insufficient evidence for each catalog ID's Batch support.
- [Mistral Priority](https://docs.mistral.ai/inference/priority-tier) requires an account agreement and per-model entitlement.
  Its advertised 1.75x multiplier does not prove eligibility for every model; no blanket rates were added.
- [Cohere pricing](https://docs.cohere.com/v2/docs/how-does-cohere-pricing-work) and [Cerebras pricing](https://inference-docs.cerebras.ai/support/pricing) did not establish public per-model Batch/Fast/Ultrafast rates for this update.
  Account plans, dedicated capacity, and hourly model hosting are not token service tiers.
- Dated snapshots, regional companions, historical promotions, and undocumented tier combinations were not filled by inheritance.
  An absent rate is not evidence that the provider does not support the tier.

The provider audit must revisit these unresolved combinations and flag only gaps supported by official evidence.
The daily sync, add-model, and issue-repair prompts all use the same tier instructions.
