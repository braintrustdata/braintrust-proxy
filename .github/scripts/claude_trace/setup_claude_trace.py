"""Install the pinned bt CLI and Claude Code tracing plugin, and route traces to a Braintrust project."""

import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from constants import (
    BT_DOWNLOAD_URL,
    BT_SHA256,
    BT_TARGETS,
    BT_VERSION,
    PLUGIN_COMMIT,
    PLUGIN_REPO_URL,
    PLUGIN_SUBDIR,
    PROJECT_NAME,
)

SPAN_PLUGIN_PATH = Path(__file__).resolve().parent / "name_root_span.mjs"


@dataclass(frozen=True)
class TraceSetup:
    bt_dir: Path
    plugin_dir: Path
    config_path: Path
    data_dir: Path
    socket_path: Path


def run(args: Sequence[str]) -> None:
    subprocess.run(list(args), check=True)


def project_from_env() -> str:
    value = os.environ.get("BT_TRACE_PROJECT", "")
    if not PROJECT_NAME.fullmatch(value):
        raise ValueError(f"BT_TRACE_PROJECT must be a simple project name, got {value!r}")
    return value


def bt_target_from_env() -> str:
    arch = os.environ.get("RUNNER_ARCH", "")
    if arch not in BT_TARGETS:
        raise ValueError(f"Unsupported RUNNER_ARCH for the bt CLI: {arch!r}")
    return BT_TARGETS[arch]


def runner_temp_from_env() -> Path:
    value = os.environ.get("RUNNER_TEMP", "")
    if not value:
        raise ValueError("RUNNER_TEMP is required")
    return Path(value)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=60) as response, dest.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)


def install_bt(target: str, root: Path) -> Path:
    archive = root / f"bt-{target}.tar.gz"
    download(BT_DOWNLOAD_URL.format(version=BT_VERSION, target=target), archive)
    actual = sha256_of(archive)
    if actual != BT_SHA256[target]:
        raise ValueError(f"bt {BT_VERSION} archive checksum mismatch for {target}: {actual}")
    with tarfile.open(archive) as tar:
        tar.extractall(root, filter="data")
    bt_dir = root / f"bt-{target}"
    if not (bt_dir / "bt").is_file():
        raise ValueError(f"bt archive did not contain bt-{target}/bt")
    return bt_dir


def fetch_plugin(dest: Path) -> Path:
    run(["git", "init", "-q", str(dest)])
    run(["git", "-C", str(dest), "remote", "add", "origin", PLUGIN_REPO_URL])
    run(["git", "-C", str(dest), "fetch", "-q", "--depth", "1", "origin", PLUGIN_COMMIT])
    run(["git", "-C", str(dest), "checkout", "-q", "FETCH_HEAD"])
    plugin_dir = dest / PLUGIN_SUBDIR
    if not (plugin_dir / ".claude-plugin" / "plugin.json").is_file():
        raise ValueError(f"Plugin checkout is missing {PLUGIN_SUBDIR}/.claude-plugin/plugin.json")
    return plugin_dir


def trace_config(project: str, span_plugin: Path) -> dict[str, object]:
    return {
        "trace_to_braintrust": True,
        "route": {
            "auth": {"source": "environment"},
            "destination": {"type": "project_logs", "project_name": project},
            "tags": ["ci"],
            "span_plugins": [str(span_plugin)],
        },
    }


def write_trace_config(path: Path, project: str, span_plugin: Path) -> None:
    path.write_text(json.dumps(trace_config(project, span_plugin), indent=2) + "\n", encoding="utf-8")


def setup(project: str, target: str, runner_temp: Path) -> TraceSetup:
    root = runner_temp / "claude-trace"
    root.mkdir(parents=True, exist_ok=True)
    bt_dir = install_bt(target, root)
    plugin_dir = fetch_plugin(root / "braintrust-claude-plugin")
    span_plugin = root / SPAN_PLUGIN_PATH.name
    shutil.copyfile(SPAN_PLUGIN_PATH, span_plugin)
    config_path = root / "braintrust.json"
    write_trace_config(config_path, project, span_plugin)
    return TraceSetup(
        bt_dir=bt_dir,
        plugin_dir=plugin_dir,
        config_path=config_path,
        data_dir=root / "bt-daemon",
        socket_path=root / "daemon.sock",
    )


def append_runner_lines(name: str, lines: Sequence[str]) -> None:
    if any("\r" in line or "\n" in line for line in lines):
        raise ValueError(f"{name} must contain single-line values")
    with Path(os.environ[name]).open("a", encoding="utf-8") as output:
        output.writelines(f"{line}\n" for line in lines)


def main() -> None:
    result = setup(project_from_env(), bt_target_from_env(), runner_temp_from_env())
    append_runner_lines("GITHUB_PATH", [str(result.bt_dir)])
    append_runner_lines(
        "GITHUB_ENV",
        [
            f"BT_DAEMON_CONFIG={result.config_path}",
            f"BT_DAEMON_DATA_DIR={result.data_dir}",
            f"BT_DAEMON_SOCKET={result.socket_path}",
        ],
    )
    append_runner_lines("GITHUB_OUTPUT", [f"plugin_dir={result.plugin_dir}"])
    print(f"bt {BT_VERSION} at {result.bt_dir}; trace-claude-code plugin at {result.plugin_dir}")


if __name__ == "__main__":
    main()
