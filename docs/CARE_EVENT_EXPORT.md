# GutPacer care-event/v1 export

The closed-beta API can return the authenticated household's current records as a versioned,
machine-readable export:

```text
GET /?format=care-event-v1
X-Line-Id-Token: <LIFF ID token>
```

The API verifies the token and derives the DynamoDB partition from the verified LINE subject. The
request cannot select another household. The response contains `care-event/v1` events and excludes
the LINE subject, PINs, tokens, profile preferences, and display settings. Household identifiers in
the export are deterministic pseudonyms.

## Semantics

- GutPacer records dates rather than event times. `occurredAt` uses 23:59 JST and every payload
  declares `timePrecision: "day"`; consumers must not interpret this as an exact observation time.
- A saved daily record with no bowel event exports `missingness: "confirmed_none"`. A date with no
  saved record is absent from the export and must not be interpreted as confirmed none.
- Medication events are emitted only for slots explicitly marked as taken.
- Notes are carried by `daily_condition_logged`; no separate clinical interpretation is added.
- Editing a daily record replaces its current DynamoDB value. The export is a current snapshot and
  does not claim a correction history.
- Deleted daily records are absent from later exports. Downstream deletion propagation remains a
  separate, explicitly approved workflow.

PDF remains the human-readable report. This JSON contract is for approved data-portability and
downstream workflows; it is not a clinical interoperability certification.

The runtime export path is covered by `tests/care-event-runtime-export.test.mjs`, in addition to
the standalone contract transformer tests. This prevents a schema-valid helper that is not wired
to the API from being mistaken for a verified production path.
