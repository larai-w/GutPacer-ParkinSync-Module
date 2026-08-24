import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand, GetCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
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
const TABLE_NAME = "gutpacer-logs";
const SETTINGS_TABLE = "gutpacer-settings";
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
    const keys = (items || [])
        .map((item) => item?.fullDate)
        .filter((fullDate) => typeof fullDate === "string" && fullDate.length > 0);
    const batches = [];
    for (let i = 0; i < keys.length; i += chunkSize) {
        batches.push(keys.slice(i, i + chunkSize).map((fullDate) => ({
            DeleteRequest: { Key: { fullDate } }
        })));
    }
    return batches;
}

// ─── 同意（COMP-01 Phase 2）────────────────────────────────────────────────
// 同意の主体。この運用は単一世帯・共有PINなので、世帯を1件として扱う。
// **固定文字列に落とさない**（将来 LINE ログイン版で個人が分かれたときに
// 別人の同意が混ざらないよう、環境変数で分けられる形にしておく）。
const CONSENT_SUBJECT = process.env.CONSENT_SUBJECT || "household:gutpacer-default";

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
    const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
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
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: body }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Saved" }) };
        }

        if (method === "GET") {
            const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
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
            await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { fullDate } }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Deleted" }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

    } catch (error) {
        console.error(error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
