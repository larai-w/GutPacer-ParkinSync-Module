# GutPacer タスクリスト

最終更新: 2026-07-08
親ドキュメント: 内部戦略ノート(非公開)(Phase 1「壊れない・失わない」に対応)

## 完了済み(2026-07-08 実施)

### ✅ T-1: notes 等の HTML エスケープ(XSS対策 / ストーリー S-1)

- `frontend/index.html` に `escapeHtml()` を追加。
- 履歴表示(`displayLogs`)と PDF 出力(`buildPdfReportHtml`)の両方で、サーバー由来のテキスト(notes / date / bowel.amount / bowel.type / fullDate)をエスケープしてから HTML に差し込むよう修正。
- 確認方法: notes に `<script>alert(1)</script>` を入れて保存 → 履歴・PDF とも文字としてそのまま表示されれば OK。

### ✅ T-2: レガシー API Lambda の隔離

- `backend/index.js` → `backend/legacy/index.js` へ移動(git mv)。
- `backend/legacy/README.md` に「X-Pin CORS 未対応のためデプロイ禁止」と明記。
- 現行実装は `backend/index.mjs` のみ、と一本化。

### ✅ T-3: テスト基盤(package.json + スモークテスト)

- `package.json` 新規作成(devDependencies: AWS SDK 2パッケージのみ)。
- `scripts/smoke-test.mjs`: AWS 接続不要で API Lambda の CORS / PIN 認証 / バリデーション経路を検証。
- 実行: `npm install && npm test` → **6/6 passed**(2026-07-08 時点)。

### ✅ T-4: DynamoDB バックアップ(PITR)有効化

- `gutpacer-logs` / `gutpacer-settings` 両テーブルで PITR を **ENABLED** に変更済み(us-east-1)。過去35日間の任意時点へ復元可能に。
- 再現用スクリプト: `scripts/enable-pitr.sh`。
- 復元手順: [OPERATIONS.md](OPERATIONS.md) 参照。

### ✅ T-5: 運用手順の文書化

- `docs/OPERATIONS.md` 新規作成: デプロイ経路一覧(API Lambda が手動である旨を含む)、テスト、バックアップ/リストア、環境変数、障害時の一次切り分け。
- `docs/PROJECT_HANDOFF.md` を現状に合わせて更新。

## 次のタスク候補(未着手)

**2026-07-08 更新**: 10人→30人拡大が決定したため、開発タスクは 内部グロース計画(非公開) の G-1〜G-10 が正。あなた自身の作業(LINEチャネル作成・テスター募集など)は オーナーTODO(非公開)。

旧候補との対応: T-6 は G-3 に、T-7/T-8(傾向グラフ)は G-5 以降に吸収。T-9/T-10 は G-2/G-3 の中で対応する。

## GROWTH_PLAN タスクの進捗

### ✅ G-3: API デプロイ自動化(2026-07-13)

- `.github/workflows/deploy-api.yml` 新規作成: `main` への push で `backend/index.mjs` 変更時に `npm test` → `gutpacer-backend` を自動デプロイ。
- OIDC ロール `Github-actions-gutpacer-deploy` に `gutpacer-backend` の `lambda:UpdateFunctionCode` を追加。
- 併せて `deploy-notifier.yml` のパッケージングバグを修正(`zip` → `zip -j`。handler=`index.handler` に対しパス付きzipは不整合だった)。
- **判明した既存不具合を修正**: `AWS_REGION` シークレットが us-east-1 以外だったため、Lambda更新が別リージョンのARNを叩き AccessDenied。通知の自動デプロイは追加以来ずっと失敗していた。両ワークフローで `--region us-east-1` を明示して解消。初回デプロイ成功を確認済み(gutpacer-backend, 2026-07-13 04:00 UTC 更新)。
- 検証環境(別 Lambda/テーブル)の分離は未実施。ユーザー数が増えるまでは本番直デプロイ + スモークテストで運用し、G-2 のテーブル移行時に再検討する。

未着手: G-1(LIFF認証), G-2(マルチテナント化), G-4〜G-10。G-1/G-2は事前実装が進行中。Mini App ID類は確認済みで、次の接続確認は開発用エンドポイントURL切り替えと本人LINE userId確認。

## PMポートフォリオ基盤(2026-07-19)

### ✅ PM-1: Technical PMの公開証拠をリポジトリ内に整備

- `docs/PROJECT_MANAGEMENT.md`: stakeholder → user story → acceptance → architecture/delivery → validation → release decision の流れ、Definition of Ready/Done、推奨Project fields/viewsを英語で文書化。
- User Story / Delivery Task Issue FormsとPRテンプレートを追加。受け入れ証拠、データ境界、ヘルスケア表現、rollback/recoveryを完了条件へ組み込んだ。
- `.github/workflows/project-automation.yml`: 新規Issue/PRをGitHub Projectへ自動追加するWorkflowを追加。
- `scripts/setup-github-project.sh`: dry-run既定で、Project、fields、labels、既存Issue取り込み、repository variableを一括設定できるようにした。
- 検証: YAML 4ファイルのparse、shell構文、setup dry-run、`npm test` 13/13、`git diff --check`。
- GitHub CLI再認証とsetup `--execute`を完了。[GutPacer Delivery Project](https://github.com/users/larai-w/projects/8)に既存Issue 12件、fields、labels、repository variableを反映済み。
- PM基盤のPR [#22](https://github.com/larai-w/GutPacer-ParkinSync-Module/pull/22)を`main`へmergeし、`PROJECTS_TOKEN` Secretを登録済み。
- テストIssue [#23](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues/23)でProjectへの自動追加、Workflow成功、close後のStatus=`Done`同期を確認済み。

## 運用ルール

- タスク完了時はこのファイルの該当行を「完了済み」へ移し、実施日を記す。
- 新タスクは必ず STRATEGY.md のストーリー(S-n)または Phase に紐付ける。
