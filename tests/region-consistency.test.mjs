import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WF = join(ROOT, ".github", "workflows");

// 2026-08-28: us-east-1 → ap-northeast-1 へ移設した。
// 理由は要配慮個人情報（排便・服薬・体調）を国外に置いていたこと。
//
// ⚠️ **リージョンが混ざると、デプロイは成功するのに動かない。**
// 別リージョンの関数を更新しても本番は変わらず、
// テーブルは別リージョンから読めない（F-05 と同じ形）。

const files = readdirSync(WF).filter((f) => f.endsWith(".yml"));

test("デプロイ先のリージョンが東京に揃っている", () => {
  const stray = [];
  for (const f of files) {
    const src = readFileSync(join(WF, f), "utf8");
    for (const m of src.matchAll(/--region\s+([a-z0-9-]+)/g)) {
      if (m[1] !== "ap-northeast-1") stray.push(`${f}: --region ${m[1]}`);
    }
    for (const m of src.matchAll(/aws-region:\s*([a-z0-9-]+)/g)) {
      if (m[1] !== "ap-northeast-1") stray.push(`${f}: aws-region ${m[1]}`);
    }
  }
  assert.deepEqual(
    stray,
    [],
    "旧リージョンが残っている。**デプロイは成功するのに本番が変わらない**:\n  " + stray.join("\n  "),
  );
});

test("スクリプトの既定リージョンが東京", () => {
  // 移行スクリプト自身は「どこから移すか」を持つので対象外。
  const dir = join(ROOT, "scripts");
  const stray = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    if (f === "migrate-to-tokyo.mjs") continue;
    const src = readFileSync(join(dir, f), "utf8");
    // コメントは除き、既定値として書かれているものだけ見る
    for (const line of src.split("\n")) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      if (/us-east-1/.test(line)) stray.push(`${f}: ${line.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(stray, [], "スクリプトに旧リージョンが残っている:\n  " + stray.join("\n  "));
});
