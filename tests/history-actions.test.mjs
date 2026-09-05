import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8",
);

test("履歴の編集・削除ボタンは44px以上のタップ領域を持つ", () => {
  const edit = HTML.match(/<button[^>]*loadLogByDate\([^>]+>[\s\S]*?<\/button>/);
  const remove = HTML.match(/<button[^>]*deleteLog\([^>]+>[\s\S]*?<\/button>/);
  assert.ok(edit, "履歴の編集ボタンが見つからない");
  assert.ok(remove, "履歴の削除ボタンが見つからない");
  assert.match(edit[0], /min-h-11/, "編集ボタンの高さが44px未満");
  assert.match(remove[0], /min-h-11/, "削除ボタンの高さが44px未満");
});

test("履歴アクションのラベルは残す", () => {
  assert.match(HTML, /loadLogByDate\([\s\S]*?編集[\s\S]*?<\/button>/, "編集ラベルが無い");
  assert.match(HTML, /deleteLog\([\s\S]*?削除[\s\S]*?<\/button>/, "削除ラベルが無い");
});
