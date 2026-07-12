---
name: aws-deploy-ops
description: GutPacer のデプロイ・バックアップ・障害対応を行うときの手順。S3+CloudFront、GitHub Actions、Lambda 手動デプロイ、DynamoDB PITR。
---

# AWS デプロイ・運用 (GutPacer)

詳細な手順は `docs/OPERATIONS.md` が正。このスキルは判断の要点のみ。

## デプロイ経路(3系統あることを忘れない)

| 対象 | 経路 | トリガー |
|---|---|---|
| フロントエンド | GitHub Actions → S3 + CloudFront invalidation | `main` へ push |
| 通知 Lambda | GitHub Actions | `main` へ push(`backend/notifier/**` 変更時) |
| API Lambda | **手動のみ**(zip + `aws lambda update-function-code`) | なし |

- 開発は `development` ブランチ、デプロイは `main` マージ。`development` に push しても何もデプロイされない。
- `frontend/config.js` は deploy workflow で除外される。S3 上の config.js を消さない・上書きしない。

## デプロイ前チェック

1. `npm test` が通ること。
2. API に新ヘッダー/新メソッドを足した場合、CORS 設定とフロントの fetch の両方が揃っているか。
3. リージョンは us-east-1。関数名はコンソールで確認(リポジトリに記録がない)。

## バックアップ

- DynamoDB 両テーブルで PITR 有効(2026-07-08〜)。テーブルを再作成したら `scripts/enable-pitr.sh` を再実行。
- PITR 復元は新テーブル名への復元になる。手順は `docs/OPERATIONS.md`。
- 記録データは再取得不可能。テーブル削除系の操作は必ずユーザー確認を取る。

## 障害の一次切り分け

- 画面がデータ取得失敗 → API Lambda の CloudWatch ログ。401 なら `ACCESS_PIN` 不一致。
- LINE 通知が来ない → location=facility → EventBridge ルール → notifier ログ、の順。
- デプロイが反映されない → CloudFront invalidation(`/gutpacer/*`)の実行を Actions ログで確認。
