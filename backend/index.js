const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = "gutpacer-logs"; // あとでAWSに作るテーブル名

exports.handler = async (event) => {
    // ヘルパーさんのスマホやJunさんのPCから通信できるようにするお守り（CORSヘッダー）
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    // ブラウザからの事前確認（OPTIONS）はスルーする
    const method = event.requestContext?.http?.method || event.httpMethod;
    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {
        // 【1. 記録の保存処理 (POST)】
        if (method === "POST") {
            const body = JSON.parse(event.body);
            if (!body.fullDate) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "日付がありません" }) };
            }

            // DynamoDBにデータをガツンと入れる
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: body
            }));

            return { statusCode: 200, headers, body: JSON.stringify({ message: "サーバーへの保存に成功しました！" }) };
        }

        // 【2. 履歴の取得処理 (GET)】
        if (method === "GET") {
            const result = await docClient.send(new ScanCommand({
                TableName: TABLE_NAME
            }));

            // 日付が新しい順（最新が一番上）に並び替えてフロントに返す
            const sortedItems = (result.Items || []).sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));

            return { statusCode: 200, headers, body: JSON.stringify(sortedItems) };
        }

        // 【3. 記録の削除処理 (DELETE)】
        if (method === "DELETE") {
            const fullDate = event.queryStringParameters?.fullDate;
            if (!fullDate) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "fullDate が必要です" }) };
            }
            await docClient.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { fullDate }
            }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "削除しました" }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: "許可されていない動きです" }) };

    } catch (error) {
        console.error(error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
