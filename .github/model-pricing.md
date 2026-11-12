# Model pricing

Read `packages/proxy/schema/models.ts` and the model's existing prices before researching changes.
Use `PricingTiers` as the shared list of supported tier names; adding a tier must not require a separate schema or workflow.
These names are catalog pricing categories, not provider API request parameter values.
For example, batch processing can use a different API surface from synchronous service tiers.
Check each applicable tier independently, even when top-level standard prices did not change.
This includes `batch`, `fast`, and `ultrafast`, as well as `flex` and `priority`.
Batch API support and synchronous service-tier support are separate checks.

- Keep standard prices in the top-level price fields.
  `pricing` holds only the non-standard tiers in `PricingTiers`.
  Store verified tier rates in `pricing[provider][tier]`, with a nonempty array of rate entries or an explicit alias for each provider/tier pair.
  When a provider documents two names for the same tier, store the rates once and use `{"alias": "fast"}` for the other name.
  An alias points directly to a nonempty rate array in the same model and provider and inherits every rate and condition.
  Missing targets, self-references, chains, cycles, and alias-specific overrides are invalid.
  Equal prices alone do not establish that two tiers are aliases.
- Verify support and rates for the exact model, resolved provider, and tier using official provider pricing, tier documentation, or a documented provider API.
  For OpenRouter, verify the specific upstream endpoint and its tier tag through OpenRouter's official model/endpoint data.
  Do not infer tier support or rates from another provider, tier, parent, alias, model family, or a generic discount.
- Use USD per million text tokens for `input_cost_per_mil_tokens`, `output_cost_per_mil_tokens`, `input_cache_read_cost_per_mil_tokens`, `input_cache_write_cost_per_mil_tokens`, and the `input_cache_write_{5m,30m,1h,12h}_cost_per_mil_tokens` fields.
  Cache-write prices are the total token price for the stated TTL, not a surcharge or an hourly storage fee.
  The unsuffixed cache-write field is the total price for the default TTL.
  For OpenRouter Gemini, the endpoint's `input_cache_write` price is a storage surcharge.
  Add it to the applicable `prompt` price, including prompt-length overrides, to record the [total cache-write price](https://openrouter.ai/docs/guides/best-practices/prompt-caching#google-gemini).
  Omit unknown prices; zero is a published price, not a placeholder.
  A missing provider/tier pair means support is unverified; it does not fall back to another tier or the top-level standard prices.
- Record every documented condition using `endpoints`, `supported_regions`, `inference_geo`, `deployment_type`, `model_id`, `model_version`, `min_input_tokens`, `max_input_tokens`, `valid_from`, and `valid_until` as applicable.
  Prompt-length limits and UTC date bounds are inclusive.
  Use separate entries when prices or conditions differ; do not flatten regional, endpoint, model-version, or long-context rates into one default.
  Array order does not select the applicable price; the documented conditions determine applicability.
  `inference_geo` is a request's inference geography (for example, Anthropic `global` or `us`), not the region where the API connection terminates.
  Do not substitute a regional price for an unverified global price, or the reverse.
- Verify every provider/tier pair for companion entries independently.
  An assumption that top-level standard prices match across cloud companions does not apply to provider/tier support, rates, or conditions.
  Do not copy the target's `pricing` map to a companion or rename its provider or tier keys without explicit provider evidence.
- Refresh existing rates and conditions when official sources document a change.
  Remove obsolete rates only when official sources confirm that their support or applicability ended.
  If a source is unavailable or inconclusive, preserve existing metadata and report the unresolved check.
  Missing tier evidence must not block an otherwise verified model addition or standard-price update.
- When editing catalog entries, preserve unrelated provider/tier pairs.
  In issue `model_spec`/`model_specs` patches, include only the provider/tier pairs to change, each with its complete intended rate array or alias object.
  The resolver replaces each supplied tier and preserves omitted providers and tiers; it does not append or merge individual rate entries.
  Update the target array when prices change; keep its aliases as references.
  An alias patch can point to an existing target or one supplied in the same patch; validation runs after the patch is merged.
  Set a tier to `null` in an issue patch to remove that tier, a provider to `null` to remove its tier prices, or `pricing` to `null` to remove all tier prices while preserving top-level standard prices.
  The resolver removes empty maps; do not write empty arrays or nested `null` values into catalog entries.
  When removing a target, remove or retarget its aliases in the same patch.
  For an existing model, report a pricing gap as `kind: "stale_metadata"`.
- In the job report or issue verification section, cite each official source and the rates, support, and conditions it verifies.
  Do not substitute LiteLLM or another aggregator for provider/tier evidence.
  For each model/provider checked, report each tier as verified and recorded, unsupported, or unresolved, with the reason.
  Include the check date, exact API selector, response billing signal, cache discount rules, and any expiry or prompt-length boundary.

## Reading and editing aliases

Use `StoredModelSchema` when validating or rewriting catalog files so aliases remain references.
Use `ModelSchema` to load a model for consumption, or `ModelPricingSchema` to resolve just its pricing map.
Both resolve aliases to rate arrays; `getAvailableModels()` and the dynamic model loader return resolved prices.
Consumers that read JSON directly must resolve aliases before treating tier values as arrays.
Do not serialize resolved schemas back to the catalog, because that would duplicate the prices again.

For OpenAI and OpenRouter, keep the verified rates under `fast` and store `priority` as `{"alias": "fast"}`.
Keep direct Fireworks and Anthropic tiers separate unless their own documentation establishes an alias.

## Service-tier research

Use the provider's actual billing signal when interpreting these prices.
A requested tier can fall back, and an omitted or `auto` tier can use an account default.
Do not add `auto`, `default`, or `standard` as non-standard pricing keys.
Do not treat model-name suffixes such as `-fast`, `:nitro`, or `-pro` as proof of a pricing tier.
Do not multiply a batch discount by a fast/priority premium unless the provider explicitly supports the combination.

These are starting points; recheck current documentation and exact model support on every run.
The [research snapshot](model-pricing-research.md) records the initial evidence and unresolved checks, not a replacement for current sources.

For [OpenRouter Batch](https://openrouter.ai/docs/guides/features/batch-api), query `/api/v1/models/{author}/{slug}:batch/endpoints` separately from synchronous endpoints.
Verify that the returned model and endpoint IDs match the Batch variant; preserve its endpoint tags, cache prices, and prompt-length overrides.
Batch endpoints can have a null `service_tier`, so a synchronous tier filter does not establish Batch availability or pricing.
Use the normal model slug when identifying a submitted Batch job; `:batch` is the pricing variant.

| Provider                        | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                          | Check the separate [Batch, Fast, and Ultrafast pricing tables](https://developers.openai.com/api/docs/pricing), including both context lengths and cache TTLs. [Fast](https://developers.openai.com/api/docs/guides/fast-mode) accepts `service_tier: "fast"` and `"priority"`; store `fast` rates and a `priority: {"alias": "fast"}` reference only where this alias is verified. The response reports the served tier and may report `default` after fallback. [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) is a separate tier with a narrower model list. Batch uses the [Batch API](https://developers.openai.com/api/docs/guides/batch), not `service_tier: "batch"`. |
| Anthropic                       | Check [pricing](https://platform.claude.com/docs/en/about-claude/pricing) and [fast-mode availability](https://platform.claude.com/docs/en/build-with-claude/fast-mode). `speed: "fast"` maps to catalog `fast`; legacy Priority Tier is a different product. Inspect the served speed and usage, not just `service_tier`. Batch and fast mode do not combine. Verify cache multipliers, `inference_geo`, model retirement dates, and prompt-length rules. Cloud fast mode may require a different model ID.                                                                                                                                                                                             |
| Google / Vertex                 | Check [Gemini Developer API pricing](https://aistudio.google.com/docs/pricing) and [Vertex pricing](https://cloud.google.com/model-garden/pricing) separately. Batch jobs, Flex, and Priority are distinct surfaces. Record text-token rates only; cache storage per token-hour is not a token-write price. Preserve regional differences, context bounds, and dated price transitions. A credit-back promotion is not necessarily the token's list price.                                                                                                                                                                                                                                               |
| OpenRouter                      | Read the exact model's `/api/v1/models/{author}/{slug}/endpoints` response and [service-tier rules](https://openrouter.ai/docs/guides/features/service-tiers). Use each endpoint's `service_tier`, `tag`, prices, and overrides; an endpoint label alone is insufficient. `fast` and `priority` are aliases here, so store `fast` rates and a `priority: {"alias": "fast"}` reference. `ultrafast` can fall back to priority or standard; bill the returned tier and endpoint. Never halve the model directory's standard price to invent batch prices.                                                                                                                                                  |
| Fireworks                       | Check [serverless pricing](https://docs.fireworks.ai/serverless/pricing), [modes](https://docs.fireworks.ai/serverless/serverless-modes), and [batch compatibility](https://docs.fireworks.ai/guides/batch-inference). Priority uses `service_tier: "priority"`; Fast and Ultra-fast use documented router IDs, recorded as `model_id`. These tiers are not aliases. Check US-only hosts and routers independently. A serverless listing alone does not establish batch compatibility.                                                                                                                                                                                                                   |
| Azure / Bedrock                 | Verify the exact model version, deployment or inference profile, and region using each cloud's own price and support tables. Do not copy direct OpenAI/Anthropic rates. Batch deployments/jobs are separate from online service tiers. For Azure, distinguish GlobalBatch/DataZoneBatch from GlobalStandard/DataZoneStandard. For Bedrock, distinguish service tier from latency-optimized inference.                                                                                                                                                                                                                                                                                                    |
| Groq / xAI / Together / Mistral | Verify exact model support and discount scope. [Groq batch](https://console.groq.com/docs/batch) does not stack its discount with cache discounts. [xAI](https://docs.x.ai/developers/pricing) lists model-specific batch discounts and separate priority rates; app-only Fast modes are not public API tiers. [Together](https://docs.together.ai/docs/inference/batch/overview) can support batch at standard prices. [Mistral Priority](https://docs.mistral.ai/inference/priority-tier) requires model-specific account setup. Neither batch support nor an advertised maximum discount proves a particular model's rate.                                                                            |
