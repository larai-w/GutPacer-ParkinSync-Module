// care-event/v1 の契約定義とバリデーション。
//
// 本番の API 応答を組み立てるのは backend/care-event-export.mjs
// (exportCareEvents) のほうで、こちらは配線されていない。
// このモジュールは schema/care-event-v1.schema.json に対する
// 契約と検証 (世帯分離・決定性・日付や型の妥当性) を
// tests/care-event-contract.test.mjs で固定するために置いている。
// 両者を統合するかは未決。統合するまでは export 側が正。

import { createHash } from "node:crypto";

export const CARE_EVENT_SCHEMA_VERSION = "care-event/v1";
export const GUTPACER_EXPORT_VERSION = "gutpacer-care-event/1.0";
export const GUTPACER_TRANSFORM_VERSION = "gutpacer-export/1.0";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_PATTERN = /^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/;
const ISO_WITH_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MEDICATION_SLOTS = ["morning", "noon", "evening"];

function requireNonEmptyString(value, field) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`${field} is required`);
    }
    return value;
}

function requireIsoDateTime(value, field) {
    requireNonEmptyString(value, field);
    if (!ISO_WITH_OFFSET_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
        throw new TypeError(`${field} must be an ISO 8601 date-time with an offset`);
    }
    return value;
}

function requireLocalDate(value) {
    requireNonEmptyString(value, "record.fullDate");
    if (!DATE_PATTERN.test(value)) {
        throw new TypeError("record.fullDate must use YYYY-MM-DD");
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new TypeError("record.fullDate must be a real calendar date");
    }
    return value;
}

function requireServerContext(context) {
    if (!context || context.authenticated !== true) {
        throw new TypeError("authenticated server context is required");
    }
    return {
        householdId: requireNonEmptyString(context.householdId, "context.householdId"),
        patientId: requireNonEmptyString(context.patientId, "context.patientId"),
        exportedAt: requireIsoDateTime(context.exportedAt, "context.exportedAt"),
        timezoneOffset: (() => {
            const offset = requireNonEmptyString(context.timezoneOffset, "context.timezoneOffset");
            if (!OFFSET_PATTERN.test(offset)) {
                throw new TypeError("context.timezoneOffset must use +HH:MM or -HH:MM");
            }
            return offset;
        })()
    };
}

function eventId(sourceRecordId, kind, context) {
    const digest = createHash("sha256")
        .update(`gutpacer|${context.householdId}|${context.patientId}|${sourceRecordId}|${kind}`)
        .digest("hex")
        .slice(0, 20);
    return `gp-${digest}`;
}

function baseEvent(record, context, kind, eventType, payload, missingness) {
    const localDate = requireLocalDate(record.fullDate);
    const occurredAt = `${localDate}T00:00:00${context.timezoneOffset}`;
    const recordedAt = record.recordedAt || record.updatedAt || context.exportedAt;
    requireIsoDateTime(recordedAt, "record.recordedAt");

    return {
        schemaVersion: CARE_EVENT_SCHEMA_VERSION,
        eventId: eventId(localDate, kind, context),
        eventType,
        source: "gutpacer",
        patientId: context.patientId,
        careTeamId: context.householdId,
        actorRole: "caregiver",
        occurredAt,
        recordedAt,
        localDate,
        payload: { observedAtPrecision: "day", ...payload },
        missingness,
        provenance: {
            source: "gutpacer",
            sourceRecordId: `${localDate}#${kind}`,
            recordedAt,
            exportedAt: context.exportedAt,
            transformVersion: GUTPACER_TRANSFORM_VERSION
        },
        consentScope: "personal_review",
        exportVersion: GUTPACER_EXPORT_VERSION,
        correction: { status: "original" }
    };
}

function bowelEvent(record, context) {
    if (record.hasStool === true) {
        if (!record.bowel || typeof record.bowel !== "object" || Array.isArray(record.bowel)) {
            throw new TypeError("record.bowel is required when record.hasStool is true");
        }
        return baseEvent(record, context, "bowel", "bowel_movement", {
            amount: requireNonEmptyString(record.bowel.amount, "record.bowel.amount"),
            stoolType: requireNonEmptyString(record.bowel.type, "record.bowel.type"),
            enema: record.enema === true,
            manualHelp: record.manualHelp === true
        }, "observed");
    }
    if (record.hasStool === false) {
        return baseEvent(record, context, "bowel", "bowel_movement", {}, "confirmed_none");
    }
    return baseEvent(record, context, "bowel", "bowel_movement", {}, "not_recorded");
}

function medicationEvents(record, context) {
    if (record.meds === undefined || record.meds === null) return [];
    if (typeof record.meds !== "object" || Array.isArray(record.meds)) {
        throw new TypeError("record.meds must be an object");
    }
    const unknownSlots = Object.keys(record.meds).filter((slot) => !MEDICATION_SLOTS.includes(slot));
    if (unknownSlots.length > 0) {
        throw new TypeError(`record.meds has unsupported slots: ${unknownSlots.join(", ")}`);
    }
    return MEDICATION_SLOTS.flatMap((slot) => {
        const value = record.meds[slot];
        if (value === undefined || value === false) return [];
        if (value !== true) throw new TypeError(`record.meds.${slot} must be boolean`);
        return [baseEvent(record, context, `medication-${slot}`, "medication_taken", {
            medicationCode: "movicol",
            scheduleSlot: slot
        }, "observed")];
    });
}

function conditionEvent(record, context) {
    const hasCondition = record.condition !== undefined && record.condition !== null && record.condition !== 0;
    const note = typeof record.notes === "string" ? record.notes.trim() : "";
    if (record.notes !== undefined && typeof record.notes !== "string") {
        throw new TypeError("record.notes must be a string");
    }
    if (!hasCondition && note === "") return [];
    if (hasCondition && (!Number.isInteger(record.condition) || record.condition < 1 || record.condition > 5)) {
        throw new TypeError("record.condition must be an integer from 1 to 5");
    }
    const payload = {};
    if (hasCondition) payload.conditionScore = record.condition;
    if (note !== "") payload.note = note;
    return [baseEvent(record, context, "condition", "daily_condition_logged", payload, "observed")];
}

/**
 * Convert one current GutPacer daily record into care-event/v1 events.
 * The context must be created by authenticated server code, never from request JSON.
 */
export function exportGutPacerRecord(record, serverContext) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new TypeError("record must be an object");
    }
    const context = requireServerContext(serverContext);
    requireLocalDate(record.fullDate);
    return [
        bowelEvent(record, context),
        ...medicationEvents(record, context),
        ...conditionEvent(record, context)
    ];
}

export function exportGutPacerRecords(records, serverContext) {
    if (!Array.isArray(records)) throw new TypeError("records must be an array");
    return records.flatMap((record) => exportGutPacerRecord(record, serverContext));
}
