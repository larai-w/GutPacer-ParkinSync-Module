# GutPacer display direction evaluation

Related issue: [#36](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues/36)

The interactive [display-direction prototype](../prototypes/display-directions.html) compares the same GutPacer record in four contexts. It is a design-decision artifact, not a production release. The production baseline reflects the frontend on 2026-08-01 but uses static sample data and does not connect to authentication or APIs.

## Compared directions

| Direction | Daily entry | History | Care-staff view | PDF/export |
| --- | --- | --- | --- | --- |
| Current production baseline | Narrow single-column layout, indigo controls, rounded cards, mixed Japanese/English labels | Current card density and visual hierarchy | Current indigo viewing treatment | Current factual report structure |
| Factual standard | High contrast and concise labels | Structured, low-decoration records | Common factual layout | Common factual table |
| Soft non-mascot standard | Calmer colors and plain Japanese | Same fields with restrained visual grouping | Common factual layout | Common factual table |
| Optional friendly treatment | Small opt-in character in family entry only | Falls back to a non-mascot presentation | Common factual layout; no character | Common factual table; no character |

All four directions preserve the current structured fields: date, condition, bowel occurrence/amount/type, recorded care support, medication timing, notes, and location. A presentation preference must not change stored or exported data.

## Baseline purpose

The current production baseline is a control, not a fourth redesign recommendation. It keeps the existing visual width, indigo palette, rounded cards, mixed-language section headings, and bowel-section emoji visible so that reviewers can identify what would actually change. It contains no real family records, PIN, API endpoint, or facility information.

## Decision (revised 2026-08-27)

> ### ⚠️ The original decision was made without seeing the option it chose.
>
> The first version of this document named **soft non-mascot standard** as the
> candidate default. On 2026-08-27, while starting the implementation, we found
> that the prototype had **no `[data-direction="soft"]` palette**. The button and
> the description existed, but selecting it changed nothing: it fell back to the
> prototype page's own chrome.
>
> **The recommended direction had never been rendered.** The comparison could not
> have shown it. See PR that adds the missing palette.
>
> After the palette was added and the four directions were compared for real, the
> person who uses the app daily did not prefer *soft*. They found *current* and
> *factual* equally usable, and liked the *optional friendly treatment*.

**The default for family entry is the `factual standard`.**

The choice is not based on taste. All three non-decorative directions were
judged equally usable, which means **the palette is not where the value is**.
So the direction is chosen on a structural reason instead:

- Care-staff viewing and PDF/export are **already factual** and stay that way.
- Making family entry factual too means **every context shares one visual
  language**. What the family looks at matches what a care manager or nurse
  receives, so sharing holds no surprise.
- It also makes the optional friendly treatment **the only visual marker of the
  private context**, which is what an opt-in should be.

`current` (indigo) would leave family entry looking different from the shared
views for no stated reason. **`soft` is withdrawn**: it had no reason behind it
and, once visible, was not preferred.

Care-staff viewing and PDF/export use the **factual standard** regardless of the
family's presentation preference. **A presentation preference must never change
what a professional receives.**

The current production UI remains unchanged until the implementation issue is reviewed and completed. The baseline stays available as comparison and rollback evidence after a new default is selected.

The friendly treatment remains an optional presentation layer for the private family daily-entry context. It is not the GutPacer product identity, it does not appear in shared records, and it does not assign a positive or negative meaning to a recorded outcome.

**This is the part with real value.** Bowel recording is hard to sustain, and a
presentation the family actually likes helps them keep going. That is why the
opt-in ships even though the default palette barely changes anything.

> ⚠️ **The character must not react to what was recorded.**
> "You recorded it" is fine. "That looks good today" is not.
> Being assessed by the screen on a bad day takes away the will to keep recording.
> This is a boundary, not a style preference.

## Release boundary

This prototype does not change the production frontend. A later implementation issue must cover preference persistence, care-view enforcement, migration behavior, accessibility checks, and production verification before any new default is shipped.

## Evaluation checklist

- A family caregiver can identify and complete the same fields in every direction.
- A care worker can scan the record without interpreting decorative imagery.
- Shared and exported views remain readable in grayscale and at narrow widths.
- Copy reports recorded facts and does not diagnose, prescribe treatment, promise improvement, or blame the caregiver.
- Controls retain large touch targets and visible keyboard focus.
