# GutPacer Care-Event Mapping Table (v1)

Source: `gutpacer-logs` DynamoDB item (as written by `saveGutLog()` in `frontend/index.html` and `backend/index.mjs`).
Target: `gutpacer-care-event-v1` payload (see `care-event-schema.json`).

## Field Mapping

| Source field | Target field | Rule |
|---|---|---|
| `fullDate` | `payload.log_date` | Copy as-is; must match `YYYY-MM-DD`. |
| `condition` | `payload.condition_score` | Integer 0–5; 0 = unset, never impute. |
| `hasStool` | `payload.bowel.has_stool` | Boolean. |
| `bowel.amount` | `payload.bowel.amount` | Normalize via amount table; default `unknown`. |
| `bowel.type` | `payload.bowel.type_code` | Normalize via type table; default `unknown`. |
| `bowel.type` | `payload.bowel.type_label_ja` | Original label preserved (max 100 chars). |
| `enema` | `payload.interventions.enema` | Boolean; missing → `false`. |
| `manualHelp` | `payload.interventions.manual_evacuation` | Boolean; missing → `false`. |
| `meds.morning` | `payload.medication.movicol.morning` | Boolean; missing → `false`. |
| `meds.noon` | `payload.medication.movicol.noon` | Boolean; missing → `false`. |
| `meds.evening` | `payload.medication.movicol.evening` | Boolean; missing → `false`. |
| `notes` | `payload.notes_present` | `true` if non-empty string after trim. |
| `notes` | `payload.notes_redacted` | `true` when notes_present; note text is never exported. |
| — | `schema_version` | Fixed `gutpacer-care-event-v1`. |
| — | `event_type` | Fixed `care_log_recorded`. |
| — | `source.product` | Fixed `gutpacer`. |
| — | `source.channel` | Fixed `web`. |

## Stool Amount Normalization

| Source value | Target enum |
|---|---|
| `小 (S)` | `small` |
| `中 (M)` | `medium` |
| `大 (L)` | `large` |
| missing / empty / other | `unknown` |

## Stool Type Normalization

| Source value | Target code |
|---|---|
| `硬い（コロコロ）` (UI label: 硬い（コロコロ・カチカチ）) | `hard_pellet` |
| `柔らかい（軟便）` (UI label: 柔らかい（ドロドロ・軟便）) | `soft_loose` |
| `水っぽい（下痢）` | `watery_diarrhea` |
| `普通（バナナ状）` (UI label: 普通（バナナ状・するっと）) | `normal_banana` |
| missing / empty / other | `unknown` |

## Envelope Derivation

| Target field | Derivation |
|---|---|
| `event_id` | `gp-evt-<YYYYMMDD from fullDate>-<6-digit seq>-<4–16 char lowercase hash suffix>` |
| `occurred_at` | `fullDate` + `T00:00:00+09:00` (unresolved: confirm time semantics) |
| `recorded_at` | Original save timestamp if available; otherwise export generation time (unresolved) |
| `source.export_batch_id` | `gp-export-<YYYYMMDD>T<HHMM>Z` |
| `consent.status` | Must be `granted`; otherwise record is excluded from export |
| `consent.granted_at` | From consent store (unresolved: consent store does not exist yet) |
| `consent.scope` | Fixed `research_export_v1` |

## Excluded Fields (never exported)

- `notes` free text
- `date` display string (derivable from `log_date`)
- PIN, tokens, invite codes
- DynamoDB table names, AWS identifiers
- Location setting (`home`/`facility`) — pending privacy review

## Defensive Cases

| Case | Behavior |
|---|---|
| `hasStool: true` but `bowel` missing/null | Emit `has_stool: true` with `amount: unknown`, `type_code: unknown`, `type_label_ja: ""` (schema requires label; use empty string or `"unknown"` — confirm in implementation) |
| `condition` missing/non-numeric | Emit `0` |
| `meds` missing | Emit all three as `false` |
| Unknown enum source value | Map to `unknown`; do not throw |