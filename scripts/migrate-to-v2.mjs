// Existing single-family data migration for the closed-beta schema.
// Dry-run is the default. Use --execute only after confirming MIGRATION_USER_ID.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    ScanCommand,
    GetCommand,
    BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { createDefaultProfile } from "../backend/profile-defaults.mjs";

const OLD_LOGS_TABLE = process.env.OLD_LOGS_TABLE || "gutpacer-logs";
const OLD_SETTINGS_TABLE = process.env.OLD_SETTINGS_TABLE || "gutpacer-settings";
const NEW_LOGS_TABLE = process.env.NEW_LOGS_TABLE || "gutpacer-logs-v2";
const NEW_USERS_TABLE = process.env.NEW_USERS_TABLE || "gutpacer-users";
const userId = process.env.MIGRATION_USER_ID;
const execute = process.argv.includes("--execute");
const region = process.env.AWS_REGION || "us-east-1";

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
const setting = await client.send(new GetCommand({
    TableName: OLD_SETTINGS_TABLE,
    Key: { settingKey: "location" }
}));
const location = setting.Item?.value || "home";

const migratedLogs = oldLogs.map((log) => ({ ...log, userId }));
const profile = { ...createDefaultProfile(userId), location };

console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    userId,
    sourceLogCount: oldLogs.length,
    destinationLogCount: migratedLogs.length,
    location,
    tables: { logs: NEW_LOGS_TABLE, users: NEW_USERS_TABLE }
}, null, 2));

if (!execute) {
    console.log("Dry-run only. No destination data was written.");
    process.exit(0);
}

await client.send(new BatchWriteCommand({
    RequestItems: {
        [NEW_USERS_TABLE]: [{ PutRequest: { Item: profile } }]
    }
}));

for (let i = 0; i < migratedLogs.length; i += 25) {
    const batch = migratedLogs.slice(i, i + 25).map((log) => ({
        PutRequest: { Item: log }
    }));
    await client.send(new BatchWriteCommand({
        RequestItems: { [NEW_LOGS_TABLE]: batch }
    }));
}

console.log("Migration completed. Keep legacy tables until readback verification is complete.");
