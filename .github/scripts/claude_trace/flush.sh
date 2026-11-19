#!/usr/bin/env bash
bt trace stop || echo "::warning::bt trace stop failed."
log="$BT_DAEMON_DATA_DIR/serve.log"
if [ ! -f "$log" ]; then
  echo "::warning::No bt daemon log at $log; the trace hooks did not run."
  exit 0
fi
sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -E '^\S+\s+(WARN|ERROR) ' || echo "(no trace warnings or errors)"
