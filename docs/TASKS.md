# GutPacer タスクリスト

最終更新: 2026-07-08
親ドキュメント: [STRATEGY.md](STRATEGY.md)(Phase 1「壊れない・失わない」に対応)

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

**2026-07-08 更新**: 10人→30人拡大が決定したため、開発タスクは [GROWTH_PLAN.md](GROWTH_PLAN.md) の G-1〜G-10 が正。あなた自身の作業(LINEチャネル作成・テスター募集など)は [USER_TODO.md](USER_TODO.md)。

旧候補との対応: T-6 は G-3 に、T-7/T-8(傾向グラフ)は G-5 以降に吸収。T-9/T-10 は G-2/G-3 の中で対応する。

## 運用ルール

- タスク完了時はこのファイルの該当行を「完了済み」へ移し、実施日を記す。
- 新タスクは必ず STRATEGY.md のストーリー(S-n)または Phase に紐付ける。
