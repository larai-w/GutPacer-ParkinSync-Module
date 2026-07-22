import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    QueryCommand,
    GetCommand,
    PutCommand,
    DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { getLineIdToken, verifyLineIdToken } from "./line-auth.mjs";
import { createDefaultProfile } from "./profile-defaults.mjs";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LOGS_TABLE = process.env.LOGS_TABLE || "gutpacer-logs-v2";
const USERS_TABLE = process.env.USERS_TABLE || "gutpacer-users";

const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Line-Id-Token"
};

function response(statusCode, body) {
    return { statusCode, headers, body: JSON.stringify(body) };
}

async function authenticate(event) {
    return verifyLineIdToken(getLineIdToken(event));
}

async function getOrCreateProfile(userId, dependencies = {}) {
    const db = dependencies.client || client;
    const now = dependencies.now || (() => new Date().toISOString());
    const result = await db.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId }
    }));
    if (result.Item) return result.Item;

    const profile = createDefaultProfile(userId, now());
    await db.send(new PutCommand({
        TableName: USERS_TABLE,
        Item: profile,
        ConditionExpression: "attribute_not_exists(userId)"
    })).catch(async (error) => {
        // Another first request may have created the profile concurrently.
        if (error.name !== "ConditionalCheckFailedException") throw error;
    });
    return profile;
}

export function createHandler(dependencies = {}) {
    const db = dependencies.client || client;
    const auth = dependencies.authenticate || authenticate;
    const now = dependencies.now || (() => new Date().toISOString());

    return async (event) => {
        const method = event.requestContext?.http?.method || event.httpMethod;

        if (method === "OPTIONS") return { statusCode: 200, headers, body: "" };

        try {
            const identity = await auth(event);
            const userId = identity.userId;
            const profile = await getOrCreateProfile(userId, { client: db, now });

            if (method === "GET") {
                const result = await db.send(new QueryCommand({
                    TableName: LOGS_TABLE,
                    KeyConditionExpression: "#userId = :userId",
                    ExpressionAttributeNames: { "#userId": "userId" },
                    ExpressionAttributeValues: { ":userId": userId }
                }));
                const logs = (result.Items || []).sort((a, b) =>
                    new Date(b.fullDate) - new Date(a.fullDate)
                );
                return response(200, {
                    logs,
                    location: profile.location || "home",
                    profile
                });
            }

            if (method === "POST") {
                let body;
                try {
                    body = JSON.parse(event.body || "{}");
                } catch {
                    return response(400, { error: "Invalid JSON" });
                }

                if (body.action === "saveSettings") {
                    const location = body.location === "facility" ? "facility" : "home";
                    await db.send(new PutCommand({
                        TableName: USERS_TABLE,
                        Item: { ...profile, location, updatedAt: now() }
                    }));
                    return response(200, { message: "Saved" });
                }

                if (!body.fullDate) return response(400, { error: "fullDate required" });
                const { userId: ignoredUserId, ...log } = body;
                await db.send(new PutCommand({
                    TableName: LOGS_TABLE,
                    Item: { ...log, userId }
                }));
                return response(200, { message: "Saved" });
            }

            if (method === "DELETE") {
                const fullDate = event.queryStringParameters?.fullDate;
                if (!fullDate) return response(400, { error: "fullDate required" });
                await db.send(new DeleteCommand({
                    TableName: LOGS_TABLE,
                    Key: { userId, fullDate }
                }));
                return response(200, { message: "Deleted" });
            }

            return response(405, { error: "Method not allowed" });
        } catch (error) {
            if (error.name === "LineAuthError") {
                return response(401, { error: "Unauthorized" });
            }
            console.error(error);
            return response(500, { error: "Internal server error" });
        }
    };
}

export const handler = createHandler();
