#!/usr/bin/env bash
# 動作確認で投入したテスト2行だけをKVから削除する（本物の回答は消さない）。
# 使い方: リポジトリ直下で  bash cleanup-testdata.sh
set -euo pipefail
NS=2ebdd7fffa7e417280c03d81f9faab15   # v0.3専用 LOGS namespace（title: scenario_logs）
for key in \
  "session:smoke-v03-001"
do
  echo "削除: $key"
  wrangler kv key delete "$key" --namespace-id "$NS" --remote
done
echo "✓ テスト2行を削除しました"
