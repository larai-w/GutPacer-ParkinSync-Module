# Agent Instructions

When opening this repository, run `git status --short` first. Session handoffs, worklogs, strategy,
and growth planning now live in the private **`larai-w/veai-private`** repo (`gutpacer/` folder),
not here — clone that repo if you need the latest handoff and concrete values.

Key points:

- Treat `backend/index.mjs` as the current core API Lambda unless the user says otherwise.
- Be careful with `frontend/config.js`; it is intentionally ignored and contains deployment-specific API config.
- Do not commit secrets, PINs, LINE tokens, or AWS credentials.
- The app is for caregiver tracking/reminders, not medical diagnosis or treatment advice.
- Keep changes small and aligned with the existing serverless/static structure.

## Private material — strategy, business, growth

- Business, growth, roadmap, pricing, revenue, sales/pilot, and market-analysis planning — plus
  internal worklogs and handovers — must **never** be committed to this public repo. They live in
  the private **`larai-w/veai-private`** repo (per-product folders; synced and backed up).
- Machine-local scratch may go in `docs-private/` (gitignored — local only, not synced).
- A pre-commit guard (`scripts/check_public_repo.py` via `.githooks/`) blocks this content and
  secrets from being committed here; never bypass it with `--no-verify`. A fresh clone runs
  `npm install` to set it up (or once: `git config core.hooksPath .githooks`).

