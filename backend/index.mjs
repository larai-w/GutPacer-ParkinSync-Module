import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = "gutpacer-logs";
const SETTINGS_TABLE = "gutpacer-settings";

export const handler = async (event) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    try {
        const method = event.requestContext?.http?.method || event.httpMethod;

        if (method === "OPTIONS") {
            return { statusCode: 200, headers, body: "" };
        }

        if (method === "POST") {
            const body = JSON.parse(event.body);
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
