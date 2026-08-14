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

const {
    handler: apiHandler,
    validateRecordTimeMetric,
    buildRecordTimeMetricItem,
    METRICS_TTL_SECONDS
} = await import("../backend/index.mjs");
const { handler: mvpApiHandler, createHandler } = await import("../backend/index-mvp.mjs");
const notifierModule = await import("../backend/notifier/index.mjs");
const { createNotifierHandler } = await import("../backend/notifier/index-mvp.mjs");
const { verifyLineIdToken } = await import("../backend/line-auth.mjs");
const { exportCareEvents } = await import("../backend/care-event-export.mjs");
const { exitCode: preflightExitCode } = await import("./beta-preflight.mjs");

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

await test("MVP API: 未招待のLINEユーザーはプロフィール作成前に403", async () => {
    const db = createFakeDb({ GetCommand: () => ({}) });
    const handler = authedMvpHandler("U-not-invited", db);
    const res = await handler({ requestContext: { http: { method: "GET" } }, headers: {} });
    assert.equal(res.statusCode, 403);
    assert.equal(db.calls.some((call) => call.name === "PutCommand"), false);
});

await test("MVP API: 明示的に招待されたLINEユーザーだけ初回プロフィールを作成", async () => {
    const db = createFakeDb({
        GetCommand: () => ({}),
        PutCommand: () => ({}),
        QueryCommand: () => ({ Items: [] })
    });
    const handler = createHandler({
        client: db,
        now: () => "2026-08-13T00:00:00.000Z",
        authenticate: async () => ({ userId: "U-invited" }),
        invitedUserIds: "U-invited"
    });
    const res = await handler({ requestContext: { http: { method: "GET" } }, headers: {} });
    assert.equal(res.statusCode, 200);
    const profilePut = db.calls.find((call) =>
        call.name === "PutCommand" && call.input.TableName === "gutpacer-users"
    );
    assert.equal(profilePut.input.Item.userId, "U-invited");
});

await test("MVP API: 正しい初回招待コードをハッシュ照合してプロフィールを作成", async () => {
    const db = createFakeDb({
        GetCommand: () => ({}),
        PutCommand: () => ({}),
        QueryCommand: () => ({ Items: [] })
    });
    const handler = createHandler({
        client: db,
        now: () => "2026-08-13T00:00:00.000Z",
        authenticate: async () => ({ userId: "U-code-invited" }),
        inviteCodeHash: "749c5b21dac895cc65b662352bccb1ba5aadbf658d7ad0c315539066f66c9b54"
    });
    const res = await handler({
        requestContext: { http: { method: "GET" } },
        headers: { "X-Invite-Code": "synthetic-invite" }
    });
    assert.equal(res.statusCode, 200);
    assert.ok(db.calls.some((call) => call.name === "PutCommand"));
});

await test("MVP API: 誤った招待コードは403でプロフィールを作らない", async () => {
    const db = createFakeDb({ GetCommand: () => ({}) });
    const handler = createHandler({
        client: db,
        authenticate: async () => ({ userId: "U-wrong-code" }),
        inviteCodeHash: "749c5b21dac895cc65b662352bccb1ba5aadbf658d7ad0c315539066f66c9b54"
    });
    const res = await handler({
        requestContext: { http: { method: "GET" } },
        headers: { "X-Invite-Code": "wrong" }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(db.calls.some((call) => call.name === "PutCommand"), false);
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

await test("MVP API: care-event/v1 export は認証済み世帯のQuery結果だけを返す", async () => {
    const db = createFakeDb({
        GetCommand: () => ({ Item: { userId: "U-verified", location: "home" } }),
        QueryCommand: () => ({
            Items: [{
                userId: "U-verified",
                fullDate: "2026-08-12",
                condition: 3,
                bowel: { amount: "中", type: "普通" },
                meds: { morning: true },
                notes: "synthetic note"
            }]
        })
    });
    const handler = authedMvpHandler("U-verified", db);
    const res = await handler({
        requestContext: { http: { method: "GET" } },
        headers: {},
        queryStringParameters: { format: "care-event-v1" }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.contract, "care-event/v1");
    assert.ok(body.events.length >= 3);
    assert.ok(body.events.every((event) => event.schemaVersion === "care-event/v1"));
    assert.doesNotMatch(res.body, /U-verified|X-Line-Id-Token|token/i);
});

await test("care-event/v1 export は日単位・欠測・メモの意味を保持する", async () => {
    const body = exportCareEvents([{
        fullDate: "2026-08-12",
        condition: 0,
        bowel: null,
        meds: {},
        notes: "synthetic note"
    }], "U-synthetic", "2026-08-13T00:00:00.000Z");
    const bowel = body.events.find((event) => event.eventType === "bowel_movement");
    const condition = body.events.find((event) => event.eventType === "daily_condition_logged");
    assert.equal(bowel.missingness, "confirmed_none");
    assert.equal(bowel.payload.timePrecision, "day");
    assert.equal(condition.payload.note, "synthetic note");
});

await test("API: 正しい PIN でも fullDate 欠落の POST は 400", async () => {
    const res = await apiHandler({
        requestContext: { http: { method: "POST" } },
        headers: { "x-pin": "1234" },
        body: JSON.stringify({ notes: "test" })
    });
    assert.equal(res.statusCode, 400);
});

await test("Metrics API: サーバー有効化なしでは 503", async () => {
    const res = await apiHandler({
        requestContext: { http: { method: "POST" } },
        headers: { "x-pin": "1234" },
        body: JSON.stringify({ action: "recordTime", product: "gutpacer", channel: "web", durationMs: 1200 })
    });
    assert.equal(res.statusCode, 503);
});

await test("Metrics contract: 最小ペイロードだけを受理", async () => {
    assert.deepEqual(
        validateRecordTimeMetric({ action: "recordTime", product: "gutpacer", channel: "web", durationMs: 1200 }),
        { metric: { product: "gutpacer", channel: "web", durationMs: 1200 } }
    );
    assert.equal(
        validateRecordTimeMetric({ action: "recordTime", product: "gutpacer", channel: "web", durationMs: 1200, recordId: "x" }).error,
        "Unexpected metric field"
    );
});

// RB-0015 の承認チェック#4 が要求する5項目のうち、認証・値域・TTL の3件。
await test("Metrics API: PIN なしの計測POSTは 401（認証は計測ゲートより先）", async () => {
    const res = await apiHandler({
        requestContext: { http: { method: "POST" } },
        headers: {},
        body: JSON.stringify({ action: "recordTime", product: "gutpacer", channel: "web", durationMs: 1200 })
    });
    assert.equal(res.statusCode, 401);
});

await test("Metrics contract: durationMs の値域外・非整数は拒否", async () => {
    const base = { action: "recordTime", product: "gutpacer", channel: "web" };
    for (const durationMs of [99, 3600001, 1200.5, NaN, null, undefined, "abc", {}]) {
        assert.equal(
            validateRecordTimeMetric({ ...base, durationMs }).error,
            "Invalid metric value",
            `durationMs=${String(durationMs)} が拒否されていない`
        );
    }
    // 境界値そのものは受理する
    for (const durationMs of [100, 3600000]) {
        assert.equal(validateRecordTimeMetric({ ...base, durationMs }).error, undefined);
    }
    // 数値化できる文字列は Number() で受理する（意図された挙動）。
    // ただし保存されるのは必ず数値で、クライアントの型は持ち込まない。
    const coerced = validateRecordTimeMetric({ ...base, durationMs: "1200" });
    assert.equal(coerced.error, undefined);
    assert.strictEqual(coerced.metric.durationMs, 1200);
});

await test("Metrics TTL: 保存 item は35日後に失効し、識別子を含まない（ADR-0007 制約3・6）", async () => {
    assert.equal(METRICS_TTL_SECONDS, 35 * 24 * 60 * 60);
    const now = new Date("2026-08-14T12:00:00.000Z");
    const item = buildRecordTimeMetricItem({ durationMs: 1200 }, now, "fixed-id");
    assert.equal(item.ttl, Math.floor(now.getTime() / 1000) + 35 * 24 * 60 * 60);
    // ブラックリスト: 記録本文やクライアント由来の識別子を持ち込まない
    for (const forbidden of ["recordId", "sessionId", "userId", "householdId", "memo", "bowel", "condition"]) {
        assert.equal(forbidden in item, false, `${forbidden} が item に混入している`);
    }
});

await test("Notifier: モジュールがロードでき handler が関数である", async () => {
    assert.equal(typeof notifierModule.handler, "function");
});

await test("MVP Notifier: ユーザーごとのキーで記録を確認し個別送信する", async () => {
    const db = createFakeDb({
        ScanCommand: () => ({
            Items: [
                { userId: "U-one", location: "home", notify: { remindAfterDays: 1, warnAfterDays: 2 } },
                { userId: "U-two", location: "facility", notify: { remindAfterDays: 1, warnAfterDays: 2 } }
            ]
        }),
        GetCommand: () => ({})
    });
    const sent = [];
    const handler = createNotifierHandler({
        client: db,
        now: () => new Date("2026-08-13T00:00:00Z"),
        sendLineMessage: async (userId) => sent.push(userId)
    });
    const res = await handler();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(sent, ["U-one"]);
    const gets = db.calls.filter((call) => call.name === "GetCommand");
    assert.ok(gets.length > 0);
    assert.ok(gets.every((call) => call.input.Key.userId === "U-one"));
});

await test("MVP Notifier: 1ユーザーの送信失敗後も他ユーザーを処理して失敗を通知する", async () => {
    const db = createFakeDb({
        ScanCommand: () => ({
            Items: [
                { userId: "U-fail", location: "home" },
                { userId: "U-ok", location: "home" }
            ]
        }),
        GetCommand: () => ({})
    });
    const attempted = [];
    const handler = createNotifierHandler({
        client: db,
        now: () => new Date("2026-08-13T00:00:00Z"),
        logger: { error() {} },
        sendLineMessage: async (userId) => {
            attempted.push(userId);
            if (userId === "U-fail") throw new Error("test failure");
        }
    });
    await assert.rejects(() => handler(), /1 user failure/);
    assert.deepEqual(attempted, ["U-fail", "U-ok"]);
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

await test("Beta preflight: BLOCKEDが1件でもあれば失敗終了する", async () => {
    assert.equal(preflightExitCode([{ status: "PASS" }]), 0);
    assert.equal(preflightExitCode([{ status: "PASS" }, { status: "BLOCKED" }]), 1);
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
