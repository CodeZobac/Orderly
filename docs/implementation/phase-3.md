# Phase 3 — GitHub pull requests and work evidence

Status: planned. Execute in its own chat session after Phase 2.

## Start here

Use Serena; read AGENTS.md, the [plan index](README.md), prior handoffs, and architecture/integration/UI memories. Verify Phase 2's canonical task IDs and job infrastructure. Reuse the Hallmark amber system.

## Goal

Time entries connect to GitHub PRs and Asana/Notion tasks, giving the freelancer an understandable record of what the work delivered.

## Implementation sequence

1. Implement a GitHub App connection with narrowly scoped repository access, installation lifecycle handling, and secure server-side credentials. Document local callback/webhook setup and required permissions.
2. Let users select repositories and map them to projects. Import PR IDs, URLs, titles, authors, branches, and open/closed/merged state; avoid unnecessary source-code ingestion.
3. Support explicit task ↔ PR links and suggestions from exact external task IDs/URLs in PR titles, descriptions, or branch names. Require confirmation for ambiguous matches. Support multiple PRs for a task and multiple tasks per PR.
4. Show a task's time history alongside linked PR events and source-task details. A timer launched from a PR requires a canonical task selection; a standalone PR can create a local task with explicit project assignment.
5. Process verified GitHub events through the existing durable queue, deduplicate delivery IDs, fetch canonical state, and support missed-event reconciliation. Handle installation removal, repository access changes, and unavailable PRs.
6. Add review reminders for unlinked work and unusually long timers. PR creation, commits, merge, and board transitions must not manufacture billable time or stop a timer without the user's configured and explicit action; automatic timer rules are deferred.

## Acceptance checks

- Connect a repository and link a PR to an Asana task and another to a Notion task.
- One task linked to several PRs still counts its time once. One PR linked to several tasks does not duplicate or reallocate entries.
- Exact-ID suggestions are explainable, ambiguous suggestions remain unconfirmed, and explicit corrections are audited.
- A PR open across several days with 45 recorded minutes still shows 45 minutes of work.
- Duplicate/out-of-order events, revoked installation access, invalid signatures, and missed deliveries recover safely.
- Run lint, type checks, build, linking/deduplication/authorization tests, and a browser test of task → PR → recorded time. Record live GitHub smoke-test results separately from fixtures.

## Deliverables and boundary

GitHub App integration, task/PR linking UI, evidence timeline, setup documentation, tests, and `handoffs/phase-3.md`. Record evidence ownership and billing deduplication invariants in Serena. Billing reports remain Phase 4. Stop after the handoff.

## Official reference

[GitHub webhook best practices](https://docs.github.com/en/enterprise-cloud%40latest/webhooks/using-webhooks/best-practices-for-using-webhooks) informs signature verification, asynchronous processing, delivery deduplication, and missed-delivery recovery. Recheck current GitHub App permissions and API versions when implementing.
