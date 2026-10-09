# Orderly

Phase 1 is a solo freelancer tracker: private account, clients/projects/tasks, one persisted timer, manual intervals, corrections with audit history, and timezone-aware daily/weekly totals. Asana, Notion, GitHub, and billing exports are upcoming phases.

## Local setup

Requires Node.js 24+ and npm. Run from `source/`:

```sh
npm ci
cp .env.example .env.local
npm run db:check
npm run dev
```

Configure `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in ignored `.env.local`. The supplied publishable key is retained as `SUPABASE_PUBLISHABLE_KEY`; private Orderly operations use the server secret. Authentication remains Orderly's own implementation. A missing or placeholder secret returns a setup error rather than opening private database access.

Enable the Supabase GitHub integration for `CodeZobac/Orderly`, with working directory `source` and production branch `main`. Commit versioned migrations under `supabase/migrations/` through the normal pull request workflow. Enable production deployment when configuring the integration. Optional preview branching should be configured with awareness of its billing; require its successful check before merging when enabled. Dashboard connection and live deployment are pending: see [Supabase handoff](../docs/implementation/handoffs/supabase-foundation.md). `db:check` loads `.env.local` and verifies RPC access; it does not deploy migrations.

Open http://localhost:3000 and create an account with a password of at least 12 characters after the migration is deployed. `ORDERLY_ORIGIN` sets the exact allowed browser origin. Fonts remain self-hosted. Webpack is used for dev/build because this environment blocks Turbopack CSS-worker IPC; Tailwind uses the official PostCSS adapter.

Existing SQLite data is preserved. Stop the old app, back it up, and run `npm run db:import -- /absolute/path/orderly.sqlite` against an empty migrated Supabase database. Import is a single transaction and preserves account IDs, password hashes, session hashes, intervals, rate history, audit and retry records. It refuses a nonempty target; it does not modify the source file or create an export containing credentials. Old `migrations/` files remain for legacy import verification only.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser suite starts the app on port 3200 and a test-only RPC service on port 3001. The actual SQL migrations run in embedded PostgreSQL (PGlite); the real Supabase SDK communicates with the local fixture. No live Supabase data is touched. Each run creates unique accounts. Screenshots and contrast measurements are written to ignored `test-results/`. `npm run format` formats application code. On environments restricting subprocess IPC, run tests/build/browser with the appropriate execution permission.

For production: deploy migrations through GitHub, configure server secrets and `ORDERLY_ORIGIN` to the HTTPS public origin, then `npm run build` and `npm start`. Production session cookies require HTTPS. Durable storage lives in Supabase, allowing stateless app hosts. Arrange database backups and verify restore procedures. `npm run smoke:production` creates a test account/client against `ORDERLY_SMOKE_ORIGIN` (default localhost:3100); use an isolated fixture or preview environment, not an unattended production dataset.

## Architecture and contracts

- Next.js App Router, strict TypeScript, React, server-only Supabase SDK over PostgREST RPC; Postgres schema and functions in `supabase/migrations/`.
- A user's ID is the private workspace ownership key. All reads/mutations resolve ownership server-side; related client/project/task IDs are checked before writing. No team workspace UI.
- Authentication uses Node scrypt with per-password salts, random 256-bit session tokens, only token hashes persisted, 30-day HttpOnly/SameSite Strict cookies, logout revocation, and persistent per-email login throttling. Password reset and email verification are outside this local MVP; do not advertise them.
- `GET /api/work` returns the authenticated workspace snapshot and server `now`; no-store. `POST /api/auth` accepts `register|login` with email/password or `logout`.
- `POST /api/work` requires a unique `key` and `action`. Actions: `client {name}`, `project {clientId,name,currency,rate}`, `task {projectId,name}`, `rate {projectId,rate}`, `start {taskId}`, `stop {entryId}`, `switch {entryId,taskId}`, `manual {taskId,start,end,billable,notes}`, `edit {entryId,version,taskId,start,end,billable,notes}`, `delete|restore {entryId,version}`, `timezone {timezone}`. Rate is a decimal string; start/end are UTC epoch milliseconds. Mutations reject cross-origin requests; direct clients must send the configured Origin.
- Every mutation is one Postgres RPC transaction, locking the owner user row before interval/idempotency checks, with an ownership-scoped idempotency key. Reusing a key with another payload returns 409. Successful retries return the original result and a fresh snapshot. Keys and audit records are durable. Failed requests leave the transaction unchanged. Uncertain network saves retain the original payload/key for explicit retry; no offline start queue.
- A partial unique index enforces one unfinished entry per user across processes/tabs. A start while any timer runs returns 409; switch requires the expected active ID and stops/starts atomically at one boundary. Resume creates a new interval for the same task. Repeated stop of an already stopped entry does not create work. UI refreshes on focus and every 15 seconds.
- No tick accumulation: active elapsed time derives from persisted UTC start and server-clock offset. Active time is excluded from finalized totals. Timers over 12 hours require review; no invented deductions.
- Final intervals must have end > start and may touch but never overlap another undeleted interval, including an active timer. Corrections use optimistic versions (409 on stale edits); delete is soft with Undo; corrections, deletes/restores, starts/stops keep before/after audit records.
- Rates are integer minor units; project rate history is append-only. Every interval snapshots its project rate/currency. Changing a default rate leaves recorded snapshots intact. Task reattribution intentionally snapshots the destination project's current rate/currency and is audited. No monetary float arithmetic, billing calculations, rounding, or currency conversion.
- Daily totals split finalized intervals at local date boundaries with DST-aware binary search. Weeks begin Monday. Manual/edit forms explicitly accept UTC timestamps (with millisecond precision), avoiding ambiguous local DST input; display follows the chosen IANA timezone.
- Future background sync: a separate worker using a durable Postgres jobs table with leases, provider-scoped dedupe, retry/backoff, and visible status. No request-bound timers or in-memory queues. Add this in Phase 2 with encrypted credentials and provider verification; no scheduler is implemented in Phase 1.

## Module map and design

`lib/db.ts`: private Supabase RPC transport; `lib/auth.ts`: credentials/sessions; `lib/domain.ts`: owned RPC calls; `supabase/migrations/`: transactional timers/audit/idempotency; `lib/time.ts`: exact durations/date boundaries; `lib/http.ts`: origin/JSON/error handling; `lib/types.ts`: shared contracts. `components/tracker.tsx` owns the workspace views; `components/fields.tsx` provides shared labelled fields and submit states. Routes: `/` Today, `/projects`, `/tasks/:id`, `/timesheet`, `/settings`; `/api/auth`, `/api/work`.

Hallmark custom amber Workbench system: `tokens.css` is the portable source, imported by `app/globals.css`. Geist display/body and Geist Mono tabular time, light warm paper, restrained amber buttons with dark text, dark amber focus. `.hallmark/log.json` and `docs/implementation/handoffs/phase-1.md` preserve design/verification decisions. Preserve tokens in later phases; integrations currently say “Upcoming · not connected”.

Private tables live in `orderly_private` with RLS enabled and no public policies. Composite ownership foreign keys prevent cross-user relationships. Exposed `public.orderly_*` RPCs use SECURITY INVOKER, an empty search path, and service-role-only EXECUTE grants. Orderly does not use Supabase Auth identities or trust a browser-supplied owner ID.
