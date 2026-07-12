# Claude Instructions

Start every session by reading `docs/PROJECT_HANDOFF.md`.

Operational defaults:

- Current app surface is `frontend/index.html`.
- Current API Lambda is probably `backend/index.mjs`.
- Notification Lambda is `backend/notifier/index.mjs`.
- `frontend/config.js` is ignored by git and should not be overwritten without explicit user confirmation.
- Avoid committing secrets or deployment-specific credentials.

## Model role split (planning vs implementation)

This project separates roles by model tier. This applies to every session and every user of this repo.

- **Planning / strategy / task breakdown / review**: done by the main session model (the highest-tier model available, e.g. Fable). Strategy docs live in `docs/STRATEGY.md`, `docs/GROWTH_PLAN.md`, `docs/TASKS.md`.
- **Implementation work**: delegate to the `builder` agent (`.claude/agents/builder.md`, default model Sonnet). For architecture-heavy tasks (e.g. G-1 auth, G-2 table migration), spawn builder with `model: "opus"`.
- Use the `/delegate` skill (`.claude/skills/delegate/SKILL.md`) for the full plan → delegate → review cycle. The main session must review the diff and re-run `npm test` before reporting a delegated task as done.
- Do not let builder make scope or strategy decisions; if builder reports ambiguity, the main session decides and re-instructs via SendMessage.

