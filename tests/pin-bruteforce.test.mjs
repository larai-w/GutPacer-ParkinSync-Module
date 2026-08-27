import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  timingSafeEqualString,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_SECONDS,
} from "../backend/index.mjs";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "backend", "index.mjs"),
  "utf8"
);

// 2026-08-27 に測った実態:
//   PIN は 4桁の数字（10,000通り）／レート制限なし／関数URLは公開
//   → 毎秒10回試せば平均8分で当たる計算（**実際には試していない**）
//
// 第一の手当ては PIN を長くすること。ここはその次の層。
// **長さだけに頼ると、桁数を戻されたときに何も残らない。**

test("PIN の比較が定時間で行われる", () => {
  assert.equal(timingSafeEqualString("abcd", "abcd"), true);
  assert.equal(timingSafeEqualString("abcd", "abce"), false);
  assert.equal(timingSafeEqualString("abcd", "abc"), false, "長さ違いを通している");
  assert.equal(timingSafeEqualString("", ""), true);
  assert.equal(timingSafeEqualString(null, "abcd"), false);
  assert.equal(timingSafeEqualString("abcd", undefined), false);
});

test("素の比較で PIN を判定していない", () => {
  // 素の `!==` は違う位置で早く返るため、応答時間から1文字ずつ絞り込める。
  assert.ok(
    !/pin\s*!==\s*process\.env\.ACCESS_PIN/.test(SRC),
    "PIN を素の !== で比較している。応答時間から1文字ずつ絞り込める"
  );
  assert.match(
    SRC,
    /timingSafeEqualString\(pin,/,
    "PIN の比較に定時間比較を使っていない"
  );
});

test("失敗を数えて締め出す", () => {
  // 締め出しが無いと、PIN を長くしても「いつかは当たる」が残る。
  assert.ok(MAX_FAILED_ATTEMPTS > 0, "失敗回数の上限が無い");
  assert.ok(MAX_FAILED_ATTEMPTS <= 10, "上限が緩すぎる（総当たりを止められない）");
  assert.ok(LOCKOUT_SECONDS >= 300, "締め出しが短すぎる（すぐ再開できる）");

  assert.match(SRC, /isLockedOut\(sourceIp\)/, "締め出しの判定を呼んでいない");
  assert.match(SRC, /recordFailedAttempt\(sourceIp\)/, "失敗を数えていない");
  assert.match(SRC, /clearFailedAttempts\(sourceIp\)/, "成功時に数え直していない");
});

test("締め出しの判定は認証より先に行う", () => {
  // 後に置くと、締め出し中でも PIN の判定が走り、
  // **正解かどうかが応答から分かってしまう。**
  const lock = SRC.indexOf("await isLockedOut(sourceIp)");
  const verify = SRC.indexOf("timingSafeEqualString(pin,");
  assert.ok(lock !== -1 && verify !== -1);
  assert.ok(
    lock < verify,
    "締め出しの判定が PIN の判定より後にある。締め出し中でも正解かどうかが分かる"
  );
});

test("締め出しの仕組みが壊れても、認証は止まらない", () => {
  // ⚠️ これは追加の層であって、認証そのものではない。
  // DynamoDB が落ちたときに**家族が入れなくなるほうが困る**（夜間の記録が止まる）。
  const start = SRC.indexOf("async function isLockedOut");
  const body = SRC.slice(start, SRC.indexOf("\n}", start));

  // ⚠️ 最初は `/return false/` を見ていたが、**この関数には return false が
  // 他にも2箇所ある**（item が無い／期限切れ）。catch から消しても通ってしまった。
  // **catch の中身**を見る。
  const catchBlock = body.match(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(catchBlock, "締め出しの判定が失敗したとき握りつぶしていない");
  assert.match(
    catchBlock[1],
    /return false/,
    "失敗時に締め出し扱いにしている。DynamoDB が落ちると家族が入れなくなる"
  );
  assert.ok(
    !/throw/.test(catchBlock[1]),
    "締め出しの判定の失敗で例外を投げている。認証を巻き込む"
  );

  for (const fn of ["recordFailedAttempt", "clearFailedAttempts"]) {
    const i = SRC.indexOf(`async function ${fn}`);
    const b = SRC.slice(i, SRC.indexOf("\n}", i));
    assert.match(b, /catch/, `${fn} が失敗したとき認証を巻き込む`);
  }
});

test("締め出しの失敗を黙って捨てない", () => {
  // 握りつぶすなら、**握りつぶしたことは残す。**
  // 残さないと、締め出しが効いていないことに誰も気づけない。
  for (const marker of [
    "[PIN LOCKOUT CHECK FAILED]",
    "[PIN ATTEMPT RECORD FAILED]",
    "[PIN ATTEMPT CLEAR FAILED]",
    "[PIN LOCKOUT]",
  ]) {
    assert.ok(SRC.includes(marker), `${marker} のログが無い`);
  }
});
