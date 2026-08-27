import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, DeleteCommand, GetCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import {
    CONSENT_SETTING_PREFIX,
    CONSENT_TEXT_VERSION,
    PRIVACY_POLICY_VERSION,
    buildGrantRecord,
    buildRevokeRecord,
    evaluateAll,
    extractConsentRecords,
    isConsentType,
    latestRecord,
    makeConsentSettingKey,
} from "./consent.mjs";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
// ⚠️ 2026-08-27: `gutpacer-logs` から移行した（issue #3）。
// 旧テーブルは `fullDate` だけがキーで、**世帯が増えると同じ日付が上書きされた**。
// 読み出しも全件 Scan で、**全員が全員の記録を見る**形だった。
// 記録が2つのテーブルに割れていたのも同じ根（`gutpacer-mvp-dev` は v2 へ書いていた）。
const TABLE_NAME = "gutpacer-logs-v2";

// 記録を分ける単位は**世帯**であって個人ではない。
// issue #4 で「招待された介護者」がサインインする予定なので、
// 個人の userId をキーにすると**同じ家の2人目が記録を見られない**。
// 同意記録も同じ主体で保存している（値を揃えること）。
const HOUSEHOLD_ID = process.env.HOUSEHOLD_ID
    || process.env.CONSENT_SUBJECT
    || "household:gutpacer-default";
const SETTINGS_TABLE = "gutpacer-settings";

// ── 初期化のうちに DynamoDB へ一度つないでおく ────────────────────────
//
// 2026-08-26 の実測: **バーストの2番目のリクエストだけが約950ms**かかっていた
// （1番目は約16ms、3番目以降も速い）。p95 は 984ms で SLO の 500ms を超える。
//
// 理由は呼ばれ方にある。ブラウザはまず `OPTIONS` プリフライトを投げ、
// これはハンドラが即返して **DynamoDB に触れない**。だから
// **2番目のリクエストが、そのコンテナで最初の DynamoDB 呼び出し**になり、
// 認証情報の解決と TLS 確立の代金をそこで払う。128MB は CPU が最小なので
// それが約1秒になる。
//
// `new DynamoDBClient()` を書くだけでは足りない。**AWS SDK v3 は実際に
// コマンドを送るまで、接続も認証情報の解決もしない。**
//
// 初期化フェーズに移すと二重に得をする:
//   1. ウォームなコンテナではリクエスト経路から消える
//   2. **Lambda は初期化中だけ CPU を上乗せする**ので、同じ処理が速く終わる
//
// ⚠️ **ここで例外を投げてはいけない。** モジュール読み込みが失敗すると
// Init Error になり、関数全体が起動しない（2026-08-20 に Medication Promise が
// これで6日間止まった）。**必ず握りつぶす。** 温めに失敗しても、
// 遅くなるだけで動作は変わらない。
//
// ⚠️ **定数より後に置くこと。** `SETTINGS_TABLE` より前に書くと
// TDZ の ReferenceError になり、下の catch がそれを飲み込んで
// **温めが黙って効かない**（実際に一度やった）。
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    try {
        // 存在しないキーを1件読むだけ。**書かない・消さない・副作用なし。**
        await docClient.send(new GetCommand({
            TableName: SETTINGS_TABLE,
            Key: { settingKey: "__warmup__" }
        }));
    } catch {
        // 温められなかっただけ。**動作には影響しない。**
    }
}
// 計測テーブルは環境変数からのみ取る。既定値を置かない。
// 既定を "gutpacer-metrics" のような本番名にすると、環境変数が抜けたときに
// test 環境から本番テーブルへ書いてしまう(BEN-004 承認ゲート F-03)。
// 未設定なら収集しない = fail closed。収集自体が既定オフなので実害はない。
const METRICS_TABLE = process.env.METRICS_TABLE;
const METRICS_COLLECTION_ENABLED = process.env.METRICS_COLLECTION_ENABLED === "true";
const METRICS_FIELDS = new Set(["action", "product", "channel", "durationMs"]);

export function validateRecordTimeMetric(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { error: "Invalid metric payload" };
    }
    if (Object.keys(body).some((field) => !METRICS_FIELDS.has(field))) {
        return { error: "Unexpected metric field" };
    }

    const durationMs = Number(body.durationMs);
    if (
        body.product !== "gutpacer" ||
        body.channel !== "web" ||
        !Number.isInteger(durationMs) ||
        durationMs < 100 ||
        durationMs > 3600000
    ) {
        return { error: "Invalid metric value" };
    }
    return { metric: { product: "gutpacer", channel: "web", durationMs } };
}

// ADR-0007 制約3: 保存期間は35日(DynamoDB TTL)。
// 値を直書きせず定数にして、テストから検証できるようにする。
export const METRICS_TTL_SECONDS = 35 * 24 * 60 * 60;

// 書き込む item の組み立て。AWS を呼ばずに中身を検証できるよう切り出している。
export function buildRecordTimeMetricItem(metric, now = new Date(), id = randomUUID()) {
    return {
        pk: `gutpacer#${id}`,
        sk: now.toISOString(),
        product: "gutpacer",
        channel: "web",
        eventType: "record_saved",
        durationMs: metric.durationMs,
        date: now.toISOString().slice(0, 10),
        ttl: Math.floor(now.getTime() / 1000) + METRICS_TTL_SECONDS
    };
}

// ─── 全データ削除（同意の撤回・APPI §16）────────────────────────────────
// COMP-01 の C-05「いつでも撤回・削除できること」。日単位の削除しか無く、
// 撤回が成立していなかった。
//
// 破壊的な操作なので、PIN だけでは実行させない。合言葉を本文に入れさせて
// 「うっかり」と「同じリクエストの再送」で全消えしないようにする。
// 復旧は gutpacer-logs の PITR（有効・35日）による。
export const DELETE_ALL_CONFIRMATION = "DELETE-ALL";

export function validateDeleteAllRequest(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { error: "Invalid request" };
    }
    if (body.confirm !== DELETE_ALL_CONFIRMATION) {
        return { error: "Confirmation phrase required" };
    }
    return { ok: true };
}

// Scan の結果を BatchWrite の 25件チャンクへ割る。AWS を呼ばずに検算できる
// よう切り出す。キーは fullDate（gutpacer-logs のパーティションキー）。
export function buildDeleteAllBatches(items, chunkSize = 25) {
    // 複合キーになったので、**両方揃っている item だけ**を対象にする。
    // 片方でも欠けたキーを渡すと DynamoDB が例外を投げ、
    // **その batch ごと消えずに終わる**（消えたつもりで残る）。
    const keys = (items || [])
        .map((item) => ({ userId: item?.userId, fullDate: item?.fullDate }))
        .filter(({ userId, fullDate }) =>
            typeof userId === "string" && userId.length > 0
            && typeof fullDate === "string" && fullDate.length > 0);
    const batches = [];
    for (let i = 0; i < keys.length; i += chunkSize) {
        batches.push(keys.slice(i, i + chunkSize).map(({ userId, fullDate }) => ({
            DeleteRequest: { Key: { userId, fullDate } }
        })));
    }
    return batches;
}

// ─── 同意（COMP-01 Phase 2）────────────────────────────────────────────────
// 同意の主体。この運用は単一世帯・共有PINなので、世帯を1件として扱う。
// **固定文字列に落とさない**（将来 LINE ログイン版で個人が分かれたときに
// 別人の同意が混ざらないよう、環境変数で分けられる形にしておく）。
// 同意の主体は世帯。**記録のキーと同じ値を使う。**
// 別々に持つと、同意の対象と記録の対象がずれる。
const CONSENT_SUBJECT = HOUSEHOLD_ID;

async function listConsentRecords() {
    // このテーブルは単一世帯用で数アイテムしかないので Scan で読む。
    // 件数が増える設計に変わるなら、テーブル設計から見直すこと。
    const result = await docClient.send(new ScanCommand({ TableName: SETTINGS_TABLE }));
    return extractConsentRecords(result.Items);
}

async function putConsentRecord(record) {
    await docClient.send(new PutCommand({
        TableName: SETTINGS_TABLE,
        Item: {
            settingKey: makeConsentSettingKey(record.consentType, record.consentId),
            record,
            updatedAt: record.updatedAt
        }
    }));
}

async function getConsentState() {
    const records = await listConsentRecords();
    return evaluateAll(records, new Date());
}

async function deleteAllLogs() {
    // ⚠️ **ここが一番危ない。** Scan のままだと、世帯が増えたときに
    // **他所帯の記録まで消す**。削除は必ず自分の世帯の範囲に閉じる。
    const result = await docClient.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "#u = :household",
        ExpressionAttributeNames: { "#u": "userId" },
        ExpressionAttributeValues: { ":household": HOUSEHOLD_ID }
    }));
    const items = result.Items || [];
    const batches = buildDeleteAllBatches(items);

    for (const batch of batches) {
        await docClient.send(new BatchWriteCommand({
            RequestItems: { [TABLE_NAME]: batch }
        }));
    }

    // 握りつぶさないための固定文字列。件数の食い違いはここでしか見えない。
    // CLAUDE.md §2.55 に合わせ、メトリクスフィルタを張れる形にしておく。
    const deleted = batches.reduce((n, b) => n + b.length, 0);
    console.log(`[DELETE ALL] scanned=${items.length} deleted=${deleted}`);
    if (deleted !== items.length) {
        console.log(`[DELETE ALL INCOMPLETE] scanned=${items.length} deleted=${deleted}`);
    }
    return deleted;
}

async function saveRecordTimeMetric(body) {
    if (!METRICS_COLLECTION_ENABLED || !METRICS_TABLE) {
        return { statusCode: 503, error: "Metrics collection is disabled" };
    }
    const validated = validateRecordTimeMetric(body);
    if (validated.error) {
        return { statusCode: 400, error: validated.error };
    }

    await docClient.send(new PutCommand({
        TableName: METRICS_TABLE,
        Item: buildRecordTimeMetricItem(validated.metric)
    }));

    return { statusCode: 200, message: "Metric saved" };
}

export const handler = async (event) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-Pin"
    };

    try {
        const method = event.requestContext?.http?.method || event.httpMethod;

        if (method === "OPTIONS") {
            return { statusCode: 200, headers, body: "" };
        }

        const pin = event.headers?.['x-pin'];
        if (!pin || pin !== process.env.ACCESS_PIN) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
        }

        if (method === "POST") {
            const body = JSON.parse(event.body);

            // Existing PIN auth and an explicit server flag are both required.
            if (body.action === "getConsent") {
                try {
                    const state = await getConsentState();
                    return { statusCode: 200, headers, body: JSON.stringify({
                        state,
                        versions: { ppVersion: PRIVACY_POLICY_VERSION, consentTextVersion: CONSENT_TEXT_VERSION }
                    }) };
                } catch (error) {
                    // **読めなかったことを「同意していない」として返さない。**
                    // 画面が同意画面を出し、押した先の書き込みも失敗して閉じ込める。
                    console.log(`[CONSENT READ FAILED] subject=${CONSENT_SUBJECT} ${error.message}`);
                    return { statusCode: 503, headers, body: JSON.stringify({
                        error: "同意の状態を確認できませんでした", unavailable: true
                    }) };
                }
            }

            if (body.action === "grantConsent" || body.action === "revokeConsent") {
                if (!isConsentType(body.consentType)) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: "同意の種類が正しくありません" }) };
                }
                try {
                    if (body.action === "grantConsent") {
                        // 記録する版は**サーバ側の定数**を使う。クライアントの申告は使わない。
                        // 古い画面がキャッシュされていても、記録は実際に見せた版になる。
                        await putConsentRecord(buildGrantRecord({
                            consentId: randomUUID(),
                            userId: CONSENT_SUBJECT,
                            consentType: body.consentType
                        }, new Date()));
                    } else {
                        const records = await listConsentRecords();
                        const previous = latestRecord(records.filter((r) => r.consentType === body.consentType));
                        if (!previous || previous.status === "revoked") {
                            // 「無いものを撤回した」を成功として返さない
                            return { statusCode: 409, headers, body: JSON.stringify({ error: "撤回できる同意がありません" }) };
                        }
                        await putConsentRecord(buildRevokeRecord(previous, randomUUID(), new Date()));
                    }
                } catch (error) {
                    // 書けなかったのに「同意しました」と見せない
                    console.log(`[CONSENT WRITE FAILED] subject=${CONSENT_SUBJECT} action=${body.action} ${error.message}`);
                    return { statusCode: 503, headers, body: JSON.stringify({ error: "記録できませんでした。時間をおいてお試しください" }) };
                }
                return { statusCode: 200, headers, body: JSON.stringify({ state: await getConsentState() }) };
            }

            if (body.action === "deleteAllData") {
                const validated = validateDeleteAllRequest(body);
                if (validated.error) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: validated.error }) };
                }
                const deleted = await deleteAllLogs();
                return { statusCode: 200, headers, body: JSON.stringify({ message: "All data deleted", deleted }) };
            }

            if (body.action === "recordTime") {
                const result = await saveRecordTimeMetric(body);
                if (result.error) {
                    return { statusCode: result.statusCode, headers, body: JSON.stringify({ error: result.error }) };
                }
                return { statusCode: 200, headers, body: JSON.stringify({ message: result.message }) };
            }

            if (body.action === "saveSettings") {
                await docClient.send(new PutCommand({
                    TableName: SETTINGS_TABLE,
                    Item: {
                        settingKey: "location",
                        value: body.location,
                        updatedAt: new Date().toISOString()
                    }
                }));
                return { statusCode: 200, headers, body: JSON.stringify({ message: "Saved" }) };
            }
            if (!body.fullDate) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "fullDate required" }) };
            }
            // **世帯を必ず載せる。** 抜けると、キーの無い item ができて読めなくなる。
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: { ...body, userId: HOUSEHOLD_ID }
            }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Saved" }) };
        }

        if (method === "GET") {
            // **Scan ではなく Query。** 世帯で絞らないと、他所帯の記録が混ざる。
            const result = await docClient.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "#u = :household",
                ExpressionAttributeNames: { "#u": "userId" },
                ExpressionAttributeValues: { ":household": HOUSEHOLD_ID }
            }));
            const logs = (result.Items || []).sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));

            let location = "home";
            try {
                const settingResult = await docClient.send(new GetCommand({
                    TableName: SETTINGS_TABLE,
                    Key: { settingKey: "location" }
                }));
                location = settingResult.Item?.value ?? "home";
            } catch (e) {
                console.error("Settings fetch failed, using default:", e.message);
            }

            return { statusCode: 200, headers, body: JSON.stringify({ logs, location }) };
        }

        if (method === "DELETE") {
            const fullDate = event.queryStringParameters?.fullDate;
            if (!fullDate) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "fullDate required" }) };
            }
            await docClient.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { userId: HOUSEHOLD_ID, fullDate }
            }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Deleted" }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

    } catch (error) {
        console.error(error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
