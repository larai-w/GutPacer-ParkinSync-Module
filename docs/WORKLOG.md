# 作業ログ / セッション引き継ぎ

新しいセッション(Codex含む)は `docs/PROJECT_HANDOFF.md` → このファイルの順で読むと、直近の作業と現状が分かる。
古い順に上から、最新が下。

---

## 2026-07-08 〜 07-14: Phase 1 完了 + デプロイ自動化(Claude Code / Fable・Opus・Sonnet)

### このセッションで決めたこと(戦略)

- GutPacer を1家族専用から「まず10家族 → その後30家族」へ拡大する方針を決定。
- 薬・便の状態区分・通知しきい値を**ユーザーごとにカスタマイズ**できるようにする(要件)。
- 戦略・計画・ロードマップは新規ドキュメント群に集約:
  - 内部戦略ノート(非公開) — 全体戦略・ユーザーストーリー・コスト
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

- 開発の次タスクは **G-1(LIFF認証)**。この時点ではLINE Mini App情報待ちだったが、2026-07-16にMini AppチャネルIDと各環境のLIFF IDが共有済み。
- 未着手: G-1, G-2(DynamoDBマルチテナント化), G-4〜G-10。詳細は `docs/GROWTH_PLAN.md`。
- 人間がやることの一覧と優先順位は `docs/USER_TODO.md`。

---

## 2026-07-16: G-1/G-2 事前実装 + v2テーブル作成(Codex)

### 実装したこと

- `backend/index-mvp.mjs` を `createHandler()` で依存注入できる形にし、実DynamoDBへ触らず userId 境界をテストできるようにした。
- `scripts/smoke-test.mjs` に MVP API の userId 分離テストを追加。
  - GET は検証済みLINE userIdだけでQueryする。
  - POST は本文の `userId` を信用せず、検証済みLINE userIdで保存する。
  - DELETE は検証済みLINE userId + `fullDate` をキーにする。
- `scripts/create-v2-tables.mjs` を追加。dry-runがデフォルトで、`--execute` 時だけ `gutpacer-logs-v2` / `gutpacer-users` を作成し、PITRを有効化する。
- `package.json` に `setup:v2:tables` と `migrate:v2` を追加。

### AWSで実行済み

- `npm run setup:v2:tables -- --execute`
  - `gutpacer-logs-v2` 作成済み
  - `gutpacer-users` 作成済み
  - 両方ともPITR有効化処理まで完了
- `MIGRATION_USER_ID=U-dryrun npm run migrate:v2`
  - dry-runのみ実行。書き込みなし。
  - 旧ログ件数: 6
  - 移行予定ログ件数: 6
  - 旧location: `facility`

### 検証

- `npm test` → 13/13 passed

### 追加で共有されたLINE Mini App情報(2026-07-16)

- Mini AppチャネルID: `2010428233`
- 開発用LIFF ID: `2010720966-MDc5cyaa`
- 審査用LIFF ID: `2010720967-TssMkFAf`
- 本番用LIFF ID: `2010720968-FR7IVKjb`

### まだ人間待ちのもの

- Mini Appの開発用エンドポイントURLが現在 `https://developers.line.biz/assets/liff-default-dev.html` のため、開発接続時はGutPacerの開発用配信URLへ切り替える必要がある。
- 既存6件の本移行には、移行先にする実ユーザーのLINE userId(`sub`)が必要。仮の `U-dryrun` では本移行しない。
- 本番APIはまだ `backend/index.mjs` のPIN版。`backend/index-mvp.mjs` は本番デプロイしない。

---

## 2026-07-19: Technical PM / GitHub Project自動化基盤(Codex)

### 実装したこと

- `docs/PROJECT_MANAGEMENT.md` を追加。formal Scrumを行ったとは主張せず、solo / AI-assisted / evidence-led Agile deliveryとして、ペルソナ、DoR/DoD、リスク、release gate、cloud architecture判断を公開証拠化。
- User Story / Delivery Task Issue Forms、PRテンプレートを追加。Story、受け入れ条件、検証証拠、privacy/health-copy/data-boundary/recoveryを一連で残せる構成にした。
- `project-automation.yml` を追加。Project URL変数と限定権限tokenが設定済みなら、新規Issue/PRを`GutPacer Delivery` Projectへ自動追加する。
- `scripts/setup-github-project.sh` を追加。dry-runが既定。`--execute`でProject、Priority/Phase/Area/Size/Target fields、PM labels、既存Issue取り込み、repository variableを冪等に設定する。
- READMEの根拠が弱い「Scrum採用」表現を、実態と証拠に合うTechnical PM / iterative Agile deliveryへ修正。

### 検証

- YAML parse: Issue Forms / config / Project workflowすべてOK
- `bash -n scripts/setup-github-project.sh` + dry-run: OK
- `npm test`: 13/13 passed
- `git diff --check`: OK

### GitHub外部反映

- `gh`を`repo`, `project`, `read:project` scopeで再認証。
- [GutPacer Delivery Project](https://github.com/users/larai-w/projects/8)を作成。既存Issue 12件、Priority/Phase/Area/Size/Target fields、11個のPM/リスクlabels、`GUTPACER_PROJECT_URL` variableを反映。
- 作業中のLINE/MVP変更を混ぜないため、最新`main`から`agent/technical-pm-workflow`を作成。PM関連9ファイルだけをcommit/pushし、Draft PR [#22](https://github.com/larai-w/GutPacer-ParkinSync-Module/pull/22)を作成。
- PRは最新`main`へrebaseし、`npm test` 6/6、YAML/shell/diff checkに合格後、`main`へsquash mergeした(merge SHA: `85259302a9c5477a863b368703248537f832f78c`)。
- `PROJECTS_TOKEN` Secretを値を表示せず登録。テストIssue [#23](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues/23)でWorkflow成功、Projectへの自動追加、close後のStatus=`Done`同期まで確認した。
- 今後の新規Issue/PRは`GutPacer Delivery` Projectへ自動追加される。GitHub側で残っている承認作業はない。

---

## 2026-07-19: LINE Mini App 開発接続準備(Codex)

### 実装・AWSで進めたこと

- `frontend/index.html` の `config.js` 読み込みを絶対URLから相対URL `./config.js` に変更。これにより、本番 `/gutpacer/` と開発 `/gutpacer/dev/` がそれぞれ自分の `config.js` を読める。
- 開発用MVP API Lambda `gutpacer-mvp-dev` を作成した。
  - Runtime: nodejs24.x
  - Handler: `index.handler`
  - Region: us-east-1
  - Environment:
    - `LINE_LOGIN_CHANNEL_ID=2010428233`
    - `LOGS_TABLE=gutpacer-logs-v2`
    - `USERS_TABLE=gutpacer-users`
- 開発用MVP API Function URLを作成した。
  - `https://3cxmfovepd6mwir4a5jxwtotf40ojdia.lambda-url.us-east-1.on.aws/`
  - `AuthType=NONE`
  - API内部で `X-Line-Id-Token` をLINE verify endpointへ送って検証する。
- Function URLの公開invoke権限を追加した。
  - `lambda:InvokeFunctionUrl`
  - `lambda:InvokeFunction` with `lambda:InvokedViaFunctionUrl=true`
- トークンなしGETで `401 Unauthorized` が返ることを確認した。Lambdaまで到達しており、未認証リクエストは拒否されている。
- 開発用フロントをS3に配置した。
  - URL: `https://veai.jp/gutpacer/dev/`
  - S3: `s3://veai-careready-frontend/gutpacer/dev/index.html`
  - config: `s3://veai-careready-frontend/gutpacer/dev/config.js`
- 開発用config.js:

```js
window.API_URL = "https://3cxmfovepd6mwir4a5jxwtotf40ojdia.lambda-url.us-east-1.on.aws/";
window.GUTPACER_LIFF_ID = "2010720966-MDc5cyaa";
```

### 注意・判断

- `https://veai.jp/gutpacer-dev/` を使うためCloudFront behavior追加を試したが、Free pricing planの制限で追加不可だった。Distribution configは変更されていない。
- 代替として、既存 `/gutpacer/*` behavior配下の `https://veai.jp/gutpacer/dev/` を開発URLにした。
- 本番 `gutpacer-backend` と本番 `/gutpacer/config.js` は変更していない。

### 次に人間がやること

LINE Developers Consoleで、開発用Mini AppのエンドポイントURLを `https://veai.jp/gutpacer/dev/` に変更する。その後、スマホのLINEで `https://miniapp.line.me/2010720966-MDc5cyaa` を開く。

---

## 2026-07-20: Claude handoff summary(Codex)

### 現在の到達点

- GutPacer の本番 PIN 版は維持したまま、LINE 接続確認用の開発経路を分離済み。
- 開発用MVP API Lambda: `gutpacer-mvp-dev`
  - Function URL: `https://3cxmfovepd6mwir4a5jxwtotf40ojdia.lambda-url.us-east-1.on.aws/`
  - Env:
    - `LINE_LOGIN_CHANNEL_ID=2010428233`
    - `LOGS_TABLE=gutpacer-logs-v2`
    - `USERS_TABLE=gutpacer-users`
- 開発用フロント: `https://veai.jp/gutpacer/dev/`
- 開発用configは `frontend/index.html` の相対 `./config.js` で読み込む。
- ローカルテスト: `npm test` は `13/13 passed`。
- AWS上で `gutpacer-mvp-dev` はトークンなしGETで `401 Unauthorized` を返すところまで確認済み。

### Claude が次にやること

1. LINE Developers Console で Mini App 開発用エンドポイントURLを `https://veai.jp/gutpacer/dev/` に設定する。
2. スマホの LINE で `https://miniapp.line.me/2010720966-MDc5cyaa` を開き、認証後の `sub` を確認する。
3. 取得した `sub` を使って `MIGRATION_USER_ID=<sub> npm run migrate:v2` の dry-run を確認し、問題なければ `--execute` で既存 6 件を移す。
4. その後、MVP を本番導線へ寄せるか、開発 Lambda として残すかを判断する。

### 注意

- 本番 `gutpacer-backend` と本番 `/gutpacer/` はまだ PIN 版のまま。
- CloudFront Free plan の制限で `/gutpacer-dev/*` の新規 behavior は追加できなかったため、開発URLは `/gutpacer/dev/` に置いている。
- チャネルシークレット、アクセストークン、AWS 認証情報は記録しない。

---

## 2026-07-20: 未コミット実装のコミット整理 + 権限ガードレール + 公開流出防止(Claude / Opus)

### やったこと

- ワークツリーに未コミットで溜まっていた G-1/G-2 実装群(`backend/line-auth.mjs` / `index-mvp.mjs` / `profile-defaults.mjs`、`frontend/index.html` の LIFF 対応、`scripts/create-v2-tables.mjs` / `migrate-to-v2.mjs`、`package.json`、`scripts/smoke-test.mjs`、docs、blog)を消失リスク解消のため論理単位でコミットした。`npm test` は 13/13 のまま。
- Claude Code の権限設定を「自律度は維持・破壊的操作だけ確認/ブロック」に整備。
  - `.claude/settings.local.json`(個人・gitignore)から危険な広域 allow(`aws iam *` / `aws lambda *` / `git push *`)を削除。
  - `.claude/settings.json`(共有・追跡対象)を新規追加。`ask`=git push / aws lambda・iam・dynamodb delete・s3 rm|sync|cp・cloudfront invalidation / deploy-notifier.sh / migrate:v2・setup:v2:tables。`deny`=force/mirror push・`git reset --hard`・`git clean -fd(x)`・`rm -rf /|~`・`.env`/`*.pem`/`*credentials*`/`.aws` 読み取り・`frontend/config.js` 上書き。優先順位 deny>ask>allow。
- push 前に `security-review` を実施。LINE 認証のテナント分離は適切、シークレット混入なし、HIGH/MEDIUM の脆弱性なしを確認。

### 公開リポジトリへの戦略情報流出を検知・阻止(重要)

- 本リポジトリは **PUBLIC**。過去に commit 70a3da7 が内部戦略docを `docs/` から外し、`.gitignore` の `docs-private/` に隔離する運用が確立されていた。
- 初回コミットに、同カテゴリの戦略doc `CONTENT_AND_GROWTH_PLAN.md` / `MARKETING_POSITIONING.md` / `MVP_PLAN.md` を公開 `docs/` へ含めてしまっていた。push 前に検知。
- 該当コミット(未push)を巻き戻して作り直し、3ファイルを `docs-private/`(gitignore済)へ退避。公開履歴・push差分の双方に、ファイル名も本文の特徴的文言も残らないことを確認してから push した。
- 公開 `docs/` に残したのは技術系のみ: `ARCHITECTURE.md`(技術構成)、`LINE_DEV_SETUP.md`(公開ID類のみ)、`blog/`(公開前提の下書き)。

### 事実メモ

- push 済みブランチ: `origin/development`(先頭 `ef4e942`)。本番 `main` は未変更。
- 教訓: 公開repoへの push 前は、シークレットだけでなく**戦略コンテンツ**もスキャンする(security-review は docs を対象外にするため別途手動確認が必要)。

### まだ人間待ち(変わらず)

- LINE Developers Console で開発用 Mini App エンドポイントURLを `https://veai.jp/gutpacer/dev/` へ設定 → 実機で `sub` 確認 → `MIGRATION_USER_ID=<sub> npm run migrate:v2`(dry-run→`--execute`)。
