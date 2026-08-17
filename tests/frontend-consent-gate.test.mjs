// フロント側の計測同意ゲートの回帰テスト。
//
// ADR-0007 制約2「利用者の明示オプトインを必須とし、未選択・不明・設定破損時は
// 計測しない」を、UI ではなく実際のコードで固定する。
//
// index.html は単一ファイルのため、recordTimeTracker の IIFE をソースから抽出し、
// localStorage / fetch をスタブした環境で評価して振る舞いを検証する。
// 抽出に失敗した場合は「テストが通った」ように見せず、必ず落とす。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");

const START = "const recordTimeTracker = (() => {";
const END = "})();";
const startIndex = html.indexOf(START);
assert.notEqual(startIndex, -1, "recordTimeTracker の定義が index.html に見つからない（実装が動いた可能性）");
const endIndex = html.indexOf(END, startIndex);
assert.notEqual(endIndex, -1, "recordTimeTracker の終端が見つからない");
const trackerSource = html.slice(startIndex, endIndex + END.length);

// 抽出したソースを、依存をスタブした関数として評価する。
function makeTracker({ consent }) {
  const store = new Map();
  if (consent !== undefined) store.set("metrics_consent", consent);

  const calls = [];
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const fetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ ok: true });
  };

  const factory = new Function(
    "localStorage",
    "fetch",
    "API_URL",
    "getAuthHeaders",
    `${trackerSource}\nreturn recordTimeTracker;`
  );
  const tracker = factory(localStorage, fetch, "https://example.invalid/api", (h) => h);
  return { tracker, calls };
}

test("同意がない状態では計測を開始も送信もしない", async () => {
  // 未選択(null)、明示的な拒否、設定破損(想定外の値)のいずれでも送信しない
  for (const consent of [undefined, "denied", "", "true", "GRANTED", "1"]) {
    const { tracker, calls } = makeTracker({ consent });
    assert.equal(tracker.hasConsent(), false, `consent=${String(consent)} が同意扱いされている`);

    tracker.start();
    await tracker.stop();
    tracker.flushOnUnload();

    assert.equal(calls.length, 0, `consent=${String(consent)} で送信が発生した`);
  }
});

test("同意しても start を経ていなければ送信しない", async () => {
  const { tracker, calls } = makeTracker({ consent: "granted" });
  await tracker.stop();
  tracker.flushOnUnload();
  assert.equal(calls.length, 0);
});

test("同意後の送信ペイロードは4項目のみで、識別子も記録本文も含まない", async () => {
  const { tracker, calls } = makeTracker({ consent: "granted" });

  tracker.start();
  await new Promise((resolve) => setTimeout(resolve, 120)); // 下限100msを超えさせる
  await tracker.stop();

  assert.equal(calls.length, 1, "同意済みでも送信されていない");
  const body = JSON.parse(calls[0].init.body);

  assert.deepEqual(
    Object.keys(body).sort(),
    ["action", "channel", "durationMs", "product"],
    "ペイロードのフィールドが想定と違う"
  );
  assert.equal(body.product, "gutpacer");
  assert.equal(body.channel, "web");
  assert.equal(Number.isInteger(body.durationMs), true);

  for (const forbidden of ["recordId", "sessionId", "userId", "householdId", "memo", "bowel", "condition", "startedAt"]) {
    assert.equal(forbidden in body, false, `${forbidden} が送信ペイロードに混入している`);
  }
});

test("同意を撤回すると以降は送信しない", async () => {
  const { tracker, calls } = makeTracker({ consent: "granted" });

  tracker.start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  await tracker.stop();
  assert.equal(calls.length, 1);

  // 撤回はトグル操作で localStorage の値が変わることで表現される
  const revoked = makeTracker({ consent: "denied" });
  revoked.tracker.start();
  await revoked.tracker.stop();
  revoked.tracker.flushOnUnload();
  assert.equal(revoked.calls.length, 0, "撤回後も送信されている");
});
