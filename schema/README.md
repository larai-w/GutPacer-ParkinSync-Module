# care-event/v1 canonical schema

`care-event-v1.schema.json` is the canonical public schema for the VEAI care-event v1 contract.
The runtime GutPacer exporter and its tests use this file directly.

Downstream repositories enforce drift checks in CI:

- ParkinSync keeps a research-adapter copy and compares normalized schema content with this file.
- Medication Promise defines a closed medication-only specialization and checks that it can only
  narrow this contract; it cannot remove required fields, widen enums, or add fields to closed
  canonical objects.

The canonical repository also runs `care-event-schema-drift.yml` whenever this schema changes. It
checks out both downstream repositories and executes their guards against the proposed canonical
version, so a canonical pull request cannot silently leave either implementation behind.

Because v1 is closed with `additionalProperties: false`, even an apparently additive field can be
rejected by an older validator when emitted. A semantic change therefore requires coordinated
consumer updates or a new schema version. Formatting and order-only edits are not semantic changes.
