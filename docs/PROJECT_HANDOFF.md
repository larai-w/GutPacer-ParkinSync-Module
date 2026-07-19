# GutPacer Project Handoff

Last updated: 2026-07-14

**Latest session handoff: `docs/WORKLOG.md`** — read it for the most recent work, current state, and concrete values (Lambda names, LINE account, region gotchas).

Companion docs: `docs/STRATEGY.md` (strategy/roadmap/user stories), `docs/GROWTH_PLAN.md` (10→30 user plan, dev tasks G-1..G-10), `docs/PROJECT_MANAGEMENT.md` (public Technical PM evidence and delivery model), `docs/TASKS.md` (task progress), `docs/USER_TODO.md` (human owner's todo), `docs/OPERATIONS.md` (deploy/backup/troubleshooting).

This document is the first recovery point for future Codex/Claude sessions. Read it before changing code.

## Current Project State

GutPacer is a small serverless bowel movement and Movicol tracking app for Parkinson's care.

- Frontend: single static page at `frontend/index.html`.
- Core API Lambda: `backend/index.mjs` is the only supported implementation.
- Legacy/commonJS API Lambda: moved to `backend/legacy/index.js` (2026-07-08). Do not deploy it; see `backend/legacy/README.md`.
- Notification Lambda: `backend/notifier/index.mjs` sends LINE reminders/warnings.
- Python notifier: `backend/notifier/lambda_function.py` is an older/reference version.
- CloudShell notifier deploy script: `scripts/deploy-notifier.sh`.
- GitHub Actions:
  - `.github/workflows/deploy.yml` deploys frontend to S3 on pushes to `main`.
  - `.github/workflows/deploy-notifier.yml` deploys notifier Lambda on pushes to `main` that touch `backend/notifier/**`.

Current git branch during this handoff: `development`, tracking `origin/development`.

Current untracked local file:

- `veai-gutpacer.code-workspace`

No tracked file changes were present before this handoff documentation was added.

## What Works Now

### Frontend

`frontend/index.html` provides:

- PIN gate using `localStorage` key `gutpacer_pin`.
- Daily date and condition score input.
- Bowel record: amount, stool type, enema, manual help.
- Movicol checkboxes: morning/noon/evening.
- Notes.
- Location toggle: `home` / `facility`.
- History display with edit/delete actions.
- Last stool status warning.
- PDF export using CDN-loaded `html2canvas` and `jspdf`.

The page loads `https://veai.jp/gutpacer/config.js`, which is ignored by git via `frontend/config.js`. That config is expected to define `API_URL`.

### Core API Lambda

`backend/index.mjs` supports:

- `OPTIONS` for CORS preflight.
- `GET` for all logs plus current location setting.
- `POST` for log writes.
- `POST` with `{ action: "saveSettings", location }` for location setting.
- `DELETE ?fullDate=YYYY-MM-DD` for deleting a log.
- PIN auth through request header `X-Pin`; expected env var: `ACCESS_PIN`.

DynamoDB tables used:

- `gutpacer-logs`, keyed by `fullDate`.
- `gutpacer-settings`, keyed by `settingKey`.

Important: `backend/index.mjs` has `Access-Control-Allow-Headers: Content-Type,X-Pin`. The legacy `backend/legacy/index.js` only allows `Content-Type`, so browser PIN requests fail preflight if that version is deployed — never deploy it.

### Tests

`npm install && npm test` runs `scripts/smoke-test.mjs`: offline smoke tests for the API Lambda's CORS/PIN/validation paths plus a notifier module load check. Run before deploying API changes.

### Backups

Point-in-time recovery (PITR) is ENABLED on both DynamoDB tables as of 2026-07-08. Re-enable after table recreation with `scripts/enable-pitr.sh`. Restore procedure: `docs/OPERATIONS.md`.

### Notifier Lambda

`backend/notifier/index.mjs`:

- Reads location from `gutpacer-settings`.
- Skips LINE notification when location is `facility`.
- Uses JST date calculation.
- Checks stool presence by `bowel != null` for each date.
- Sends a reminder if yesterday had no stool and the day before had stool.
- Sends a warning if yesterday and previous days had no stool, counting up to 7 days.
- Sends Flex Message push notifications through LINE Messaging API.

Expected notifier env vars:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_USER_ID`

## Recent Git History

Most recent commits at handoff:

```text
e78bd9f Fix CORS to allow X-Pin header
29fe70b Add PIN authentication to frontend and Lambda
4f705fd Add GitHub Actions workflow for Lambda notifier auto-deploy
9711901 Fix stool detection to check bowel field instead of record existence
e1c4682 Rewrite notifier with 1-day reminder / 2-day warning logic
dc351f2 Add Python version of gutpacer-notifier Lambda
e629b80 Add CloudShell deployment script for gutpacer-notifier Lambda
2cc2e61 Add LINE notification Lambda for daily bowel alert
5a18e55 Add index.mjs with POST saveSettings and safe GET for Lambda deployment
0fba132 Fix GET handler: isolate settings fetch in try/catch, always return 200
```

## Operational Notes

- Production app URL referenced by code: `https://veai.jp/gutpacer/`.
- Frontend deployment target in GitHub Actions: `s3://veai-careready-frontend/gutpacer/`.
- Frontend workflow excludes `config.js`, so API endpoint config must be managed outside git.
- CloudFront invalidation paths: `/gutpacer/` and `/gutpacer/*`.
- Notifier scheduled rule in `scripts/deploy-notifier.sh`: `cron(0 23 * * ? *)`, which is 08:00 JST.
- AWS region in script: `us-east-1`.

## Known Gaps / Risks

- Core API deploy workflow is not present in this repo; manual deploy steps are in `docs/OPERATIONS.md`. Confirm the Lambda function name before deploying.
- Branch mismatch risk: workflows deploy from `main`, but development happens on `development`.
- Notifier GitHub Action zips `backend/notifier/index.mjs` with its directory path. Confirm Lambda handler/package layout if deployments fail; `scripts/deploy-notifier.sh` packages it as root `index.mjs`.
- Frontend uses inline event handlers and direct HTML string rendering. Server-derived text is escaped via `escapeHtml()` (added 2026-07-08) — keep using it for any new interpolation into HTML.
- Health-care context: avoid adding diagnosis/treatment advice. Keep app language to tracking/reminders and caregiver coordination.

Resolved on 2026-07-08: `package.json` + smoke tests added; legacy `index.js` isolated; `notes` XSS escaping added; DynamoDB PITR enabled.

## Suggested Next Steps

1. Decide whether `backend/index.mjs` is the only supported core API Lambda and mark/remove `backend/index.js` accordingly.
2. Add a minimal API deploy path or document the existing manual deployment process.
3. Add escaping for history/PDF text fields before rendering user-entered notes.
4. Add a tiny local smoke-test script for Lambda handlers with sample events.
5. Confirm whether development should merge to `main` for deployment, or whether workflows should also deploy from `development`.

## Quick Recovery Checklist

Run:

```bash
git status --short --branch
git log --oneline --decorate -10
rg --files
```

Then read:

```bash
sed -n '1,220p' docs/PROJECT_HANDOFF.md
sed -n '1,220p' frontend/index.html
sed -n '1,220p' backend/index.mjs
sed -n '1,240p' backend/notifier/index.mjs
```

Before deploying, verify:

- Target branch (`main` vs `development`).
- AWS region and Lambda function names.
- Required GitHub secrets and Lambda environment variables.
- Whether `frontend/config.js` exists in the deployed S3 path and defines `API_URL`.
