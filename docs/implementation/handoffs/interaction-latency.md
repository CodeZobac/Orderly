# Interaction latency fixes

Implemented locally on 2026-10-20; production performance is not yet measured.

## Changes

- Root layout retains WorkspaceProvider across route changes. Page components reuse the loaded snapshot, pending-save state, errors and memoized daily totals. Refresh is explicit or on return after 60 seconds; there is no data polling.
- Write/auth transitions abort previous GETs, advance a response generation and serialize workspace actions. Uncertain saves retain their idempotency key. Logout/expiry clears private data and view state resets when account identity changes. Background refresh leaves loaded content visible.
- Only elapsed time and the 12-hour notice tick every second. Workspace date state changes on local date rollover. History calculations are memoized, timezone formatters cached (max 64), and midnight boundaries shared per calculation; same-day entries need no binary search.
- Work responses expose safe timing and byte-count headers. Browser User Timing retains one `orderly-work` measure containing request/header/body/JSON durations, bytes, server timing and transport mode. Inspect the request's Timing panel and `performance.getEntriesByName("orderly-work")`; no telemetry service receives these diagnostics.
- `orderly_work` performs existing Orderly session validation, optional mutation and full snapshot in one service-role-only RPC transaction. No Supabase Auth or browser access was introduced. Existing owner locks, retry semantics, rates and audits stay in the underlying functions. Response construction failure rolls a mutation back.

## Deployment

Migration created by the installed CLI: `source/supabase/migrations/20261020001104_work_latency.sql`. It adds one function and its role grants; it does not rewrite tables or old migrations. Include it in the normal GitHub deployment workflow. Working directory: `source`; production branch: `main`. Verify dashboard integration and any required preview check before claiming deployment success.

No migration was applied directly. The current connector has not granted access to Orderly's project, so live schema, grants and deployment are unverified.

Application code can precede the migration: if PostgREST specifically reports the new function missing (PGRST202), it uses the existing authenticated calls for 60 seconds before trying discovery again. It does not fall back on timeouts, network failures or SQL failures, which might have committed a write. Other missing RPCs remain errors. The backend process keeps only discovery capability state, never session authorization, in its cache.

`X-Work-Mode: combined` confirms use of the new function; `legacy` means the old sequence is still active. Deploying the migration is necessary to realize the database round-trip reduction. The first discovery attempt against an unmigrated backend adds one failed lookup; subsequent requests use the old path for the discovery interval.

Combined-mode `auth`, `mutation` and `snapshot` timings are database execution time; legacy-mode stages include their individual remote RPC time. `work` covers route preparation plus the whole operation, `serialize` measures JSON encoding and `total` covers response preparation. These spans overlap and must not be added together. Server total excludes sending the response over the network. Browser header/body/parse measurements include the client side. X-Work-Bytes is the uncompressed JSON body size.

## Verification

- TypeScript route generation/type checking, targeted ESLint for all changed TypeScript files, and the Next.js production build passed. Final results are recorded in Serena task_status.
- SQL reviewed statically for function signature, existing session validation, transaction reuse, empty search_path, SECURITY INVOKER and revoked public/anon/authenticated grants. The PostgreSQL fixture registry recognizes the new RPC for future authorized runs.
- No automated tests, browser tests/replays, benchmarks, migration execution or live production verification were run. No before/after latency claim is made.

## Conditional follow-up

Use timing/payload evidence from normal use to decide whether full history/audit transfer warrants range-based APIs or paging. This change preserves complete history for totals, task pages and billing. Do not substitute a partial snapshot without adapting every consumer and reconciliation rule. Production warm/cold profiles and transaction/concurrency/DST/navigation verification remain for an explicitly authorized test pass.

Investigation and original acceptance criteria: [interaction latency plan](../plans/interaction-latency.md).
