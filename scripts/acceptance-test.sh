#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/clips"
PROFILE="${PROFILE:-openclaw}"
WAIT_MODE="${WAIT_MODE:-networkidle}"
TIMEOUT_MS="${TIMEOUT_MS:-60000}"

URL_1="https://zhuanlan.zhihu.com/p/2007944059558323475?share_code=wpShSwJIjJWb&utm_psn=2010112084201980758"
URL_2="https://x.com/i/status/2025986105485733945"

run_one() {
	local url="$1"
	echo "[acceptance] clipping: ${url}"
	npm run clip -- "${url}" --output "${OUT_DIR}" --profile "${PROFILE}" --wait "${WAIT_MODE}" --timeout-ms "${TIMEOUT_MS}"
}

run_one "${URL_1}"
run_one "${URL_2}"

echo "[acceptance] PASS: both target URLs clipped successfully."
