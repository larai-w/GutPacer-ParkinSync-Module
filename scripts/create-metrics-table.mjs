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

const TABLE_NAME = process.env.METRICS_TABLE_NAME || 'gutpacer-metrics';
const REGION_INDEX = process.argv.indexOf('--region');
const REGION = REGION_INDEX >= 0
  ? process.argv[REGION_INDEX + 1]
  : (process.env.AWS_REGION || 'ap-northeast-1');
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
