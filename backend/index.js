const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = "gutpacer-logs";
const SETTINGS_TABLE = "gutpacer-settings";

exports.handler = async (event) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    const method = event.requestContext?.http?.method || event.httpMethod;
    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {
        // 【1. 記録の保存処理 (POST)】
        if (method === "POST") {
            const body = JSON.parse(event.body);

            if (body.action === "saveSettings") {
                await docClient.send(new PutCommand({
                    TableName: SETTINGS_TABLE,
                    Item: { settingKey: "location", value: body.location, updatedAt: new Date().toISOString() }
                }));
                return { statusCode: 200, headers, body: JSON.stringify({ message: "設定を保存しました" }) };
            }

            if (!body.fullDate) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "日付がありません" }) };
            }
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: body }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "保存成功" }) };
        }

        // 【2. ログと設定の一括取得 (GET)】
        if (method === "GET") {
            const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
            const logs = (result.Items || []).sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));

            // 設定テーブルのエラーはログのみ。失敗してもデフォルト値で続行
            let location = "home";
            try {
                const settingResult = await docClient.send(new GetCommand({
                    TableName: SETTINGS_TABLE,
                    Key: { settingKey: "location" }
                }));
                location = settingResult.Item?.value ?? "home";
            } catch (e) {
                console.error("設定テーブルの取得に失敗（デフォルト値を使用）:", e.message);
            }

            return { statusCode: 200, headers, body: JSON.stringify({ logs, location }) };
        }

        // 【3. 記録の削除処理 (DELETE)】
        if (method === "DELETE") {
            const fullDate = event.queryStringParameters?.fullDate;
            if (!fullDate) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "fullDate が必要です" }) };
            }
            await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { fullDate } }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "削除しました" }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: "メソッドエラー" }) };

    } catch (error) {
        console.error(error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
