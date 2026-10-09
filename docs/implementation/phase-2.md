# Phase 2 — Asana and Notion integrations

Status: planned. Execute in its own chat session after Phase 1.

## Start here

Use Serena; read AGENTS.md, the [plan index](README.md), `handoffs/phase-1.md`, and memories for architecture, timers, and UI. Verify the persisted tracker and ownership checks work. Reuse the Hallmark amber system for new screens.

## Goal

A freelancer can connect both Asana and Notion, select task sources, map them to Orderly projects, and track time against imported tasks.

## Implementation sequence

1. Add connection, external task link, source mapping, sync state, durable job/event, and credential-storage models. Define provider adapters for connect/disconnect, source discovery, paginated import, normalization, and reconciliation. Verify each provider's current API and authentication requirements before coding.
2. Implement Asana OAuth, project selection, task import, and section/status mappings. A task appearing in several Asana projects must not create repeated time records; require a billing-project assignment if ambiguous.
3. Implement Notion authorization and selection of accessible databases/data sources. Map title, status/select, optional assignee, and due-date properties through a configuration screen. Store stable property IDs; surface schema changes for remapping. Do not assume every database is a task board.
4. Normalize provider tasks into canonical Orderly tasks. Preserve provider URLs and stable IDs. Allow explicit linking to an existing task; do not merge Asana and Notion tasks just because their titles match. Keep external metadata ownership separate from local notes, rates, and time.
5. Add initial import, incremental updates, authenticated webhooks, deduplication, retry/backoff, rate-limit handling, periodic reconciliation, and manual resync. Fetch current state when events arrive out of order. Acknowledge events only after durable receipt.
6. Build connection/source mapping screens, provider badges, last successful sync/error status, reconnect/disconnect controls, and a unified task list with start-timer actions. Archived or inaccessible source tasks retain historical entries.

## Acceptance checks

- Import paginated task collections from both providers and start/stop time on each.
- Repeating imports or webhook deliveries produces no duplicate tasks or durations.
- Rename/move/complete/archive scenarios update metadata without changing recorded time or rates.
- A Notion property rename, incompatible type change, or revoked source access yields a clear recovery path.
- Handle expired/revoked credentials, rate limits, temporary outages, invalid callbacks, and replayed events in tests.
- Disconnect stops future sync and removes usable credentials while preserving time records and historical labels.
- Run lint, type checks, build, adapter/worker tests, and browser tests of mapping and import flows. Perform live smoke checks in Asana and Notion when credentials are available; otherwise mark live verification blocked rather than claiming completion.

## Deliverables and boundary

Both provider adapters, reliable synchronization, integration UI, setup instructions for callbacks/scopes/environment variables, fixture tests, and `handoffs/phase-2.md`. Record source ownership, stable-ID rules, adapter contract, and setup blockers in Serena. Do not write time or statuses back to providers. Stop after the handoff.

## Official references

- [Asana OAuth](https://developers.asana.com/docs/oauth) and [webhook guide](https://developers.asana.com/docs/webhooks-guide): implement provider-specific authorization and webhook verification/lifecycle.
- [Notion data model](https://developers.notion.com/guides/data-apis/working-with-databases): databases, data sources, and pages are separate objects; mappings must identify the correct data source.
- [Notion authorization](https://developers.notion.com/guides/get-started/authorization) and [webhooks](https://developers.notion.com/reference/webhooks): verify access and event handling against the API version pinned during implementation.
