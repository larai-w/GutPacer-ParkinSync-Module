# Contributing to GutPacer

Thanks for helping improve GutPacer. Start by reading `README.md` and `AGENTS.md`.

## What can be changed

- Fix bugs, improve UX, and strengthen automation with small, reviewable patches.
- Keep changes aligned with the existing serverless/static architecture.

## Public-repo boundary

- Do not commit private strategy, raw data, credentials, pricing/sales notes, or personal information.
- If you need to discuss sensitive details, use `larai-w/veai-private` and keep public PR/commits sanitized.

## Run it locally

Start with the [static preview in the README](README.md#local-preview). It uses sample
content and does not need AWS credentials or a backend. The actual application frontend
requires an isolated API and an ignored `frontend/config.js` for authentication and record access.

For the existing checks, use Node.js 24:

```bash
npm ci
npm test        # smoke test + unit tests
```

The backend (`backend/index.mjs`) is an AWS Lambda function. **You do not need it
running to work on the static prototype, mocked tests, docs, or accessibility.** Changes that
require live AWS are not expected from outside contributors.

## Before you start

- Confirm behavior impact and success criteria in an issue when not trivial.
- Prefer one purpose per PR.

## Required checks (before commit)

```bash
python3 scripts/check_public_repo.py --staged
```

If your change affects code paths, run repository tests/build steps from `README.md`.

## PR checklist

1. Describe the problem and expected behavior.
2. Add or update tests if behavior changes.
3. Keep PR comments and commit messages neutral and factual.
4. Include verification commands in the PR body.

## Security and privacy

No secrets, API keys, or credentials in code or issue content. Use existing secret management.

## License

Contributions are accepted under this repository's license.
