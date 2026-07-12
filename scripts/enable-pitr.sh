#!/bin/bash
# DynamoDB のポイントインタイムリカバリ (PITR) を有効化する。
# 記録データは再取得不可能なため、テーブル再作成時は必ず実行すること。
# 実行済み: 2026-07-08 (gutpacer-logs, gutpacer-settings とも ENABLED)
set -euo pipefail

REGION="us-east-1"
TABLES=("gutpacer-logs" "gutpacer-settings")

for TABLE in "${TABLES[@]}"; do
    echo "Enabling PITR on ${TABLE}..."
    aws dynamodb update-continuous-backups \
        --table-name "${TABLE}" \
        --region "${REGION}" \
        --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
        --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
        --output text
done
