# Model validation prompt

Write a starter prompt that a separate agent will run to validate the models from this run end to end against Braintrust.
The workflow appends the file you write to the pull request description inside a collapsed `<details>` block and a four-backtick Markdown code fence.
Write only the prompt text: no heading, `<details>` wrapper, or four-backtick fences.

The prompt must be self-contained, because the agent running it will not see this workflow or its inputs.
Address it to that agent and include:

1. **Scope**: the model IDs added or changed in this run, with cloud/provider companions grouped under their primary model.
   For each primary model, list its `format`, `flavor`, `available_providers`, capability flags, token limits, and standard prices from `packages/proxy/schema/model_list.json`.
   List companions by ID only.
   For changed models, name the fields that changed.
   Do not treat case-only ID pairs on different providers as duplicates.
2. **Setup**:
   - The hosted Gateway (`https://gateway.braintrust.dev`) loads `packages/proxy/schema/model_list.json` from `main`, so run the prompt after the pull request merges.
     To test before merging, run a local Gateway from `braintrustdata/braintrust` with its `proxy` submodule checked out to this branch and `MODEL_CATALOG_REFRESH_SECONDS=0`.
   - Authenticate with `BRAINTRUST_API_KEY` for an organization that has AI provider keys for these providers.
     Before probing models, check which providers this credential can access in the target organization and note their exact configured endpoint names.
     Report providers the credential cannot access as blocked and do not probe them.
   - Send every request with the `x-bt-project-name: model-validation` header.
3. **Documentation pass**: read the provider's official model page, migration or upgrade guide, and pricing page for each primary model.
   Compare them with the catalog entry and report mismatches.
   List every change from the `parent` or previous model in the family that affects API callers, such as new, removed, or renamed parameters, tools, content types, limits, and pricing.
   Each change becomes a test case in the Gateway pass.
   Use official provider sources only.
4. **Gateway pass**: for each primary model, test the endpoints that match its `flavor`:
   - `chat`: `/v1/chat/completions`, `/v1/responses`, and `/v1/messages`, plus the provider's native format.
     Test non-streaming and streaming, system prompts, and multi-turn conversations.
     Where supported, test tool calls (including parallel calls and tool-result round trips), JSON-schema structured output, image input, and reasoning effort or budget.
   - `completion`: `/v1/completions`.
   - `embedding`: `/v1/embeddings`, and check the vector dimension.
   - `decisions`: `/v1/decisions`.
   - `realtime`: the `/v1/realtime` WebSocket.
   - `live`: the `/v1/live/sessions` WebSocket.
     Run every test case from the documentation pass, including parameters the provider now rejects or ignores.
     For provider-specific IDs, including case variants, pin every request to the entry's intended provider using its configured endpoint name in `x-bt-endpoint-name`.
     Verify that `x-bt-used-endpoint` on each successful response matches the pin before counting it as a pass.
     For each response, check usage token counts, and check that a repeated request with `x-bt-use-cache: always` is served from cache.
     Send one basic request to each companion.
5. **Product pass**: check that each model appears in the playground model picker with the expected display name, and that its logged LLM spans in the `model-validation` project show token usage and an estimated cost consistent with the catalog prices.
6. **Report**: return a pass/fail/blocked/skip table per model and check.
   Report `no provider registered` or `Configured providers` errors as blocked by credentials or provider configuration, not as model failures.
   For each failure, include the request, the error or unexpected output, and whether the likely fix is in the catalog (`braintrustdata/braintrust-proxy`), the Gateway or Lingua translation layer (`gateway/` or `lingua/` in `braintrustdata/braintrust`), or the provider.
   Do not edit code.

Only include models that exist in the final `packages/proxy/schema/model_list.json`.
If more than 25 primary models changed, give full details for the first 25 and list the remaining IDs.
