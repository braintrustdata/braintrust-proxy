import json
import os
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import model_drop_watch


def research_response(entry: dict[str, object]) -> dict[str, object]:
    return {
        "output": [
            {
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps({"models": [entry]}),
                    },
                ],
            },
        ],
    }


def entry() -> dict[str, object]:
    return {
        "model_slug": "new-model",
        "displayName": "New model",
        "multimodal": True,
        "reasoning": None,
        "reasoning_budget": None,
        "supports_streaming": True,
        "input_cost_per_mil_tokens": 1,
        "output_cost_per_mil_tokens": 2,
        "input_cache_read_cost_per_mil_tokens": None,
        "input_cache_write_cost_per_mil_tokens": None,
        "input_cache_write_5m_cost_per_mil_tokens": None,
        "input_cache_write_1h_cost_per_mil_tokens": None,
        "max_input_tokens": 1000,
        "max_output_tokens": 100,
    }


class ModelDropWatchTest(unittest.TestCase):
    def test_reads_all_gemini_model_pages(self) -> None:
        requests: list[str] = []
        responses = iter(
            [
                {"data": []},
                {"data": [], "has_more": False},
                {
                    "models": [
                        {
                            "name": "models/gemini-first-page",
                            "supportedGenerationMethods": ["generateContent"],
                        },
                    ],
                    "nextPageToken": "second page",
                },
                {
                    "models": [
                        {
                            "name": "models/gemini-second-page",
                            "supportedGenerationMethods": ["generateContent"],
                        },
                    ],
                },
            ],
        )

        def request_json(url: str, _headers: dict[str, str]) -> object:
            requests.append(url)
            return next(responses)

        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "test",
                "ANTHROPIC_API_KEY": "test",
                "GEMINI_API_KEY": "test",
            },
        ), patch.object(model_drop_watch, "request_json", side_effect=request_json):
            self.assertEqual(
                model_drop_watch.provider_models(),
                [
                    {"model_slug": "gemini-first-page", "provider": "google"},
                    {"model_slug": "gemini-second-page", "provider": "google"},
                ],
            )

        self.assertEqual(parse_qs(urlparse(requests[-1]).query)["pageToken"], ["second page"])

    def test_builds_provider_routing_fields_deterministically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_list = Path(directory) / "model_list.json"
            candidates = Path(directory) / "candidates.json"
            model_list.write_text("{}")
            candidates.write_text(json.dumps([{"model_slug": "new-model", "provider": "google"}]))
            with patch.dict(os.environ, {"OPENAI_BASE_URL": "https://gateway.example/v1", "BRAINTRUST_GATEWAY_API_KEY": "test"}), patch.object(model_drop_watch, "MODEL_LIST", model_list), patch.object(
                model_drop_watch,
                "request_json",
                return_value=research_response(entry()),
            ):
                model_drop_watch.research_and_apply(candidates)
            model = json.loads(model_list.read_text())["new-model"]
            self.assertEqual(model["format"], "google")
            self.assertEqual(model["flavor"], "chat")
            self.assertEqual(model["available_providers"], ["google"])

    def test_rejects_non_integer_token_limits_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_list = Path(directory) / "model_list.json"
            candidates = Path(directory) / "candidates.json"
            model_list.write_text("{}")
            candidates.write_text(json.dumps([{"model_slug": "new-model", "provider": "openai"}]))
            invalid_entry = entry()
            invalid_entry["max_output_tokens"] = 100.5
            with patch.dict(os.environ, {"OPENAI_BASE_URL": "https://gateway.example/v1", "BRAINTRUST_GATEWAY_API_KEY": "test"}), patch.object(model_drop_watch, "MODEL_LIST", model_list), patch.object(
                model_drop_watch,
                "request_json",
                return_value=research_response(invalid_entry),
            ):
                with self.assertRaisesRegex(ValueError, "token limit"):
                    model_drop_watch.research_and_apply(candidates)
            self.assertEqual(model_list.read_text(), "{}")


if __name__ == "__main__":
    unittest.main()
