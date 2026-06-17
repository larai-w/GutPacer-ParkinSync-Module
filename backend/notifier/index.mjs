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

async function getLog(dateStr) {
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { fullDate: dateStr }
        }));
        return result.Item ?? null;
    } catch (e) {
        console.error("DynamoDB getLog failed for", dateStr, e.message);
        return null;
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
        altText: "GutPacer: 昨日の記録がまだありません",
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#f59e0b",
                paddingAll: "16px",
                contents: [{
                    type: "text",
                    text: "📝 記録の入力をお願いします",
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
                    text: "昨日の記録がまだありません。アプリから記録を入力してください。",
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

function buildWarningMessage(missingDays) {
    return {
        type: "flex",
        altText: "GutPacer: " + missingDays + "日間記録がありません",
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#ef4444",
                paddingAll: "16px",
                contents: [{
                    type: "text",
                    text: "⚠️ " + missingDays + "日間記録がありません",
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
                    text: missingDays + "日間記録がありません。体調はどうですか？",
                    wrap: true,
                    size: "sm",
                    color: "#374151"
                }]
            },
            footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "12px",
                contents: [buildAppButton("アプリを開く", "#ef4444")]
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

    const yesterdayLog = await getLog(yesterday);

    if (yesterdayLog !== null) {
        console.log("Record found for yesterday - no notification needed");
        return { statusCode: 200, body: "No notification needed" };
    }

    const dayBeforeLog = await getLog(dayBefore);

    if (dayBeforeLog === null) {
        // 昨日も一昨日も記録なし → 連続日数を算出して警告
        let missingDays = 2;
        while (missingDays < 7) {
            const older = getJSTDate(-(missingDays + 1));
            const olderLog = await getLog(older);
            if (olderLog === null) {
                missingDays++;
            } else {
                break;
            }
        }
        console.log(missingDays + " days without records - sending warning");
        await sendLineMessage([buildWarningMessage(missingDays)]);
        return { statusCode: 200, body: "Sent: " + missingDays + "-day warning" };
    }

    // 昨日だけ記録なし → 通常の催促通知
    console.log("No record for yesterday only - sending reminder");
    await sendLineMessage([buildReminderMessage()]);
    return { statusCode: 200, body: "Sent: reminder" };
};
