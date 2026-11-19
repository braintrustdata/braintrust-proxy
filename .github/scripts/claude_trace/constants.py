"""Pinned versions for tracing Claude Code runs in CI to Braintrust."""

import re

BT_VERSION = "v0.32.0"
BT_DOWNLOAD_URL = "https://github.com/braintrustdata/bt/releases/download/{version}/bt-{target}.tar.gz"
BT_TARGETS = {
    "X64": "x86_64-unknown-linux-gnu",
    "ARM64": "aarch64-unknown-linux-gnu",
}
BT_SHA256 = {
    "x86_64-unknown-linux-gnu": "ed0349baeb0b477f26ad6018a51fff46adcf1b391075ff693af39b917ad6104e",
    "aarch64-unknown-linux-gnu": "aa15ec12d09d60dc482144d4f236dc51ca7b7b21c81e1251ac5cd5254c5ad00e",
}

PLUGIN_REPO_URL = "https://github.com/braintrustdata/braintrust-claude-plugin"
PLUGIN_COMMIT = "3314637da3bc6ff3fd523032c9717e3dd76a52bf"  # v3.0.6
PLUGIN_SUBDIR = "plugins/trace-claude-code"

PROJECT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
