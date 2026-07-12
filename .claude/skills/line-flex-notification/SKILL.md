---
name: line-flex-notification
description: 通知 Lambda (backend/notifier/index.mjs) の変更時に使う。LINE Messaging API の Flex Message 送信、JST 日付計算、リマインド/警告ロジックのルール。
---

# LINE 通知 Lambda パターン (GutPacer)

`backend/notifier/index.mjs`。EventBridge `cron(0 23 * * ? *)`(= JST 08:00)で起動。

## 通知ロジック(仕様として固定)

1. `gutpacer-settings` の location が `facility` なら**何も送らず終了**(施設滞在中は記録できないため。通知のオオカミ少年化防止)。
2. 昨日 `bowel != null` → 通知不要。
3. 昨日だけ記録なし → リマインド(黄色ヘッダー)。
4. 昨日+一昨日以上なし → 警告(赤ヘッダー)。連続日数は最大7日までさかのぼって数える。

「記録なし」と「bowel: null(排便なしと記録)」の区別が全ての前提。判定は `result.Item?.bowel != null`。

## 実装パターン

- **JST 日付**: `new Date(now.getTime() + 9*60*60*1000)` して `toISOString().split("T")[0]`。Lambda は UTC で動くので `new Date()` 直接の日付は使わない。
- **LINE 送信**: 依存を増やさないため `https` 標準モジュールで `api.line.me/v2/bot/message/push` へ直接 POST。`Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>`。
- **Flex Message**: bubble 構造(header に色付き背景 + body + footer にアプリを開く URI ボタン)。`altText` は通知プレビューに出るので日本語で要点を書く。
- 環境変数: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_USER_ID`。git に入れない。

## デプロイ

`backend/notifier/**` を触って `main` に push すると `deploy-notifier.yml` が自動デプロイ。zip のパッケージレイアウト(root の index.mjs)に注意 — 失敗したら `scripts/deploy-notifier.sh` のレイアウトと比較する。
