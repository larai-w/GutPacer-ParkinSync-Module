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
//   事業所閲覧モード（?view=care）を **localStorage に保存していた。**
//   家族の端末で一度でも開くと、閉じても戻らない。
//   閲覧モードでは入力欄と保存ボタンが全部消えるので、
//   **「記録できない」という形で現れる。**
//
// → sessionStorage に置く。**タブを閉じれば家族表示に戻る。**

test("閲覧モードを localStorage に保存しない", () => {
  assert.ok(
    !/localStorage\.setItem\(CARE_VIEW_KEY/.test(HTML),
    "閲覧モードを localStorage に保存している。**端末に残り続け、家族が記録できなくなる**",
  );
  assert.match(
    HTML,
    /sessionStorage\.setItem\(CARE_VIEW_KEY/,
    "閲覧モードの保存に sessionStorage を使っていない",
  );
});

test("旧版が localStorage に書いた値を消す", () => {
  // **移行を忘れると、既に詰まっている端末は詰まったまま。**
  assert.match(
    HTML,
    /localStorage\.removeItem\(CARE_VIEW_KEY\)/,
    "旧版の localStorage の値を消していない。**既に閲覧モードで固まった端末が戻らない**",
  );
});

test("家族表示へ戻す導線がある", () => {
  assert.match(HTML, /onclick="switchToFamilyView\(\)"/, "戻すボタンが無い");
  assert.match(HTML, /body\.view-care #careViewBanner\s*\{\s*display:\s*flex/,
    "閲覧モードでバナーが出ない。**戻り方が分からなくなる**");
});

test("保存に失敗しても落ちない", () => {
  // プライベートウィンドウ等で sessionStorage が読めないことがある。
  // **表示だけの設定なので、記録を巻き込んではいけない。**
  const store = HTML.slice(HTML.indexOf("const viewStore"), HTML.indexOf("function applyViewMode"));
  assert.ok(store.length > 0, "viewStore が見つからない");
  assert.equal(
    (store.match(/catch/g) || []).length >= 3,
    true,
    "viewStore の読み書きが try/catch で守られていない",
  );
});
