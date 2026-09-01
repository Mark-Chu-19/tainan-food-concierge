#!/usr/bin/env bash
# 一鍵設定：把本專案的 skills 連進 Hermes，檢查必要的 API key。
# 用法：bash scripts/setup.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_DIR="${HOME}/.hermes"
SKILLS_SRC="${REPO_DIR}/skills"
SKILLS_DST="${HERMES_DIR}/skills"

echo "==> 專案目錄：${REPO_DIR}"

# 1. 確認 hermes 已安裝
if ! command -v hermes >/dev/null 2>&1; then
  echo "!! 找不到 hermes。先安裝："
  echo "   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
  exit 1
fi

# 2. 連結 skills（用 symlink，改 repo 即時生效）
mkdir -p "${SKILLS_DST}"
for skill in "${SKILLS_SRC}"/*/; do
  name="$(basename "${skill}")"
  ln -sfn "${skill%/}" "${SKILLS_DST}/${name}"
  echo "==> linked skill: ${name}"
done

# 3. 檢查祕密（不印出值）
ENV_FILE="${HERMES_DIR}/.env"
touch "${ENV_FILE}"
check_key () {
  if grep -q "^$1=" "${ENV_FILE}" 2>/dev/null; then
    echo "==> ${ENV_FILE} 已有 $1 ✓"
  else
    echo "!! ${ENV_FILE} 缺少 $1（$2）"
  fi
}
check_key ANTHROPIC_API_KEY   "Claude 推理大腦"
check_key GOOGLE_MAPS_API_KEY "餐廳資料 + 地圖路線"
echo "   （選用）GOOGLE_SERVICE_ACCOUNT_PATH / EVENTS_SHEET_ID：政府活動層"
echo "   （選用）THREADS_ACCESS_TOKEN：Threads 趨勢訊號"

echo ""
echo "==> 完成。接著："
echo "    hermes model      # 若還沒設 Claude"
echo "    hermes --tui      # 開始對話，輸入 /tainan-food-intake"
