/**
 * GutPacer Care-Event Export — Schema Validation Tests (Design Phase)
 *
 * Run: node --test event-export/validate-care-event.test.mjs
 *
 * This test file validates the care-event-schema.json contract and the
 * mapping rules defined in mapping-table.md. It does NOT touch any
 * production code, DynamoDB, or deployment artifacts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(join(__dirname, "care-event-schema.json"), "utf-8")
);

// ─── Minimal JSON Schema Validator (subset of draft 2020-12) ───────────────
// Covers: type, required, properties, additionalProperties, const, enum,
// pattern, minimum, maximum, maxLength, format (date-time basic check),
// allOf/if/then. Sufficient for this schema without external dependencies.

function validateSchema(instance, schemaNode, path = "$") {
  const errors = [];

  if (schemaNode.const !== undefined) {
    if (instance !== schemaNode.const) {
      errors.push(`${path}: expected const ${JSON.stringify(schemaNode.const)}, got ${JSON.stringify(instance)}`);
    }
    return errors;
  }

  if (schemaNode.enum !== undefined) {
    if (!schemaNode.enum.includes(instance)) {
      errors.push(`${path}: value ${JSON.stringify(instance)} not in enum [${schemaNode.enum.join(", ")}]`);
    }
    return errors;
  }

  if (schemaNode.type) {
    const typeValid = checkType(instance, schemaNode.type);
    if (!typeValid) {
      errors.push(`${path}: expected type ${schemaNode.type}, got ${typeof instance}`);
      return errors;
    }
  }

  if (schemaNode.pattern && typeof instance === "string") {
    if (!new RegExp(schemaNode.pattern).test(instance)) {
      errors.push(`${path}: string "${instance}" does not match pattern ${schemaNode.pattern}`);
    }
  }

  if (schemaNode.minimum !== undefined && typeof instance === "number") {
    if (instance < schemaNode.minimum) {
      errors.push(`${path}: ${instance} < minimum ${schemaNode.minimum}`);
    }
  }

  if (schemaNode.maximum !== undefined && typeof instance === "number") {
    if (instance > schemaNode.maximum) {
      errors.push(`${path}: ${instance} > maximum ${schemaNode.maximum}`);
    }
  }

  if (schemaNode.maxLength !== undefined && typeof instance === "string") {
    if (instance.length > schemaNode.maxLength) {
      errors.push(`${path}: string length ${instance.length} > maxLength ${schemaNode.maxLength}`);
    }
  }

  if (schemaNode.format === "date-time" && typeof instance === "string") {
    if (isNaN(Date.parse(instance))) {
      errors.push(`${path}: "${instance}" is not a valid date-time`);
    }
  }

  if (schemaNode.type === "object" && typeof instance === "object" && instance !== null && !Array.isArray(instance)) {
    // required
    if (schemaNode.required) {
      for (const key of schemaNode.required) {
        if (!(key in instance)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
    }

    // properties
    if (schemaNode.properties) {
      for (const [key, subSchema] of Object.entries(schemaNode.properties)) {
        if (key in instance) {
          errors.push(...validateSchema(instance[key], subSchema, `${path}.${key}`));
        }
      }
    }

    // additionalProperties
    if (schemaNode.additionalProperties === false && schemaNode.properties) {
      for (const key of Object.keys(instance)) {
        if (!(key in schemaNode.properties)) {
          errors.push(`${path}: unexpected property "${key}"`);
        }
      }
    }

    // allOf with if/then
    if (schemaNode.allOf) {
      for (const sub of schemaNode.allOf) {
        if (sub.if && sub.then) {
          const ifErrors = validateSchema(instance, sub.if, path);
          if (ifErrors.length === 0) {
            errors.push(...validateSchema(instance, sub.then, path));
          }
        } else {
          errors.push(...validateSchema(instance, sub, path));
        }
      }
    }
  }

  return errors;
}

function checkType(value, type) {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

function validateEvent(event) {
  return validateSchema(event, schema);
}

// ─── Mapping Logic (design-phase reference implementation) ──────────────────

const AMOUNT_MAP = {
  "小 (S)": "small",
  "中 (M)": "medium",
  "大 (L)": "large",
};

const TYPE_MAP = {
  "硬い（コロコロ）": "hard_pellet",
  "柔らかい（軟便）": "soft_loose",
  "水っぽい（下痢）": "watery_diarrhea",
  "普通（バナナ状）": "normal_banana",
};

function mapLogToEvent(log, { seq = 1, batchId = "gp-export-20260822T0930Z", consentGrantedAt = "2026-08-20T10:00:00+09:00" } = {}) {
  const fullDate = log.fullDate || "1970-01-01";
  const dateCompact = fullDate.replace(/-/g, "");
  const seqStr = String(seq).padStart(6, "0");
  const hashSuffix = simpleHash(fullDate + JSON.stringify(log)).slice(0, 8);

  const hasStool = Boolean(log.hasStool);
  const bowel = log.bowel || {};

  const payload = {
    log_date: fullDate,
    condition_score: Number.isInteger(log.condition) ? Math.min(5, Math.max(0, log.condition)) : 0,
    bowel: {
      has_stool: hasStool,
      ...(hasStool
        ? {
            amount: AMOUNT_MAP[bowel.amount] || "unknown",
            type_code: TYPE_MAP[bowel.type] || "unknown",
            type_label_ja: (bowel.type || "unknown").slice(0, 100),
          }
        : {}),
    },
    interventions: {
      enema: Boolean(log.enema),
      manual_evacuation: Boolean(log.manualHelp),
    },
    medication: {
      movicol: {
        morning: Boolean(log.meds?.morning),
        noon: Boolean(log.meds?.noon),
        evening: Boolean(log.meds?.evening),
      },
    },
    notes_present: Boolean(log.notes && log.notes.trim().length > 0),
    notes_redacted: Boolean(log.notes && log.notes.trim().length > 0),
  };

  return {
    schema_version: "gutpacer-care-event-v1",
    event_id: `gp-evt-${dateCompact}-${seqStr}-${hashSuffix}`,
    event_type: "care_log_recorded",
    occurred_at: `${fullDate}T00:00:00+09:00`,
    recorded_at: new Date().toISOString(),
    source: {
      product: "gutpacer",
      channel: "web",
      export_batch_id: batchId,
    },
    consent: {
      status: "granted",
      granted_at: consentGrantedAt,
      scope: "research_export_v1",
    },
    payload,
  };
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36).padStart(4, "a");
}

// ─── Sample Fixtures ────────────────────────────────────────────────────────

const FIXTURE_FULL = {
  fullDate: "2026-08-20",
  date: "8/20",
  condition: 4,
  hasStool: true,
  bowel: { amount: "中 (M)", type: "普通（バナナ状）" },
  enema: false,
  manualHelp: true,
  meds: { morning: true, noon: false, evening: true },
  notes: "お腹の張りはなさそう。夕食もよく食べた。",
};

const FIXTURE_EMPTY = {
  fullDate: "2026-08-21",
  date: "8/21",
  condition: 0,
  hasStool: false,
  bowel: null,
  enema: false,
  manualHelp: false,
  meds: { morning: false, noon: false, evening: false },
  notes: "",
};

const FIXTURE_UNKNOWN_AMOUNT = {
  fullDate: "2026-08-19",
  date: "8/19",
  condition: 3,
  hasStool: true,
  bowel: { amount: "超大 (XL)", type: "硬い（コロコロ）" },
  enema: true,
  manualHelp: false,
  meds: { morning: true, noon: true, evening: false },
  notes: "浣腸後に少量のみ。",
};

const FIXTURE_MISSING_BOWEL = {
  fullDate: "2026-08-18",
  date: "8/18",
  condition: 2,
  hasStool: true,
  bowel: null,
  enema: false,
  manualHelp: false,
  meds: { morning: false, noon: false, evening: true },
  notes: "",
};

const FIXTURE_MISSING_MEDS = {
  fullDate: "2026-08-17",
  date: "8/17",
  condition: 5,
  hasStool: false,
  bowel: null,
  enema: false,
  manualHelp: false,
  meds: undefined,
  notes: "   ",
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("care-event-schema.json structural integrity", () => {
  it("has correct $schema and title", () => {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.title, "GutPacer Care Event v1");
  });

  it("requires all envelope fields", () => {
    const required = schema.required;
    assert.ok(required.includes("schema_version"));
    assert.ok(required.includes("event_id"));
    assert.ok(required.includes("event_type"));
    assert.ok(required.includes("occurred_at"));
    assert.ok(required.includes("recorded_at"));
    assert.ok(required.includes("source"));
    assert.ok(required.includes("consent"));
    assert.ok(required.includes("payload"));
  });

  it("disallows additional properties at top level", () => {
    assert.equal(schema.additionalProperties, false);
  });

  it("payload requires all care fields", () => {
    const payloadRequired = schema.properties.payload.required;
    assert.ok(payloadRequired.includes("log_date"));
    assert.ok(payloadRequired.includes("condition_score"));
    assert.ok(payloadRequired.includes("bowel"));
    assert.ok(payloadRequired.includes("interventions"));
    assert.ok(payloadRequired.includes("medication"));
    assert.ok(payloadRequired.includes("notes_present"));
    assert.ok(payloadRequired.includes("notes_redacted"));
  });
});

describe("valid fixtures pass schema validation", () => {
  const fixtures = [
    ["full record", FIXTURE_FULL],
    ["empty record", FIXTURE_EMPTY],
    ["unknown amount", FIXTURE_UNKNOWN_AMOUNT],
    ["missing bowel object", FIXTURE_MISSING_BOWEL],
    ["missing meds", FIXTURE_MISSING_MEDS],
  ];

  for (const [name, fixture] of fixtures) {
    it(`${name} maps to a valid event`, () => {
      const event = mapLogToEvent(fixture);
      const errors = validateEvent(event);
      assert.deepEqual(errors, [], `Validation errors for ${name}: ${errors.join("; ")}`);
    });
  }
});

describe("invalid events are rejected", () => {
  it("rejects missing schema_version", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    delete event.schema_version;
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("schema_version")));
  });

  it("rejects wrong schema_version", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.schema_version = "gutpacer-care-event-v2";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
  });

  it("rejects invalid log_date format", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.payload.log_date = "2026/08/20";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("log_date")));
  });

  it("rejects condition_score out of range", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.payload.condition_score = 6;
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
  });

  it("rejects negative condition_score", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.payload.condition_score = -1;
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
  });

  it("rejects invalid bowel.amount enum", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.payload.bowel.amount = "extra_large";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
  });

  it("rejects unexpected top-level property", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.extra_field = "should not be here";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("extra_field")));
  });

  it("rejects notes text in payload", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.payload.notes_text = "お腹の張りはなさそう。";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("notes_text")));
  });

  it("rejects consent status other than granted", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.consent.status = "pending";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
  });

  it("rejects invalid event_id pattern", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    event.event_id = "invalid-id";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0);
  });
});

describe("mapping rules", () => {
  it("normalizes stool amount correctly", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    assert.equal(event.payload.bowel.amount, "medium");
  });

  it("normalizes unknown amount to unknown", () => {
    const event = mapLogToEvent(FIXTURE_UNKNOWN_AMOUNT);
    assert.equal(event.payload.bowel.amount, "unknown");
  });

  it("normalizes stool type correctly", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    assert.equal(event.payload.bowel.type_code, "normal_banana");
    assert.equal(event.payload.bowel.type_label_ja, "普通（バナナ状）");
  });

  it("handles hasStool true but bowel null defensively", () => {
    const event = mapLogToEvent(FIXTURE_MISSING_BOWEL);
    assert.equal(event.payload.bowel.has_stool, true);
    assert.equal(event.payload.bowel.amount, "unknown");
    assert.equal(event.payload.bowel.type_code, "unknown");
  });

  it("handles missing meds as all false", () => {
    const event = mapLogToEvent(FIXTURE_MISSING_MEDS);
    assert.deepEqual(event.payload.medication.movicol, {
      morning: false,
      noon: false,
      evening: false,
    });
  });

  it("preserves condition 0 as unset", () => {
    const event = mapLogToEvent(FIXTURE_EMPTY);
    assert.equal(event.payload.condition_score, 0);
  });

  it("clamps condition above 5 to 5", () => {
    const log = { ...FIXTURE_FULL, condition: 99 };
    const event = mapLogToEvent(log);
    assert.equal(event.payload.condition_score, 5);
  });

  it("maps whitespace-only notes as not present", () => {
    const event = mapLogToEvent(FIXTURE_MISSING_MEDS);
    assert.equal(event.payload.notes_present, false);
    assert.equal(event.payload.notes_redacted, false);
  });
});

describe("privacy: no free-text leakage", () => {
  it("never includes notes content in serialized event", () => {
    const sensitiveNote = "患者名: 山田太郎、要介護3、特養入所中";
    const log = { ...FIXTURE_FULL, notes: sensitiveNote };
    const event = mapLogToEvent(log);
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes(sensitiveNote));
    assert.ok(!serialized.includes("山田太郎"));
    assert.ok(event.payload.notes_present === true);
    assert.ok(event.payload.notes_redacted === true);
  });

  it("does not include PIN or auth tokens", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes("x-pin"));
    assert.ok(!serialized.includes("X-Pin"));
    assert.ok(!serialized.includes("ACCESS_PIN"));
  });

  it("does not include DynamoDB table names", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes("gutpacer-logs"));
    assert.ok(!serialized.includes("gutpacer-settings"));
  });
});

describe("deterministic event_id", () => {
  it("same input produces same event_id", () => {
    const event1 = mapLogToEvent(FIXTURE_FULL, { seq: 1 });
    const event2 = mapLogToEvent(FIXTURE_FULL, { seq: 1 });
    assert.equal(event1.event_id, event2.event_id);
  });

  it("different seq produces different event_id", () => {
    const event1 = mapLogToEvent(FIXTURE_FULL, { seq: 1 });
    const event2 = mapLogToEvent(FIXTURE_FULL, { seq: 2 });
    assert.notEqual(event1.event_id, event2.event_id);
  });

  it("event_id matches schema pattern", () => {
    const event = mapLogToEvent(FIXTURE_FULL);
    const pattern = new RegExp(schema.properties.event_id.pattern);
    assert.ok(pattern.test(event.event_id), `event_id "${event.event_id}" should match pattern`);
  });
});

describe("consent gate (design rule)", () => {
  it("records without granted consent must not produce valid events", () => {
    // This test documents the rule: the consent.status const is "granted",
    // so any other value will fail validation. In production, the export
    // pipeline must filter before reaching this point.
    const event = mapLogToEvent(FIXTURE_FULL);
    event.consent.status = "denied";
    const errors = validateEvent(event);
    assert.ok(errors.length > 0, "denied consent should fail schema validation");
  });
});