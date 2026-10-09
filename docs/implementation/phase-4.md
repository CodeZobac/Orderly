# Phase 4 — Billing, reporting, and release readiness

Status: planned. Execute in its own chat session after Phase 3.

## Start here

Use Serena; read AGENTS.md, the [plan index](README.md), all prior handoffs, and memories for time/rate/evidence invariants and UI. Verify real recorded entries and provider links exist. Reuse Hallmark's amber components for reports and review screens.

## Goal

A freelancer can review a billing period, correct issues, finalize a reproducible billable-work report, and export it with links to supporting tasks and PRs.

## Implementation sequence

1. Implement billing-period review by client/project/task, billable versus non-billable totals, rate overrides with explicit audit history, and unbilled time. Default to exact recorded duration. If optional rounding is offered, show its increment, direction, and aggregation level in the preview and preserve unrounded values.
2. Block finalization of running entries, invalid intervals, missing rates, or inconsistent currency assignments; flag unusually long entries for explicit review. Allow legitimate non-code/manual tasks without requiring a PR.
3. Calculate totals with fixed-precision arithmetic and a documented currency rounding rule. Sum exact line calculations and round at the stated level. Store effective rates, currency, interval allocation, source-entry revisions, labels, evidence URLs, and rounding policy in finalized billing snapshots.
4. Implement draft → finalized billing batches. Finalized entries cannot be silently edited or billed twice. Corrections require an audited adjustment or void/reissue flow. Split entries spanning billing boundaries into non-overlapping allocations so adjacent periods cannot bill the same seconds twice.
5. Build reports with date/project/client filters, task subtotals, recorded versus billed durations, amounts, and source/PR evidence. Export CSV and a print-ready report; verify the exported totals match the UI and guard CSV cells against formula injection.
6. Complete end-to-end coverage, accessible/responsive UI checks, durable job monitoring, backup/restore verification, deployment/runbook instructions, and configuration validation. Prepare a release candidate; actual hosting deployment requires the user's selected environment and authorization.

## Acceptance checks

- An end-to-end flow imports Asana/Notion work, records time, links PRs, reviews a period, and exports matching totals.
- Two billable hours at 60 currency units/hour plus one non-billable hour produce 120 currency units; attaching extra PRs changes neither time nor money.
- Later rate changes and provider renames/deletions leave finalized reports unchanged.
- Duplicate finalize requests and concurrent sessions cannot double-bill an entry or interval allocation.
- Test midnight/daylight-saving boundaries, split billing periods, monetary rounding, multiple currencies kept separate, and audited corrections.
- Run lint, type checks, build, domain/integration/end-to-end tests, contrast/accessibility checks, and backup/restore smoke checks. Record unavailable live services honestly.

## Deliverables and boundary

Billing review and finalization, CSV/print export, reproducible reports, meaningful tests, operational documentation, and `handoffs/phase-4.md`. Update all relevant Serena memories and index status with actual release readiness. This is a billable-work reporting MVP; payment collection, tax-compliant invoicing, provider writeback, native desktop idle detection, and team billing workflows remain future scope.
