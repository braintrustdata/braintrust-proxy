# Model pricing

Read `packages/proxy/schema/models.ts` and the model's existing prices before researching changes.
Use `PricingTiers` as the shared list of supported tier names; adding a tier must not require a separate schema or workflow.
These names are catalog pricing categories, not provider API request parameter values.
For example, batch processing can use a different API surface from synchronous service tiers.
Check each applicable tier independently, even when top-level standard prices did not change.

- Keep standard prices in the top-level price fields.
  `pricing` holds only the non-standard tiers in `PricingTiers`.
  Store verified tier rates in `pricing[provider][tier]`, with a nonempty array of rate entries for each provider/tier pair.
- Verify support and rates for the exact model, resolved provider, and tier using official provider pricing, tier documentation, or a documented provider API.
  For OpenRouter, verify the specific upstream endpoint and its tier tag through OpenRouter's official model/endpoint data.
  Do not infer tier support or rates from another provider, tier, parent, alias, model family, or a generic discount.
- Use USD per million text tokens for `input_cost_per_mil_tokens`, `output_cost_per_mil_tokens`, `input_cache_read_cost_per_mil_tokens`, `input_cache_write_cost_per_mil_tokens`, `input_cache_write_5m_cost_per_mil_tokens`, and `input_cache_write_1h_cost_per_mil_tokens`.
  Cache-write prices are the total token price for the stated TTL, not a surcharge or an hourly storage fee.
  The unsuffixed cache-write field is the total price for the default TTL.
  For OpenRouter Gemini, the endpoint's `input_cache_write` price is a storage surcharge.
  Add it to the applicable `prompt` price, including prompt-length overrides, to record the [total cache-write price](https://openrouter.ai/docs/guides/best-practices/prompt-caching#google-gemini).
  Omit unknown prices; zero is a published price, not a placeholder.
  A missing provider/tier pair means support is unverified; it does not fall back to another tier or the top-level standard prices.
- Record every documented condition using `endpoints`, `supported_regions`, `deployment_type`, `model_id`, `model_version`, `min_input_tokens`, `max_input_tokens`, `valid_from`, and `valid_until` as applicable.
  Prompt-length limits and UTC date bounds are inclusive.
  Use separate entries when prices or conditions differ; do not flatten regional, endpoint, model-version, or long-context rates into one default.
  Array order does not select the applicable price; the documented conditions determine applicability.
- Verify every provider/tier pair for companion entries independently.
  An assumption that top-level standard prices match across cloud companions does not apply to provider/tier support, rates, or conditions.
  Do not copy the target's `pricing` map to a companion or rename its provider or tier keys without explicit provider evidence.
- Refresh existing rates and conditions when official sources document a change.
  Remove obsolete rates only when official sources confirm that their support or applicability ended.
  If a source is unavailable or inconclusive, preserve existing metadata and report the unresolved check.
  Missing tier evidence must not block an otherwise verified model addition or standard-price update.
- When editing catalog entries, preserve unrelated provider/tier pairs.
  In issue `model_spec`/`model_specs` patches, include only the provider/tier pairs to change, each with its complete intended rate array.
  The resolver replaces each supplied array and preserves omitted providers and tiers; it does not append or merge individual rate entries.
  Set a tier to `null` in an issue patch to remove that tier, a provider to `null` to remove its tier prices, or `pricing` to `null` to remove all tier prices while preserving top-level standard prices.
  The resolver removes empty maps; do not write empty arrays or nested `null` values into catalog entries.
  For an existing model, report a pricing gap as `kind: "stale_metadata"`.
- In the job report or issue verification section, cite each official source and the rates, support, and conditions it verifies.
  Do not substitute LiteLLM or another aggregator for provider/tier evidence.
