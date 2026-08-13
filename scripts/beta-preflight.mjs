#!/usr/bin/env node

// Read-only closed-beta readiness check.
//
// Local checks run by default. Network and AWS checks are opt-in so pull requests and
// developer machines do not unexpectedly contact production systems.
//
//   npm run beta:preflight
//   npm run beta:preflight -- --online
//   npm run beta:preflight -- --online --aws

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REGION = process.env.GUTPACER_AWS_REGION || "us-east-1";
const PRODUCTION_URL = process.env.GUTPACER_PRODUCTION_URL || "https://veai.jp/gutpacer/";
const BETA_URL = process.env.GUTPACER_BETA_URL || "https://veai.jp/gutpacer/dev/";
const BETA_API_URL = process.env.GUTPACER_BETA_API_URL ||
    "https://3cxmfovepd6mwir4a5jxwtotf40ojdia.lambda-url.us-east-1.on.aws/";

const RESULTS = [];

function record(status, name, detail) {
    RESULTS.push({ status, name, detail });
}

function run(command, args) {
    return spawnSync(command, args, {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, AWS_MAX_ATTEMPTS: process.env.AWS_MAX_ATTEMPTS || "1" },
        timeout: 20_000,
        stdio: ["ignore", "pipe", "pipe"]
    });
}

async function check(name, fn) {
    try {
        const detail = await fn();
        record("PASS", name, detail);
    } catch (error) {
        record("BLOCKED", name, error.message);
    }
}

function requireCommand(command, args, successDetail) {
    const result = run(command, args);
    if (result.status !== 0) {
        if (result.error?.code === "ETIMEDOUT") throw new Error("command timed out after 20 seconds");
        const lastLine = (result.stderr || result.stdout || "command failed")
            .trim().split("\n").at(-1);
        throw new Error(lastLine);
    }
    return successDetail;
}

async function expectHttp(url, expectedStatus) {
    const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(10_000)
    });
    if (response.status !== expectedStatus) {
        throw new Error(`expected HTTP ${expectedStatus}, received ${response.status}`);
    }
    return `HTTP ${response.status}`;
}

function awsJson(args) {
    const result = run("aws", [
        ...args, "--region", REGION, "--output", "json",
        "--cli-connect-timeout", "5", "--cli-read-timeout", "10"
    ]);
    if (result.status !== 0) {
        if (result.error?.code === "ETIMEDOUT") throw new Error("AWS check timed out after 20 seconds");
        const message = (result.stderr || "AWS command failed").trim().split("\n").at(-1);
        throw new Error(message);
    }
    return JSON.parse(result.stdout);
}

async function localChecks() {
    await check("Automated smoke tests", () =>
        requireCommand("node", ["scripts/smoke-test.mjs"], "all tests passed"));
    await check("Public-repository boundary", () =>
        requireCommand("python3", ["scripts/check_public_repo.py", "--working-tree"],
            "tracked and untracked files passed"));
}

async function onlineChecks() {
    await check("Production frontend", () => expectHttp(PRODUCTION_URL, 200));
    await check("Closed-beta frontend", () => expectHttp(BETA_URL, 200));
    await check("Closed-beta API rejects anonymous access", () => expectHttp(BETA_API_URL, 401));
    await check("Dependency audit", () =>
        requireCommand("npm", ["audit", "--audit-level=high"], "no high severity findings"));
}

async function awsChecks() {
    await check("AWS credentials", () => {
        awsJson(["sts", "get-caller-identity"]);
        return "available (identity intentionally not printed)";
    });

    for (const tableName of [
        "gutpacer-logs", "gutpacer-settings", "gutpacer-logs-v2", "gutpacer-users"
    ]) {
        await check(`DynamoDB PITR: ${tableName}`, () => {
            const output = awsJson([
                "dynamodb", "describe-continuous-backups", "--table-name", tableName
            ]);
            const status = output.ContinuousBackupsDescription
                ?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
            if (status !== "ENABLED") throw new Error(`PITR is ${status || "unknown"}`);
            return "enabled";
        });
    }

    for (const functionName of ["gutpacer-mvp-dev", "gutpacer-notifier"]) {
        await check(`Lambda health: ${functionName}`, () => {
            const output = awsJson([
                "lambda", "get-function-configuration", "--function-name", functionName
            ]);
            if (output.State !== "Active" || output.LastUpdateStatus !== "Successful") {
                throw new Error(`state=${output.State}, lastUpdate=${output.LastUpdateStatus}`);
            }
            return "active; last update successful";
        });
    }

    await check("Notifier secret is configured", () => {
        const output = awsJson([
            "lambda", "get-function-configuration", "--function-name", "gutpacer-notifier"
        ]);
        const keys = Object.keys(output.Environment?.Variables || {});
        if (!keys.includes("LINE_CHANNEL_ACCESS_TOKEN")) {
            throw new Error("LINE_CHANNEL_ACCESS_TOKEN environment key is missing");
        }
        return "environment key exists (value intentionally not read or printed)";
    });

    await check("Daily notifier schedule", () => {
        const output = awsJson([
            "events", "describe-rule", "--name", "gutpacer-daily-8am-jst"
        ]);
        if (output.State !== "ENABLED") throw new Error(`schedule is ${output.State}`);
        if (output.ScheduleExpression !== "cron(0 23 * * ? *)") {
            throw new Error(`unexpected schedule: ${output.ScheduleExpression}`);
        }
        return "enabled at 08:00 JST";
    });

    for (const functionName of ["gutpacer-mvp-dev", "gutpacer-notifier"]) {
        await check(`CloudWatch error alarm: ${functionName}`, () => {
            const output = awsJson(["cloudwatch", "describe-alarms", "--alarm-types", "MetricAlarm"]);
            const match = (output.MetricAlarms || []).find((alarm) =>
                alarm.Namespace === "AWS/Lambda" && alarm.MetricName === "Errors" &&
                (alarm.Dimensions || []).some((dimension) =>
                    dimension.Name === "FunctionName" && dimension.Value === functionName));
            if (!match) throw new Error("no Lambda Errors alarm found");
            return `configured; state=${match.StateValue}`;
        });
    }
}

export function exitCode(results) {
    return results.some((result) => result.status === "BLOCKED") ? 1 : 0;
}

async function main() {
    const args = new Set(process.argv.slice(2));
    const unknown = [...args].filter((arg) => !["--online", "--aws", "--json"].includes(arg));
    if (unknown.length) {
        console.error(`Unknown option(s): ${unknown.join(", ")}`);
        process.exitCode = 2;
        return;
    }

    await localChecks();
    if (args.has("--online") || args.has("--aws")) await onlineChecks();
    if (args.has("--aws")) await awsChecks();

    const humanChecks = [
        "Confirm the LINE access token was rotated after the exposure event",
        "Review the latest migration evidence and verify aggregate readback counts",
        "Complete the real-phone login/read/create/edit/delete/PDF/logout/location walkthrough",
        "Confirm one test notification reaches only the intended LINE account",
        "Obtain owner approval before LINE environment promotion or public release"
    ];

    if (args.has("--json")) {
        console.log(JSON.stringify({ results: RESULTS, humanChecks }, null, 2));
    } else {
        console.log("\nGutPacer closed-beta preflight");
        for (const result of RESULTS) {
            console.log(`[${result.status}] ${result.name}: ${result.detail}`);
        }
        console.log("\n[HUMAN] Required before release");
        humanChecks.forEach((item) => console.log(`- ${item}`));
        const passed = RESULTS.filter((result) => result.status === "PASS").length;
        const blocked = RESULTS.length - passed;
        console.log(`\nResult: ${passed} passed, ${blocked} blocked`);
    }
    process.exitCode = exitCode(RESULTS);
}

const invokedDirectly = process.argv[1] &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) await main();
