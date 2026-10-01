#!/usr/bin/env bash
# Wrapper for cron/systemd: loads secrets from an env file kept OUTSIDE the repository,
# then runs the autopilot.  Example:  deploy/run.sh run --live
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${AUTOPILOT_ENV:-$HOME/.config/naver-ads-autopilot.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
exec python3 -m autopilot "$@" --config "${AUTOPILOT_CONFIG:-config.toml}"
