# GutPacer 運用手順書

作成日: 2026-07-08

## 構成の全体像

| コンポーネント | 実体 | デプロイ方法 |
|---|---|---|
| フロントエンド | `frontend/index.html` → `s3://veai-careready-frontend/gutpacer/` | GitHub Actions (`deploy.yml`)、`main` への push で自動 |
| API Lambda | `backend/index.mjs` | **手動**(下記参照) |
| 通知 Lambda | `backend/notifier/index.mjs` | GitHub Actions (`deploy-notifier.yml`)、`main` への push で自動 |
| データ | DynamoDB `gutpacer-logs` / `gutpacer-settings`(us-east-1) | — |
| 通知スケジュール | EventBridge `cron(0 23 * * ? *)` = JST 08:00 | `scripts/deploy-notifier.sh` 参照 |

- `backend/legacy/index.js` はレガシー。デプロイ禁止(`backend/legacy/README.md` 参照)。
- `frontend/config.js` は git 管理外。S3 側に直接置かれ、`API_URL` を定義する。deploy workflow は `config.js` を除外している。

## デプロイ

### フロントエンド / 通知 Lambda

`development` → `main` へマージすると GitHub Actions が自動デプロイする。
通知 Lambda は `backend/notifier/**` に変更があるときのみ走る。

### API Lambda(手動)

デプロイ用 workflow は存在しない。AWS コンソールまたは CLI で `backend/index.mjs` の内容を Lambda に反映する。

```bash
cd backend
zip -j /tmp/gutpacer-api.zip index.mjs
aws lambda update-function-code \
  --function-name <API Lambda 関数名> \  # コンソールで要確認
  --zip-file fileb:///tmp/gutpacer-api.zip \
  --region us-east-1
```

必要な環境変数: `ACCESS_PIN`(PIN認証用)。

デプロイ後の確認: ブラウザで https://veai.jp/gutpacer/ を開き、PIN入力 → 履歴が表示されること。

## テスト

```bash
npm install   # 初回のみ
npm test      # Lambda ハンドラのスモークテスト(AWS 接続不要)
```

API の挙動(CORS / PIN / バリデーション)を変更したら、デプロイ前に必ず実行する。

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
