# GutPacer

**A serverless bowel-movement and laxative tracking app for family caregivers — with optional daily reminders. Part of the ParkinSync care-data ecosystem.**

Caregivers log daily bowel events and medication intake through a mobile-friendly single-page app backed by AWS Lambda and DynamoDB. The tool itself is condition-agnostic; data collected here can feed the broader ParkinSync analytics pipeline.

**Status:** In development

---

## Why this exists

Bowel rhythm is easy to lose track of in daily home care, yet it matters: constipation is a common issue for many older people and for people with chronic conditions, and in Parkinson's Disease specifically it is reported to affect how L-dopa is absorbed ("delayed-on" / "wearing-off"). GutPacer — which began from that Parkinson's care context — creates a single point of truth for caregivers to track bowel patterns and laxative intake, building a dataset that can later feed correlation analysis within ParkinSync.

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
  ├─ 1-day reminder: yesterday no stool, day before had stool
  ├─ 2+ day warning: counts up to 7 consecutive days without stool
  └─ LINE Messaging API  (Flex Message push)

DynamoDB PITR: enabled on both tables (as of 2026-07-08)

Frontend deploy: GitHub Actions → S3 sync on push to main
Notifier deploy: GitHub Actions → Lambda zip on push to backend/notifier/**
```

No framework build step — the frontend is a single static HTML file. The API Lambda and notifier Lambda are deployed independently.

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

Related engineering write-ups are on the [VEAI LAB blog](https://veai.jp/blog/).
