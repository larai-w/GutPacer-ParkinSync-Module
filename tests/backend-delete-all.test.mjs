// 全データ削除（同意の撤回）の回帰テスト。
//
// COMP-01 の C-05「いつでも撤回・削除できること」。GutPacer には日単位の
// 削除しか無く、撤回が成立していなかった。
//
// 破壊的な操作なので、合言葉なしでは通らないこと・Scan の結果が漏れなく
// BatchWrite のキーへ変換されることを、AWS を呼ばずに検証する。

import assert from "node:assert/strict";
import test from "node:test";

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

test("Scan の全件が BatchWrite のキーへ落ちる", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({
    fullDate: `2026-08-${String(i + 1).padStart(2, "0")}`,
    note: "残ってはいけない",
  }));
  const batches = buildDeleteAllBatches(items);
  const keys = batches.flat().map((r) => r.DeleteRequest.Key.fullDate);

  assert.equal(keys.length, items.length, "件数が減っている（消し残しになる）");
  assert.deepEqual(new Set(keys), new Set(items.map((i) => i.fullDate)));
  // 削除リクエストにキー以外を混ぜない
  for (const r of batches.flat()) {
    assert.deepEqual(Object.keys(r.DeleteRequest.Key), ["fullDate"]);
  }
});

test("BatchWrite の上限25件で割る", () => {
  const items = Array.from({ length: 53 }, (_, i) => ({ fullDate: `d-${i}` }));
  const batches = buildDeleteAllBatches(items);

  assert.deepEqual(batches.map((b) => b.length), [25, 25, 3]);
  assert.equal(batches.flat().length, 53);
  for (const b of batches) {
    assert.ok(b.length <= 25, "DynamoDB の BatchWriteItem は1回25件まで");
  }
});

test("キーの無い item は落とす（不正なキーで BatchWrite を落とさない）", () => {
  const batches = buildDeleteAllBatches([
    { fullDate: "2026-08-01" },
    { note: "fullDate が無い" },
    { fullDate: "" },
    { fullDate: null },
    null,
  ]);
  assert.deepEqual(batches.flat().map((r) => r.DeleteRequest.Key.fullDate), ["2026-08-01"]);
});

test("空でもエラーにならず、バッチも作らない", () => {
  assert.deepEqual(buildDeleteAllBatches([]), []);
  assert.deepEqual(buildDeleteAllBatches(undefined), []);
});
