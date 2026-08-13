import { createHash } from "node:crypto";

const SOURCE = "gutpacer";
const EXPORT_VERSION = "gutpacer-export/1.0";
const TRANSFORM_VERSION = "gutpacer-care-event/1.0";

function digest(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function dayTimestamp(localDate) {
    return `${localDate}T23:59:00+09:00`;
}

function validTimestamp(value, fallback) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

export function exportCareEvents(logs, userId, exportedAt = new Date().toISOString()) {
    const subject = `household-${digest(userId)}`;
    const events = [];

    function addEvent(log, suffix, eventType, payload, missingness = "observed") {
        const occurredAt = dayTimestamp(log.fullDate);
        const recordedAt = validTimestamp(log.updatedAt || log.createdAt, occurredAt);
        const sourceRecordId = `daily-${digest(`${userId}|${log.fullDate}`)}`;
        events.push({
            schemaVersion: "care-event/v1",
            eventId: `gp-${digest(`${sourceRecordId}|${suffix}`)}`,
            eventType,
            source: SOURCE,
            patientId: subject,
            careTeamId: subject,
            actorRole: "caregiver",
            occurredAt,
            recordedAt,
            localDate: log.fullDate,
            payload: { ...payload, timePrecision: "day" },
            missingness,
            provenance: {
                source: SOURCE,
                sourceRecordId,
                recordedAt,
                exportedAt,
                transformVersion: TRANSFORM_VERSION
            },
            consentScope: "personal_review",
            exportVersion: EXPORT_VERSION
        });
    }

    for (const log of logs) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(log.fullDate || "")) continue;

        addEvent(
            log,
            "bowel",
            "bowel_movement",
            log.bowel ? {
                amount: log.bowel.amount ?? null,
                stoolType: log.bowel.type ?? null,
                enema: Boolean(log.enema),
                manualHelp: Boolean(log.manualHelp)
            } : {},
            log.bowel ? "observed" : "confirmed_none"
        );

        if (Number(log.condition) > 0 || log.notes) {
            addEvent(log, "condition", "daily_condition_logged", {
                conditionScore: Number(log.condition) > 0 ? Number(log.condition) : null,
                note: log.notes || ""
            });
        }

        for (const [slot, taken] of Object.entries(log.meds || {})) {
            if (taken) addEvent(log, `movicol-${slot}`, "movicol_taken", {
                medicationName: "モビコール",
                slot
            });
        }
    }

    return {
        contract: "care-event/v1",
        exportVersion: EXPORT_VERSION,
        exportedAt,
        timezone: "Asia/Tokyo",
        events
    };
}
