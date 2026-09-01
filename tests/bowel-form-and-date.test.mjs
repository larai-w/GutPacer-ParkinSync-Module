import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "index.html"),
  "utf8",
);
// 画面に出る部分だけを見る。<style>/<script> と、
// 経緯を書いた HTML コメントは対象外（利用者には見えない）。
const BODY = HTML
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<!--[\s\S]*?-->/g, "");

// 2026-09-01 オーナー指摘:
// 「普通（バナナ状・するっと）」は、**形**と**出しやすさ**を混ぜていた。
// バナナ状でもいきんで時間がかかることはあり、それがまさに困りごとなのに、
// 選ぶと「するっと出た」ことになってしまっていた。

test("状態の選択肢に出しやすさを混ぜない", () => {
  const easeWords = ["するっと", "スルッと", "すんなり", "らく", "楽に"];
  const found = easeWords.filter((w) => BODY.includes(w));
  assert.deepEqual(
    found,
    [],
    "状態（形）の選択肢に出しやすさの言葉が混ざっている。**出しやすさは stoolDifficult で別に持つ**",
  );
});

test("状態の保存値は変えない（過去データと比べられなくなる）", () => {
  // ラベルは直してよいが value は保存されて PDF・施設共有にも出る。
  for (const value of [
    "硬い（コロコロ）",
    "柔らかい（軟便）",
    "水っぽい（下痢）",
    "普通（バナナ状）",
  ]) {
    assert.ok(
      HTML.includes(`<option value="${value}">`),
      `保存値 ${value} が消えている。過去の記録と比較できなくなる`,
    );
  }
});

test("出にくさを、形とは別の項目として持つ", () => {
  assert.ok(
    HTML.includes('id="stoolDifficult"'),
    "出にくさのチェック欄が無い。形だけでは「バナナ状だが出にくかった」を記録できない",
  );
  assert.match(
    HTML,
    /difficult:\s*document\.getElementById\('stoolDifficult'\)\.checked/,
    "出にくさが保存されていない",
  );
});

test("古い記録を「出にくかった」にしない", () => {
  // difficult を持たない過去の記録は false 扱い。真偽が不明なものを
  // 「出にくかった」と表示すると、記録を偽ることになる。
  assert.match(
    HTML,
    /log\.bowel\.difficult === true/,
    "difficult の判定が厳密でない。undefined を truthy 側に倒さないこと",
  );
});

// 2026-09-01 オーナー指摘: 前日の記録に戻りにくい。
// 素の date ピッカーだと、前日を選ぶだけで数タップかかっていた。

test("前の日・今日にワンタップで移動できる", () => {
  assert.ok(BODY.includes("shiftLogDate(-1)"), "「前の日」ボタンが無い");
  assert.ok(BODY.includes("setLogDateToday()"), "「今日にする」ボタンが無い");
});

test("日付ボタンは 44px 以上の当たり判定を持つ", () => {
  // 片手・高齢の利用者が押す。小さいボタンを増やさない。
  const dateButtons = [...BODY.matchAll(/<button[^>]*onclick="(?:shiftLogDate|setLogDateToday)[^"]*"[^>]*>/g)]
    .map((m) => m[0]);
  assert.equal(dateButtons.length, 2, "日付ボタンが2つ見つからない");
  for (const btn of dateButtons) {
    assert.ok(btn.includes("min-h-11"), `当たり判定が小さい: ${btn}`);
  }
});

test("日付が空でも前の日を押して壊れない", () => {
  // input が空のまま押されると new Date("") で Invalid Date になる。
  assert.match(
    HTML,
    /input\.value \? new Date\(`\$\{input\.value\}T00:00:00`\) : new Date\(\)/,
    "空の日付に対する備えが無い",
  );
});
