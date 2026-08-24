// 同意ゲートが起動のどの経路でも通ることを固定する。
//
// 2026-08-24 に本番で踏んだ穴: `checkConsent()` を `submitPin()` からだけ
// 呼んでいた。**一度PINを入れたあとは、再読み込みしても同意画面が出ない。**
// プライバシーポリシーのリンクを踏んで戻ってくるだけでゲートが素通りになり、
// 同意していないのにアプリが使えた。オーナーが実機で見つけた。
//
// 単体テストでは拾えない種類の穴なので、**起動経路の構造**を直接見る。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("frontend/index.html", "utf8");

/** window.onload の本体を取り出す。 */
function bootBody() {
    const start = html.indexOf("window.onload = async function()");
    assert.notEqual(start, -1, "window.onload が見つからない（起動処理が変わった可能性）");
    // 対応する閉じ括弧まで数える
    const from = html.indexOf("{", start);
    let depth = 0;
    for (let i = from; i < html.length; i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}") {
            depth--;
            if (depth === 0) return html.slice(from, i + 1);
        }
    }
    throw new Error("window.onload の終端が見つからない");
}

test("起動処理そのもので同意を確認している", () => {
    assert.match(
        bootBody(),
        /checkConsent\(\)/,
        "window.onload から checkConsent() を呼んでいない。" +
            "PIN 入力時だけの確認だと、2回目以降の起動でゲートが素通りになる",
    );
});

/** 行コメントを落とす。コメント内の文字列を呼び出しと数えないため。 */
function stripLineComments(src) {
    return src
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
}

test("記録を読み込む経路の数だけ、同意の確認がある", () => {
    const body = stripLineComments(bootBody());
    // fetchDataFromServer を呼ぶ = アプリを使わせる経路
    const loads = (body.match(/fetchDataFromServer\(/g) || []).length;
    const checks = (body.match(/checkConsent\(/g) || []).length;
    assert.ok(loads > 0, "起動処理で記録を読み込んでいない（検出が壊れている可能性）");
    assert.equal(
        checks,
        loads,
        `記録を読み込む経路が ${loads} 本あるのに、同意の確認は ${checks} 本しかない。` +
            "確認の無い経路がゲートの抜け道になる",
    );
});

test("PIN 入力の直後にも同意を確認している", () => {
    const start = html.indexOf("async function submitPin()");
    assert.notEqual(start, -1, "submitPin が見つからない");
    const body = html.slice(start, start + 1400);
    assert.match(body, /checkConsent\(\)/, "PIN 入力直後の確認が消えている");
});

test("同意画面のプライバシーポリシーは別タブで開く", () => {
    const start = html.indexOf('id="consentOverlay"');
    assert.notEqual(start, -1, "同意画面が見つからない");
    const overlay = html.slice(start, html.indexOf('id="pinOverlay"'));
    const link = overlay.match(/<a[^>]*privacy\.html[^>]*>/);
    assert.ok(link, "同意画面にプライバシーポリシーへのリンクが無い");
    assert.match(
        link[0],
        /target="_blank"/,
        "同じタブで開くと同意画面を離れてしまう。戻ってきたときに何が起きるかが経路依存になる",
    );
    assert.match(link[0], /rel="noopener"/, "target=_blank には rel=noopener を付ける");
});

test("同意画面は既定で隠れている（同意済みの人に出さない）", () => {
    const start = html.indexOf('id="consentOverlay"');
    const tag = html.slice(start, html.indexOf(">", start));
    assert.match(tag, /hidden/, "同意画面が既定で表示になっている");
});
