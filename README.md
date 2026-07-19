# GutPacer

**A serverless bowel movement and Movicol tracking app for Parkinson's Disease caregivers — a module of ParkinSync.**

Caregivers log daily bowel events and medication intake through a mobile-friendly single-page app backed by AWS Lambda and DynamoDB. Data collected here feeds the broader ParkinSync analytics pipeline.

**Status:** In development

---

## Why this exists

Constipation is widely reported as a common non-motor symptom in Parkinson's Disease, and is thought to affect how L-dopa medication is absorbed ("delayed-on" / "wearing-off" phenomena). GutPacer creates a single point of truth for caregivers to track bowel patterns and Movicol laxative intake, building the dataset needed for future correlation analysis within ParkinSync.

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

## 🏁 Product and Project Management

GutPacer uses **iterative, evidence-led Agile delivery**. It does not claim that a solo project ran formal Scrum ceremonies. The public management trail connects caregiver problems to personas, user stories, acceptance criteria, implementation, verification, release decisions, and incident learning.

- [Delivery management and Definition of Done](docs/PROJECT_MANAGEMENT.md)
- [Delivered work and verification evidence](docs/TASKS.md)

New work uses structured GitHub User Story and Delivery Task forms. Issues and pull requests can be automatically added to the **GutPacer Delivery** GitHub Project, while pull requests retain acceptance evidence, risk review, and decision context.

The current production version is a single-family, PIN-protected tool. LINE identity, server-enforced user isolation, and per-user notifications are being developed for a small closed beta. General availability is not claimed.
