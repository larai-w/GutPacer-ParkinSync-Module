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
import { createHash, timingSafeEqual } from "node:crypto";
import { getLineIdToken, verifyLineIdToken } from "./line-auth.mjs";
import { createDefaultProfile, defaultHouseholdId } from "./profile-defaults.mjs";
import { exportCareEvents } from "./care-event-export.mjs";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LOGS_TABLE = process.env.LOGS_TABLE || "gutpacer-logs-v2";
const USERS_TABLE = process.env.USERS_TABLE || "gutpacer-users";

const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Line-Id-Token,X-Invite-Code"
};

function response(statusCode, body) {
    return { statusCode, headers, body: JSON.stringify(body) };
}

class InviteRequiredError extends Error {
    constructor() {
        super("Invited account required");
        this.name = "InviteRequiredError";
    }
}

async function authenticate(event) {
    return verifyLineIdToken(getLineIdToken(event));
}

function getHeader(event, name) {
    const wanted = name.toLowerCase();
    return Object.entries(event?.headers || {}).find(([key]) => key.toLowerCase() === wanted)?.[1] || "";
}

function inviteCodeMatches(code, expectedHash) {
    if (!code || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
    const actual = createHash("sha256").update(code).digest();
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function getOrCreateProfile(userId, dependencies = {}) {
    const db = dependencies.client || client;
    const now = dependencies.now || (() => new Date().toISOString());
    const result = await db.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId }
    }));
    if (result.Item) return result.Item;

    const invitedUserIds = new Set(String(
        dependencies.invitedUserIds ?? process.env.INVITED_USER_IDS ?? ""
    ).split(",").map((value) => value.trim()).filter(Boolean));
    const inviteHash = dependencies.inviteCodeHash ?? process.env.INVITE_CODE_HASH ?? "";
    if (!invitedUserIds.has(userId) && !inviteCodeMatches(dependencies.inviteCode, inviteHash)) {
        throw new InviteRequiredError();
    }

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
            const profile = await getOrCreateProfile(userId, {
                client: db,
                now,
                invitedUserIds: dependencies.invitedUserIds,
                inviteCodeHash: dependencies.inviteCodeHash,
                inviteCode: getHeader(event, "X-Invite-Code")
            });

            // 記録は**世帯**で引く。LINE の userId は「誰か」を確かめるためのもので、
            // 「誰の記録か」を分ける単位ではない（issue #3）。
            // これを個人のままにすると、PIN 経路（世帯キー）と記録が割れる。
            const householdId = profile.householdId || defaultHouseholdId();

            if (method === "GET") {
                const result = await db.send(new QueryCommand({
                    TableName: LOGS_TABLE,
                    KeyConditionExpression: "#userId = :userId",
                    ExpressionAttributeNames: { "#userId": "userId" },
                    ExpressionAttributeValues: { ":userId": householdId }
                }));
                const logs = (result.Items || []).sort((a, b) =>
                    new Date(b.fullDate) - new Date(a.fullDate)
                );
                if (event.queryStringParameters?.format === "care-event-v1") {
                    return response(200, exportCareEvents(logs, householdId, now()));
                }
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
                    // **世帯で書く。** 読み出しも世帯で引くので、ここを個人のままにすると
                    // 書いた本人にも読めなくなる。
                    Item: { ...log, userId: householdId }
                }));
                return response(200, { message: "Saved" });
            }

            if (method === "DELETE") {
                const fullDate = event.queryStringParameters?.fullDate;
                if (!fullDate) return response(400, { error: "fullDate required" });
                await db.send(new DeleteCommand({
                    TableName: LOGS_TABLE,
                    // **読み書きと同じキーで消す。** ここだけ個人のままだと、
                    // 書いた記録が一件も消せなくなる（撤回が成立しない・COMP-01 C-05）。
                    Key: { userId: householdId, fullDate }
                }));
                return response(200, { message: "Deleted" });
            }

            return response(405, { error: "Method not allowed" });
        } catch (error) {
            if (error.name === "LineAuthError") {
                return response(401, { error: "Unauthorized" });
            }
            if (error.name === "InviteRequiredError") {
                return response(403, { error: "Invite required" });
            }
            console.error(error);
            return response(500, { error: "Internal server error" });
        }
    };
}

export const handler = createHandler();
