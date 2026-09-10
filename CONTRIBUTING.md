# Contributing to GutPacer

Thanks for helping improve GutPacer. Start by reading `README.md` and `AGENTS.md`.

## What can be changed

- Fix bugs, improve UX, and strengthen automation with small, reviewable patches.
- Keep changes aligned with the existing serverless/static architecture.

## Public-repo boundary

- Do not commit private strategy, raw data, credentials, pricing/sales notes, or personal information.
- If you need to discuss sensitive details, use `larai-w/veai-private` and keep public PR/commits sanitized.

## Run it locally

The frontend is a single static page. **No build step, no AWS credentials.**

```bash
python3 -m http.server 8000 --directory frontend
# open http://localhost:8000
npm test        # smoke test + unit tests
```

The backend (`backend/index.mjs`) is an AWS Lambda function. **You do not need it
running to work on the frontend, tests, docs, or accessibility.** Changes that
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
