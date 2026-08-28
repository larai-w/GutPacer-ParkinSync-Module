import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8",
);
const STYLE = HTML.slice(HTML.indexOf("<style"), HTML.indexOf("</style>"));

// 親しみ表示を「配色だけ」から「着せ替え」にした（2026-08-28）。
// プロトタイプにあったマスコットを移植。
// **家族の入力画面だけ**に出す、が守るべき不変条件。

test("既定（事実中心）では出ない", () => {
  assert.match(STYLE, /\.gp-mascot\s*\{\s*display:\s*none/, "既定で非表示になっていない");
});

test("親しみ表示のときだけ出る", () => {
  assert.match(
    STYLE,
    /body\[data-display="friendly"\]\)?[^{]*\.gp-mascot\s*\{\s*display:\s*flex/,
    "親しみ表示で出る指定が無い",
  );
});

test("事業所閲覧には出さない", () => {
  // ⚠️ **外に見せる画面の見た目を変えない**（#42 の判断）。
  const rule = STYLE.match(/body\[data-display="friendly"\][^{]*\.gp-mascot\s*\{/);
  assert.ok(rule, "マスコットの表示ルールが見つからない");
  assert.match(
    rule[0],
    /:not\(\.view-care\)/,
    "事業所閲覧モードを除外していない。**事業所に見せる画面にマスコットが出る**",
  );
});

test("PDF には出ない（書き出し前に事実中心へ戻している）", () => {
  // マスコットは data-display に紐づくので、PDF 側の既存の戻し処理で自然に外れる。
  // **その戻し処理が消えると、PDF にマスコットが載る。**
  assert.match(
    HTML,
    /document\.body\.dataset\.display = 'factual';/,
    "PDF 書き出し前に事実中心へ戻していない。**PDF にマスコットが載る**",
  );
  assert.match(
    HTML,
    /if \(displayBeforePdf\) document\.body\.dataset\.display = displayBeforePdf;/,
    "PDF 書き出し後に表示設定を戻していない",
  );
});

test("記録の結果を評価する文言を使っていない", () => {
  // #42:「記録された結果に良し悪しの意味を与えない」。
  // 体調が悪い日に画面から評価されるのは、続ける力を削る。
  const block = HTML.slice(HTML.indexOf('class="gp-mascot'), HTML.indexOf('class="gp-mascot') + 600);
  for (const w of ["良い", "えらい", "すごい", "がんばり", "調子がいい", "できています"]) {
    assert.ok(!block.includes(w), `マスコットの文言に評価の語「${w}」が入っている`);
  }
});

test("入力欄と同じく、閲覧モードでは消える要素になっている", () => {
  const block = HTML.slice(HTML.indexOf('class="gp-mascot'), HTML.indexOf('class="gp-mascot') + 120);
  assert.match(block, /js-input-only/, "js-input-only が付いていない");
});
