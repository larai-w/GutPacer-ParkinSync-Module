// Create closed-beta DynamoDB tables for the LINE-authenticated schema.
// Dry-run is the default. Use --execute to create/update AWS resources.

import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
    UpdateContinuousBackupsCommand
} from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION || "us-east-1";
const logsTable = process.env.NEW_LOGS_TABLE || "gutpacer-logs-v2";
const usersTable = process.env.NEW_USERS_TABLE || "gutpacer-users";
const execute = process.argv.includes("--execute");

const client = new DynamoDBClient({ region });

const tableDefinitions = [
    {
        TableName: logsTable,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
            { AttributeName: "userId", AttributeType: "S" },
            { AttributeName: "fullDate", AttributeType: "S" }
        ],
        KeySchema: [
            { AttributeName: "userId", KeyType: "HASH" },
            { AttributeName: "fullDate", KeyType: "RANGE" }
        ]
    },
    {
        TableName: usersTable,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
            { AttributeName: "userId", AttributeType: "S" }
        ],
        KeySchema: [
            { AttributeName: "userId", KeyType: "HASH" }
        ]
    }
];

async function tableExists(tableName) {
    try {
        await client.send(new DescribeTableCommand({ TableName: tableName }));
        return true;
    } catch (error) {
        if (error.name === "ResourceNotFoundException") return false;
        throw error;
    }
}

async function waitForActive(tableName) {
    for (let attempt = 1; attempt <= 30; attempt++) {
        try {
            const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
            const status = result.Table?.TableStatus;
            if (status === "ACTIVE") return;
            console.log(`${tableName} status is ${status}; waiting`);
        } catch (error) {
            if (error.name !== "ResourceNotFoundException") throw error;
            console.log(`${tableName} is not visible yet; waiting`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`${tableName} did not become ACTIVE in time`);
}

async function enablePitr(tableName) {
    for (let attempt = 1; attempt <= 30; attempt++) {
        try {
            await client.send(new UpdateContinuousBackupsCommand({
                TableName: tableName,
                PointInTimeRecoverySpecification: {
                    PointInTimeRecoveryEnabled: true
                }
            }));
            return;
        } catch (error) {
            if (error.name !== "ContinuousBackupsUnavailableException") throw error;
            console.log(`${tableName} continuous backups unavailable; retrying`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
    throw new Error(`${tableName} PITR could not be enabled in time`);
}

console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    region,
    tables: tableDefinitions.map(({ TableName, KeySchema, BillingMode }) => ({
        TableName,
        KeySchema,
        BillingMode,
        pitr: "enabled after create"
    }))
}, null, 2));

if (!execute) {
    console.log("Dry-run only. No AWS resources were created or changed.");
    process.exit(0);
}

for (const definition of tableDefinitions) {
    if (await tableExists(definition.TableName)) {
        console.log(`${definition.TableName} already exists; waiting for ACTIVE then enabling PITR`);
        await waitForActive(definition.TableName);
        await enablePitr(definition.TableName);
        continue;
    }

    console.log(`Creating ${definition.TableName}`);
    await client.send(new CreateTableCommand(definition));
    await waitForActive(definition.TableName);
    await enablePitr(definition.TableName);
}

console.log("v2 table setup completed.");
