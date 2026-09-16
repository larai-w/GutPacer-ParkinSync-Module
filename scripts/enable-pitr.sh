#!/bin/bash
# DynamoDB のポイントインタイムリカバリ (PITR) を有効化する。
# 記録データは再取得不可能なため、テーブル再作成時は必ず実行すること。
# 実行済み: 2026-07-08 (us-east-1 の gutpacer-logs, gutpacer-settings とも ENABLED)
# 2026-08-28 に ap-northeast-1 へ移設。2026-09-16 に東京の5テーブルで PITR と削除保護を有効化した。
# 既定は東京。旧リージョンを触るときだけ REGION を上書きする。
set -euo pipefail

REGION="${REGION:-ap-northeast-1}"
TABLES=("gutpacer-logs" "gutpacer-logs-v2" "gutpacer-settings" "gutpacer-users" "GutPacerMetrics")

for TABLE in "${TABLES[@]}"; do
    echo "Enabling PITR on ${TABLE}..."
    aws dynamodb update-continuous-backups \
        --table-name "${TABLE}" \
        --region "${REGION}" \
        --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
        --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
        --output text
done
