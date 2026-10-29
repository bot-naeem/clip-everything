#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/clips"
WAIT_MODE="${WAIT_MODE:-networkidle}"
TIMEOUT_MS="${TIMEOUT_MS:-60000}"
BROWSER="${BROWSER:-auto}"

URL_ZHUANLAN="${URL_ZHUANLAN:-https://zhuanlan.zhihu.com/p/2007944059558323475?share_code=wpShSwJIjJWb&utm_psn=2010112084201980758}"
URL_ANSWER="${URL_ANSWER:-https://www.zhihu.com/question/663685088/answer/2010288487912453827?share_code=ACh1UIIEWUaq&utm_psn=2010336889304007631}"

OUT_ZHUANLAN="${OUT_DIR}/qa-zhihu-zhuanlan.md"
OUT_ANSWER="${OUT_DIR}/qa-zhihu-answer.md"

rm -f "${OUT_DIR}/qa-zhihu-zhuanlan"*.md
rm -f "${OUT_DIR}/qa-zhihu-answer"*.md

run_one() {
  local url="$1"
  local filename="$2"
  echo "[zhihu-acceptance] clipping: ${url}"
  npm run clip -- "${url}" --output "${OUT_DIR}" --filename "${filename}" --browser "${BROWSER}" --wait "${WAIT_MODE}" --timeout-ms "${TIMEOUT_MS}"
}

run_one "${URL_ZHUANLAN}" "qa-zhihu-zhuanlan"
run_one "${URL_ANSWER}" "qa-zhihu-answer"

echo "[zhihu-acceptance] quality check: zhuanlan"
node "${ROOT_DIR}/scripts/zhihu-quality-check.js" --file "${OUT_ZHUANLAN}" --url "${URL_ZHUANLAN}"

echo "[zhihu-acceptance] quality check: answer"
node "${ROOT_DIR}/scripts/zhihu-quality-check.js" --file "${OUT_ANSWER}" --url "${URL_ANSWER}"

echo "[zhihu-acceptance] PASS: both Zhihu pages passed quality checks."
