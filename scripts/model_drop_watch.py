"""Detect provider model drops and apply verified gateway research to the catalog."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any
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


def request_json(url: str, headers: dict[str, str], body: object | None = None) -> object:
    data = None if body is None else json.dumps(body).encode()
    request = Request(url, data=data, headers=headers, method="POST" if data else "GET")
    with urlopen(request, timeout=30) as response:  # nosec B310 -- provider URLs are constants below
        return json.load(response)


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
    gemini = request_json(
        f"https://generativelanguage.googleapis.com/v1beta/models?key={os.environ['GEMINI_API_KEY']}",
        {},
    )

    candidates: list[dict[str, str]] = []
    responses: list[tuple[str, object, str]] = [("openai", openai, "id")]
    responses.extend(("anthropic", page, "id") for page in anthropic_pages)
    for provider, response, key in responses:
        if not isinstance(response, dict) or not isinstance(response.get("data"), list):
            raise ValueError(f"invalid {provider} models response")
        for item in response["data"]:
            if isinstance(item, dict) and isinstance(item.get(key), str) and is_chat_model(item[key], provider, item):
                candidates.append({"model_slug": item[key], "provider": provider})
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


def research_and_apply(cases_path: Path) -> None:
    cases: object = json.loads(cases_path.read_text())
    if not isinstance(cases, list) or not cases:
        raise ValueError("candidate list must be non-empty")
    prompt = """Research the listed new model drops using only the official pricing documentation URLs supplied. Return JSON only with a `models` object keyed by model slug. Each value must be a complete model_list.json spec. Do not include a model unless its existence, chat capability, and pricing/token metadata are verified. Never guess a field. Sources: https://developers.openai.com/api/docs/pricing https://platform.claude.com/docs/en/about-claude/models/overview https://ai.google.dev/gemini-api/docs/pricing\nCandidates:\n""" + json.dumps(cases)
    response = request_json(
        f"{os.environ['OPENAI_BASE_URL'].rstrip('/')}/responses",
        {
            "Authorization": f"Bearer {os.environ['BRAINTRUST_GATEWAY_API_KEY']}",
            "Content-Type": "application/json",
            "x-bt-project-name": "automations-spend-control",
        },
        {"model": "gpt-5-mini", "input": prompt, "tools": [{"type": "web_search", "filters": {"allowed_domains": ["developers.openai.com", "platform.claude.com", "ai.google.dev"]}}]},
    )
    result: object = json.loads(response_text(response))
    if not isinstance(result, dict) or not isinstance(result.get("models"), dict):
        raise ValueError("research response must contain a models object")
    local: object = json.loads(MODEL_LIST.read_text())
    if not isinstance(local, dict):
        raise ValueError("model_list.json must contain an object")
    candidate_slugs = {case["model_slug"] for case in cases if isinstance(case, dict) and isinstance(case.get("model_slug"), str)}
    for slug, spec in result["models"].items():
        if slug not in candidate_slugs or not isinstance(spec, dict):
            raise ValueError("research returned an invalid model spec")
        local[slug] = spec
    MODEL_LIST.write_text(json.dumps(local, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    detect_parser = subparsers.add_parser("detect")
    detect_parser.add_argument("--output", type=Path, required=True)
    apply_parser = subparsers.add_parser("research-and-apply")
    apply_parser.add_argument("--candidates", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "detect":
        detect(args.output)
    else:
        research_and_apply(args.candidates)


if __name__ == "__main__":
    main()
