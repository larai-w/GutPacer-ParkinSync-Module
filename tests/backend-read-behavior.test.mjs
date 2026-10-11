// Synthetic core-API behavior checks. All DynamoDB sends are intercepted.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const send = mock.method(DynamoDBDocumentClient.prototype, "send", async () => {
    throw new Error("Unexpected DynamoDB command");
});
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.ACCESS_PIN = "synthetic-pin";
process.env.HOUSEHOLD_ID = "synthetic-group";
const { handler, MAX_FAILED_ATTEMPTS } = await import("../backend/index.mjs");

function request(pin = "synthetic-pin") {
    return {
        requestContext: { http: { method: "GET", sourceIp: "192.0.2.10" } },
        headers: { "x-pin": pin },
    };
}

function fakeDb({ attempt, logs, location, failLocation = false, failLogs = false } = {}) {
    const calls = [];
    send.mock.mockImplementation(async (command) => {
        const name = command.constructor.name;
        const input = command.input;
        calls.push({ name, input });
        if (name === "GetCommand" && input.Key.settingKey.startsWith("pinfail#")) {
            return attempt ? { Item: attempt } : {};
        }
        if (name === "QueryCommand") {
            assert.equal(input.ExpressionAttributeValues[":household"], "synthetic-group");
            if (failLogs) throw new Error("Synthetic records read failure");
            return logs ?? { Items: [] };
        }
        if (name === "GetCommand" && input.Key.settingKey === "location") {
            if (failLocation) throw new Error("Synthetic settings read failure");
            return location ?? { Item: { value: "home" } };
        }
        if (name === "DeleteCommand" || name === "UpdateCommand") return {};
        throw new Error("Unexpected DynamoDB command");
    });
    return calls;
}

test("successful GET without failure history makes no cleanup write", async () => {
    const calls = fakeDb();
    const response = await handler(request());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { logs: [], location: "home" });
    assert.deepEqual(calls.map((call) => call.name), ["GetCommand", "QueryCommand", "GetCommand"]);
});

test("successful GET clears existing failure history before reading records", async () => {
    const calls = fakeDb({ attempt: { count: 1, expiresAt: Date.now() / 1000 + 900 } });
    assert.equal((await handler(request())).statusCode, 200);
    assert.deepEqual(calls.map((call) => call.name), ["GetCommand", "DeleteCommand", "QueryCommand", "GetCommand"]);
    assert.equal(calls[1].input.Key.settingKey, "pinfail#192.0.2.10");
});

test("locked GET does not read records or clear failure history even with the correct PIN", async () => {
    const calls = fakeDb({ attempt: { count: MAX_FAILED_ATTEMPTS, expiresAt: Date.now() / 1000 + 900 } });
    assert.equal((await handler(request())).statusCode, 429);
    assert.deepEqual(calls.map((call) => call.name), ["GetCommand"]);
});

test("incorrect PIN records failure without reading records or location", async () => {
    const calls = fakeDb();
    assert.equal((await handler(request("synthetic-wrong"))).statusCode, 401);
    assert.deepEqual(calls.map((call) => call.name), ["GetCommand", "UpdateCommand"]);
});

test("GET starts both reads before either finishes and waits for both", async () => {
    let finishLogs, finishLocation;
    const logs = new Promise((resolve) => { finishLogs = resolve; });
    const location = new Promise((resolve) => { finishLocation = resolve; });
    const calls = fakeDb({ logs, location });
    let finished = false;
    const pending = handler(request()).then((response) => { finished = true; return response; });
    try {
        await new Promise(setImmediate);
        assert.deepEqual(calls.map((call) => call.name), ["GetCommand", "QueryCommand", "GetCommand"]);
        assert.equal(finished, false);
        finishLogs({ Items: [] });
        await new Promise(setImmediate);
        assert.equal(finished, false, "Response returned before settings completed");
        finishLocation({ Item: { value: "home" } });
        const response = await pending;
        assert.equal(response.statusCode, 200);
        assert.deepEqual(JSON.parse(response.body), { logs: [], location: "home" });
    } finally {
        finishLogs({ Items: [] });
        finishLocation({});
        await pending;
    }
});

test("settings read failure preserves successfully read records with the default location", async () => {
    const records = [{ fullDate: "2035-01-14" }, { fullDate: "2035-01-15" }];
    fakeDb({ failLocation: true, logs: { Items: records } });
    const response = await handler(request());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
        logs: [{ fullDate: "2035-01-15" }, { fullDate: "2035-01-14" }], location: "home",
    });
});

test("records read failure returns an error instead of an empty successful history", async () => {
    fakeDb({ failLogs: true });
    assert.equal((await handler(request())).statusCode, 500);
});
