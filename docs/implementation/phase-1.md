# Phase 1 — Foundation, Hallmark UI, and time tracking

Status: complete (2026-10-09). See [handoff and acceptance results](handoffs/phase-1.md).

## Start here

Use Serena; read root and nested AGENTS.md, the [plan index](README.md), and relevant memories. Inspect the current starter. No previous implementation handoff is required. This brief defines planned behavior, not existing functionality.

## Goal

A freelancer can sign in, create a client/project/task, record time, correct entries, and see daily/weekly totals that persist across reloads.

## Implementation sequence

1. Choose and record the persistence, authentication, migration, and future background-job approach. Provide local setup, environment examples without secrets, and reproducible migrations. Enforce workspace ownership on every server operation.
2. Create clients, projects, tasks, time entries, and audit records. Projects have currency and default hourly rate; entries store the applicable rate so later rate changes do not silently rewrite earlier work.
3. **Use Hallmark for the frontend.** Read its SKILL.md and applicable references, inspect existing CSS/fonts, announce files to be changed, and follow its design workflow. The user has requested an amber palette and authorized proceeding; infer audience = individual freelancers, main action = start/stop work on a task, tone = utilitarian. Use custom amber theme guidance; keep framework CSS directives intact.
4. Build navigation and reusable components around Today/timer, Projects, task detail, Timesheet, and Settings. Provide honest empty, loading, validation, error, and success states. Integration settings can be clearly marked as upcoming; do not present them as connected. Preserve theme tokens and Hallmark preflight/log artifacts for later sessions.
5. Implement server-backed start, stop, resume, and explicit task switching. Derive elapsed time from persisted timestamps, not accumulated browser ticks. Refresh/reopen restores the active timer. Handle failed requests without silently losing or fabricating entries; offline starts are not part of this MVP.
6. Implement manual entries, notes, billability, edit/delete audit history, overlap validation, timezone selection, daily/weekly totals, and rate snapshots. Separate unfinished timers from finalized durations. Flag long-running timers for review instead of inventing idle-time deductions.

## Acceptance checks

- A new user can complete client → project → task → timer → timesheet with persisted data.
- Two browser tabs cannot create two active timers; repeated start/stop requests cannot duplicate entries.
- Refresh and browser restart preserve timer state. Manual intervals reject negative durations and overlapping work for the same user; boundary-touching intervals are allowed.
- Timezone/daylight-saving and midnight boundaries produce correct durations and daily totals.
- One user cannot read or mutate another user's data through direct requests.
- Amber text/button/focus/disabled/error state pairs meet the plan's measured contrast targets. Verify keyboard navigation, accessible labels, reduced motion, and layouts at 320/375/414/768 px plus desktop using Hallmark's visual checks.
- Run lint, TypeScript checking, production build, domain tests for timer concurrency and durations, and a browser smoke test of the core journey. Record actual results and limitations.

## Deliverables and boundary

Working persisted tracker, migrations, reusable Hallmark components/tokens, meaningful tests, setup instructions, and `handoffs/phase-1.md`. Record the selected stack, route/module map, timer contract, and design decisions in Serena. Provider integrations and billing exports belong to later phases. Stop after the handoff.
