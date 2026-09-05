import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8",
);

test("保存後に確認カードを表示する", () => {
  assert.match(HTML, /id="saveConfirmation"[^>]*role="status"/, "保存確認がステータスとして通知されない");
  assert.match(HTML, /aria-live="polite"/, "保存確認が読み上げ対象になっていない");
  assert.match(HTML, /showSaveConfirmation\(logEntry\)/, "保存成功時に確認カードを表示していない");
});

test("確認カードは保存した日付・排便・服薬を要約する", () => {
  const start = HTML.indexOf("function showSaveConfirmation");
  const body = HTML.slice(start, start + 1800);
  assert.match(body, /logEntry\.fullDate/, "保存日が確認表示に含まれていない");
  assert.match(body, /logEntry\.hasStool/, "排便の有無が確認表示に含まれていない");
  assert.match(body, /logEntry\.meds/, "服薬内容が確認表示に含まれていない");
  assert.match(body, /textContent/, "要約をtextContentで表示していない");
});

test("確認カードに結果の評価語を使わない", () => {
  const start = HTML.indexOf('id="saveConfirmation"');
  const block = HTML.slice(start, start + 500);
  for (const word of ["良い", "えらい", "すごい", "がんばり", "順調"]) {
    assert.ok(!block.includes(word), `保存結果を評価する語「${word}」が入っている`);
  }
});
