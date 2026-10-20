# Connections and parallel timers

Implemented locally on 2026-10-20. Production activation is not verified. Tests were not authorized and were not run.

## Behavior and contracts

- Settings → General retains timezone and operations, and adds the simultaneous timer limit (default 2, positive integer, or No limit). Connections owns Notion/Asana and GitHub setup. OAuth callbacks return to `/settings/connections`.
- Notion workspace and authorizing-person IDs/names are retained separately from credentials. User IDs in people properties determine eligibility; names/emails never establish identity. Reconnect old connections before enabling automation. Truncated people lists are paginated before eligibility checks.
- Discovery lists only accessible data sources. Inspect shows every exposed property and mapping choices. New selected sources create a project under a connection-specific client, with EUR/zero-rate defaults; existing source mappings are reused and never merged by name. Explicit project links preserve rates and historical attribution.
- Mapping uses stable property/option IDs, with explicit Doing options and an automation checkbox. Ambiguous properties require a choice. Initial import, reconnect, remap, or access recovery establishes a full-scan baseline. A newly discovered task also establishes its own baseline; no inferred historical time is created.
- Later transitions into Doing start only the connected person's assigned tasks. Leaving Doing stops that task when it belongs/belonged to that person; loss of assignment stops only a Notion-origin timer. Manual stops do not restart during unchanged Doing scans. Assigning someone to an already-Doing task does not start a timer.
- Owner-row serialization and an entry trigger enforce capacity and same-task nonoverlap across every write path. Different tasks may overlap; their full durations and project rates count independently. Lowering capacity preserves existing timers. Blocked starts notify once per transition and are not queued.
- Starts/stops use observation time, never webhook timestamps. Duplicate hints re-read canonical state; older provider `updated_at` metadata cannot regress state. Sync fencing and generations prevent retired work from committing. Status observation, timer mutation, and event insertion are one transaction.
- Timer events have monotonic cursor IDs and origin. Request replay and persisted Notion transition state suppress duplicate mutations/events. Visible tabs poll every 5 seconds and on focus; a cursor advances only after an accepted fresh snapshot. Full snapshots are not polled when nothing changed.
- Notification claims are owner-scoped, leased for 30 seconds, and acknowledged after display. Interrupted claims can be recovered. Multiple tabs cannot simultaneously claim a notification. A display-before-ack crash can replay that notification after the lease expires (at-least-once recovery). No private state is stored in browser storage. Origin `orderly` is toast-only; external changes/blocked starts also queue one bundled sound per event. Browser restrictions expose Enable sound. Closed apps cannot play sounds.
- Disconnect/access loss disables automation, preserves history and running timers, and requires manual stopping/recovery. Provider status changes remain in Notion; timer actions never write Notion properties. GitHub remains evidence/account/repository management.

## Database and deployment

CLI-generated migration: `source/supabase/migrations/20261020003346_connections_parallel_timers.sql`.

Adds user capacity, connection identity, source baselines, timer origin, observed Notion states, durable timer events, and service-role-only event RPCs. Replaces user-wide uniqueness with per-task uniqueness, updates mutations/snapshots/board sync, and preserves legacy SQLite import defaults. All new tables are private with RLS; independent Orderly sessions and service-role invoker functions remain the access boundary.

Deploy through the Supabase GitHub integration for `CodeZobac/Orderly`, working directory `source`, production branch `main`. Deploy the complete ordered migration set before the app/worker version that calls these functions. Do not apply directly in production. Pause the old worker during rollout, deploy schema and new app/worker together, then reconnect Notion and enable selected boards. Baseline scans prevent existing Doing tasks from starting on rollout.

The checkout already contained pending phase-four/workspace changes and two predecessor migrations when this task began. They were preserved. The user subsequently requested stopping final checks and pushing all pending changes. The pending work is included in logical commits on main; no PR merge is involved. Actual database deployment remains unverified; require the preview check where configured.

Observed local blockers (values were not printed):

- `NOTION_WEBHOOK_VERIFICATION_TOKEN` missing.
- `ORDERLY_ORIGIN` is not a production HTTPS origin.
- `GITHUB_APP_PRIVATE_KEY` is not a valid RSA key.
- Asana client credentials absent (only needed for Asana).
- No local sync worker process is running.
- The Supabase connector denies access to the configured project, so migration history and dashboard GitHub integration cannot be verified. Its available project is a different project; do not deploy there.

Supply valid server configuration, finish Notion webhook verification, and run the worker as a supervised service after deploying. Missing webhook configuration is shown in Connections; the worker's periodic reconciliation can still detect transitions, but timing is delayed. Aggregated/missed provider transitions cannot reconstruct an exact historical timeline.

## Acceptance scenarios prepared (not executed)

1. Sidebar navigation/direct URLs/OAuth returns select General or Connections correctly; existing Asana and GitHub evidence controls still work.
2. Connect Notion, verify workspace/person, browse paginated access, inspect fields, and select a board. Repeating selection reuses its project. Same-name boards remain distinct. Existing explicit links/rates are unchanged.
3. Exercise ambiguous/missing property mappings, renamed/deleted Doing options, absent OAuth identity, and people lists longer than 25. Failed access must not be treated as unassignment.
4. Import already-Doing tasks, reconnect, remap, and recover access: no timers start. A later non-Doing → Doing transition assigned to the connected owner starts once. Other people's and unassigned tasks never start.
5. Leave Doing, lose assignment, manually stop, retry duplicate events, and deliver older metadata. Verify targeted stops, no restart on unchanged Doing, and generation/lease fencing.
6. Start concurrently from browser tabs and worker at capacity. Verify per-task uniqueness, default limit 2, limit 1, No limit, lowering limits while running, and no queued restart after a blocked transition.
7. Record overlapping different-task hours: each counts fully and uses its own saved rate. Same-task overlaps remain rejected. Verify edit/delete/restore, manual historical entries on a currently running task, rate changes, frozen billing allocations, and legacy imports.
8. Verify toasts for all successful time mutations and silent Orderly-origin events. External events each play a short sound. Check blocked audio, dismissal, offline return, claim retry/expiry, multiple tabs, pending save retries, and logout/account isolation.
9. Check worker supervision and signed webhook delivery after deployment. Inspect migration history and private grants with Supabase MCP; do not infer success from configuration alone.

## Verification record

Final command outcomes are recorded in the task completion message and Serena `task_status`. SQL compilation checks only schema/function syntax in an isolated database; they do not exercise application scenarios, concurrency, or live deployment.
