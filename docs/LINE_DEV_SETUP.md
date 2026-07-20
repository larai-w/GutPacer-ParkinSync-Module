# LINE Mini App 開発設定

最終更新: 2026-07-19

## IDの整理

| 用途 | 値 | 使う場所 |
|---|---:|---|
| Mini AppチャネルID | `2010428233` | APIのIDトークン検証時 (`LINE_LOGIN_CHANNEL_ID`) |
| 開発用LIFF ID | `2010720966-MDc5cyaa` | フロントの`liff.init()` / `GUTPACER_LIFF_ID` |
| 審査用LIFF ID | `2010720967-TssMkFAf` | 審査環境の`GUTPACER_LIFF_ID` |
| 本番用LIFF ID | `2010720968-FR7IVKjb` | 本番環境の`GUTPACER_LIFF_ID` |

LINE Mini Appでも、Mini App URL のパス部分が `liff.init({ liffId })` に渡す値として使える。

| 環境 | LIFF URL | `liffId` |
|---|---|---|
| 開発用 | `https://miniapp.line.me/2010720966-MDc5cyaa` | `2010720966-MDc5cyaa` |
| 審査用 | `https://miniapp.line.me/2010720967-TssMkFAf` | `2010720967-TssMkFAf` |
| 本番用 | `https://miniapp.line.me/2010720968-FR7IVKjb` | `2010720968-FR7IVKjb` |

API側のIDトークン検証に使うチャネルIDは `2010428233`。LIFF URLの先頭数字(`2010720966`など)とは別なので混同しない。

## Mini Appの接続情報を確認した後に設定する値

`frontend/config.js`はGit管理外の環境固有ファイルなので、開発用配信先に次の値を設定する。

```js
window.API_URL = "<development-api-url>";
window.GUTPACER_LIFF_ID = "2010720966-MDc5cyaa";
```

Mini AppのLIFF IDが空の場合、フロントは従来のPIN版として動作する。これにより、接続情報の確認前に現行本番を壊さない。

Lambda環境変数:

```text
LINE_LOGIN_CHANNEL_ID=2010428233
```

現時点のMini AppエンドポイントURL:

| 環境 | エンドポイントURL |
|---|---|
| 開発用 | `https://developers.line.biz/assets/liff-default-dev.html` |
| 審査用 | `https://developers.line.biz/assets/liff-default-review.html` |
| 本番用 | `https://developers.line.biz/assets/liff-default-published.html` |

実アプリ接続時は、対象環境のエンドポイントURLをGutPacerの配信URLへ向ける必要がある。開発用から先に切り替える。

## 次にやる具体手順: H-4 開発接続確認

この作業では、**開発用Mini Appだけ**を変更する。審査用・本番用のエンドポイントURLは、MVP用APIとデータ移行の検証が終わるまで変更しない。

### 1. こちらで先に用意するもの

開発用Mini Appの接続先にするには、次の2つが必要。

| 必要なもの | 例 | 状態 |
|---|---|---|
| 開発用フロントURL | `https://veai.jp/gutpacer/dev/` | 作成済み |
| 開発用API URL | `https://3cxmfovepd6mwir4a5jxwtotf40ojdia.lambda-url.us-east-1.on.aws/` | 作成済み |

開発用フロントの `config.js` には次の値を置く。

```js
window.API_URL = "https://3cxmfovepd6mwir4a5jxwtotf40ojdia.lambda-url.us-east-1.on.aws/";
window.GUTPACER_LIFF_ID = "2010720966-MDc5cyaa";
```

開発用API Lambdaには次の環境変数を設定する。

```text
LINE_LOGIN_CHANNEL_ID=2010428233
LOGS_TABLE=gutpacer-logs-v2
USERS_TABLE=gutpacer-users
```

### 2. あなたがLINE Developersでやる操作

1. LINE Developers Consoleを開く。
2. ProviderからGutPacerのMini Appチャネルを開く。
3. チャネルIDが `2010428233` であることを確認する。
4. Mini App設定の「開発用」環境を開く。
5. エンドポイントURLを `https://veai.jp/gutpacer/dev/` に変更する。
6. 保存する。
7. スマホのLINEで開発用Mini App URLを開く: `https://miniapp.line.me/2010720966-MDc5cyaa`

### 3. スマホで確認すること

開発用Mini Appを開いたとき、期待する挙動は以下。

1. PIN画面ではなく、LINEログイン経由でアプリが開く。
2. 初回GETで `gutpacer-users` に本人用プロフィールが自動作成される。
3. 履歴が空、または移行後の6件だけ表示される。
4. テスト記録を1件保存できる。
5. 保存した記録が `gutpacer-logs-v2` に本人のLINE `sub` をPKとして保存される。

本人のLINE userId(`sub`)は、IDトークンをLINEで検証したAPIだけが取得する。チャネル情報やLIFF IDから推測できないので、Mini Appを実際に開いて確認する必要がある。

### 4. userId確認後にこちらでやる作業

本人の `sub` が確認できたら、既存6件をv2テーブルへ移行する。

```bash
MIGRATION_USER_ID="<LINE sub>" npm run migrate:v2
MIGRATION_USER_ID="<LINE sub>" npm run migrate:v2 -- --execute
```

1行目はdry-runで、書き込みなし。件数と移行先を確認してから2行目を実行する。

### 5. まだやらないこと

- 本番用Mini App URL `https://miniapp.line.me/2010720968-FR7IVKjb` のエンドポイントURL変更。
- 本番API `gutpacer-backend` を `backend/index-mvp.mjs` に差し替えること。
- 旧テーブル `gutpacer-logs` / `gutpacer-settings` の削除。
- LINEチャネルシークレット、アクセストークン、AWS認証情報をgitに入れること。

## 実装済みの接続点

- `backend/line-auth.mjs`: IDトークンをLINE Verify endpointで検証
- `backend/index-mvp.mjs`: `X-Line-Id-Token`で認証するユーザー分離API候補
- `frontend/index.html`: `GUTPACER_LIFF_ID`がある場合だけLIFFログインを有効化

## 注意

- `backend/index-mvp.mjs`はまだ本番Lambdaへデプロイしない。
- 開発用DynamoDBテーブルと開発用Lambdaを用意してから接続する。
- `LINE_LOGIN_CHANNEL_ID` と `GUTPACER_LIFF_ID` を取り違えない。
- チャネルシークレット、LINEアクセストークン、AWS認証情報は記録・共有しない。
