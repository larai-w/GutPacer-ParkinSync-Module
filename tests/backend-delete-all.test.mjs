// 全データ削除（同意の撤回）の回帰テスト。
//
// COMP-01 の C-05「いつでも撤回・削除できること」。GutPacer には日単位の
// 削除しか無く、撤回が成立していなかった。
//
// 破壊的な操作なので、合言葉なしでは通らないこと・Scan の結果が漏れなく
// BatchWrite のキーへ変換されることを、AWS を呼ばずに検証する。

import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  DELETE_ALL_CONFIRMATION,
  validateDeleteAllRequest,
  buildDeleteAllBatches,
} from "../backend/index.mjs";

test("合言葉が無ければ通らない", () => {
  assert.equal(validateDeleteAllRequest({}).error, "Confirmation phrase required");
  assert.equal(
    validateDeleteAllRequest({ action: "deleteAllData" }).error,
    "Confirmation phrase required",
  );
});

test("合言葉が違えば通らない", () => {
  assert.equal(validateDeleteAllRequest({ confirm: "delete-all" }).error, "Confirmation phrase required");
  assert.equal(validateDeleteAllRequest({ confirm: "DELETE ALL" }).error, "Confirmation phrase required");
  assert.equal(validateDeleteAllRequest({ confirm: "" }).error, "Confirmation phrase required");
});

test("本文が object でなければ通らない", () => {
  assert.equal(validateDeleteAllRequest(null).error, "Invalid request");
  assert.equal(validateDeleteAllRequest([]).error, "Invalid request");
  assert.equal(validateDeleteAllRequest("DELETE-ALL").error, "Invalid request");
});

test("合言葉が一致したときだけ通る", () => {
  assert.deepEqual(validateDeleteAllRequest({ confirm: DELETE_ALL_CONFIRMATION }), { ok: true });
});

test("読み出した全件が BatchWrite のキーへ落ちる", () => {
  // 2026-08-27: キーが `fullDate` 単独から `userId`+`fullDate` の複合になった。
  // **両方揃っていないと DynamoDB が例外を投げ、その batch ごと消えずに終わる。**
  const items = Array.from({ length: 7 }, (_, i) => ({
    userId: "household:test",
    fullDate: `2026-08-${String(i + 1).padStart(2, "0")}`,
    note: "残ってはいけない",
  }));
  const batches = buildDeleteAllBatches(items);
  const keys = batches.flat().map((r) => r.DeleteRequest.Key.fullDate);

  assert.equal(keys.length, items.length, "件数が減っている（消し残しになる）");
  assert.deepEqual(new Set(keys), new Set(items.map((i) => i.fullDate)));
  // 削除リクエストにキー以外を混ぜない。**両方揃っていること。**
  for (const r of batches.flat()) {
    assert.deepEqual(Object.keys(r.DeleteRequest.Key).sort(), ["fullDate", "userId"]);
    assert.equal(r.DeleteRequest.Key.userId, "household:test");
  }
});

test("削除は世帯を越えない", () => {
  // **一番危ない性質。** 読み出しを Query で世帯に絞っているので、
  // ここへ他所帯の item は来ない。来たとしても、
  // **その item 自身の userId でキーを組む**（別世帯のキーを勝手に作らない）。
  const batches = buildDeleteAllBatches([
    { userId: "household:a", fullDate: "2026-08-01" },
    { userId: "household:b", fullDate: "2026-08-01" },
  ]);
  const pairs = batches.flat().map((r) => `${r.DeleteRequest.Key.userId}/${r.DeleteRequest.Key.fullDate}`);
  assert.deepEqual(pairs.sort(), ["household:a/2026-08-01", "household:b/2026-08-01"]);
});

test("BatchWrite の上限25件で割る", () => {
  const items = Array.from({ length: 53 }, (_, i) => ({ userId: "household:test", fullDate: `d-${i}` }));
  const batches = buildDeleteAllBatches(items);

  assert.deepEqual(batches.map((b) => b.length), [25, 25, 3]);
  assert.equal(batches.flat().length, 53);
  for (const b of batches) {
    assert.ok(b.length <= 25, "DynamoDB の BatchWriteItem は1回25件まで");
  }
});

test("キーが欠けた item は落とす（不正なキーで BatchWrite を落とさない）", () => {
  // 複合キーなので、**どちらが欠けても使えない。**
  const batches = buildDeleteAllBatches([
    { userId: "household:test", fullDate: "2026-08-01" },
    { userId: "household:test", note: "fullDate が無い" },
    { fullDate: "2026-08-02" },                 // userId が無い
    { userId: "", fullDate: "2026-08-03" },
    { userId: "household:test", fullDate: "" },
    { userId: null, fullDate: null },
    null,
  ]);
  assert.deepEqual(
    batches.flat().map((r) => r.DeleteRequest.Key.fullDate),
    ["2026-08-01"],
    "キーの欠けた item が混ざっている（BatchWrite ごと失敗して消え残る）"
  );
});

test("空でもエラーにならず、バッチも作らない", () => {
  assert.deepEqual(buildDeleteAllBatches([]), []);
  assert.deepEqual(buildDeleteAllBatches(undefined), []);
});

// ── 世帯を越えないこと（issue #3・2026-08-27）─────────────────────────
//
// ⚠️ ここは**純粋関数のテストでは守れない**。実際、`deleteAllLogs` を
// Query から Scan に戻しても、上のテストは全部通ってしまった。
// **守っていないガードは、無いより悪い。**
//
// 押さえるのは不変条件: **記録テーブルを Scan しない。**
// Scan は世帯の区別なく全件返すので、そこから作った削除リストは
// **他所帯の記録まで消す**。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BACKEND = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "backend", "index.mjs"),
  "utf8",
);

function isolatedDeleteAll(send, messages = []) {
  const start = BACKEND.indexOf("async function deleteAllLogs()");
  const end = BACKEND.indexOf("\n}\n\nasync function saveRecordTimeMetric", start);
  assert.ok(start >= 0 && end > start, "deleteAllLogs body is missing");
  class QueryCommand { constructor(input) { this.input = input; this.kind = "query"; } }
  class BatchWriteCommand { constructor(input) { this.input = input; this.kind = "batch"; } }
  return runInNewContext(`(${BACKEND.slice(start, end + 2)})`, {
    docClient: { send }, QueryCommand, BatchWriteCommand,
    TABLE_NAME: "gutpacer-logs-v2", HOUSEHOLD_ID: "household:test",
    buildDeleteAllBatches,
    console: { log: (message) => messages.push(message) },
  });
}

test("全件削除はQueryの次ページまで読み、全キーを削除する", async () => {
  const queried = [];
  const deleted = [];
  const deleteAll = isolatedDeleteAll(async (command) => {
    if (command.kind === "query") {
      queried.push(command.input);
      if (queried.length === 1) return {
        Items: [{ userId: "household:test", fullDate: "2026-10-01" }],
        LastEvaluatedKey: { userId: "household:test", fullDate: "2026-10-01" },
      };
      if (queried.length === 2) return {
        Items: [{ userId: "household:test", fullDate: "2026-10-02" }],
      };
      return { Items: [] };
    }
    deleted.push(...command.input.RequestItems["gutpacer-logs-v2"].map((item) => item.DeleteRequest.Key.fullDate));
    return {};
  });

  assert.equal(await deleteAll(), 2);
  assert.deepEqual(deleted, ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(queried[1].ExclusiveStartKey, {
    userId: "household:test", fullDate: "2026-10-01",
  });
  assert.equal(queried[2].ConsistentRead, true);
  assert.equal(queried[2].Limit, 1);
});

test("BatchWriteの未処理項目を削除成功と数えない", async () => {
  const messages = [];
  const deleteAll = isolatedDeleteAll(async (command) => {
    if (command.kind === "query") return {
      Items: [{ userId: "household:test", fullDate: "2026-10-01" }],
    };
    return { UnprocessedItems: command.input.RequestItems };
  }, messages);

  await assert.rejects(deleteAll(), /incomplete/i);
  assert.ok(messages.some((message) => message.includes("[DELETE ALL INCOMPLETE]")));
});

test("削除後に同じ世帯の記録が残れば成功を返さない", async () => {
  const messages = [];
  let queries = 0;
  const deleteAll = isolatedDeleteAll(async (command) => {
    if (command.kind === "query") {
      queries += 1;
      return { Items: [{ userId: "household:test", fullDate: "2026-10-01" }] };
    }
    return {};
  }, messages);

  await assert.rejects(deleteAll(), /incomplete/i);
  assert.equal(queries, 2);
  assert.ok(messages.some((message) => message.includes("[DELETE ALL INCOMPLETE]")));
});

test("記録テーブルを Scan しない（世帯を越えて読まない）", () => {
  // TABLE_NAME を対象にした Scan が1つでもあってはいけない。
  // 同意テーブル(SETTINGS_TABLE)の Scan は単一世帯の設定なので対象外。
  const scans = [...BACKEND.matchAll(/new ScanCommand\(\{[^}]*TableName:\s*(\w+)/g)]
    .map((m) => m[1]);
  assert.ok(
    !scans.includes("TABLE_NAME"),
    `記録テーブルを Scan している（${scans.join(", ")}）。世帯の区別なく全件読む`,
  );
});

test("全件削除は世帯で絞ってから消す", () => {
  const start = BACKEND.indexOf("async function deleteAllLogs()");
  assert.ok(start !== -1, "deleteAllLogs が無い");
  const body = BACKEND.slice(start, BACKEND.indexOf("\n}", start));

  assert.match(body, /new QueryCommand/,
    "全件削除が Query で絞っていない。**他所帯の記録まで消す**");
  assert.ok(!/new ScanCommand/.test(body),
    "全件削除が Scan を使っている。**他所帯の記録まで消す**");
  assert.match(body, /HOUSEHOLD_ID/,
    "全件削除が世帯を指定していない");
});

test("記録の読み出しも世帯で絞る", () => {
  // 読み出しが Scan だと、**他所帯の記録が画面に出る。**
  const queries = [...BACKEND.matchAll(/new QueryCommand\(\{[\s\S]{0,400}?\}\)/g)];
  assert.ok(queries.length >= 2,
    `Query が ${queries.length} 箇所。読み出しと全件削除の2つは要る`);
  for (const q of queries) {
    assert.match(q[0], /":household":\s*HOUSEHOLD_ID/,
      "世帯を指定していない Query がある");
  }
});

test("GETの記録Queryと設定取得は並列で、設定失敗はhomeへフォールバックする", () => {
  const start = BACKEND.indexOf('if (method === "GET")');
  const body = BACKEND.slice(start, BACKEND.indexOf('if (method === "DELETE")', start));
  assert.match(body, /const logsPromise = docClient\.send\(new QueryCommand/);
  assert.match(body, /const settingPromise = docClient\.send\(new GetCommand/);
  assert.match(body, /Promise\.all\(\[logsPromise, settingPromise\]\)/);
  assert.match(body, /return null;/, "設定取得失敗時にPromiseを解決していない");
  assert.match(body, /settingResult\?\.Item\?\.value \?\? "home"/);
});
