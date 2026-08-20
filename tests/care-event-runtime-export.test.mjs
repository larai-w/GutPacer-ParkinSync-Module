import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exportCareEvents } from "../backend/care-event-export.mjs";

const schema = JSON.parse(await readFile(new URL("../schema/care-event-v1.schema.json", import.meta.url)));
const fixture = JSON.parse(await readFile(new URL("./fixtures/gutpacer-synthetic.json", import.meta.url)));

function validateRuntimeEvent(event) {
    for (const field of schema.required) assert.ok(Object.hasOwn(event, field), `missing required field: ${field}`);
    assert.equal(event.schemaVersion, "care-event/v1");
    assert.ok(schema.properties.eventType.enum.includes(event.eventType));
    assert.ok(schema.properties.missingness.enum.includes(event.missingness));
    assert.ok(schema.properties.consentScope.enum.includes(event.consentScope));
    assert.match(event.localDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof event.payload, "object");
    assert.equal(event.provenance.source, "gutpacer");
    assert.equal(event.provenance.sourceRecordId.startsWith("daily-"), true);
    assert.equal(event.provenance.recordedAt, event.recordedAt);
    assert.equal(event.provenance.exportedAt, "2026-08-13T10:00:00+09:00");
}

test("the runtime care-event export is schema-shaped and preserves missingness", () => {
    const exported = exportCareEvents(fixture, "synthetic-household-001", "2026-08-13T10:00:00+09:00");
    assert.equal(exported.contract, "care-event/v1");
    assert.equal(exported.events.length, 6);
    exported.events.forEach(validateRuntimeEvent);

    const bowel = exported.events.filter((event) => event.eventType === "bowel_movement");
    assert.deepEqual(bowel.map((event) => event.missingness), ["observed", "confirmed_none", "confirmed_none"]);
    assert.ok(exported.events.some((event) => event.eventType === "movicol_taken"));
    assert.ok(exported.events.every((event) => !event.eventId.includes("synthetic-household-001")));
});

test("the runtime export is deterministic for the same snapshot", () => {
    const first = exportCareEvents(fixture, "synthetic-household-001", "2026-08-13T10:00:00+09:00");
    const second = exportCareEvents(fixture, "synthetic-household-001", "2026-08-13T10:00:00+09:00");
    assert.deepEqual(first, second);
});
