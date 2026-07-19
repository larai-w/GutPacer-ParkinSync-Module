# GutPacer Delivery Management

GutPacer is managed as an iterative, evidence-led health-adjacent product. This repository does not claim that a full Scrum team operated formal Scrum events. It demonstrates practical Agile product delivery by connecting stakeholder problems to user stories, acceptance criteria, implementation, verification, release decisions, and operational learning.

## Product outcome

Reduce the memory and hand-off burden around bowel and medication records for family caregivers without turning the application into a diagnostic or treatment tool.

The current release is a single-family, PIN-protected tool. The next validated outcome is a closed beta for 3-5 invited families with LINE identity and server-enforced data isolation. General release is not the current milestone.

## Stakeholders and personas

| Persona | Need | Current product response |
| --- | --- | --- |
| Primary family caregiver | Record daily events quickly and review history | Fast mobile form, history, PDF, LINE reminder |
| Person receiving care | Have daily observations retained without extra interaction | Caregiver-led record; no diagnostic automation |
| Secondary caregiver | Understand the situation when responsibility changes | Planned after identity and access boundaries |
| Care professional | Receive a clearer factual summary during a conversation | PDF output; no clinical recommendation |
| Product operator | Protect records and investigate failures | PIN baseline, PITR, smoke tests, deployment workflows |

Detailed personas and story rationale are maintained in [STRATEGY.md](STRATEGY.md). The 10-to-30-family product plan is in [GROWTH_PLAN.md](GROWTH_PLAN.md).

## Delivery lifecycle

1. **Discover** - capture a caregiver workflow, constraint, incident, or interview question.
2. **Frame** - write a user story and explicitly record what is out of scope.
3. **Define** - add observable acceptance criteria, risk notes, and a validation plan.
4. **Deliver** - implement on `development`; use a linked pull request or traceable commit.
5. **Verify** - run automated tests and record any required real-device or production check.
6. **Release** - merge to `main` only when the relevant release conditions are met.
7. **Learn** - update the worklog, decision record, backlog, and next hypothesis.

## Definition of ready

A user-facing story is ready when:

- the persona, problem, and intended outcome are explicit;
- acceptance criteria are observable and testable;
- dependencies and privacy or safety risks are identified;
- out-of-scope behavior is recorded;
- the validation method is known.

## Definition of done

Work is done when:

- acceptance criteria are met and linked evidence exists;
- relevant automated checks pass;
- authentication and user data boundaries remain intact;
- operational and handoff documentation is updated;
- no secrets or personal health information are committed;
- health-related language remains limited to recording, reminders, and communication support;
- deployment, rollback, or recovery is addressed when production state changes.

## Roadmap and evidence

| Outcome | Evidence | Status |
| --- | --- | --- |
| Fast single-family logging | Issue #1, frontend history, PDF export | Delivered |
| Serverless persistence | Issue #2, API Lambda, DynamoDB | Delivered |
| Reminder workflow | notifier Lambda and corrected bowel-field semantics | Delivered for one family |
| Privacy baseline | Issues #8/#20, PIN auth, CORS fix, XSS escaping, PITR | Delivered; duplicate backlog needs triage |
| Repeatable delivery | API/notifier/frontend GitHub Actions and smoke tests | Delivered |
| Verified user identity | `backend/line-auth.mjs`, LINE Mini App setup notes | In development |
| Multi-family data isolation | v2 table design, migration dry-run, isolation tests | In development |
| Closed beta readiness | Release conditions documented in this delivery model and owner tasks | Not yet released |

The repository history includes failures as well as completed work: incorrect notification semantics, a CORS preflight gap, a Lambda zip layout mismatch, and an AWS region mismatch. These are retained as delivery evidence because resolving and documenting operational failure is part of product management.

## GitHub Project design

Recommended project title: **GutPacer Delivery**

Recommended fields:

| Field | Values |
| --- | --- |
| Status | Todo, In Progress, Done |
| Priority | P0, P1, P2, P3 |
| Phase | Foundation, Closed beta, 10 families, 30 families, Later |
| Area | Product, Frontend, API, Data, LINE, Notifications, Security, Operations, Research, Content |
| Size | XS, S, M, L |
| Target | Unscheduled, Current, Next, Later |

Useful views:

- **Roadmap** grouped by Phase and sorted by Priority.
- **Delivery board** grouped by Status, filtered to Current and Next.
- **User outcomes** filtered to user-story issues.
- **Risks and blockers** filtered to P0 or blocked work.
- **Learning log** showing research, validation, and decision issues.

The workflow in `.github/workflows/project-automation.yml` adds newly opened issues and pull requests to the project. GitHub's repository-scoped `GITHUB_TOKEN` cannot update a user-owned Project, so the workflow requires a narrowly scoped `PROJECTS_TOKEN` secret and a `GUTPACER_PROJECT_URL` repository variable.

## Honest portfolio use

For interviews, describe this as **solo, AI-assisted Agile product delivery led with cloud architecture depth**, not as management of a Scrum team. Strong evidence includes:

- translating a lived caregiver problem into personas and testable stories;
- separating owner-only tasks from automatable engineering work;
- managing privacy, medical-copy, migration, and release risks;
- choosing a closed beta instead of claiming premature general availability;
- preserving acceptance criteria, incident learning, and deployment evidence in public.
- translating AWS serverless architecture, identity boundaries, CI/CD, observability, and recovery constraints into product scope and release criteria.

The strongest interview narrative is not "I used GitHub Projects." It is "I made product and cloud-architecture decisions traceable from stakeholder need to verified outcome, and automated the administrative steps so the evidence stayed current."
