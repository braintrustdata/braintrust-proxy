"""Pinned versions for tracing Claude Code runs in CI to Braintrust."""

import re

BT_VERSION = "v0.24.0"
BT_DOWNLOAD_URL = "https://github.com/braintrustdata/bt/releases/download/{version}/bt-{target}.tar.gz"
BT_TARGETS = {
    "X64": "x86_64-unknown-linux-gnu",
    "ARM64": "aarch64-unknown-linux-gnu",
}
BT_SHA256 = {
    "x86_64-unknown-linux-gnu": "de9210bc4e05e1ad5865b217afee9f4601a0b5888d9809ec09435ba68e72eba0",
    "aarch64-unknown-linux-gnu": "fe9d1e1ec0ea227b54c21430e0809f5adf8e882f46caed0bf094daf6d8b7297e",
}

PLUGIN_REPO_URL = "https://github.com/braintrustdata/braintrust-claude-plugin"
PLUGIN_COMMIT = "d26e64d52951919e2fbd4fa4cb737b9a5e6a9316"  # v3.0.3
PLUGIN_SUBDIR = "plugins/trace-claude-code"

PROJECT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
