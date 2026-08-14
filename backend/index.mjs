import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = "gutpacer-logs";
const SETTINGS_TABLE = "gutpacer-settings";
const METRICS_TABLE = "gutpacer-metrics";
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

async function saveRecordTimeMetric(body) {
    if (!METRICS_COLLECTION_ENABLED) {
        return { statusCode: 503, error: "Metrics collection is disabled" };
    }
    const validated = validateRecordTimeMetric(body);
    if (validated.error) {
        return { statusCode: 400, error: validated.error };
    }

    const now = new Date();
    await docClient.send(new PutCommand({
        TableName: METRICS_TABLE,
        Item: {
            pk: `gutpacer#${randomUUID()}`,
            sk: now.toISOString(),
            product: "gutpacer",
            channel: "web",
            eventType: "record_saved",
            durationMs: validated.metric.durationMs,
            date: now.toISOString().slice(0, 10),
            ttl: Math.floor(now.getTime() / 1000) + 35 * 24 * 60 * 60
        }
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
