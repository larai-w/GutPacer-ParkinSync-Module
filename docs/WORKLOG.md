# 作業ログ / セッション引き継ぎ

新しいセッション(Codex含む)は `docs/PROJECT_HANDOFF.md` → このファイルの順で読むと、直近の作業と現状が分かる。
古い順に上から、最新が下。

---

## 2026-07-08 〜 07-14: Phase 1 完了 + デプロイ自動化(Claude Code / Fable・Opus・Sonnet)

### このセッションで決めたこと(戦略)

- GutPacer を1家族専用から「まず10家族 → その後30家族」へ拡大する方針を決定。
- 薬・便の状態区分・通知しきい値を**ユーザーごとにカスタマイズ**できるようにする(要件)。
- 戦略・計画・ロードマップは新規ドキュメント群に集約:
  - `docs/STRATEGY.md` — 全体戦略・ユーザーストーリー・コスト
  - `docs/GROWTH_PLAN.md` — 10→30人の具体プラン、開発タスク G-1〜G-10、技術方針3決定
  - `docs/TASKS.md` — タスクの完了実績と進捗
  - `docs/USER_TODO.md` — **人間(オーナー)がやること**。時間見積もり付き
  - `docs/OPERATIONS.md` — デプロイ/バックアップ/障害対応
- 役割分担の仕組みを導入: 立案=上位モデル、実装=`builder` エージェント(既定Sonnet、大物はOpus)。
  - `.claude/agents/builder.md`、`.claude/skills/delegate/`、`CLAUDE.md` に明文化。
  - パターン集スキル: `.claude/skills/` に serverless-lambda-api / line-flex-notification / vanilla-frontend / aws-deploy-ops。

### 実装・インフラでやったこと(すべて main 反映済み・本番デプロイ済み)

1. **XSS対策**: `frontend/index.html` に `escapeHtml()` を追加。履歴表示とPDF出力の全サーバー由来テキスト(notes/date/bowel/fullDate)をエスケープ。
2. **レガシー隔離**: 旧CommonJS版を `backend/legacy/index.js` へ移動 + デプロイ禁止READMEを添付。現行APIは `backend/index.mjs` のみ。
3. **テスト基盤**: `package.json` + `scripts/smoke-test.mjs`(AWS接続不要のスモークテスト6件)。`npm test` で実行。
4. **DynamoDB PITR**: `gutpacer-logs` / `gutpacer-settings` 両テーブルでポイントインタイムリカバリを有効化(過去35日復元可)。再現用 `scripts/enable-pitr.sh`。
5. **G-3 デプロイ自動化**: `.github/workflows/deploy-api.yml` 新規作成(main push で `npm test` → `gutpacer-backend` を自動デプロイ)。OIDCロール `Github-actions-gutpacer-deploy` に backend の更新権限を追加。

### この過程で見つけて直した既存バグ(重要)

- **リージョン不一致**: `AWS_REGION` シークレットが us-east-1 以外に設定されていて、Lambda更新が別リージョンのARNを叩き `AccessDenied`。この影響で**通知の自動デプロイ(deploy-notifier.yml)は2026-06に追加されて以来ずっと失敗していた**。両ワークフローの `update-function-code` に `--region us-east-1` を明示して解消。
- **zipパッケージング**: handler が `index.handler` なのにパス付きzipでルートに `index.mjs` が来ていなかった。`zip -j` に修正。
- 両ワークフローに `workflow_dispatch`(手動実行)を追加。**現在フロント/API/通知の3ワークフロー全て緑**を確認済み。

### 事実メモ(引き継ぎで使う具体値)

- API Lambda 関数名: **`gutpacer-backend`**(us-east-1, nodejs24.x, handler=`index.handler`, env `ACCESS_PIN`)
- 通知 Lambda: **`gutpacer-notifier`**(us-east-1)
- Lambda 関数は**全て us-east-1**。ただし `AWS_REGION` シークレットは別リージョン。デプロイ系のCLIは region を明示すること。
- OIDCデプロイロール: `Github-actions-gutpacer-deploy`(backend/notifier の UpdateFunctionCode + S3/CloudFront)
- LINE公式アカウント: **@775deus**(保有済み。友だち追加の入口・通知の送り主)
- AWSアカウント: 339712703146 / CloudFront distribution: E32Z6UIZTZD6DE

### 次にやること

- 開発の次タスクは **G-1(LIFF認証)**。ただし人間側の **H-4(LINE Login チャネル + LIFF アプリ作成 → LIFF ID 取得)** が前提でブロック中。
- 未着手: G-1, G-2(DynamoDBマルチテナント化), G-4〜G-10。詳細は `docs/GROWTH_PLAN.md`。
- 人間がやることの一覧と優先順位は `docs/USER_TODO.md`。
