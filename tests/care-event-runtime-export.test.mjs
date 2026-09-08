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
    assert.deepEqual(bowel.map((event) => event.missingness), ["observed", "confirmed_none", "not_recorded"]);
    assert.ok(exported.events.some((event) => event.eventType === "movicol_taken"));
    const medicationEvent = exported.events.find((event) => event.eventType === "movicol_taken");
    assert.equal(medicationEvent.payload.medicationRef, "med-movicol");
    assert.equal(Object.hasOwn(medicationEvent.payload, "medicationName"), false);
    assert.ok(exported.events.every((event) => !event.eventId.includes("synthetic-household-001")));
});

test("the runtime export is deterministic for the same snapshot", () => {
    const first = exportCareEvents(fixture, "synthetic-household-001", "2026-08-13T10:00:00+09:00");
    const second = exportCareEvents(fixture, "synthetic-household-001", "2026-08-13T10:00:00+09:00");
    assert.deepEqual(first, second);
});

test("legacy no-stool values are not treated as confirmed absence", () => {
    for (const record of [
        { hasStool: false, bowel: null },
        { hasStool: false },
        { bowelConfirmedNone: "true" },
        { hasStool: true, bowel: null, bowelConfirmedNone: true },
    ]) {
        const result = exportCareEvents([{ fullDate: "2026-09-08", ...record }], "synthetic");
        assert.equal(result.events[0].missingness, "not_recorded");
        assert.deepEqual(result.events[0].payload, { timePrecision: "day" });
    }
});

test("explicit absence survives export and observations take precedence", () => {
    const result = exportCareEvents([
        { fullDate: "2026-09-07", hasStool: false, bowel: null, bowelConfirmedNone: true },
        { fullDate: "2026-09-08", hasStool: true, bowel: { amount: "小 (S)", type: "普通（バナナ状）" }, bowelConfirmedNone: true },
    ], "synthetic");
    assert.deepEqual(result.events.map(x => x.missingness), ["confirmed_none", "observed"]);
    assert.equal(result.events[1].provenance.transformVersion, "gutpacer-care-event/1.1");
});
