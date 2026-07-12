---
name: vanilla-frontend
description: GutPacer のフロントエンド (frontend/index.html) を変更するときのパターン集。escapeHtml 必須ルール、PIN ゲート、PDF 出力、介護者向け UI 原則。
---

# フロントエンドパターン (GutPacer)

単一ファイル `frontend/index.html`。フレームワークなし(素の JS + Tailwind CDN)。この軽さは意図的な設計 — SPA 化しない。

## 絶対ルール: escapeHtml

サーバー由来のテキストを HTML 文字列に差し込むときは**必ず** `escapeHtml()` を通す。対象: notes, date, fullDate, bowel.amount, bowel.type、および今後追加するあらゆる自由入力フィールド。履歴表示(`displayLogs`)と PDF 生成(`buildPdfReportHtml`)の両方が対象。

## PIN ゲート

- PIN は `localStorage['gutpacer_pin']` に保持し、全 fetch に `X-Pin` ヘッダーで付与。
- 401 が返ったら `handleUnauthorized()` → localStorage から PIN を消して PIN 画面を再表示。新しい fetch 呼び出しを書くときはこの 401 ハンドリングを必ず入れる。

## PDF 出力

`buildPdfReportHtml()` で印刷用 HTML を組み、画面外 div (`#pdfReportContent`, width 780px) に流し込み → html2canvas でラスタライズ → jsPDF で A4 複数ページ分割。日本語フォント問題を canvas 経由で回避している構造なので、jsPDF の text API に置き換えないこと。

## UI 原則(介護者向け)

- 入力は 1 画面完結・タップ主体(ボタン選択 > テキスト入力)。記録の継続率が全てなので入力ステップを増やさない。
- 設定値(`config.js` の `API_URL`)は git 管理外。`https://veai.jp/gutpacer/config.js` から読み込まれる。config.js をリポジトリに追加しない。
- 文言は「記録・共有」に限定。診断・治療助言(「〜すべき」等の医療判断)は書かない。既存の「浣腸を検討」レベルの家族内運用メモが上限。
