import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LOGS_TABLE = process.env.LOGS_TABLE || "gutpacer-logs-v2";

// ⚠️ **ここは `backend/profile-defaults.mjs` から import しない。**
// この関数の zip は `index.mjs` 1枚を root に置く形なので、
// `../profile-defaults.mjs` は**実行時に解決できない**（Init Error で止まる）。
// 2026-08-20 に Medication Promise が同じ形で6日間止まり、
// 2026-08-24 に GutPacer の `consent.mjs` でも同じことが起きた。
//
// 値が2か所に分かれるが、**一致することをテストで縛る**
// （tests/household-id-consistency.test.mjs）。
const DEFAULT_HOUSEHOLD_ID = process.env.HOUSEHOLD_ID
    || process.env.CONSENT_SUBJECT
    || "household:gutpacer-default";
const USERS_TABLE = process.env.USERS_TABLE || "gutpacer-users";
const APP_URL = process.env.APP_URL || "https://veai.jp/gutpacer/";

function getJSTDate(offsetDays = 0, now = new Date()) {
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    jst.setUTCDate(jst.getUTCDate() + offsetDays);
    return jst.toISOString().split("T")[0];
}

async function sendLineMessage(userId, message, options = {}) {
    const token = options.token || process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const fetchImpl = options.fetchImpl || fetch;
    if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");

    const result = await fetchImpl("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ to: userId, messages: [message] })
    });
    if (!result.ok) throw new Error(`LINE push failed (${result.status})`);
}

function buildReminderMessage(missingDays, warnAfterDays, appUrl = APP_URL) {
    const isWarning = missingDays >= warnAfterDays;
    return {
        type: "flex",
        altText: `GutPacer: 直近${missingDays}日間、排便「あり」の記録がありません`,
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                backgroundColor: isWarning ? "#b45309" : "#f59e0b",
                paddingAll: "16px",
                contents: [{
                    type: "text",
                    text: "記録を確認してください",
                    weight: "bold",
                    color: "#ffffff",
                    size: "md",
                    wrap: true
                }]
            },
            body: {
                type: "box",
                layout: "vertical",
                paddingAll: "16px",
                contents: [{
                    type: "text",
                    text: `直近${missingDays}日間、排便「あり」の記録がありません。アプリで記録内容を確認してください。`,
                    wrap: true,
                    size: "sm",
                    color: "#374151"
                }]
            },
            footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "12px",
                contents: [{
                    type: "button",
                    action: { type: "uri", label: "アプリを開く", uri: appUrl },
                    style: "primary",
                    color: isWarning ? "#b45309" : "#4f46e5"
                }]
            }
        }
    };
}

export function createNotifierHandler(dependencies = {}) {
    const db = dependencies.client || client;
    const now = dependencies.now || (() => new Date());
    const push = dependencies.sendLineMessage || ((userId, message) =>
        sendLineMessage(userId, message, dependencies));
    const logger = dependencies.logger || console;

    // 記録は**世帯**のキーで入っている（issue #3・2026-08-27）。
    // ここを LINE の userId のまま引くと、**記録済みでも見つからず、
    // 毎日リマインドを送る**ことになる。
    // プロフィールから世帯を取る。**個人の userId は「誰か」を確かめるためのもので、
    // 「誰の記録か」を分ける単位ではない**（issue #3）。
    function householdOf(profile) {
        return profile?.householdId || DEFAULT_HOUSEHOLD_ID;
    }

    async function hadStool(householdId, date) {
        const result = await db.send(new GetCommand({
            TableName: LOGS_TABLE,
            Key: { userId: householdId, fullDate: date }
        }));
        return result.Item?.bowel != null;
    }

    return async () => {
        const usersResult = await db.send(new ScanCommand({ TableName: USERS_TABLE }));
        const users = usersResult.Items || [];
        const summary = { checked: 0, sent: 0, skipped: 0, failed: 0 };

        for (const profile of users) {
            summary.checked++;
            if (!profile.userId || profile.location === "facility" || profile.notify?.enabled === false) {
                summary.skipped++;
                continue;
            }

            try {
                const remindAfterDays = Math.max(1, Number(profile.notify?.remindAfterDays) || 1);
                const warnAfterDays = Math.max(remindAfterDays, Number(profile.notify?.warnAfterDays) || 2);
                let missingDays = 0;

                for (let offset = 1; offset <= 7; offset++) {
                    // **プロフィールの世帯で引く。** profile.userId（LINE の個人）
                    // ではない。まだ世帯を持たない古いプロフィールは既定値へ。
                    if (await hadStool(householdOf(profile), getJSTDate(-offset, now()))) break;
                    missingDays++;
                }

                if (missingDays < remindAfterDays) {
                    summary.skipped++;
                    continue;
                }

                await push(profile.userId, buildReminderMessage(missingDays, warnAfterDays));
                summary.sent++;
            } catch (error) {
                summary.failed++;
                logger.error("Notifier user processing failed", error.message);
            }
        }

        if (summary.failed > 0) {
            const error = new Error(`Notifier completed with ${summary.failed} user failure(s)`);
            error.summary = summary;
            throw error;
        }
        return { statusCode: 200, body: JSON.stringify(summary) };
    };
}

export const handler = createNotifierHandler();
