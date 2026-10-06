import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const commands = source.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');

test('frontend deployment does not recursively remove S3 prefixes', () => {
    assert.doesNotMatch(commands, /\baws\s+s3\s+rm\b/);
});
test('frontend sync retains objects absent from the checkout', () => {
    assert.doesNotMatch(commands, /--delete\b/);
    assert.match(commands, /aws\s+s3\s+sync\s+"frontend\/"\s+"s3:\/\/veai-careready-frontend\/gutpacer\/"/);
});
test('deployment keeps runtime config and the beta prefix excluded', () => {
    assert.match(commands, /--exclude\s+"config\.js"/);
    assert.match(commands, /--exclude\s+"dev\/\*"/);
    assert.match(commands, /aws\s+cloudfront\s+create-invalidation/);
});
