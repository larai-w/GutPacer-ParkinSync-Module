import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8",
);

// 2026-08-28 に起きたこと:
//   #42 で Tailwind の indigo 系を CSS 変数に差し替えたが、**フォールバックを
//   置かなかった。** 変数が解決できないと、その宣言は無効として捨てられ、
//   background-color は **transparent** になる。
//   対象のボタンは文字が白なので、**白背景に白文字＝消えたように見える。**
//   保存ボタンと、選択中の「その日の調子」ボタンが見えないと報告があった。
//
// **色を変数にするなら、変数が無くても元の見た目に戻ること。**

test("配色の var() には必ずフォールバックがある", () => {
  const style = HTML.slice(HTML.indexOf("<style"), HTML.indexOf("</style>"));

  const bad = [];
  for (const m of style.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
    // 定義側（--x: ...）ではなく使用側だけを見る。`,` があればフォールバックあり。
    if (m[2] === ")") bad.push(m[1]);
  }

  assert.deepEqual(
    [...new Set(bad)],
    [],
    "フォールバックの無い var() がある。**変数が解決できないと背景が透明になり、" +
      "白文字のボタンが消える**（2026-08-28 に発生）:\n  " +
      [...new Set(bad)].join("\n  "),
  );
});

test("白文字のボタンの背景が、変数だけに依存していない", () => {
  // 保存ボタンは text-white。背景が落ちると**押せるのに見えない**状態になる。
  const style = HTML.slice(HTML.indexOf("<style"), HTML.indexOf("</style>"));
  const rule = style.match(/body \.bg-indigo-600,[\s\S]*?\}/);
  assert.ok(rule, "bg-indigo-600 の上書きが見つからない");
  assert.match(
    rule[0],
    /var\(--gp-accent,\s*#[0-9a-fA-F]{3,6}\)/,
    "bg-indigo-600 の背景にフォールバックが無い。保存ボタンが消える",
  );
});
