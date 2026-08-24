// 同意文言が、法が求める要素を落としていないことを固定する。
//
// 2026-08-24: GutPacer には文言のテストが無く、**C-04（同意しない場合に
// 不利益がないことの明示）が最初から抜けていた。** 短縮しようとして初めて
// 気づいた。Medication Promise 側は要素IDを持たせて機械で見ていたので
// 同じ守りを入れる。
//
// 文言は人が書き換える。書き換えたときに「撤回方法の記載が消えた」
// 「任意性の説明が消えた」を検知できないと、公開されたあと誰も気づかない。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("frontend/index.html", "utf8");

/** 同意画面の中身を切り出す。 */
function overlay() {
    const start = html.indexOf('id="consentOverlay"');
    assert.notEqual(start, -1, "同意画面が見つからない");
    return html.slice(start, html.indexOf('id="pinOverlay"'));
}

/** data-req ごとの本文を取り出す。 */
function sections() {
    const out = {};
    for (const m of overlay().matchAll(
        /<section data-req="([^"]+)">\s*<h3[^>]*>([^<]+)<\/h3>\s*<p>([^<]+)<\/p>/g,
    )) {
        out[m[1]] = { heading: m[2], body: m[3] };
    }
    return out;
}

// COMP-01 §2.1 の必須要素。
// C-01 利用目的 / C-02 取得データ範囲 / C-03 第三者提供 / C-04 任意性 /
// C-05 撤回方法 / C-06 同意の記録 / C-07 要配慮の特別同意
const REQUIRED = ["C-01", "C-02", "C-03", "C-04", "C-05", "C-07"];

test("必須要素がすべて画面に出ている", () => {
    const s = sections();
    for (const r of REQUIRED) {
        assert.ok(s[r], `必須要素 ${r} の記載が無い`);
    }
});

test("要配慮個人情報であることの明示（C-07）がある", () => {
    const s = sections()["C-07"];
    assert.match(s.body, /配慮/, "要配慮であることが読み取れない");
    assert.match(s.body, /同意/, "事前同意の説明が無い");
});

test("任意性（C-04）が明示されている", () => {
    // ここが 2026-08-24 まで抜けていた。
    const s = sections()["C-04"];
    assert.match(s.body, /不利益/, "同意しない場合に不利益が無いことが書かれていない");
});

test("撤回方法（C-05）が具体的に書いてある", () => {
    const s = sections()["C-05"];
    assert.match(s.body, /削除/, "撤回の手段が書かれていない");
});

test("第三者提供（C-03）は「しない」と言い切っている", () => {
    // 言い回しではなく言い切っているかを見る（一字一句だと短縮で落ちる）。
    assert.match(sections()["C-03"].body, /第三者へ[^。]*提供しません/);
});

test("どの節も空でなく、短すぎない", () => {
    for (const [req, s] of Object.entries(sections())) {
        assert.ok(s.heading.trim().length > 0, `${req} の見出しが空`);
        assert.ok(s.body.trim().length > 10, `${req} の本文が短すぎる`);
    }
});

test("効能効果をうたう表現を混ぜない", () => {
    const banned = ["治る", "治療", "改善します", "予防できます", "診断"];
    for (const [req, s] of Object.entries(sections())) {
        for (const w of banned) {
            assert.ok(!s.body.includes(w), `${req} に「${w}」が入っている`);
        }
    }
});

test("スマホで読める長さに収める", () => {
    // 読まれない同意文は、同意を取っていることにならない。
    const total = Object.values(sections()).reduce(
        (n, s) => n + s.heading.length + s.body.length,
        0,
    );
    assert.ok(total > 0, "本文が取れていない（検出が壊れている可能性）");
    assert.ok(
        total <= 450,
        `同意文が ${total} 字。スマホで数画面ぶんスクロールする。詳細はプライバシーポリシーへ寄せる`,
    );
});

test("文言を変えたら版も上がる仕組みになっている", () => {
    const consent = readFileSync("backend/consent.mjs", "utf8");
    const m = consent.match(/CONSENT_TEXT_VERSION = ['"]([^'"]+)['"]/);
    assert.ok(m, "CONSENT_TEXT_VERSION が無い");
    assert.match(m[1], /^\d{4}-\d{2}-\d{2}(-\d+)?$/, `版の形が違う: ${m[1]}`);
});
