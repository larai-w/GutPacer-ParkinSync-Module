# GutPacer — Delivered Work & Verification Evidence

This is the public delivery log: shipped tasks, how each was verified, and the decisions behind
them. It is the "evidence" half of the management trail described in
[PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md). Internal growth, business, and roadmap planning are
kept in private notes and are intentionally not reproduced here.

## Completed — hardening & operations (2026-07-08)

### ✅ T-1: HTML-escape user text (XSS mitigation)

- Added `escapeHtml()` in `frontend/index.html`.
- Both the history view (`displayLogs`) and PDF output (`buildPdfReportHtml`) now escape
  server-derived text (notes / date / bowel.amount / bowel.type / fullDate) before inserting it
  into HTML.
- Verification: enter `<script>alert(1)</script>` into notes and save → it renders as literal text
  in both history and PDF.

### ✅ T-2: Isolate the legacy API Lambda

- Moved `backend/index.js` → `backend/legacy/index.js` (`git mv`).
- Documented "do not deploy — no X-Pin CORS support" in `backend/legacy/README.md`.
- Consolidated the live implementation to `backend/index.mjs` only.

### ✅ T-3: Test foundation (package.json + smoke test)

- Created `package.json` (devDependencies: AWS SDK, 2 packages only).
- `scripts/smoke-test.mjs`: verifies the API Lambda's CORS / PIN-auth / validation paths without
  needing an AWS connection.
- Run: `npm install && npm test` → **6/6 passed** (as of 2026-07-08).

### ✅ T-4: Enable DynamoDB backup (PITR)

- Point-in-time recovery set to **ENABLED** on both `gutpacer-logs` / `gutpacer-settings`
  (us-east-1) — restore to any point in the last 35 days.
- Reproduce with `scripts/enable-pitr.sh`.
- Restore procedure is documented in the internal operations runbook.

### ✅ T-5: Document operations

- Created `docs/OPERATIONS.md`: deploy paths (including that the API Lambda is manual), testing,
  backup/restore, environment variables, and first-line incident triage.

## Completed — delivery automation (2026-07-13)

### ✅ Automate API deployment

- Added `.github/workflows/deploy-api.yml`: a push to `main` that touches `backend/index.mjs` runs
  `npm test` then auto-deploys `gutpacer-backend`.
- Granted the OIDC role `Github-actions-gutpacer-deploy` `lambda:UpdateFunctionCode` on
  `gutpacer-backend`.
- Fixed a packaging bug in `deploy-notifier.yml` (`zip` → `zip -j`; a path-prefixed zip was
  inconsistent with `handler=index.handler`).
- **Fixed a pre-existing latent defect**: the `AWS_REGION` secret pointed outside us-east-1, so
  Lambda updates hit an ARN in the wrong region and failed with AccessDenied — the notifier's
  auto-deploy had been silently failing since it was first added. Pinned `--region us-east-1` in
  both workflows to resolve it; confirmed the first successful deploy (gutpacer-backend,
  2026-07-13 04:00 UTC).
- A separate verification environment (isolated Lambda/table) is not yet in place. Until it is,
  production runs direct-deploy + smoke test; the split will be revisited during the multi-tenant
  table migration.

## Completed — product-management foundation (2026-07-19)

### ✅ Establish public technical-PM evidence in the repo

- `docs/PROJECT_MANAGEMENT.md`: documents the flow stakeholder → user story → acceptance →
  architecture/delivery → validation → release decision, plus Definition of Ready/Done and
  recommended Project fields/views (in English).
- Added User Story / Delivery Task Issue Forms and a PR template. Acceptance evidence, data
  boundaries, health-claim wording, and rollback/recovery are built into the Definition of Done.
- `.github/workflows/project-automation.yml`: auto-adds new Issues/PRs to the GitHub Project.
- `scripts/setup-github-project.sh`: dry-run by default; configures the Project, fields, labels,
  existing-issue import, and repository variables in one pass.
- Verification: parsed 4 YAML files, checked shell syntax, ran setup dry-run, `npm test` 13/13,
  `git diff --check`.
- Applied to the [GutPacer Delivery Project](https://github.com/users/larai-w/projects/8): existing
  issues, fields, labels, and a repository variable are in place. Merged the PM-foundation PR
  [#22](https://github.com/larai-w/GutPacer-ParkinSync-Module/pull/22); verified auto-add,
  workflow success, and post-close `Status=Done` sync via test issue
  [#23](https://github.com/larai-w/GutPacer-ParkinSync-Module/issues/23).

## Working rules

- When a task is done, move its line here under "Completed" and record the date.
- New tasks link to a user story or delivery phase (planning detail kept in private notes).
