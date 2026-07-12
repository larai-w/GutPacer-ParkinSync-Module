// Lambda ハンドラのスモークテスト。
// DynamoDB に到達しない経路(CORS プリフライト / PIN 認証 / バリデーション)だけを検証する。
// 実行: npm test  (要: npm install)

import assert from "node:assert/strict";

process.env.ACCESS_PIN = "1234";

const results = [];

async function test(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
    } catch (e) {
        results.push({ name, ok: false, error: e.message });
    }
}

const { handler: apiHandler } = await import("../backend/index.mjs");
const notifierModule = await import("../backend/notifier/index.mjs");

await test("API: OPTIONS はPINなしで 200 を返す", async () => {
    const res = await apiHandler({ requestContext: { http: { method: "OPTIONS" } }, headers: {} });
    assert.equal(res.statusCode, 200);
});

await test("API: CORS ヘッダーが X-Pin を許可している", async () => {
    const res = await apiHandler({ requestContext: { http: { method: "OPTIONS" } }, headers: {} });
    assert.match(res.headers["Access-Control-Allow-Headers"], /X-Pin/);
});

await test("API: PIN なしの GET は 401", async () => {
    const res = await apiHandler({ requestContext: { http: { method: "GET" } }, headers: {} });
    assert.equal(res.statusCode, 401);
});

await test("API: 誤った PIN の GET は 401", async () => {
    const res = await apiHandler({
        requestContext: { http: { method: "GET" } },
        headers: { "x-pin": "0000" }
    });
    assert.equal(res.statusCode, 401);
});

await test("API: 正しい PIN でも fullDate 欠落の POST は 400", async () => {
    const res = await apiHandler({
        requestContext: { http: { method: "POST" } },
        headers: { "x-pin": "1234" },
        body: JSON.stringify({ notes: "test" })
    });
    assert.equal(res.statusCode, 400);
});

await test("Notifier: モジュールがロードでき handler が関数である", async () => {
    assert.equal(typeof notifierModule.handler, "function");
});

let failed = 0;
for (const r of results) {
    if (r.ok) {
        console.log(`  ✅ ${r.name}`);
    } else {
        failed++;
        console.error(`  ❌ ${r.name}: ${r.error}`);
    }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
