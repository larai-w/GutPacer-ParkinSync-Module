// Lambda ハンドラのスモークテスト。
// DynamoDB に到達しない経路と、注入した fake DB で userId 境界を検証する。
// 実行: npm test  (要: npm install)

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
const { handler: mvpApiHandler, createHandler } = await import("../backend/index-mvp.mjs");
const notifierModule = await import("../backend/notifier/index.mjs");
const { verifyLineIdToken } = await import("../backend/line-auth.mjs");

function createFakeDb(responses = {}) {
    const calls = [];
    return {
        calls,
        async send(command) {
            const name = command.constructor.name;
            calls.push({ name, input: command.input });
            if (responses[name]) return responses[name](command.input, calls);
            return {};
        }
    };
}

function authedMvpHandler(userId, db) {
    return createHandler({
        client: db,
        now: () => "2026-07-16T00:00:00.000Z",
        authenticate: async () => ({ userId, displayName: "Test User" })
    });
}

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

await test("MVP API: OPTIONS はLINEトークンなしで 200を返す", async () => {
    const res = await mvpApiHandler({ requestContext: { http: { method: "OPTIONS" } }, headers: {} });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["Access-Control-Allow-Headers"], /X-Line-Id-Token/);
});

await test("MVP API: LINEトークンなしのGETは 401", async () => {
    const res = await mvpApiHandler({ requestContext: { http: { method: "GET" } }, headers: {} });
    assert.equal(res.statusCode, 401);
});

await test("MVP API: GET は検証済みuserIdだけでQueryする", async () => {
    const db = createFakeDb({
        GetCommand: () => ({ Item: { userId: "U-verified", location: "home" } }),
        QueryCommand: () => ({
            Items: [
                { userId: "U-verified", fullDate: "2026-07-15" },
                { userId: "U-verified", fullDate: "2026-07-16" }
            ]
        })
    });
    const handler = authedMvpHandler("U-verified", db);
    const res = await handler({ requestContext: { http: { method: "GET" } }, headers: {} });
    assert.equal(res.statusCode, 200);
    const query = db.calls.find((call) => call.name === "QueryCommand");
    assert.equal(query.input.ExpressionAttributeValues[":userId"], "U-verified");
    assert.deepEqual(JSON.parse(res.body).logs.map((log) => log.fullDate), ["2026-07-16", "2026-07-15"]);
});

await test("MVP API: POST は本文のuserIdを信用せず検証済みuserIdで保存する", async () => {
    const db = createFakeDb({
        GetCommand: () => ({ Item: { userId: "U-verified", location: "home" } }),
        PutCommand: () => ({})
    });
    const handler = authedMvpHandler("U-verified", db);
    const res = await handler({
        requestContext: { http: { method: "POST" } },
        headers: {},
        body: JSON.stringify({ userId: "U-attacker", fullDate: "2026-07-16", notes: "test" })
    });
    assert.equal(res.statusCode, 200);
    const put = db.calls.find((call) => call.name === "PutCommand" && call.input.TableName === "gutpacer-logs-v2");
    assert.equal(put.input.Item.userId, "U-verified");
    assert.equal(put.input.Item.fullDate, "2026-07-16");
});

await test("MVP API: DELETE は検証済みuserIdとfullDateをキーにする", async () => {
    const db = createFakeDb({
        GetCommand: () => ({ Item: { userId: "U-verified", location: "home" } }),
        DeleteCommand: () => ({})
    });
    const handler = authedMvpHandler("U-verified", db);
    const res = await handler({
        requestContext: { http: { method: "DELETE" } },
        headers: {},
        queryStringParameters: { fullDate: "2026-07-16" }
    });
    assert.equal(res.statusCode, 200);
    const del = db.calls.find((call) => call.name === "DeleteCommand");
    assert.deepEqual(del.input.Key, { userId: "U-verified", fullDate: "2026-07-16" });
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

await test("LINE auth: 検証済みsubをuserIdとして返す", async () => {
    const result = await verifyLineIdToken("test-token", {
        channelId: "test-channel",
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ sub: "U-test", name: "Test User" })
        })
    });
    assert.deepEqual(result, {
        userId: "U-test",
        displayName: "Test User",
        pictureUrl: "",
        email: ""
    });
});

await test("LINE auth: subなしのトークンを拒否する", async () => {
    await assert.rejects(
        () => verifyLineIdToken("test-token", {
            channelId: "test-channel",
            fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
        }),
        /no user subject/
    );
});

await test("Public copy: 記録事実と未公開境界を守り治療指示を含めない", async () => {
    const paths = [
        "frontend/index.html",
        "frontend/privacy.html",
        "frontend/terms.html",
        "backend/notifier/index.mjs",
        "README.md"
    ];
    const copy = (await Promise.all(
        paths.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8"))
    )).join("\n");

    assert.doesNotMatch(copy, /浣腸してください|浣腸を検討|腸のペースを整える/);
    assert.match(copy, /最後の排便記録/);
    assert.match(copy, /単一家族/);
    assert.match(copy, /LINEログイン版は、運営者から個別に案内された場合/);
});

await test("Display prototype: 現行UIを含む4方向を静的データだけで比較できる", async () => {
    const prototype = await readFile(
        new URL("../prototypes/display-directions.html", import.meta.url),
        "utf8"
    );
    const directionButtons = prototype.match(/data-direction-button=/g) || [];

    assert.equal(directionButtons.length, 4);
    assert.match(prototype, /data-direction="current"/);
    assert.match(prototype, /現行UI（比較基準）/);
    assert.match(prototype, /やわらか標準/);
    assert.match(prototype, /親しみ表示/);
    assert.doesNotMatch(prototype, /config\.js|fetch\s*\(/);
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
