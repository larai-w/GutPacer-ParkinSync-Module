import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    CARE_EVENT_SCHEMA_VERSION,
    GUTPACER_EXPORT_VERSION,
    exportGutPacerRecords
} from "../backend/care-event-contract.mjs";

const schema = JSON.parse(await readFile(new URL("../schema/care-event-v1.schema.json", import.meta.url)));
const fixture = JSON.parse(await readFile(new URL("./fixtures/gutpacer-synthetic.json", import.meta.url)));
const context = Object.freeze({
    authenticated: true,
    householdId: "synthetic-household-001",
    patientId: "synthetic-patient-001",
    timezoneOffset: "+09:00",
    exportedAt: "2026-08-13T10:00:00+09:00"
});

function validateAgainstCareEventSchema(event) {
    for (const field of schema.required) {
        assert.ok(Object.hasOwn(event, field), `missing required field: ${field}`);
    }
    assert.deepEqual(
        Object.keys(event).filter((field) => !Object.hasOwn(schema.properties, field)),
        [],
        "top-level additional properties are forbidden"
    );
    assert.equal(event.schemaVersion, schema.properties.schemaVersion.const);
    assert.ok(schema.properties.eventType.enum.includes(event.eventType));
    assert.ok(schema.properties.missingness.enum.includes(event.missingness));
    assert.ok(schema.properties.consentScope.enum.includes(event.consentScope));
    assert.match(event.localDate, new RegExp(schema.properties.localDate.pattern));
    assert.equal(typeof event.payload, "object");
    for (const field of schema.properties.provenance.required) {
        assert.ok(Object.hasOwn(event.provenance, field), `missing provenance field: ${field}`);
    }
    assert.deepEqual(
        Object.keys(event.provenance).filter(
            (field) => !Object.hasOwn(schema.properties.provenance.properties, field)
        ),
        [],
        "provenance additional properties are forbidden"
    );
}

test("synthetic records produce schema-valid care-event/v1 events", () => {
    const events = exportGutPacerRecords(fixture, context);
    assert.equal(events.length, 6);
    events.forEach(validateAgainstCareEventSchema);
    assert.ok(events.every((event) => event.schemaVersion === CARE_EVENT_SCHEMA_VERSION));
    assert.ok(events.every((event) => event.exportVersion === GUTPACER_EXPORT_VERSION));
});

test("bowel presence, confirmed none, and missing record stay distinct", () => {
    const events = exportGutPacerRecords(fixture, context);
    const bowel = events.filter((event) => event.eventType === "bowel_movement");
    assert.deepEqual(bowel.map((event) => event.missingness), ["observed", "confirmed_none", "not_recorded"]);
    assert.equal(bowel[0].payload.observedAtPrecision, "day");
});

test("unchecked medication slots do not become missed doses", () => {
    const events = exportGutPacerRecords(fixture, context);
    const medications = events.filter((event) => event.eventType === "medication_taken");
    assert.deepEqual(medications.map((event) => event.payload.scheduleSlot), ["morning", "evening"]);
    assert.ok(events.every((event) => event.eventType !== "medication_missed"));
});

test("authenticated household context is mandatory and never read from the record", () => {
    const recordWithInjectedBoundary = { ...fixture[0], householdId: "attacker-household" };
    assert.throws(() => exportGutPacerRecords([recordWithInjectedBoundary], undefined), /authenticated server context/);
    assert.throws(
        () => exportGutPacerRecords([recordWithInjectedBoundary], { ...context, householdId: "" }),
        /context.householdId/
    );
    const [event] = exportGutPacerRecords([recordWithInjectedBoundary], context);
    assert.equal(event.careTeamId, context.householdId);
});

test("event IDs are deterministic and do not contain household or patient IDs", () => {
    const first = exportGutPacerRecords(fixture, context);
    const second = exportGutPacerRecords(fixture, context);
    const otherHousehold = exportGutPacerRecords(fixture, {
        ...context,
        householdId: "synthetic-household-002",
        patientId: "synthetic-patient-002"
    });
    assert.deepEqual(first.map((event) => event.eventId), second.map((event) => event.eventId));
    assert.notDeepEqual(first.map((event) => event.eventId), otherHousehold.map((event) => event.eventId));
    for (const event of first) {
        assert.ok(!event.eventId.includes(context.householdId));
        assert.ok(!event.eventId.includes(context.patientId));
    }
});

test("invalid dates and ambiguous source values fail closed", () => {
    assert.throws(() => exportGutPacerRecords([{ ...fixture[0], fullDate: "2026-02-30" }], context), /real calendar date/);
    assert.throws(() => exportGutPacerRecords([{ ...fixture[0], hasStool: true, bowel: null }], context), /record.bowel/);
    assert.throws(() => exportGutPacerRecords([{ ...fixture[0], condition: 9 }], context), /record.condition/);
    assert.throws(
        () => exportGutPacerRecords([{ ...fixture[0], meds: { morning: "yes" } }], context),
        /must be boolean/
    );
});
