// 全データ削除を「偶然は押せない」形に保つ。
//
// 2026-08-24 オーナー指摘: 設定を上から見ていく途中に赤いボタンが置かれていて
// 「いずれ押してしまいそう」。合言葉は**押したあと**の守りでしかない。
// 押す前に、開くという操作を1つ挟む。
//
// あわせて prompt() をやめた。ブラウザによってはブロックされることがあり、
// その場合**削除がまったくできなくなる**（COMP-01 C-05 の撤回導線が成立しない）。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("frontend/index.html", "utf8");

/** 削除まわりの markup を切り出す。 */
function deleteSection() {
    const start = html.indexOf('id="deleteAllDetails"');
    assert.notEqual(start, -1, "削除セクションが <details> になっていない");
    const end = html.indexOf("</details>", start);
    return html.slice(start, end);
}

/** onDeleteAllData の本体を切り出す。 */
function deleteHandler() {
    const start = html.indexOf("async function onDeleteAllData()");
    assert.notEqual(start, -1, "onDeleteAllData が見つからない");
    return html.slice(start, start + 2200);
}

test("削除は折りたたみの中にあり、既定で閉じている", () => {
    const tag = html.slice(html.indexOf('<details id="deleteAllDetails"'), html.indexOf(">", html.indexOf('<details id="deleteAllDetails"')) + 1);
    assert.ok(!/\bopen\b/.test(tag), "<details> が既定で開いている。スクロール中に見えてしまう");
});

test("削除ボタンは既定で押せない", () => {
    const section = deleteSection();
    const btn = section.slice(section.indexOf('id="deleteAllBtn"'));
    const tagEnd = btn.indexOf(">");
    assert.match(
        btn.slice(0, tagEnd),
        /disabled/,
        "ボタンが既定で有効になっている。開いた直後に押せてしまう",
    );
});

test("合言葉の入力欄があり、入力のたびに判定している", () => {
    const section = deleteSection();
    assert.match(section, /id="deleteAllConfirm"/, "合言葉の入力欄が無い");
    assert.match(section, /oninput="onDeleteAllConfirmInput\(\)"/, "入力のたびに判定していない");
    assert.match(section, /DELETE-ALL/, "何を入力するのかが画面に出ていない");
});

test("削除に prompt() を使わない", () => {
    assert.ok(
        !/prompt\s*\(/.test(deleteHandler()),
        "削除フローで prompt() を使っている。ブロックされる環境で削除できなくなる",
    );
});

test("ボタンの disabled だけに頼らず、実行時にも合言葉を見る", () => {
    // disabled は DOM から外せる。UI の状態だけを頼りにしない。
    assert.match(
        deleteHandler(),
        /!==\s*DELETE_ALL_CONFIRMATION/,
        "実行時の合言葉チェックが無い",
    );
});

test("実行後に合言葉を残さない", () => {
    const body = deleteHandler();
    assert.match(body, /input\.value\s*=\s*''/, "入力欄を空に戻していない。次に開くと1タップで消せてしまう");
    assert.match(body, /btn\.disabled\s*=\s*true/, "実行後にボタンを無効へ戻していない");
});

test("元に戻せないことが画面に書いてある", () => {
    const section = deleteSection();
    assert.match(section, /元に戻せません/, "取り返しがつかないことが書かれていない");
});

test("サーバ側の合言葉チェックは残っている（画面だけの守りにしない）", () => {
    const backend = readFileSync("backend/index.mjs", "utf8");
    assert.match(backend, /validateDeleteAllRequest|DELETE_ALL_CONFIRMATION/, "サーバ側の検証が消えている");
});
