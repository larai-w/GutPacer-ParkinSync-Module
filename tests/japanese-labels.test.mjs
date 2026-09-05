import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8",
);
// 画面に出る部分だけを見る（<style> と <script> は対象外）
const BODY = HTML
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

// 2026-08-28: 日本の家族介護者向けなのに、ラベルが全部英語併記だった
// （記録を保存する (Save Log) / 量 (Amount) / Bowel Tracker (排便記録) …）。
// **英語が効いている場面が説明できない**ので消した。
// 例外は 小(S) 中(M) 大(L) だけ。**短い記号として機能している。**

test("ラベルに英語を併記していない", () => {
  const jaThenEn = [...BODY.matchAll(/[一-龥ぁ-んァ-ヶー]+ *(\([A-Za-z][A-Za-z /]*\))/g)]
    .map((m) => m[1])
    .filter((en) => !["(S)", "(M)", "(L)"].includes(en));
  const enThenJa = [...BODY.matchAll(/[A-Z][A-Za-z ]+ *\([一-龥ぁ-んァ-ヶー]+\)/g)].map((m) => m[0]);

  assert.deepEqual(
    [...new Set([...jaThenEn, ...enThenJa])],
    [],
    "英語併記が残っている。**誰のための英語かが説明できない**",
  );
});

test("小・中・大の記号は残っている", () => {
  // これは英語というより**短い記号**。消すと選択肢が長くなる。
  for (const m of ["小 (S)", "中 (M)", "大 (L)"]) {
    assert.ok(BODY.includes(m), `${m} が消えている`);
  }
});

test("保存後の確認に実装の都合を書かない", () => {
  // 「AWSサーバーに記録を保存しました！」と出していた。
  // **AWS が何かを知っている必要はない。** それはこちらの都合。
  assert.ok(
    !/alert\([^)]*AWS/.test(HTML),
    "保存メッセージに AWS が出ている。**利用者に関係のない実装の都合**",
  );
  assert.match(HTML, /id="saveConfirmation"/, "保存後の確認表示が無い");
  assert.match(HTML, /記録を保存しました/, "保存確認メッセージが無い");
});
