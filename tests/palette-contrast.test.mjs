import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8",
);

// 2026-08-28: 配色をロゴ（#3f7d54 緑 / #e8961e オレンジ）基準に取り直した。
//
// ⚠️ **--gp-accent と --gp-accent-strong は、白文字のボタン背景に使う。**
// 明るい色を入れると**押せるのに読めない**ボタンになる。
// 実際、ロゴのオレンジ #e8961e をそのまま使おうとして 2.38:1 で断念した。
// 使う人には高齢の方も含まれる。ここは機械で止める。

function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastWithWhite(hex) {
  const l = luminance(hex);
  return (1.0 + 0.05) / (l + 0.05);
}

/** ブロック内の変数を拾う */
function varsIn(selector) {
  const m = HTML.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}"));
  assert.ok(m, `${selector} が見つからない`);
  const out = {};
  for (const v of m[0].matchAll(/(--gp-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[v[1]] = v[2];
  return out;
}

const AA = 4.5;

test("既定（事実中心）の主要色が、白文字で読める", () => {
  const v = varsIn(":root");
  for (const key of ["--gp-accent", "--gp-accent-strong"]) {
    const c = contrastWithWhite(v[key]);
    assert.ok(
      c >= AA,
      `${key} (${v[key]}) の白文字コントラストが ${c.toFixed(2)}:1。` +
        `**押せるのに読めないボタンになる**（AA は ${AA}:1）`,
    );
  }
});

test("親しみ表示の主要色が、白文字で読める", () => {
  const v = varsIn('body[data-display="friendly"]:not(.view-care)');
  for (const key of ["--gp-accent", "--gp-accent-strong"]) {
    const c = contrastWithWhite(v[key]);
    assert.ok(
      c >= AA,
      `${key} (${v[key]}) の白文字コントラストが ${c.toFixed(2)}:1（AA は ${AA}:1）`,
    );
  }
});

test("差し色（オレンジ）を、白文字の背景に使っていない", () => {
  // ロゴのオレンジは白文字と 2.38:1。**面には使えない。**
  // ロゴ自身も「緑が面、オレンジは小さな差し色」という使い方をしている。
  const style = HTML.slice(HTML.indexOf("<style"), HTML.indexOf("</style>"));
  const bgRules = style.match(/[^{}]*\{[^}]*background-color:\s*var\(--gp-highlight[^}]*\}/g) || [];
  assert.deepEqual(
    bgRules.filter((r) => !/\.gp-mascot/.test(r)),
    [],
    "差し色を背景に使っている箇所がある。**白文字が載ると読めなくなる**",
  );
});
