import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "backend", "index.mjs"), "utf8");

// 2026-08-26 の実測でレイテンシ p95 が 984ms（SLO 500ms）だった。
// 原因はバーストの2番目のリクエスト——そのコンテナで最初の DynamoDB 呼び出しが、
// 認証情報の解決と TLS 確立を request 経路で払っていた。
// 初期化フェーズへ移したので、その形が崩れないよう固定する。

test("温めは、参照する定数より後に書かれている", () => {
    // **最初にこれを間違えた。** `SETTINGS_TABLE` より前に置いたので
    // TDZ の ReferenceError になり、catch がそれを飲み込んで
    // **温めが黙って効かない**状態になった。テストは通り、本番だけ遅いまま。
    const constPos = SRC.indexOf('const SETTINGS_TABLE =');
    const warmPos = SRC.indexOf('settingKey: "__warmup__"');
    assert.ok(constPos !== -1, "SETTINGS_TABLE の宣言が見つからない");
    assert.ok(warmPos !== -1, "温めが無い");
    assert.ok(
        warmPos > constPos,
        "温めが SETTINGS_TABLE の宣言より前にある。TDZ で落ち、catch に飲まれて黙って効かなくなる"
    );
});

test("温めの失敗が関数全体を止めない", () => {
    // モジュール読み込みで例外が出ると Init Error になり、**関数が起動しない**。
    // 2026-08-20 に Medication Promise がこれで6日間止まった。
    const warmPos = SRC.indexOf('settingKey: "__warmup__"');
    const after = SRC.slice(warmPos, warmPos + 400);
    assert.match(after, /\}\s*catch/, "温めが try/catch で囲まれていない");
});

test("温めは Lambda の中でだけ走る", () => {
    // ローカルのテストや開発でネットワークを叩きにいかない。
    const warmPos = SRC.indexOf('settingKey: "__warmup__"');
    const before = SRC.slice(Math.max(0, warmPos - 600), warmPos);
    assert.match(
        before,
        /process\.env\.AWS_LAMBDA_FUNCTION_NAME/,
        "AWS_LAMBDA_FUNCTION_NAME で囲われていない。テスト実行中に AWS を叩く"
    );
});

test("温めは読むだけで、書き込み系のコマンドを使わない", () => {
    // 副作用のある温めは、それ自体が事故のもと。
    const warmPos = SRC.indexOf('settingKey: "__warmup__"');
    const block = SRC.slice(Math.max(0, warmPos - 300), warmPos + 200);
    for (const forbidden of ["PutCommand", "DeleteCommand", "BatchWriteCommand", "UpdateCommand"]) {
        assert.ok(
            !block.includes(forbidden),
            `温めに ${forbidden} を使っている。読むだけにすること`
        );
    }
    assert.ok(block.includes("GetCommand"), "温めが GetCommand を使っていない");
});

test("AWS に届かなくてもモジュールは読み込める", async () => {
    // **これが本題。** 上の3つは形の確認で、これは挙動の確認。
    // 到達できない先を向けて、それでも import が例外を投げないことを見る。
    const saved = { ...process.env };
    process.env.AWS_LAMBDA_FUNCTION_NAME = "gutpacer-backend-test";
    process.env.AWS_ENDPOINT_URL = "http://127.0.0.1:1";   // 必ず接続拒否される
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "testing";
    process.env.AWS_SECRET_ACCESS_KEY = "testing";
    process.env.AWS_MAX_ATTEMPTS = "1";
    try {
        // クエリ文字列でモジュールキャッシュを避ける
        const mod = await import(`../backend/index.mjs?warmup-probe=${Date.now()}`);
        assert.equal(typeof mod.handler, "function", "handler が取れない");
    } finally {
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
    }
});
