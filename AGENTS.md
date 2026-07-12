# Agent Instructions

When opening this repository, read `docs/PROJECT_HANDOFF.md` first.

Key points:

- Treat `backend/index.mjs` as the current core API Lambda unless the user says otherwise.
- Be careful with `frontend/config.js`; it is intentionally ignored and contains deployment-specific API config.
- Do not commit secrets, PINs, LINE tokens, or AWS credentials.
- The app is for caregiver tracking/reminders, not medical diagnosis or treatment advice.
- Keep changes small and aligned with the existing serverless/static structure.

