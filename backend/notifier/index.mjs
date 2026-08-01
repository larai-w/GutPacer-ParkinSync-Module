import https from "https";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = "gutpacer-logs";
const SETTINGS_TABLE = "gutpacer-settings";
const APP_URL = "https://veai.jp/gutpacer/";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;

function getJSTDate(offsetDays = 0) {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    jst.setDate(jst.getDate() + offsetDays);
    return jst.toISOString().split("T")[0];
}

// 排便判定: bowel に量・硬さが入っている日 = 排便あり
// gutpacer-logs の bowel フィールド: { amount: "小 (S)"|"中 (M)"|"大 (L)", type: "硬い（コロコロ）"|... }
// 排便なしの日は bowel: null で保存される
async function hadStool(dateStr) {
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { fullDate: dateStr }
        }));
        return result.Item?.bowel != null;
    } catch (e) {
        console.error("DynamoDB GetItem failed for", dateStr, e.message);
        return false;
    }
}

function sendLineMessage(messages) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ to: LINE_USER_ID, messages });
        const options = {
            hostname: "api.line.me",
            path: "/v2/bot/message/push",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN,
                "Content-Length": Buffer.byteLength(payload)
            }
        };
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                console.log("LINE API response:", res.statusCode, data);
                resolve({ statusCode: res.statusCode, body: data });
            });
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}

function buildAppButton(label, color) {
    return {
        type: "button",
        action: { type: "uri", label: label, uri: APP_URL },
        style: "primary",
        color: color
    };
}

function buildReminderMessage() {
    return {
        type: "flex",
        altText: "GutPacer: 昨日は排便「あり」の記録がありません",
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#f59e0b",
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
                    text: "昨日は排便「あり」の記録がありません。アプリで記録内容を確認してください。",
                    wrap: true,
                    size: "sm",
                    color: "#374151"
                }]
            },
            footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "12px",
                contents: [buildAppButton("アプリを開く", "#4f46e5")]
            }
        }
    };
}

function buildMultiDayReminderMessage(missingDays) {
    return {
        type: "flex",
        altText: "GutPacer: 直近" + missingDays + "日間、排便「あり」の記録がありません",
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#b45309",
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
                    text: "直近" + missingDays + "日間、排便「あり」の記録がありません。アプリで記録内容を確認してください。",
                    wrap: true,
                    size: "sm",
                    color: "#374151"
                }]
            },
            footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "12px",
                contents: [buildAppButton("記録を確認", "#b45309")]
            }
        }
    };
}

export const handler = async () => {
    // 1. 居住環境チェック（施設なら通知しない）
    let location = "home";
    try {
        const settingResult = await docClient.send(new GetCommand({
            TableName: SETTINGS_TABLE,
            Key: { settingKey: "location" }
        }));
        location = settingResult.Item?.value ?? "home";
    } catch (e) {
        console.error("Settings fetch failed, assuming home:", e.message);
    }

    if (location === "facility") {
        console.log("Location is facility - skipping notification");
        return { statusCode: 200, body: "Skipped (facility)" };
    }

    // 2. 直近2日間の記録を確認（在宅の場合のみ）
    const yesterday = getJSTDate(-1);
    const dayBefore = getJSTDate(-2);

    const yesterdayHadStool = await hadStool(yesterday);

    if (yesterdayHadStool) {
        console.log("Stool recorded for yesterday - no notification needed");
        return { statusCode: 200, body: "No notification needed" };
    }

    const dayBeforeHadStool = await hadStool(dayBefore);

    if (!dayBeforeHadStool) {
        // 昨日も一昨日も排便「あり」の記録なし → 連続日数を算出して確認通知
        let missingDays = 2;
        while (missingDays < 7) {
            const older = getJSTDate(-(missingDays + 1));
            const olderHadStool = await hadStool(older);
            if (!olderHadStool) {
                missingDays++;
            } else {
                break;
            }
        }
        console.log(missingDays + " days without a bowel-present record - sending reminder");
        await sendLineMessage([buildMultiDayReminderMessage(missingDays)]);
        return { statusCode: 200, body: "Sent: multi-day record reminder" };
    }

    // 昨日だけ記録なし → 通常の催促通知
    console.log("No record for yesterday only - sending reminder");
    await sendLineMessage([buildReminderMessage()]);
    return { statusCode: 200, body: "Sent: reminder" };
};
