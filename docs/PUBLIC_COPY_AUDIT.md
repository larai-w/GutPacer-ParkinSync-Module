# GutPacer public copy audit

Related issue: [#37](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues/37)

Audit date: 2026-08-01

## Reviewed surfaces

- Production family and read-only care views
- Scheduled LINE notification copy
- Privacy policy and terms
- Repository README, architecture, and product manifest
- VEAI LAB English and Japanese product pages
- Published and scheduled GutPacer blog articles
- The display-direction prototype from [#36](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues/36)

## Implemented capability statement

GutPacer currently serves one configured, PIN-protected family household. It records bowel, medication, condition, support, location, and note fields. It provides history, PDF export, a read-only care view, and scheduled LINE record reminders for the configured household.

The read-only view does not authenticate individual care workers or provide role management. The LINE-authenticated multi-household path is development work and is not the production access boundary.

## Corrections made

- Replaced language that implied GutPacer changes bowel health with factual record wording.
- Removed treatment instructions based only on elapsed days since a bowel record.
- Made notifications describe the absence of a bowel-present record instead of a general missing record or health warning.
- Clarified PIN production access and the unreleased LINE login boundary in legal copy.
- Removed fixed cohort-size language and corrected clinical-scale implications in scheduled site articles.
- Kept mascot/friendly display work explicitly at prototype level and out of care-staff and PDF output.

## Copy rule

Public copy may describe recorded observations, implemented exports, and current access controls. It must not infer a diagnosis, recommend a treatment, promise improvement, imply professional validation, or describe an unreleased identity or shared-care workflow as available.
