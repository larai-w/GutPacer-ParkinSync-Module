# GutPacer display direction evaluation

Related issue: [#36](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues/36)

The interactive [display-direction prototype](../prototypes/display-directions.html) compares the same GutPacer record in four contexts. It is a design-decision artifact, not a production release.

## Compared directions

| Direction | Daily entry | History | Care-staff view | PDF/export |
| --- | --- | --- | --- | --- |
| Factual standard | High contrast and concise labels | Structured, low-decoration records | Common factual layout | Common factual table |
| Soft non-mascot standard | Calmer colors and plain Japanese | Same fields with restrained visual grouping | Common factual layout | Common factual table |
| Optional friendly treatment | Small opt-in character in family entry only | Falls back to a non-mascot presentation | Common factual layout; no character | Common factual table; no character |

All directions preserve the current structured fields: date, condition, bowel occurrence/amount/type, recorded care support, medication timing, notes, and location. A presentation preference must not change stored or exported data.

## Decision

The candidate default is **soft non-mascot standard** for the family experience. Care-staff viewing and PDF/export use the **factual standard** regardless of the family's presentation preference.

The friendly treatment remains an optional presentation layer for the private family daily-entry context. It is not the GutPacer product identity, it does not appear in shared records, and it does not assign a positive or negative meaning to a recorded outcome.

## Release boundary

This prototype does not change the production frontend. A later implementation issue must cover preference persistence, care-view enforcement, migration behavior, accessibility checks, and production verification before any new default is shipped.

## Evaluation checklist

- A family caregiver can identify and complete the same fields in every direction.
- A care worker can scan the record without interpreting decorative imagery.
- Shared and exported views remain readable in grayscale and at narrow widths.
- Copy reports recorded facts and does not diagnose, prescribe treatment, promise improvement, or blame the caregiver.
- Controls retain large touch targets and visible keyboard focus.
