/**
 * GutPacer を us-east-1 → ap-northeast-1 へ移す（データ部分）。
 *
 *   node scripts/migrate-to-tokyo.mjs            # 下見（何もしない）
 *   node scripts/migrate-to-tokyo.mjs --apply    # 実行
 *
 * ⚠️ **旧リージョン（us-east-1）には一切書き込まない。読むだけ。**
 * 失敗しても現状は壊れない。切り替えは frontend/config.js を
 * 東京の Function URL に向けたときに初めて起きる。
 *
 * 何度実行しても同じ結果になるように書く（テーブルは存在すれば作らない、
 * 項目は put で上書き）。
 */
import {
  DynamoDBClient, CreateTableCommand, DescribeTableCommand, ListTablesCommand,
  ScanCommand, BatchWriteItemCommand, waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const FROM = "us-east-1";
const TO = "ap-northeast-1";
const APPLY = process.argv.includes("--apply");

// 旧リージョンで確認した定義。**GSI もTTLも無い、オンデマンド。**
const TABLES = [
  { name: "gutpacer-logs-v2", keys: [["userId", "HASH", "S"], ["fullDate", "RANGE", "S"]] },
  { name: "gutpacer-logs", keys: [["fullDate", "HASH", "S"]] },
  { name: "gutpacer-settings", keys: [["settingKey", "HASH", "S"]] },
  { name: "gutpacer-users", keys: [["userId", "HASH", "S"]] },
];

const src = new DynamoDBClient({ region: FROM });
const dst = new DynamoDBClient({ region: TO });

async function existsInTokyo(name) {
  try {
    await dst.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (e) {
    if (e.name === "ResourceNotFoundException") return false;
    throw e;
  }
}

async function createTable(t) {
  await dst.send(new CreateTableCommand({
    TableName: t.name,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: t.keys.map(([n, , type]) => ({ AttributeName: n, AttributeType: type })),
    KeySchema: t.keys.map(([n, kt]) => ({ AttributeName: n, KeyType: kt })),
  }));
  await waitUntilTableExists({ client: dst, maxWaitTime: 120 }, { TableName: t.name });
}

async function scanAll(client, name) {
  const items = [];
  let key;
  do {
    const r = await client.send(new ScanCommand({ TableName: name, ExclusiveStartKey: key }));
    items.push(...(r.Items ?? []));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

async function copy(t) {
  const items = await scanAll(src, t.name);
  if (!APPLY) return { count: items.length, wrote: 0 };
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    let req = { [t.name]: chunk };
    // 未処理分は必ず再送する。**黙って落とさない。**
    for (let attempt = 0; attempt < 5 && Object.keys(req).length; attempt++) {
      const r = await dst.send(new BatchWriteItemCommand({ RequestItems: req }));
      req = r.UnprocessedItems ?? {};
      if (Object.keys(req).length) await new Promise((s) => setTimeout(s, 300 * (attempt + 1)));
    }
    if (Object.keys(req).length) throw new Error(`${t.name}: 書き込めなかった項目が残った`);
  }
  return { count: items.length, wrote: items.length };
}

console.log(`${FROM} → ${TO}${APPLY ? "" : "（下見。--apply で実行）"}\n`);
let ng = 0;
for (const t of TABLES) {
  const has = await existsInTokyo(t.name);
  if (!has) {
    if (APPLY) { await createTable(t); console.log(`  作成 ${t.name}`); }
    else console.log(`  作成予定 ${t.name}`);
  } else {
    console.log(`  既にある ${t.name}`);
  }
  if (!APPLY && !has) { console.log(`         （テーブルが無いので件数の照合は実行時に）`); continue; }

  const { count } = await copy(t);
  if (APPLY) {
    const after = (await scanAll(dst, t.name)).length;
    const ok = after >= count;
    if (!ok) ng++;
    console.log(`         ${count} 件 → 東京 ${after} 件 ${ok ? "✅" : "★不一致"}`);
  } else {
    console.log(`         ${count} 件を移す予定`);
  }
}
console.log(ng ? `\n★ ${ng} 件のテーブルで不一致。切り替えないこと。` : "\n照合 OK。旧リージョンはそのまま残してある。");
