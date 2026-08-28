// Existing single-family data migration for the closed-beta schema.
// Dry-run is the default. Use --execute only after confirming MIGRATION_USER_ID.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    ScanCommand,
    QueryCommand,
    GetCommand,
    PutCommand
} from "@aws-sdk/lib-dynamodb";
import { createDefaultProfile } from "../backend/profile-defaults.mjs";

const OLD_LOGS_TABLE = process.env.OLD_LOGS_TABLE || "gutpacer-logs";
const OLD_SETTINGS_TABLE = process.env.OLD_SETTINGS_TABLE || "gutpacer-settings";
const NEW_LOGS_TABLE = process.env.NEW_LOGS_TABLE || "gutpacer-logs-v2";
const NEW_USERS_TABLE = process.env.NEW_USERS_TABLE || "gutpacer-users";
const userId = process.env.MIGRATION_USER_ID;
const execute = process.argv.includes("--execute");
const region = process.env.AWS_REGION || "ap-northeast-1";

if (!userId) {
    console.error("MIGRATION_USER_ID is required");
    process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

async function scanAll(tableName) {
    const items = [];
    let ExclusiveStartKey;
    do {
        const result = await client.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey
        }));
        items.push(...(result.Items || []));
        ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}

const oldLogs = await scanAll(OLD_LOGS_TABLE);
const existingLogsResult = await client.send(new QueryCommand({
    TableName: NEW_LOGS_TABLE,
    KeyConditionExpression: "#userId = :userId",
    ExpressionAttributeNames: { "#userId": "userId" },
    ExpressionAttributeValues: { ":userId": userId }
}));
const existingLogs = existingLogsResult.Items || [];
const existingDates = new Set(existingLogs.map((log) => log.fullDate));
const missingLogs = oldLogs.filter((log) => !existingDates.has(log.fullDate));
const setting = await client.send(new GetCommand({
    TableName: OLD_SETTINGS_TABLE,
    Key: { settingKey: "location" }
}));
const location = setting.Item?.value || "home";

const existingProfile = await client.send(new GetCommand({
    TableName: NEW_USERS_TABLE,
    Key: { userId }
}));
const migratedLogs = missingLogs.map((log) => ({ ...log, userId }));
const profile = { ...createDefaultProfile(userId), location };

console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    migrationTargetConfigured: true,
    sourceLogCount: oldLogs.length,
    existingDestinationLogCount: existingLogs.length,
    missingDestinationLogCount: migratedLogs.length,
    existingProfilePreserved: Boolean(existingProfile.Item),
    location,
    tables: { logs: NEW_LOGS_TABLE, users: NEW_USERS_TABLE }
}, null, 2));

if (!execute) {
    console.log("Dry-run only. No destination data was written.");
    process.exit(0);
}

if (!existingProfile.Item) {
    await client.send(new PutCommand({
        TableName: NEW_USERS_TABLE,
        Item: profile,
        ConditionExpression: "attribute_not_exists(userId)"
    })).catch((error) => {
        if (error.name !== "ConditionalCheckFailedException") throw error;
    });
}

let writtenLogCount = 0;
for (const log of migratedLogs) {
    await client.send(new PutCommand({
        TableName: NEW_LOGS_TABLE,
        Item: log,
        ConditionExpression: "attribute_not_exists(userId) AND attribute_not_exists(fullDate)"
    })).then(() => {
        writtenLogCount++;
    }).catch((error) => {
        if (error.name !== "ConditionalCheckFailedException") throw error;
    });
}

console.log(JSON.stringify({
    migrationCompleted: true,
    writtenLogCount,
    skippedExistingLogCount: oldLogs.length - writtenLogCount,
    legacyTablesRetained: true
}, null, 2));
