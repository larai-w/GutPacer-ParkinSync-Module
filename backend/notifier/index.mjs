import https from "https";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

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

function sendLineMessage(messages) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ to: LINE_USER_ID, messages });
        const options = {
            hostname: "api.line.me",
            path: "/v2/bot/message/push",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
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
        action: { type: "uri", label, uri: APP_URL },
        style: "primary",
        color
    };
}

function buildNoRecordMessage() {
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

function buildEnemaAlertMessage(daysSinceLastStool) {
    return {
        type: "flex",
        altText: `GutPacer: 排便アラート (${daysSinceLastStool}日経過)`,
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#ef4444",
                paddingAll: "16px",
                contents: [{
                    type: "text",
                    text: "🚨 排便アラート",
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
                    text: `最後の排便から${daysSinceLastStool}日以上経過しています。今日、訪問看護師さんやデイケアに浣腸をお願いしてください。`,
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
    // Step 1: Check location setting
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

    const today = getJSTDate(0);
    const yesterday = getJSTDate(-1);

    // Step 2: Check if yesterday's record exists
    let yesterdayLog = null;
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { fullDate: yesterday }
        }));
        yesterdayLog = result.Item;
    } catch (e) {
        console.error("Failed to fetch yesterday's log:", e.message);
    }

    if (!yesterdayLog) {
        console.log("No record for yesterday - sending reminder");
        await sendLineMessage([buildNoRecordMessage()]);
        return { statusCode: 200, body: "Sent: no record reminder" };
    }

    // Step 3: Scan all logs to evaluate stool pattern
    let allLogs = [];
    try {
        const scanResult = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
        allLogs = (scanResult.Items || [])
            .filter(log => log.fullDate < today)
            .sort((a, b) => (a.fullDate > b.fullDate ? -1 : 1)); // newest first
    } catch (e) {
        console.error("Scan failed:", e.message);
        return { statusCode: 500, body: "Scan failed" };
    }

    const lastStoolLog = allLogs.find(log => log.hasStool === true);

    if (!lastStoolLog) {
        console.log("No stool records found at all - skipping");
        return { statusCode: 200, body: "No stool history - skipping" };
    }

    // Calculate days since last stool (in JST)
    const lastStoolMs = new Date(lastStoolLog.fullDate + "T00:00:00+09:00").getTime();
    const todayMs = new Date(today + "T00:00:00+09:00").getTime();
    const daysSinceLastStool = Math.floor((todayMs - lastStoolMs) / (1000 * 60 * 60 * 24));

    // Condition: 2+ days since last stool OR 2 consecutive logged days with hasStool:false
    const twoConsecutiveFalse =
        allLogs.length >= 2 &&
        allLogs[0].hasStool === false &&
        allLogs[1].hasStool === false;

    if (daysSinceLastStool >= 2 || twoConsecutiveFalse) {
        console.log(`Alert triggered: ${daysSinceLastStool} days since last stool, twoConsecutiveFalse=${twoConsecutiveFalse}`);
        await sendLineMessage([buildEnemaAlertMessage(daysSinceLastStool)]);
        return { statusCode: 200, body: `Sent: enema alert (${daysSinceLastStool} days)` };
    }

    console.log(`All clear: last stool ${daysSinceLastStool} day(s) ago`);
    return { statusCode: 200, body: "No notification needed" };
};
