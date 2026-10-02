# GutPacer

**A mobile-friendly bowel and medication record for caregivers, built with a static frontend and AWS serverless services.**

[日本語](README.ja.md) · [Local preview](#local-preview) · [Architecture](#architecture) · [Contributing](CONTRIBUTING.md)

GutPacer helps caregivers record daily observations, correct earlier entries, and prepare a PDF for review. It preserves the difference between an explicitly confirmed absence and an observation that was never recorded. The interface is currently in Japanese; this README provides an English guide to the implementation.

**Scope:** In development. The core PIN API serves one configured household. A separate LINE-authenticated API and a versioned observation export are implemented for a closed-beta path. Their presence in source does not imply public signup or a generally available multi-household service. GutPacer does not diagnose conditions or recommend treatment.

## What you can explore

| Capability | Implementation and boundary |
| --- | --- |
| Daily records | Bowel amount/type, explicit absence, medication slots, condition and notes in [the frontend](frontend/index.html) |
| History and corrections | Edit or delete a dated record; edits replace the stored daily record |
| Read-only care view | A presentation mode in the same frontend, not a separately authorized staff account |
| PDF export | Human-readable history generated in the browser |
| LINE record reminders | [Profile-aware notifier](backend/notifier/index-mvp.mjs); skips disabled notifications and profiles whose location is `facility` |
| Machine-readable export | `care-event/v1` snapshot through the [LINE API](backend/index-mvp.mjs); see [export semantics](docs/CARE_EVENT_EXPORT.md) |
| Display exploration | [Static UI comparison](prototypes/display-directions.html) with sample content and four visual directions |

## Local preview

### Explore the static UI comparison without accounts

Requirements: Git and Python 3. No Node installation, AWS credentials or LINE login are needed for this preview.

```bash
git clone https://github.com/larai-w/GutPacer-ParkinSync-Module.git
cd GutPacer-ParkinSync-Module
python3 -m http.server 8000 --bind 127.0.0.1
```

Open **http://127.0.0.1:8000/prototypes/display-directions.html**. Switch between entry, history, care-view and report contexts, and compare the four display directions. Stop the server with `Ctrl+C`.

This is an existing design prototype with static sample content. It does not save records or call the API. Some labels reflect an earlier design: use the [record semantics below](#record-semantics) and the current frontend as the reference for actual behavior.

### Work on the application frontend

`frontend/index.html` is the actual app, with no bundler or framework build step. It loads browser libraries from CDNs and expects a deployment-specific `frontend/config.js`, which is intentionally ignored by Git.

In a **fresh development checkout**, create that file only when connecting to your own isolated development backend:

```js
window.API_URL = "http://127.0.0.1:8001/";
window.GUTPACER_LIFF_ID = "";
```

The URL above is an example for a separately supplied local backend; this repository does not start a server on port 8001. Open **http://127.0.0.1:8000/frontend/** using the static server above. Without a compatible API, authentication, saving and history loading will not work. This is not a complete offline app.

An empty LIFF ID selects PIN mode. LINE mode requires an appropriately configured LIFF app and the separate LINE API. Never point experiments at a live household backend, overwrite an existing deployment configuration, or put credentials in this file.

## Architecture

```text
Mobile browser
  frontend/index.html + environment-specific config.js
       |
       +-- PIN mode: X-Pin --> backend/index.mjs
       |                         |-- logs: household partition + fullDate
       |                         `-- settings, consent and PIN lockout state
       |
       `-- LINE mode: ID token --> backend/index-mvp.mjs
                                  |-- verified identity + profile
                                  |-- household-scoped daily logs
                                  `-- care-event/v1 snapshot export

Scheduled invocation --> backend/notifier/index-mvp.mjs
                         |-- user profiles + household logs
                         `-- LINE Messaging API

Static hosting: S3 / CloudFront
API compute: AWS Lambda
Persistence: DynamoDB
```

The core API uses `gutpacer-logs-v2`, with `userId` holding the configured household partition and `fullDate` as the date key. It also uses `gutpacer-settings`. The LINE API and current notifier use the v2 logs and user-profile tables. [Profile defaults](backend/profile-defaults.mjs) and [household consistency checks](tests/household-id-consistency.test.mjs) describe how those paths align.

`backend/notifier/index.mjs` is the **legacy** notifier. The current notifier source selected by the closed-beta workflow is `backend/notifier/index-mvp.mjs`. The legacy workflow is manual-only; it targets the same function and can replace the current implementation. See the [workflow](.github/workflows/deploy-notifier.yml) before considering a rollback.

### Configuration reference

These are names and roles, not a turnkey provisioning recipe. Inspect the corresponding module before supplying development values.

| Component | Configuration |
| --- | --- |
| Browser | `API_URL`; optional `GUTPACER_LIFF_ID` |
| PIN API | Secret `ACCESS_PIN`; `HOUSEHOLD_ID` with `CONSENT_SUBJECT` fallback |
| LINE API | `LINE_LOGIN_CHANNEL_ID`, `LOGS_TABLE`, `USERS_TABLE`; invitation controls in [the handler](backend/index-mvp.mjs) |
| Current notifier | Secret `LINE_CHANNEL_ACCESS_TOKEN`; `LOGS_TABLE`, `USERS_TABLE`, `HOUSEHOLD_ID`, `APP_URL` |
| Optional record-time metrics | `METRICS_COLLECTION_ENABLED`, `METRICS_TABLE`; collection also requires explicit consent |

The PIN API's table names are currently constants. The LINE API and notifier accept table-name environment variables. A local configuration file alone does not provision Lambda, DynamoDB, authentication or LINE delivery.

## Record semantics

| Input or missing information | Meaning |
| --- | --- |
| Bowel event selected with details | `observed` |
| Explicitly select **排便なしを確認した** | `confirmed_none` |
| Leave bowel observation unspecified | `not_recorded`; the UI shows **未確認・記録なし** |
| No recorded medication slot | **記録なし**; not proof that medication was not taken |
| No saved daily record | No exported event for that date; not confirmed absence |

Earlier records without an explicit `bowelConfirmedNone` marker are interpreted conservatively. Their stored values are not rewritten by this display behavior. Opening an entry for correction resets the bowel controls before loading its values.

The [`care-event/v1` schema](schema/care-event-v1.schema.json) is intended for downstream observation review. The runtime export is wired into the LINE API, **not the core PIN API**. It is a current snapshot, with day-level time precision, deterministic pseudonymous identifiers and provenance; it is not an append-only correction ledger. Free-text notes may contain sensitive information, so pseudonymized exports must still be handled as care data.

Read the [export contract](docs/CARE_EVENT_EXPORT.md) and [schema versioning notes](schema/README.md). Live ingestion into ParkinSync and clinical FHIR integration are not implemented. There is no trained ML model or evaluated clinical prediction system in this repository.

## Engineering checks

Use Node.js 24, matching the main application workflows, and Python 3 for repository guards.

```bash
npm ci
npm test
```

`npm test` runs the smoke script followed by Node's test runner over `tests/*.test.mjs`. The smoke script mocks DynamoDB calls and the test suite includes synthetic fixtures. These checks do not establish the state of a deployed AWS or LINE environment.

Useful starting points for reviewing the code:

| Concern | Source / checks |
| --- | --- |
| Unknown versus confirmed absence | [Bowel observation tests](tests/bowel-observation.test.mjs) |
| Export wired into the API | [Runtime export tests](tests/care-event-runtime-export.test.mjs) |
| Household partition consistency | [Consistency tests](tests/household-id-consistency.test.mjs) |
| PIN attempts and lockout | [PIN tests](tests/pin-bruteforce.test.mjs) |
| Consent and deletion boundaries | [Consent tests](tests/backend-consent.test.mjs), [deletion tests](tests/backend-delete-all.test.mjs) |
| Lambda import packaging | [Package checks](tests/deploy-package.test.mjs) |

CI includes [security and public-content checks](.github/workflows/security-baseline.yml), [closed-beta preflight](.github/workflows/beta-preflight.yml), and [cross-repository schema drift checks](.github/workflows/care-event-schema-drift.yml). Triggers differ by workflow; the existence of a workflow is not a claim that every check ran for every change.

## Security and operational limits

- PIN mode shares a household credential stored in browser `localStorage`; it does not provide separate caregiver identities or staff permissions. The read-only care view is a UI mode, not an authorization boundary.
- LINE mode verifies ID tokens on the server and resolves the household from a profile. Review invitation and household-assignment behavior before extending this to additional households.
- Reminders describe missing **records**, not confirmed physiological absence or a recommended intervention.
- Record exports are snapshots. Deletion from GutPacer does not automatically erase downstream copies.
- The current frontend depends on CDN libraries and a working API. Production availability, backup configuration and recovery must be checked in the target environment.
- **A push to `main` triggers the frontend deployment even for documentation changes.** API deploys have path filters; closed-beta and legacy-notifier deployments are manual workflows. Publishing a documentation branch and merging it are separate operational decisions.

## Repository guide and contributing

| Location | Purpose |
| --- | --- |
| `frontend/` | Japanese application UI, privacy and terms pages |
| `backend/` | PIN API, LINE API, consent, export and notifier modules |
| `schema/` | Canonical observation contract |
| `tests/` | Unit, contract and source-level regression checks |
| `prototypes/` | Static design exploration |
| `docs/` | Technical and delivery documentation |

See [CONTRIBUTING.md](CONTRIBUTING.md) for small, reviewable changes. Before committing staged public files, run:

```bash
python3 scripts/check_public_repo.py --staged
```

Use synthetic examples. Keep care records, credentials and private working material out of issues, PRs and fixtures.

Further reading: [delivery management](docs/PROJECT_MANAGEMENT.md), [delivered work](docs/TASKS.md), [display evaluation](docs/DISPLAY_DIRECTION_EVALUATION.md), and [public copy boundaries](docs/PUBLIC_COPY_AUDIT.md). Development is solo and AI-assisted; implementation and test evidence should be reviewed directly.

Related open-source work: [Home Assistant accessibility](https://github.com/home-assistant/frontend/pull/54083), [Microduck camera snapshots](https://github.com/pollen-robotics/microduck/pull/241), and [stack-chan sample synchronization](https://github.com/stack-chan/stack-chan/pull/702).

## License

[MIT](LICENSE).
