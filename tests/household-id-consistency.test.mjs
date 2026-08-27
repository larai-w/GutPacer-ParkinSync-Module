import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// 世帯 id の既定値が複数のファイルに書かれている。
//
// **わざと複製している。** 通知の Lambda は `index.mjs` 1枚を root に置く
// zip なので、`../profile-defaults.mjs` を import すると**実行時に
// 解決できず Init Error で止まる**。2026-08-20 に Medication Promise が
// 同じ形で6日間止まり、2026-08-24 に GutPacer の consent.mjs でも起きた。
//
// 複製するなら、**ずれないことを縛る**。ずれると、同じ家の記録が
// 別々の世帯に入って**見えなくなる**。

const FILES = [
  "backend/index.mjs",
  "backend/profile-defaults.mjs",
  "backend/notifier/index-mvp.mjs",
];

function defaultsIn(src) {
  // `|| "household:..."` の形で書かれた既定値を拾う
  return [...src.matchAll(/\|\|\s*"(household:[^"]+)"/g)].map((m) => m[1]);
}

test("世帯 id の既定値が全ファイルで一致する", () => {
  const found = {};
  for (const f of FILES) {
    const vals = defaultsIn(read(f));
    assert.ok(vals.length > 0, `${f} に世帯 id の既定値が無い`);
    found[f] = [...new Set(vals)];
  }
  const all = [...new Set(Object.values(found).flat())];
  assert.equal(
    all.length, 1,
    `世帯 id の既定値がずれている: ${JSON.stringify(found)}\n` +
    "ずれると、同じ家の記録が別々の世帯に入って見えなくなる",
  );
});

test("通知は relative import で共有モジュールを読まない", () => {
  // **zip に入らない形の import を作らない。**
  const src = read("backend/notifier/index-mvp.mjs");
  const relImports = [...src.matchAll(/^import .* from "(\.\.?\/[^"]+)"/gm)].map((m) => m[1]);
  const outside = relImports.filter((p) => p.startsWith("../"));
  assert.deepEqual(
    outside, [],
    `通知が上位ディレクトリを import している (${outside.join(", ")})。` +
    "zip は index.mjs 1枚を root に置くので、実行時に解決できず Init Error になる",
  );
});
