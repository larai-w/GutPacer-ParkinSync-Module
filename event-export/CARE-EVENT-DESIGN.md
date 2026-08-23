# GutPacer Care-Event Export Design

Version: draft-v1
Date: 2026-08-22
Status: Design only — no implementation code, no deploy

## 1. Purpose

GutPacer records daily bowel movements, medication (Movicol), physical interventions (enema/manual evacuation), and free-form notes for a care recipient. This design defines a **versioned care-event export contract** so that:

1. GutPacer can export its records as synthetic/research-friendly events.
2. ParkinSync (or future research stores) can ingest these events **without direct DB coupling**.
3. The export remains auditable, consent-gated, and reversible at the policy level.

This is a **design-only deliverable**. No production code changes, no push, no deploy.

## 2. Scope and Non-Goals

### In scope

- Event envelope schema (`gutpacer-care-event-v1`).
- Mapping from existing `gutpacer-logs` DynamoDB item to event payload.
- Versioned export contract (JSON Lines or JSON array).
- Test plan: schema validation, property-based tests, sample fixtures.
- Consent and provenance metadata.

### Non-goals

- No EHR/FHIR server integration.
- No diagnosis, treatment recommendation, or medical claims.
- No cross-user aggregation in this phase.
- No real-time streaming; batch export only.
- No changes to existing Lambda or frontend behavior.

## 3. Relationship to ParkinSync

Per task requirement: **GutPacer must not directly couple to ParkinSync's DB**.

```
┌─────────────┐       versioned export        ┌─────────────────┐
│  GutPacer   │  ───────────────────────────▶ │   ParkinSync    │
│  DynamoDB   │   gutpacer-care-event-v1      │  event ingest   │
│ gutpacer-logs│   (JSON Lines / S3 object)   │  (future)       │
└─────────────┘                               └─────────────────┘
```

- GutPacer owns the export file/object.
- ParkinSync consumes via a documented contract, not by reading GutPacer tables.
- Schema version is embedded in every event; breaking changes require a new version string.

## 4. Existing Data Model (as observed)

From `backend/index.mjs` and `frontend/index.html`, a log item has:

| Field | Type | Notes |
|---|---|---|
| `fullDate` | string (PK) | `YYYY-MM-DD` |
| `date` | string | Display format `M/D` |
| `condition` | number | 0–5 (0 = unset) |
| `hasStool` | boolean | |
| `bowel` | object \| null | `{ amount, type }` when hasStool |
| `bowel.amount` | string | `小 (S)`, `中 (M)`, `大 (L)` |
| `bowel.type` | string | Japanese stool description |
| `enema` | boolean | Enema performed |
| `manualHelp` | boolean | Manual evacuation assistance |
| `meds` | object | `{ morning, noon, evening }` booleans |
| `notes` | string | Free text |

Settings table stores `location` (`home` | `facility`) but is **not** part of care-event export in v1 (see unresolved points).

## 5. Event Envelope Schema (v1)

Every exported event uses this envelope:

```json
{
  "schema_version": "gutpacer-care-event-v1",
  "event_id": "gp-evt-20260822-000001-<suffix>",
  "event_type": "care_log_recorded",
  "occurred_at": "2026-08-22T09:30:00+09:00",
  "recorded_at": "2026-08-22T09:31:12.345Z",
  "source": {
    "product": "gutpacer",
    "channel": "web",
    "export_batch_id": "gp-export-20260822T0930Z"
  },
  "consent": {
    "status": "granted",
    "granted_at": "2026-08-20T10:00:00+09:00",
    "scope": "research_export_v1"
  },
  "payload": { ... }
}
```

### 5.1 Envelope fields

| Field | Required | Description |
|---|---|---|
| `schema_version` | yes | Fixed `gutpacer-care-event-v1` for this version. |
| `event_id` | yes | Deterministic-ish ID: `gp-evt-<fullDate compact>-<seq>-<suffix>`. |
| `event_type` | yes | v1 only defines `care_log_recorded`. |
| `occurred_at` | yes | The date being recorded, at a conventional time (see unresolved point). |
| `recorded_at` | yes | ISO 8601 timestamp when the log was saved (if available). |
| `source.product` | yes | Fixed `gutpacer`. |
| `source.channel` | yes | Fixed `web` in current implementation. |
| `source.export_batch_id` | yes | Identifies the export run. |
| `consent.status` | yes | `granted` required for export; otherwise record is skipped. |
| `consent.granted_at` | yes | When consent was given. |
| `consent.scope` | yes | `research_export_v1`. |
| `payload` | yes | Care event content (below). |

## 6. Payload Schema

```json
{
  "log_date": "2026-08-22",
  "condition_score": 4,
  "bowel": {
    "has_stool": true,
    "amount": "medium",
    "type_code": "normal_banana",
    "type_label_ja": "普通（バナナ状）"
  },
  "interventions": {
    "enema": false,
    "manual_evacuation": true
  },
  "medication": {
    "movicol": {
      "morning": true,
      "noon": false,
      "evening": true
    }
  },
  "notes_redacted": false,
  "notes_present": true
}
```

### 6.1 Field rules

- `log_date`: from `fullDate`, must match `^\d{4}-\d{2}-\d{2}$`.
- `condition_score`: integer 0–5. `0` means "not set" and must be preserved as-is (do not impute).
- `bowel.has_stool`: boolean from `hasStool`.
- `bowel.amount`: normalized enum `small | medium | large | unknown`.
  - `小 (S)` → `small`
  - `中 (M)` → `medium`
  - `大 (L)` → `large`
  - missing/other → `unknown`
- `bowel.type_code`: normalized enum (see mapping table).
- `bowel.type_label_ja`: original Japanese label for human review.
- `interventions.enema`: boolean from `enema`.
- `interventions.manual_evacuation`: boolean from `manualHelp`.
- `medication.movicol.*`: booleans from `meds.*`.
- `notes_present`: boolean indicating whether notes existed at export time.
- `notes_redacted`: v1 always `true` if notes existed, because free text is **not** included in payload by default.

**Privacy rule**: `notes` free text is **not exported** in v1. Only `notes_present` is emitted. This avoids exporting potentially identifying care details without a separate review step.

## 7. Export Contract

### 7.1 Format

- JSON Lines (`.jsonl`), one event per line.
- UTF-8, LF line endings.
- File name pattern: `gutpacer-care-events_<batchId>.jsonl`.

### 7.2 Batch metadata sidecar (optional, v1.1 candidate)

A sidecar JSON file with:

- `batch_id`
- `generated_at`
- `event_count`
- `schema_version`
- `consent_filter_applied: true`

For v1, the batch ID inside each event is sufficient.

### 7.3 Ordering

- Events are sorted by `log_date` ascending, then `event_id` ascending.

### 7.4 Idempotency

- Re-running export for the same date range must produce the same `event_id` for the same source record (assuming no source change).
- `event_id` derivation: `gp-evt-<YYYYMMDD>-<seq within date>-<hash prefix of fullDate+payload canonical form>`.

## 8. Consent Gate

- Export must only include records where consent status is `granted` for scope `research_export_v1`.
- In current GutPacer, there is no explicit consent store for research export. **This is an unresolved point**; v1 design assumes a future consent store or manual human approval per export batch.
- If consent cannot be verified, the record must be **skipped**, and the skip must be logged in the export report (not in the event file).

## 9. Test Plan

### 9.1 Schema validation tests

- Validate every sample fixture against `care-event-schema.json`.
- Reject events with:
  - missing required fields
  - invalid `schema_version`
  - invalid `log_date` format
  - `condition_score` outside 0–5
  - invalid `bowel.amount` enum
  - notes text present in payload

### 9.2 Property-based tests

Generators produce random valid logs; properties:

1. **Round-trip stability**: mapping a log to event and re-validating always passes.
2. **No free text leakage**: for any generated log with arbitrary `notes`, payload never contains `notes` content.
3. **Deterministic event_id**: same input log yields same `event_id`.
4. **Consent gate**: logs without `granted` consent never appear in export output.
5. **Enum normalization**: any unknown amount/type maps to `unknown` without throwing.

### 9.3 Sample fixtures

At minimum:

- Full record with stool, all meds, both interventions, notes present.
- Record without stool, no meds, no interventions, no notes.
- Record with condition 0 (unset).
- Record with unknown/legacy amount string.
- Record with missing `bowel` object despite `hasStool: true` (defensive case).

## 10. Security and Privacy

- No PIN, tokens, or user identifiers in export.
- No DynamoDB table names or AWS account IDs in export.
- Free-text notes excluded by default.
- Export file must not be committed to any public repository.
- Export must not be sent externally without human approval.

## 11. Unresolved Points (must be answered before implementation)

1. **Consent store design**: GutPacer currently has no research-export consent mechanism. Need a consent record (local or DynamoDB) and UI or human-gate process.
2. **`occurred_at` semantics**: Should it be midnight JST of `fullDate`, or the actual save time if known? Current logs do not store save timestamp.
3. **`recorded_at` availability**: Backend does not currently persist `createdAt`. If unavailable, define fallback (e.g., export time with a flag).
4. **Location setting**: Should `home` vs `facility` be included as context? It may reveal care arrangement; needs privacy review.
5. **Notes export policy**: v1 excludes notes. If research needs notes, a separate redaction/review process must be defined.
6. **Deletion/correction**: If a log is edited or deleted after export, how is the export corrected? Need a tombstone or re-export policy.
7. **Sequence number overflow**: If more than 999 events per date (unlikely here), define extension.
8. **Timezone**: Assume Asia/Tokyo for `occurred_at`; confirm.
9. **ParkinSync ingest contract**: ParkinSync event layer currently defines its own schema; need explicit crosswalk or adapter spec.

## 12. Deliverables Checklist (this task)

- [x] `CARE-EVENT-DESIGN.md` (this file)
- [x] `care-event-schema.json`
- [x] `mapping-table.md`
- [ ] `validate-care-event.test.mjs` (to be created next)
- [ ] Test run result
- [ ] Unresolved points reported to task queue