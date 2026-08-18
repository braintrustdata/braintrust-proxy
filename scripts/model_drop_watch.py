"""Detect provider model drops and apply verified gateway research to the catalog."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


MODEL_LIST = Path("packages/proxy/schema/model_list.json")
EXCLUDED_PARTS = ("embed", "moderation", "realtime", "audio", "transcrib", "tts", "image", "video")
GOOGLE_EXCLUDED_PREFIXES = (
    "antigravity-",
    "deep-research-",
    "gemini-robotics-",
    "gemma-",
    "lyria-",
    "nano-banana-",
)
GOOGLE_EXCLUDED_MODEL_IDS = {
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-omni-flash-preview",
    "gemini-pro-latest",
}
FORMAT_BY_PROVIDER = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google",
}
RESEARCH_BOOLEAN_FIELDS = (
    "multimodal",
    "reasoning",
    "reasoning_budget",
    "supports_streaming",
)
RESEARCH_CACHE_COST_FIELDS = (
    "input_cache_read_cost_per_mil_tokens",
    "input_cache_write_cost_per_mil_tokens",
    "input_cache_write_5m_cost_per_mil_tokens",
    "input_cache_write_1h_cost_per_mil_tokens",
)
RESEARCH_REQUIRED_FIELDS = (
    "model_slug",
    "displayName",
    *RESEARCH_BOOLEAN_FIELDS,
    "input_cost_per_mil_tokens",
    "output_cost_per_mil_tokens",
    *RESEARCH_CACHE_COST_FIELDS,
    "max_input_tokens",
    "max_output_tokens",
)


def research_schema() -> dict[str, object]:
    nullable_number: dict[str, object] = {"type": ["number", "null"]}
    nullable_boolean: dict[str, object] = {"type": ["boolean", "null"]}
    nullable_string: dict[str, object] = {"type": ["string", "null"]}
    properties: dict[str, object] = {
        "model_slug": {"type": "string"},
        "displayName": nullable_string,
        "multimodal": nullable_boolean,
        "reasoning": nullable_boolean,
        "reasoning_budget": nullable_boolean,
        "supports_streaming": nullable_boolean,
        "input_cost_per_mil_tokens": {"type": "number"},
        "output_cost_per_mil_tokens": {"type": "number"},
        "input_cache_read_cost_per_mil_tokens": nullable_number,
        "input_cache_write_cost_per_mil_tokens": nullable_number,
        "input_cache_write_5m_cost_per_mil_tokens": nullable_number,
        "input_cache_write_1h_cost_per_mil_tokens": nullable_number,
        "max_input_tokens": {"type": "integer"},
        "max_output_tokens": {"type": "integer"},
    }
    return {
        "type": "object",
        "properties": {
            "models": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": properties,
                    "required": list(properties),
                    "additionalProperties": False,
                },
            },
        },
        "required": ["models"],
        "additionalProperties": False,
    }


def request_json(url: str, headers: dict[str, str], body: object | None = None, *, timeout: int = 30) -> object:
    data = None if body is None else json.dumps(body).encode()
    request = Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urlopen(request, timeout=timeout) as response:  # nosec B310 -- provider URLs are constants below
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error


def is_chat_model(model_id: str, provider: str, payload: dict[str, Any]) -> bool:
    lowered = model_id.lower()
    if any(part in lowered for part in EXCLUDED_PARTS):
        return False
    if provider == "openai" and (model_id.startswith("ft:") or model_id.startswith("computer-use")):
        return False
    if provider == "gemini":
        if model_id in GOOGLE_EXCLUDED_MODEL_IDS or model_id.startswith(GOOGLE_EXCLUDED_PREFIXES):
            return False
        methods = payload.get("supportedGenerationMethods")
        return isinstance(methods, list) and "generateContent" in methods
    return True


def provider_models() -> list[dict[str, str]]:
    openai = request_json(
        "https://api.openai.com/v1/models",
        {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
    )
    anthropic_pages: list[object] = []
    anthropic_url = "https://api.anthropic.com/v1/models"
    while True:
        anthropic = request_json(
            anthropic_url,
            {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
        )
        anthropic_pages.append(anthropic)
        if not isinstance(anthropic, dict) or anthropic.get("has_more") is not True:
            break
        last_id = anthropic.get("last_id")
        if not isinstance(last_id, str) or not last_id:
            raise ValueError("Anthropic models pagination omitted last_id")
        anthropic_url = f"https://api.anthropic.com/v1/models?after_id={last_id}"
    gemini_pages: list[object] = []
    gemini_params = {"key": os.environ["GEMINI_API_KEY"], "pageSize": "1000"}
    seen_gemini_page_tokens: set[str] = set()
    while True:
        gemini = request_json(
            f"https://generativelanguage.googleapis.com/v1beta/models?{urlencode(gemini_params)}",
            {},
        )
        gemini_pages.append(gemini)
        if not isinstance(gemini, dict) or "nextPageToken" not in gemini:
            break
        page_token = gemini["nextPageToken"]
        if not isinstance(page_token, str) or not page_token or page_token in seen_gemini_page_tokens:
            raise ValueError("Gemini models pagination returned an invalid nextPageToken")
        seen_gemini_page_tokens.add(page_token)
        gemini_params["pageToken"] = page_token

    candidates: list[dict[str, str]] = []
    responses: list[tuple[str, object, str]] = [("openai", openai, "id")]
    responses.extend(("anthropic", page, "id") for page in anthropic_pages)
    for provider, response, key in responses:
        if not isinstance(response, dict) or not isinstance(response.get("data"), list):
            raise ValueError(f"invalid {provider} models response")
        for item in response["data"]:
            if isinstance(item, dict) and isinstance(item.get(key), str) and is_chat_model(item[key], provider, item):
                candidates.append({"model_slug": item[key], "provider": provider})
    for gemini in gemini_pages:
        if not isinstance(gemini, dict) or not isinstance(gemini.get("models"), list):
            raise ValueError("invalid Gemini models response")
        for item in gemini["models"]:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                continue
            slug = item["name"].removeprefix("models/")
            if is_chat_model(slug, "gemini", item):
                candidates.append({"model_slug": slug, "provider": "google"})
    return candidates


def detect(output: Path) -> None:
    local: object = json.loads(MODEL_LIST.read_text())
    if not isinstance(local, dict):
        raise ValueError("model_list.json must contain an object")
    new_cases = [case for case in provider_models() if case["model_slug"] not in local]
    output.write_text(json.dumps(new_cases, separators=(",", ":")))


def response_text(response: object) -> str:
    if not isinstance(response, dict) or not isinstance(response.get("output"), list):
        raise ValueError("gateway returned an invalid Responses API payload")
    text = ""
    for item in response["output"]:
        if not isinstance(item, dict) or not isinstance(item.get("content"), list):
            continue
        for content in item["content"]:
            if isinstance(content, dict) and content.get("type") == "output_text" and isinstance(content.get("text"), str):
                text += content["text"]
    if not text:
        raise ValueError("gateway Responses API payload did not contain output text")
    return text


def is_nonnegative_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0


def validate_research_entry(entry: object, candidate_providers: dict[str, str]) -> tuple[str, dict[str, Any]]:
    if not isinstance(entry, dict) or set(entry) != set(RESEARCH_REQUIRED_FIELDS):
        raise ValueError("research returned an invalid model entry")
    slug = entry["model_slug"]
    if not isinstance(slug, str):
        raise ValueError("research returned an invalid model slug")
    provider = candidate_providers.get(slug)
    if provider not in FORMAT_BY_PROVIDER:
        raise ValueError("research returned an unexpected provider")
    if entry["displayName"] is not None and not isinstance(entry["displayName"], str):
        raise ValueError("research returned an invalid display name")
    if any(entry[field] is not None and not isinstance(entry[field], bool) for field in RESEARCH_BOOLEAN_FIELDS):
        raise ValueError("research returned invalid model metadata")
    if not is_nonnegative_number(entry["input_cost_per_mil_tokens"]) or not is_nonnegative_number(entry["output_cost_per_mil_tokens"]):
        raise ValueError("research returned an invalid model price")
    if any(entry[field] is not None and not is_nonnegative_number(entry[field]) for field in RESEARCH_CACHE_COST_FIELDS):
        raise ValueError("research returned an invalid cache price")
    if any(not isinstance(entry[field], int) or isinstance(entry[field], bool) or entry[field] <= 0 for field in ("max_input_tokens", "max_output_tokens")):
        raise ValueError("research returned an invalid model token limit")
    spec: dict[str, Any] = {
        "format": FORMAT_BY_PROVIDER[provider],
        "flavor": "chat",
        "available_providers": [provider],
    }
    for field, value in entry.items():
        if field != "model_slug" and value is not None:
            spec[field] = value
    return slug, spec


def research_and_apply(cases_path: Path) -> None:
    cases: object = json.loads(cases_path.read_text())
    if not isinstance(cases, list) or not cases:
        raise ValueError("candidate list must be non-empty")
    local: object = json.loads(MODEL_LIST.read_text())
    if not isinstance(local, dict):
        raise ValueError("model_list.json must contain an object")
    prompt = "The candidate model ids below were verified by the provider's direct /models endpoint and are chat-capable. Research their pricing and token metadata using only the official pricing documentation URLs supplied. Return one metadata record for every candidate. Input and output prices must be USD per million tokens; max token counts must be documented positive integers. Use null only for optional metadata that is not documented. Do not guess. Do not include commentary, sources, notes, provider routing fields, or model-list schema fields. Sources: https://developers.openai.com/api/docs/pricing https://platform.claude.com/docs/en/about-claude/models/overview https://ai.google.dev/gemini-api/docs/pricing\nCandidates:\n" + json.dumps(cases)
    response = request_json(
        f"{os.environ['OPENAI_BASE_URL'].rstrip('/')}/responses",
        {
            "Authorization": f"Bearer {os.environ['BRAINTRUST_GATEWAY_API_KEY']}",
            "Content-Type": "application/json",
            "x-bt-project-name": "automations-spend-control",
        },
        {
            "model": "gpt-5-mini",
            "input": prompt,
            "tools": [{"type": "web_search", "filters": {"allowed_domains": ["developers.openai.com", "platform.claude.com", "ai.google.dev"]}}],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "model_catalog_update",
                    "strict": True,
                    "schema": research_schema(),
                },
            },
        },
        timeout=120,
    )
    result: object = json.loads(response_text(response))
    if not isinstance(result, dict) or not isinstance(result.get("models"), list):
        raise ValueError("research response must contain a models array")
    candidate_slugs = {case["model_slug"] for case in cases if isinstance(case, dict) and isinstance(case.get("model_slug"), str)}
    candidate_providers = {
        case["model_slug"]: case["provider"]
        for case in cases
        if isinstance(case, dict) and isinstance(case.get("model_slug"), str) and isinstance(case.get("provider"), str)
    }
    researched_specs: dict[str, dict[str, Any]] = {}
    for entry in result["models"]:
        slug, spec = validate_research_entry(entry, candidate_providers)
        researched_specs[slug] = spec
    if set(researched_specs) != candidate_slugs:
        raise ValueError("research did not return a verified spec for every detected model")
    for slug, spec in researched_specs.items():
        local[slug] = spec
    MODEL_LIST.write_text(json.dumps(local, indent=2) + "\n")


def main() -> None:
    global MODEL_LIST
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    detect_parser = subparsers.add_parser("detect")
    detect_parser.add_argument("--output", type=Path, required=True)
    detect_parser.add_argument("--model-list-path", type=Path, default=MODEL_LIST)
    apply_parser = subparsers.add_parser("research-and-apply")
    apply_parser.add_argument("--candidates", type=Path, required=True)
    apply_parser.add_argument("--model-list-path", type=Path, default=MODEL_LIST)
    args = parser.parse_args()
    MODEL_LIST = args.model_list_path
    if args.command == "detect":
        detect(args.output)
    else:
        research_and_apply(args.candidates)


if __name__ == "__main__":
    main()
