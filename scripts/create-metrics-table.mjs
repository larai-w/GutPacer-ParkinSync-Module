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

// 「ハイフンがあれば stage 付き」では不十分。"gutpacer-metrics" 自体が
// ハイフンを含むため素通りする。基底名 + stage の形を厳密に要求する。
const METRICS_TABLE_BASE = 'gutpacer-metrics';
if (!new RegExp(`^${METRICS_TABLE_BASE}-[a-z0-9][a-z0-9-]*$`).test(TABLE_NAME)) {
  console.error(`Blocked: METRICS_TABLE_NAME must be "${METRICS_TABLE_BASE}-<stage>" (got "${TABLE_NAME}").`);
  console.error('         A bare base name would be the production table.');
  process.exit(2);
}

// 既定は ap-northeast-1。GutPacer のテーブルが ap-northeast-1 にあり、
// 別リージョンに作ると Lambda から書けない (F-05)。
// 2026-08-28 に us-east-1 から移設した。
const REGION_INDEX = process.argv.indexOf('--region');
const REGION = REGION_INDEX >= 0
  ? process.argv[REGION_INDEX + 1]
  : (process.env.AWS_REGION || 'ap-northeast-1');

// ガードが正しく拒否することを確認するために、実際にテーブルを作る必要はない。
// --dry-run は全チェックを通したうえで AWS 呼び出しの直前で止まる。
// これが無いと「ガードの検証行為そのものが ADR-0007 制約5 違反になる」
// (2026-08-17 に実際に発生。F-06)。
if (process.argv.includes('--dry-run')) {
  console.log(`Dry run OK: all guards passed. Would create ${TABLE_NAME} in ${REGION}.`);
  console.log('No AWS call was made.');
  process.exit(0);
}
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
