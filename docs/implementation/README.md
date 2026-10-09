# Orderly implementation plan

Status: Phase 1 complete. Phases 2–4 planned; each requires its own session.

Phase 1 handoff: [implemented foundation and verification](handoffs/phase-1.md).

Post-Phase-1 database follow-up: [Supabase migration and GitHub deployment handoff](handoffs/supabase-foundation.md). Orderly retains independent authentication; live setup is pending server credentials and dashboard integration.

Build a freelance time-tracking app that connects work in Asana, Notion, and GitHub to accurate, reviewable billable time. Implement the following four phases in four separate chat sessions, in order.

| Session | Brief | Working outcome |
| --- | --- | --- |
| 1 | [Foundation, Hallmark UI, and time tracking](phase-1.md) | **Complete** — persisted tracker; [handoff](handoffs/phase-1.md) |
| 2 | [Asana and Notion](phase-2.md) | Imported tasks with reliable synchronization and time tracking |
| 3 | [GitHub pull requests](phase-3.md) | Recorded work linked to PRs and external tasks without duplicate time |
| 4 | [Billing, reporting, and release readiness](phase-4.md) | Reviewed, reproducible billing reports with evidence and exports |

## Confirmed requirements

- Serena MCP on every task; update project memories at completion.
- Each phase is intended for a separate chat session. Finish its handoff before stopping; do not automatically begin the next phase.
- Both Asana and Notion are required initial kanban integrations.
- Use the Hallmark skill for the frontend UI phase and follow the resulting system in later UI work.
- Amber palette with excellent text and button contrast. Use a custom amber theme, dark text on amber primary buttons where contrast permits, and visible keyboard focus. Check actual color pairs in every interactive state: normal text at least 4.5:1, large text and control boundaries at least 3:1; aim for 7:1 for primary body text where practical. Color alone must not communicate status.

## Proposed MVP boundaries

- Individual freelancers, each with a private workspace; structure data for ownership isolation from day one. Team invitations and approval roles are later work.
- Responsive web app using the existing Next.js/TypeScript application in `source/`.
- Durable relational persistence, server-side authentication and authorization, migrations, and background synchronization. Select and document the database/auth/job libraries in Phase 1 after checking the repository and deployment constraints; do not assume services or credentials exist.
- One currency per project; report different currencies separately. Hourly billing, with billable/non-billable entries. Payments, tax calculation, accounting compliance, and automatic currency conversion are outside these four phases.
- Imports flow from Asana/Notion/GitHub into Orderly. Time and billing belong to Orderly. Writeback is deferred.
- Actual timer intervals and explicit manual entries are the source of hours. Board status, commits, and PR lifetime provide context, never automatic billable duration.

## Contracts shared by all sessions

- Model users/workspaces, clients, projects, canonical tasks, time entries, rate history/snapshots, external connections, external object links, PR links, sync jobs/events, audit records, and finalized billing batches incrementally.
- Every entry belongs to one canonical task/project. Multiple external links must not multiply its duration or amount.
- Store UTC instants and exact durations; display and filter in the chosen timezone. Use fixed-precision monetary arithmetic. Default to no time rounding; preserve raw duration when billing rules are applied later.
- One running timer per user, enforced transactionally. Start/stop requests must tolerate retries and simultaneous tabs. Starting another task requires an explicit switch that stops the previous timer.
- Editing duration, task attribution, or billability requires an audit record. Finalized billing records retain their original amounts, rates, and evidence even if upstream objects change.
- External objects use stable provider IDs scoped to their connection/workspace. Imported task metadata can change; recorded time must survive renames, archives, deletions, and disconnects.
- Authenticate callbacks, encrypt provider credentials at rest, restrict access by owner, keep secrets out of logs, and use durable retries with visible sync status.

## How to start a new session

Paste the appropriate instruction, replacing N with 1, 2, 3, or 4:

> Use Serena MCP and implement only Phase N from docs/implementation/phase-N.md. Read AGENTS.md, docs/implementation/README.md, the phase brief, relevant Serena memories, and previous handoff files. Verify prerequisites against the current code. Complete this phase's acceptance checks and write its handoff; update Serena memories before finishing. Use Hallmark for frontend UI, preserve the amber palette and contrast requirements, and do not start the next phase automatically.

The root AGENTS.md commit workflow applies only when the user requests a commit. A phase implementation request alone does not ask for a push or PR.

## Required handoff after every phase

Create `docs/implementation/handoffs/phase-N.md` with:

- Status: complete, partial, or blocked, and which acceptance criteria passed.
- Implemented capabilities and important file/module paths.
- Actual architecture, schema/migration decisions, API contracts, and design-token locations.
- Exact setup/start/check commands and environment variable names (never secret values).
- Checks run and results; distinguish fixtures/mocks from live provider verification.
- Remaining defects, external setup blockers, and the next session's first steps.

Update the phase's status in this index, Serena `implementation_plan`, relevant focused memories, and `task_status`. A new session must inspect code and handoffs rather than assuming planned work is implemented. If a phase cannot finish in one session, leave a precise resume point and continue that phase in the next chat before advancing.

## Current baseline

The application in `source/` implements the Phase 1 tracker with independent account/session authentication and Hallmark amber tokens. The subsequent Supabase follow-up replaces runtime SQLite with private Postgres RPCs and GitHub-managed migrations; live activation remains pending external setup. See both handoffs and `source/README.md` for current contracts and checks. The Supabase GitHub deployment integration is infrastructure, separate from Phase 3's pull-request evidence feature. Provider integrations and billing/export features remain planned. Read `source/AGENTS.md` and installed Next.js documentation before coding.
