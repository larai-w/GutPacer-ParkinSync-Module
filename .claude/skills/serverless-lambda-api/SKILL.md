---
name: serverless-lambda-api
description: GutPacer の API Lambda (backend/index.mjs) を変更・拡張するときのパターン集。CORS、PIN認証、DynamoDB、検証順序のルール。
---

# サーバーレス Lambda API パターン (GutPacer)

`backend/index.mjs` が唯一の API 実装。ESM + AWS SDK v3 + DynamoDB DocumentClient。
`backend/legacy/index.js` はデプロイ禁止のレガシー(X-Pin CORS 未対応)。

## ハンドラ内の処理順序(崩さないこと)

1. CORS ヘッダー定義 — `Access-Control-Allow-Headers` に `Content-Type,X-Pin` を必ず含める。新ヘッダー追加時はここも更新しないとブラウザのプリフライトで死ぬ。
2. `OPTIONS` は PIN チェック**前**に 200 を返す(プリフライトには認証ヘッダーが付かないため)。
3. PIN 認証: `event.headers?.['x-pin']`(小文字。API Gateway/関数URLはヘッダー名を小文字化する)と `process.env.ACCESS_PIN` を比較、不一致は 401。
4. メソッド分岐 → バリデーション(400)→ DynamoDB 操作。

## DynamoDB

- `gutpacer-logs`: キー `fullDate` (YYYY-MM-DD)。ログ本体。`bowel: null` は「排便なしと記録した日」を意味し、「未記録」と区別される — notifier がこの区別に依存しているので壊さない。
- `gutpacer-settings`: キー `settingKey`。現在 `location` (home/facility) のみ。
- リージョン: us-east-1。PITR 有効(再作成時は `scripts/enable-pitr.sh`)。

## 変更時の必須手順

1. `npm test` でスモークテスト(`scripts/smoke-test.mjs`)を通す。DB到達前の経路(OPTIONS/401/400)を検証している。新しい検証経路を足したらテストも足す。
2. デプロイは手動(`docs/OPERATIONS.md` 参照)。GitHub Actions は API Lambda をデプロイしない。
3. フロントに新ヘッダーを追加するときは CORS の Allow-Headers 更新とセットで。
