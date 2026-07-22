# GutPacer 運用手順書

作成日: 2026-07-08

## 構成の全体像

| コンポーネント | 実体 | デプロイ方法 |
|---|---|---|
| フロントエンド | `frontend/index.html` → `s3://veai-careready-frontend/gutpacer/` | GitHub Actions (`deploy.yml`)、`main` への push で自動 |
| API Lambda | `backend/index.mjs` → `gutpacer-backend` | GitHub Actions (`deploy-api.yml`)、`main` への push で自動 |
| 通知 Lambda | `backend/notifier/index.mjs` → `gutpacer-notifier` | GitHub Actions (`deploy-notifier.yml`)、`main` への push で自動 |
| データ | DynamoDB `gutpacer-logs` / `gutpacer-settings`(us-east-1) | — |
| 通知スケジュール | EventBridge `cron(0 23 * * ? *)` = JST 08:00 | `scripts/deploy-notifier.sh` 参照 |

- `backend/legacy/index.js` はレガシー。デプロイ禁止(`backend/legacy/README.md` 参照)。
- `frontend/config.js` は git 管理外。S3 側に直接置かれ、`API_URL` を定義する。deploy workflow は `config.js` を除外している。

## デプロイ

`development` → `main` へマージすると GitHub Actions が対象ごとに自動デプロイする。

| workflow | トリガー(main への push で) | 内容 |
|---|---|---|
| `deploy.yml` | 常時 | `frontend/` を S3 sync + CloudFront invalidation |
| `deploy-api.yml` | `backend/index.mjs` 変更時 | `npm test` → `gutpacer-backend` を更新 |
| `deploy-notifier.yml` | `backend/notifier/**` 変更時 | `gutpacer-notifier` を更新 |

- API/通知の Lambda は zip ルートに `index.mjs` を置く必要がある(handler = `index.handler`)。ワークフローは `zip -j` でパスを除去している。AWS SDK v3 はランタイム同梱のため node_modules は同梱しない。
- OIDC ロール `Github-actions-gutpacer-deploy` が `gutpacer-backend` / `gutpacer-notifier` の `lambda:UpdateFunctionCode` と S3/CloudFront 権限を持つ(2026-07-13 に backend を追加)。
- 必要な GitHub secrets: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`(OIDC認証用。Lambda関数の us-east-1 とは別リージョン), `CLOUDFRONT_DISTRIBUTION_ID`。
- Lambda 関数は全て **us-east-1** 固定。ワークフローの `update-function-code` は `--region us-east-1` を明示指定している(`AWS_REGION` シークレットが別リージョンのため、これがないと us-east-1 のARNに対して AccessDenied になる)。
- API Lambda の環境変数 `ACCESS_PIN`(PIN認証用)は Lambda 側で管理。コードには入れない。

デプロイ後の確認: ブラウザで https://veai.jp/gutpacer/ を開き、PIN入力 → 履歴が表示されること。

### 手動デプロイ(緊急時のフォールバック)

```bash
zip -j /tmp/gutpacer-api.zip backend/index.mjs
aws lambda update-function-code \
  --function-name gutpacer-backend \
  --zip-file fileb:///tmp/gutpacer-api.zip \
  --region us-east-1
```

## テスト

```bash
npm install   # 初回のみ
npm test      # Lambda ハンドラのスモークテスト(AWS 接続不要)
```

API の挙動(CORS / PIN / バリデーション)を変更したら、デプロイ前に必ず実行する。

### 継続率レポート (H-11)

```bash
npm run report:retention        # 直近28日(4週)・今日JST基準
WEEKS=6 npm run report:retention
END_DATE=2026-07-14 npm run report:retention
```

出力の `gate` フィールド: `"expand"` = 継続5組以上, `"hold"` = 5組未満。
実行にはローカルまたは CloudShell 上で有効な AWS 認証情報が必要。出力に LINE userId (sub) が含まれるため共有時はマスクすること。

## バックアップ / リストア

### 現状

- 両テーブルとも **PITR(ポイントインタイムリカバリ)有効**(2026-07-08 有効化)。
- 過去35日間の任意時点に復元可能。追加コストはテーブルサイズ比例(現状ほぼゼロ)。

### テーブルを再作成した場合

```bash
bash scripts/enable-pitr.sh
```

### 誤削除からの復元

PITR 復元は**新しいテーブル名**への復元になる点に注意。

```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name gutpacer-logs \
  --target-table-name gutpacer-logs-restored \
  --restore-date-time <ISO8601時刻> \
  --region us-east-1
```

復元後、データを確認してから Lambda の参照先を切り替えるか、データを元テーブルに書き戻す。

## 通知 Lambda の環境変数

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_USER_ID`

トークンをローテーションしたら Lambda コンソールで更新する。git には絶対に入れない。

## 障害時の一次切り分け

1. アプリが「サーバーからデータを取得できませんでした」→ API Lambda のログ(CloudWatch)を確認。401 連発なら `ACCESS_PIN` 環境変数と入力PINの不一致を疑う。
2. LINE通知が来ない → ①location が facility になっていないか ②EventBridge ルールが有効か ③notifier の CloudWatch ログ、の順に確認。
3. デプロイしたのに反映されない → CloudFront キャッシュ。invalidation(`/gutpacer/*`)が走ったか Actions のログを確認。
