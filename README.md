# GutPacer

**A serverless bowel and medication record for a configured family household, with PDF export, a read-only care view, and scheduled LINE record reminders. Part of the ParkinSync care-data ecosystem.**

Caregivers log daily bowel events and medication intake through a mobile-friendly single-page app backed by AWS Lambda and DynamoDB. The tool itself is condition-agnostic; data collected here can feed the broader ParkinSync analytics pipeline.

**Status:** In development

---

## Why this exists

Daily bowel, medication, and condition details can be difficult to reconstruct during family conversations or appointments. GutPacer gives one configured family household a consistent place to record those observations and export them for review. It began in a Parkinson's care context, but the current tool is condition-agnostic: it does not interpret a pattern, diagnose a condition, or recommend treatment.

---

## Architecture

```
User (caregiver, mobile browser)
  │
  └─ frontend/index.html  (vanilla JS + Tailwind CSS, CDN-loaded)
         │  PIN gate (X-Pin header; PIN stored in localStorage)
         │
         ▼
  AWS CloudFront  (CDN + clean URL routing via CloudFront Functions)
         │
         ├─ Static assets ──  S3  (veai-careready-frontend/gutpacer/)
         │
         └─ /api/gutpacer/*  ──  API Gateway (HTTP API)
                                       │
                                       ├─ Lambda: backend/index.mjs  (Node.js ESM)
                                       │     ├─ GET  — fetch logs + location setting
                                       │     ├─ POST — write log / save location setting
                                       │     └─ DELETE — remove log by fullDate
                                       │
                                       └─ DynamoDB Tables:
                                             gutpacer-logs      (PK: fullDate)
                                             gutpacer-settings  (PK: settingKey)

Notifier Lambda: backend/notifier/index.mjs
  ├─ EventBridge cron: 08:00 JST daily  (cron 0 23 * * ? * UTC)
  ├─ Reads location from gutpacer-settings
  │     └─ Skips LINE push when location = "facility"
  ├─ 1-day reminder: yesterday has no bowel "present" record
  ├─ Multi-day record reminder: counts up to 7 days without a bowel "present" record
  └─ LINE Messaging API  (Flex Message push)

DynamoDB PITR: enabled on both tables (as of 2026-07-08)

Frontend deploy: GitHub Actions → S3 sync on push to main
Notifier deploy: GitHub Actions → Lambda zip on push to backend/notifier/**
```

No framework build step — the frontend is a single static HTML file. The API Lambda and notifier Lambda are deployed independently.

## Machine-readable care-event export

GutPacer exposes a household-scoped snapshot at `/?format=care-event-v1`. The export
uses the versioned `care-event/v1` contract described in
[`docs/CARE_EVENT_EXPORT.md`](docs/CARE_EVENT_EXPORT.md), preserves the distinction
between `confirmed_none` and `not_recorded`, and is covered by synthetic contract tests.
It is an observation export for governed downstream review; it is not a diagnosis,
treatment recommendation, or live clinical FHIR integration.

---

## 🏁 Product Management

GutPacer doubles as a working **product-management portfolio** — iterative, evidence-led Agile
delivery on a real caregiving tool, built solo and AI-assisted. It does not claim a solo project ran
formal Scrum ceremonies; it claims a traceable line from caregiver problem to shipped, verified
software. What it demonstrates:

- **Evidence-based delivery** — a public trail connecting caregiver problems to personas, user
  stories, acceptance criteria, implementation, verification, release decisions, and incident
  learning. See [delivery management and Definition of Done](docs/PROJECT_MANAGEMENT.md) and
  [delivered work and verification evidence](docs/TASKS.md).
- **Stakeholder management** — the current production version is a single-family, PIN-protected
  tool; LINE identity, server-enforced user isolation, and per-user notifications are staged for a
  small closed beta. Scope is bounded honestly — general availability is not claimed.
- **Technical product management** — a serverless architecture owned end to end (S3/CloudFront +
  API Gateway + Lambda + DynamoDB with PITR), plus a scheduled notifier Lambda that pushes LINE
  reminders and deliberately stays silent when care moves to a facility (see **Architecture** above).
- **Agile in practice** — new work uses structured GitHub **User Story** and **Delivery Task**
  forms; issues and PRs flow into the
  **[GutPacer Delivery](https://github.com/users/larai-w/projects/8)** GitHub Project, and PRs
  retain acceptance evidence, risk review, and decision context. See the
  **[issues](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues)**.
- **Design decisions** — the public
  **[display-direction evaluation](docs/DISPLAY_DIRECTION_EVALUATION.md)** compares factual,
  soft non-mascot, and optional friendly treatments across family entry, history, care-staff,
  and PDF contexts before any production default changes.
- **Public claim control** — the
  **[public copy audit](docs/PUBLIC_COPY_AUDIT.md)** records the implemented scope, unreleased
  boundaries, and health-copy rules applied across the app, repository, product pages, and blog.

Related engineering write-ups are on the [VEAI LAB blog](https://veai.jp/blog/).
