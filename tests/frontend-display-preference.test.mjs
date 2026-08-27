import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8"
);

// 表示の切り替え（issue #42・2026-08-27）
//
// 決定（DISPLAY_DIRECTION_EVALUATION.md 改訂版）:
//   既定は「事実中心」。事業所閲覧と PDF と同じ見た目にする。
//   親しみ表示は**家族の入力画面だけ**のオプトイン。既定オフ。
//
// **表示の好みが、保存されるものや共有されるものを変えてはいけない。**

test("既定は事実中心（親しみ表示ではない）", () => {
  // `:root` に既定の配色があり、friendly は別セレクタで上書きする形。
  assert.match(HTML, /:root\s*\{[^}]*--gp-accent:\s*#31556e/, "既定の配色が事実中心でない");
  assert.match(
    HTML,
    /body\[data-display="friendly"\]/,
    "親しみ表示が既定を上書きする形になっていない"
  );
});

test("親しみ表示は事業所閲覧に出さない", () => {
  // 共有される画面は、家族の表示設定に左右されない。
  assert.match(
    HTML,
    /body\[data-display="friendly"\]:not\(\.view-care\)/,
    "親しみ表示が事業所閲覧にも適用される。**共有画面が家族の好みで変わる**"
  );
});

test("PDF は常に標準で書き出す", () => {
  // 家族の好みが、ケアマネや看護師が受け取るものを変えてはいけない。
  assert.match(
    HTML,
    /document\.body\.dataset\.display = 'factual';/,
    "PDF 生成前に標準へ戻していない"
  );
  // 失敗しても元に戻すこと（家族の画面の設定を壊さない）
  const idx = HTML.indexOf("const displayBeforePdf");
  assert.ok(idx !== -1, "書き出し前の設定を控えていない");
  const after = HTML.slice(idx, idx + 4000);
  assert.match(after, /finally\s*\{[\s\S]{0,200}displayBeforePdf/, "finally で戻していない");
});

test("設定は端末だけに保存し、サーバーへ送らない", () => {
  // 表示の好みは記録ではない。API に混ぜない。
  assert.match(HTML, /DISPLAY_STORAGE_KEY\s*=\s*'gutpacer_display'/, "保存キーが無い");
  const idx = HTML.indexOf("function onDisplayToggle");
  const body = HTML.slice(idx, idx + 700);
  assert.ok(!/fetch\s*\(/.test(body), "切り替えでサーバーに送信している");
});

test("localStorage が使えなくても落ちない", () => {
  // プライベートモードなどで読み書きが例外になる環境がある。
  // **読めなければ既定で動く**こと。
  const load = HTML.slice(HTML.indexOf("function loadDisplaySetting"), HTML.indexOf("function onDisplayToggle"));
  assert.match(load, /try\s*\{/, "読み出しを try で囲っていない");
  assert.match(load, /return 'factual'/, "読めないときに既定へ倒していない");

  const toggle = HTML.slice(HTML.indexOf("function onDisplayToggle"), HTML.indexOf("function onDisplayToggle") + 700);
  assert.match(toggle, /try\s*\{[\s\S]{0,200}setItem/, "保存を try で囲っていない");
});

test("起動時に設定を当てる", () => {
  // 当てないと、設定しても次に開いたとき標準に戻る。
  const onload = HTML.slice(HTML.indexOf("window.onload"), HTML.indexOf("window.onload") + 600);
  assert.match(onload, /applyDisplaySetting\(loadDisplaySetting\(\)\)/, "起動時に当てていない");
});

test("切り替えのボタンに状態が出る", () => {
  // 見た目だけで状態を示さない。読み上げにも伝える。
  assert.match(HTML, /id="displayToggleBtn"[\s\S]{0,200}aria-pressed/, "aria-pressed が無い");
  assert.match(HTML, /btn\.setAttribute\('aria-pressed'/, "切り替え時に aria-pressed を更新していない");
});

test("記録の中身と書き出しの内容を変えない", () => {
  // 表示の設定が API の本文や書き出しに混ざっていないこと。
  assert.ok(
    !/JSON\.stringify\([^)]*display/.test(HTML),
    "表示設定を API 本文に混ぜている"
  );
  assert.ok(
    !/buildPdfReportHtml[\s\S]{0,400}dataset\.display/.test(HTML),
    "書き出しの中身が表示設定で変わる"
  );
});
