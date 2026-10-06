import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Evaluate the checks with synthetic CLI responses; never use AWS or credentials.
const source = readFileSync(new URL('../scripts/beta-preflight.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function awsChecks() {');
const end = source.indexOf('\nexport function exitCode', start);
assert.ok(start >= 0 && end > start);

async function checks(missingKey = false) {
    const results = [];
    const calls = [];
    function awsJson(args) {
        if (args[0] === 'lambda') {
            calls.push(args);
            const query = args[args.indexOf('--query') + 1];
            if (!args.includes('--query')) throw new Error('Unprojected Lambda configuration');
            if (query === '{State:State,LastUpdateStatus:LastUpdateStatus}') {
                return { State: 'Active', LastUpdateStatus: 'Successful' };
            }
            assert.equal(query, '{EnvironmentKeys:keys(Environment.Variables || `{}`)}');
            return { EnvironmentKeys: missingKey ? [] : ['LINE_CHANNEL_ACCESS_TOKEN'] };
        }
        if (args[0] === 'dynamodb') return {
            ContinuousBackupsDescription: {
                PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'ENABLED' }
            }
        };
        if (args[0] === 'events') return { State: 'ENABLED', ScheduleExpression: 'cron(0 23 * * ? *)' };
        if (args[0] === 'cloudwatch') return { MetricAlarms: ['gutpacer-mvp-dev', 'gutpacer-notifier'].map(name => ({
            Namespace: 'AWS/Lambda', MetricName: 'Errors', StateValue: 'OK',
            Dimensions: [{ Name: 'FunctionName', Value: name }]
        })) };
        return {};
    }
    async function check(name, fn) {
        try { results.push({ name, status: 'PASS', detail: await fn() }); }
        catch (error) { results.push({ name, status: 'BLOCKED', detail: error.message }); }
    }
    await new Function('awsJson', 'check', `${source.slice(start, end)}; return awsChecks();`)(awsJson, check);
    assert.equal(calls.length, 3);
    return results;
}

for (const name of ['Lambda health: gutpacer-mvp-dev', 'Lambda health: gutpacer-notifier', 'Notifier secret is configured']) {
    test(`${name} uses projected metadata`, async () => {
        const row = (await checks()).find(row => row.name === name);
        assert.equal(row.status, 'PASS', row.detail);
    });
}
test('missing notifier key stays blocked without fetching values', async () => {
    const rows = await checks(true);
    assert.equal(rows.find(row => row.name === 'Notifier secret is configured').status, 'BLOCKED');
    assert.ok(rows.filter(row => row.name.startsWith('Lambda health:')).every(row => row.status === 'PASS'));
});
