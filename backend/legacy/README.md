# Legacy Lambda (使用禁止)

`index.js` は CommonJS 版の旧 API Lambda。以下の理由で **デプロイしないこと**。

- CORS の `Access-Control-Allow-Headers` に `X-Pin` が含まれておらず、PIN認証導入後のブラウザからのリクエストはプリフライトで失敗する。
- 現行実装は `backend/index.mjs`(ESM)。機能差分はこちらにのみ反映されている。

参照用として残しているだけであり、`backend/index.mjs` との二重メンテはしない。修正が必要になったら削除を検討すること。
