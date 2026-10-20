# Interaction latency investigation and fix plan

Date: 2026-10-20. Scope: investigate and fix 3–4 second delays when starting/stopping timers, creating items, and changing workspace views. The initial findings below describe the code before these fixes.

## Implementation status

- Implemented persistent root-layout WorkspaceProvider with in-memory data, shared memoized finalized totals, one refresh on mount, deduplicated visible/focus refresh after 60 seconds and explicit refresh. Navigation consumes the existing data. No polling or browser storage.
- GETs are aborted/invalidated before writes or authentication changes. Generation checks reject stale results; a synchronous operation lock prevents concurrent saves and unresolved retries block new mutations. Logout/expired session clears private state; Tracker view/feature state is keyed by account and resets on identity change. Unknown network/JSON outcomes retain the original idempotency key.
- Isolated elapsed timer and long-running notice ticks from the workspace. Date-dependent totals update when the local date changes. Timezone formatters have a bounded cache; daily totals skip boundary searches for same-day intervals and reuse local date boundaries for overnight intervals.
- Added Server-Timing (work/auth/mutation/snapshot/serialization/total), X-Work-Bytes, X-Work-Mode and a bounded browser User Timing measure named orderly-work with numeric durations, payload bytes and transport mode. Diagnostics contain no account data or credentials; unsupported browser measurement options cannot fail an operation.
- CLI-generated migration: source/supabase/migrations/20261020001104_work_latency.sql. Service-role-only orderly_work validates the existing hashed Orderly session and calls the existing mutation and snapshot functions in one transaction. Existing locking/idempotency/ownership rules remain in effect; a snapshot error now rolls back the mutation on this path.
- Application-first rollout is supported: only a PGRST202 missing-function response falls back to the legacy RPC sequence, with discovery retried after 60 seconds. All other errors propagate without replaying a potentially committed write. X-Work-Mode is combined or legacy. Until migration deployment, the legacy path retains its original separate-transaction semantics and round trips.
- Full history remains complete. Pagination, optimistic writes and region/index changes remain conditional follow-up because no live payload/profile/SQL evidence is available. Do not silently truncate totals, task history, audit or billing input.
- No tests, browser replay, database mutations/deployments, commits or pushes were performed for implementation. Verification results and rollout instructions: ../handoffs/interaction-latency.md.

## Findings and evidence

1. **Every work mutation waits for three sequential remote RPCs.** `source/app/api/work/route.ts` POST awaits `authenticate` → `mutate` → `snapshot`, mapping to `orderly_auth` → `orderly_mutate` → `orderly_snapshot`. `Tracker.save` keeps the workspace busy until the complete response has arrived and been parsed. Timer and item changes share this path. There is no optimistic update. Network latency and snapshot construction both sit on the critical path. This is confirmed architecture, not a measurement of each RPC's cost.
2. **Existing development trace shows a slow work request.** The existing `source/.next/dev/trace` contains a `/api/work` render span of 2,624.3 ms and a request span of 2,669.9 ms. This is one historical development request, not a representative sample, and does not isolate network, authentication, SQL, or serialization time. The same trace includes compilation spans of 935.1–3,636.5 ms. Compilation can explain cold development navigation, but cannot alone explain recurring warm saves. Do not add these overlapping spans together.
3. **Workspace state is owned by page-level Tracker instances.** Both `app/page.tsx` and `app/[...view]/page.tsx` render Tracker; no shared persistent workspace provider exists. Tracker starts with null data/loading=true and fetches `/api/work` on mount. Crossing the home/catch-all page boundary remounts it; parameter changes within the catch-all need browser confirmation rather than assuming every navigation remounts. A remount loses loaded data and waits for authentication plus a full snapshot. Billing/settings features additionally fetch their own data after mounting.
4. **The timer tick repeats expensive history calculations.** Tracker ticks every second and unconditionally calls `dailyTotals(data.entries, timezone)`. `dailyTotals` calls `nextDay` for each finalized interval/day, which binary-searches a 48-hour millisecond range (~27 iterations). Every iteration constructs an `Intl.DateTimeFormat` through `dayKey`. This repeats even when history has not changed. CPU impact depends on history size and is not yet measured.
5. **Full snapshots grow with history.** The latest snapshot SQL in `20261009235442_phase_two_integrations.sql` returns every client, project, task, nondeleted entry and audit row; task external metadata includes correlated subqueries. Every save pays this cost. Actual row counts, payload size, indexes and SQL plans were not available for this review.
6. **The loader does not impose a minimum wait.** WorkspaceLoader is a visual component; the observed delay is not an intentional three-second loading timeout. Local timer animation does not explain the shared mutation request delay.

## Measurement limits

- No browser replay, benchmark, automated tests, account creation, timer change, or schema mutation was performed.
- Supabase MCP lists a different accessible project. A read-only statistics request against Orderly's configured project was rejected for lack of permission; no live SQL timing, region, locks, deployment state or migration parity is claimed.
- Repository handoffs contain historical deployment blockers and cannot establish current deployment state.
- Existing traces describe the local development run only. Confirm whether the reported experience is this run or a deployed build before attributing the whole delay to compilation.

## Implementation sequence

### 1. Attribute latency before changing the persistence contract

Add safe `Server-Timing` measurements for session validation, mutation, snapshot and total handling to `/api/work`; separately record client response/JSON processing time and snapshot byte size. Do not log cookies, tokens, request bodies, user identifiers or secret keys. Capture cold versus warm navigation, start, stop and item creation separately during ordinary use. Use read-only database statistics/EXPLAIN when project access is available. Never use EXPLAIN ANALYZE on mutating RPCs in production.

Acceptance: identify how much time is browser work, development compilation, app→database round trips, SQL execution, and response handling. No arbitrary index or infrastructure changes without this evidence.

### 2. Remove repeated work from the browser

Memoize finalized daily totals by entries reference and timezone; keep the one-second clock confined to the active timer display. Reuse timezone formatters rather than constructing them inside every date comparison. Memoize other derived history/grouping only where the profile shows cost. Place hooks before conditional returns to preserve hook order. Preserve DST splitting, Monday weeks, and exclusion of active intervals from finalized totals.

Acceptance: ticking the active clock does not recompute finalized history. Historical totals remain correct across edits and timezone changes. Proposed interaction-feedback target: under 100 ms on the target device; this is a target, not a measured result.

### 3. Preserve workspace data across navigation

Introduce a persistent authenticated workspace provider/shell in the common layout (or a shared route-group layout covering home and all workspace views). Keep pathname-dependent rendering under the Suspense boundary required by the installed Next.js version and cacheComponents. Pages retain URL validation; views consume shared state. Scope state to the current authenticated session, clear it on logout/account change, and ignore responses from a previous session or an unmounted request.

Retain initial/manual/focus refresh semantics; do not add polling or persistent browser storage for private snapshots. Refresh in the background with the existing view visible. Guard against older GET responses overwriting newer mutations. Cache feature-specific view data only with explicit invalidation and session scoping. Preserve deep links and back/forward behavior.

Acceptance: home→projects→timesheet→home does not trigger another full work GET solely because of navigation. Switching a loaded view remains interactive while optional feature data refreshes. Confirm same-catch-all behavior using browser evidence.

### 4. Reduce database round trips safely

Add service-role-only RPC entry points that validate Orderly's hashed opaque session in the database and perform the requested operation plus the necessary response construction in one transaction. GET should validate and read in one RPC; POST should validate, mutate and return committed state in one RPC. Preserve independent Orderly auth; never accept a browser-supplied owner or introduce Supabase Auth.

Reuse current mutation logic and retain owner-row locking, idempotency-key/payload matching, version/overlap checks, atomic timer switch, rate snapshots, audits and session expiry/revocation. Return a fresh authoritative server timestamp. A mutation that fails while constructing its response should roll back consistently; document this improvement over the current separate mutation/snapshot transactions. Retrying a lost response must return the same committed operation safely.

Create any migration with the installed `supabase migration new` under `source/supabase/migrations/`; deploy through the established GitHub integration. Keep RLS/private tables, SECURITY INVOKER/empty search_path and service-role-only execution. Verify deployment access/integration instead of claiming it is live. Do not parallelize session validation with owner-dependent writes or cache authorization to hide latency.

Acceptance: one app→Supabase request per work operation, with equivalent ownership and timer invariants. Measure warm p50/p95 after instrumentation; choose deployment-region changes only if network timing supports them.

### 5. Reduce snapshot size if measurements justify it

Split workspace reference data, current/recent entries, paginated history and audit history. Update consumers deliberately: Today/week totals must not silently use incomplete history; task details, timesheet, billing and reports need explicit complete ranges or server aggregates. Prefer a small authoritative mutation result plus targeted cache updates/invalidation once the response contract is designed. Keep full-snapshot compatibility during rollout where needed.

Consider optimistic feedback only after ordering/reconciliation is reliable. Pending timer feedback must reconcile with server time and avoid falsely declaring success. Item creation may use temporary IDs with rollback. Preserve the exact retry key for uncertain network outcomes; never replay a start/stop with a new key automatically.

Acceptance: routine timer operations do not transfer an unbounded audit/history snapshot; history and billing remain complete and auditable.

## Verification when explicitly authorized

No tests are authorized by this planning request. Once requested, cover timer start/stop/switch/retry and concurrent owner locking; session isolation/logout; stale response races; history/date boundaries and DST; navigation/deep links/back-forward; paginated totals/billing completeness; warm production-mode timing and a realistic-history browser profile. Lint/type checking can accompany implementation. Report measurements separately from correctness checks and distinguish development compilation from steady-state production latency.

## Serena repair completed

The installed Serena 1.6.0 expects `languages`, while Orderly's project configuration used `language_servers`. Restored the installed schema's `languages: [typescript]`. Removed `--project-from-cwd` from the global Codex Serena launch arguments, because the desktop process detected the home directory and crashed loading its incompatible project configuration. Preserved the context allowing explicit project activation and backed up the global config as `config.toml.serena-backup`.

Verified an actual stdio MCP initialize/initial_instructions/activate_project exchange and TypeScript language-server startup. Used Serena MCP through a temporary SDK client because the current chat's native tool registry has not reloaded. Restart/reconnect Codex to refresh native tools. Other registered projects still have compatibility warnings; their files were not modified.
