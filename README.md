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

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla JS, Tailwind CSS (CDN), html2canvas + jsPDF (CDN) |
| API Lambda | Node.js ESM (`backend/index.mjs`), AWS SDK v3 |
| Notifier Lambda | Node.js ESM (`backend/notifier/index.mjs`) |
| Database | AWS DynamoDB (2 tables, PITR enabled) |
| CDN / Hosting | AWS CloudFront + S3 |
| Notifications | LINE Messaging API (Flex Message) |
| CI / Deploy | GitHub Actions |

---

## Testing

```
scripts/smoke-test.mjs  — 6 offline unit tests (npm test)
  - OPTIONS returns 200 without PIN (CORS preflight)
  - CORS headers include X-Pin
  - GET without PIN → 401
  - GET with wrong PIN → 401
  - POST with correct PIN but missing fullDate → 400
  - Notifier module loads and exports a handler function

Tests run entirely offline: no AWS credentials or network required.
```

Run tests: `npm install && npm test`

---

## Local Development

```bash
npm install
npm test       # offline smoke tests for API Lambda + notifier module load

# To exercise the API Lambda locally with a sample event:
node -e "
  process.env.ACCESS_PIN='1234';
  import('./backend/index.mjs').then(m =>
    m.handler({ requestContext:{ http:{ method:'OPTIONS' }}, headers:{} })
      .then(r => console.log(r.statusCode))
  );
"
```

The frontend requires a deployed `config.js` (ignored by git) that defines `API_URL`. For local testing, create `frontend/config.js`:

```js
const API_URL = "https://your-api-gateway-url";
```

---

## Deployment

**Frontend:** push to `main` → GitHub Actions syncs `frontend/` to `s3://veai-careready-frontend/gutpacer/` and invalidates CloudFront (`/gutpacer/` and `/gutpacer/*`). `frontend/config.js` is excluded from sync and must be managed separately.

**Notifier Lambda:** push to `main` touching `backend/notifier/**` → GitHub Actions zips and deploys to Lambda.

**Core API Lambda:** manual deployment via AWS CLI or CloudShell. See `docs/OPERATIONS.md`.

Required Lambda environment variables:
- `ACCESS_PIN` (API Lambda)
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_USER_ID` (notifier Lambda)

---

## Repository Layout

```
frontend/
  index.html           # Single-page app (PIN gate, tracker UI, PDF export)
backend/
  index.mjs            # Core API Lambda (GET/POST/DELETE + CORS + PIN auth)
  notifier/
    index.mjs          # Bowel alert notifier (LINE Flex Message)
scripts/
  smoke-test.mjs       # Offline unit tests
  deploy-notifier.sh   # CloudShell deploy script for notifier Lambda
  enable-pitr.sh       # Re-enable DynamoDB PITR after table recreation
docs/
  STRATEGY.md          # Roadmap and user stories
  OPERATIONS.md        # Deploy, backup, and troubleshooting runbook
  GROWTH_PLAN.md       # 10→30 user expansion plan (G-1..G-10 tasks)
  PROJECT_HANDOFF.md   # Session recovery guide
```

---

## Security Notes

- PIN authentication uses the `X-Pin` request header; the PIN is stored in `localStorage` and validated server-side via the `ACCESS_PIN` environment variable.
- User-entered notes are escaped with `escapeHtml()` before DOM injection.
- DynamoDB PITR is enabled on both tables. Restore procedure: `docs/OPERATIONS.md`.
- Do not deploy `backend/legacy/index.js` — it lacks the `X-Pin` CORS header and breaks preflight.

---

## License

MIT — see [LICENSE](LICENSE)

Part of the [VEAI LAB.](https://veai.jp) ecosystem — [GutPacer product page](https://veai.jp/apps/gutpacer/)
