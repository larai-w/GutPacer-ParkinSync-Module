#!/usr/bin/env node
/**
 * Creates the optional metrics table only after explicit governance approval.
 * This script is expected to refuse execution while ADR-0007 is Proposed.
 *
 * Usage:
 *   METRICS_GOVERNANCE_APPROVED=ADR-0007-Accepted \
 *     node scripts/create-metrics-table.mjs --owner-approved
 */
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

if (
  process.env.METRICS_GOVERNANCE_APPROVED !== 'ADR-0007-Accepted' ||
  !process.argv.includes('--owner-approved')
) {
  console.error('Blocked: accepted ADR-0007 and explicit owner approval are required.');
  process.exit(2);
}

// テーブル名は明示必須。既定値を置くと test 環境から本番名を作ってしまう
// (BEN-004 承認ゲート F-03)。stage を必ず名前に含めること。
//   例: gutpacer-metrics-test / gutpacer-metrics-production
const TABLE_NAME = process.env.METRICS_TABLE_NAME;
if (!TABLE_NAME) {
  console.error('Blocked: METRICS_TABLE_NAME is required (e.g. gutpacer-metrics-test).');
  console.error('         Do not rely on a default: it would point at production.');
  process.exit(2);
}

// 既定は us-east-1。GutPacer の既存テーブル(gutpacer-logs / gutpacer-settings)が
// us-east-1 にあり、別リージョンに作ると Lambda から書けない (F-05)。
const REGION_INDEX = process.argv.indexOf('--region');
const REGION = REGION_INDEX >= 0
  ? process.argv[REGION_INDEX + 1]
  : (process.env.AWS_REGION || 'us-east-1');
const client = new DynamoDBClient({ region: REGION });

async function tableExists() {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') return false;
    throw error;
  }
}

async function main() {
  if (await tableExists()) {
    console.log(`Table ${TABLE_NAME} already exists in ${REGION}`);
    return;
  }

  await client.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    Tags: [
      { Key: 'project', Value: 'ben-004' },
      { Key: 'adr', Value: '0007' },
      { Key: 'data-classification', Value: 'identifier-free-telemetry' },
      { Key: 'retention', Value: '35d' },
    ],
  }));

  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: TABLE_NAME });
  await client.send(new UpdateTimeToLiveCommand({
    TableName: TABLE_NAME,
    TimeToLiveSpecification: { Enabled: true, AttributeName: 'ttl' },
  }));
  console.log(`Created ${TABLE_NAME}; TTL enabled on "ttl".`);
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
