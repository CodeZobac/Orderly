# Orderly

Phase 1 is a solo freelancer tracker: private account, clients/projects/tasks, persisted parallel timers, manual intervals, corrections with audit history, and timezone-aware daily/weekly totals. Phase 2 adds Asana and Notion OAuth, task mapping/imports and durable synchronization; live activation and acceptance verification are pending. Phase 3 adds a GitHub App, repository mapping, PR imports, explicit task links, evidence timelines and review reminders; live setup and acceptance are pending. Phase 4 adds unbilled billing-period review, audited rates, immutable finalized allocations, CSV/print exports, and durable-job monitoring; acceptance and release verification remain pending. See the [Phase 2 handoff](../docs/implementation/handoffs/phase-2.md) and [Phase 3 handoff](../docs/implementation/handoffs/phase-3.md) for provider setup and worker operation.

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
- `POST /api/work` requires a unique `key` and `action`. Actions: `client {name}`, `project {clientId,name,currency,rate}`, `task {projectId,name}`, `rate {projectId,rate}`, `start {taskId}`, `stop {entryId}`, `switch {entryId,taskId}`, `manual {taskId,start,end,billable,notes}`, `edit {entryId,version,taskId,start,end,billable,notes}`, `delete|restore {entryId,version}`, `timezone {timezone}`, `timer_preferences {timerLimit}` (positive integer or null for no limit). Rate is a decimal string; start/end are UTC epoch milliseconds. Mutations reject cross-origin requests; direct clients must send the configured Origin.
- Every mutation is one Postgres RPC transaction, locking the owner user row before interval/idempotency checks, with an ownership-scoped idempotency key. Reusing a key with another payload returns 409. Successful retries return the original result and a fresh snapshot. Keys and audit records are durable. Failed requests leave the transaction unchanged. Uncertain network saves retain the original payload/key for explicit retry; no offline start queue.
- A partial unique index enforces one unfinished entry per task. The account timer limit defaults to two and can be changed or removed in Settings → General. Owner-row locking enforces capacity across tabs and the sync worker. Start preserves other timers; the compatibility switch API stops only its explicit entry ID. A repeated stop does not create work. Every timer counts its full duration independently. Timer event cursors are polled every five seconds while visible and on focus; only changed cursors require a new workspace snapshot. Elapsed displays still tick locally.
- No tick accumulation: active elapsed time derives from persisted UTC start and server-clock offset. Active time is excluded from finalized totals. Timers over 12 hours require review; no invented deductions.
- Final intervals must have end > start and may touch but never overlap another undeleted interval on the same task, including its active timer. Intervals on different tasks may overlap and count fully toward their respective totals and billing. Corrections use optimistic versions (409 on stale edits); delete is soft with Undo; corrections, deletes/restores, starts/stops keep before/after audit records.
- Rates are integer hundredths of currency units; project rate history is append-only. Every interval snapshots its project rate/currency. Changing a default rate leaves recorded snapshots intact. Task reattribution intentionally snapshots the destination project's current rate/currency and is audited. Billing uses exact integer/numeric arithmetic and an explicit per-currency rounding policy; no currency conversion.
- Daily totals split finalized intervals at local date boundaries with DST-aware binary search. Weeks begin Monday. Manual/edit forms explicitly accept UTC timestamps (with millisecond precision), avoiding ambiguous local DST input; display follows the chosen IANA timezone.
- Background sync: source map/resync and verified webhooks invoke the existing durable worker through Next `after()` on Vercel. Each batch handles up to 20 pages and stops starting pages after two minutes, under a 300-second route limit. Connections refreshes progress every five seconds while visible and wakes pending work every fifteen seconds, so previously queued imports resume on opening the page. `POST /api/integrations` action `run` requires an Orderly session and same origin. Three-minute fenced leases, durable cursors, event deduplication and retry/backoff remain authoritative. For unattended retries/reconciliation without request traffic, deploy the supervised `npm run sync:worker` process separately; `-- --once` handles one due page. Configure provider credentials and `ORDERLY_INTEGRATION_KEY` first.

## Module map and design

`lib/db.ts`: private Supabase RPC transport; `lib/auth.ts`: credentials/sessions; `lib/domain.ts`: owned RPC calls; `supabase/migrations/`: transactional timers/audit/idempotency; `lib/time.ts`: exact durations/date boundaries; `lib/http.ts`: origin/JSON/error handling; `lib/types.ts`: shared contracts. `components/tracker.tsx` owns the workspace views; `components/fields.tsx` provides shared labelled fields and submit states. Routes: `/` Today, `/projects`, `/tasks/:id`, `/timesheet`, `/settings`; `/api/auth`, `/api/work`.

Hallmark custom amber Workbench system: `tokens.css` is the portable source, imported by `app/globals.css`. Geist display/body and Geist Mono tabular time, light warm paper, restrained amber buttons with dark text, dark amber focus. `.hallmark/log.json` and `docs/implementation/handoffs/phase-1.md` preserve design/verification decisions. Preserve tokens in later phases. Settings now configures Asana/Notion sources and billing links; imported tasks use provider/status badges. GitHub has separate repository mappings and PR evidence controls.

Private tables live in `orderly_private` with RLS enabled and no public policies. Composite ownership foreign keys prevent cross-user relationships. Exposed `public.orderly_*` RPCs use SECURITY INVOKER, an empty search path, and service-role-only EXECUTE grants. Orderly does not use Supabase Auth identities or trust a browser-supplied owner ID.

# GitHub work evidence

Configure the server-only GitHub App values in `.env.example`, deploy the Phase 3 migration through the Supabase GitHub integration, and run the existing `npm run sync:worker` process. In Settings, install the App on selected repositories, authorize it, choose an accessible installation, and map a repository to an owned billing project. PR suggestions require confirmation. A PR timer uses an explicitly selected canonical task; standalone PRs can create a local task with an explicit project.

PR links and events never create, multiply, reattribute, or stop recorded time. Task pages show recorded history and PR/source evidence. Today reminds you about recorded tasks without PR links; the existing long-timer reminder remains advisory. GitHub setup, exact permissions, HTTPS callbacks/webhooks, recovery, and verification limits are in the [Phase 3 handoff](../docs/implementation/handoffs/phase-3.md).

When tests are explicitly authorized, `npm run test:github` runs the new linking/ownership/deduplication fixtures and `npm run test:browser` includes the mocked task → PR → recorded-time journey. These fixtures were authored but not executed during Phase 3 implementation.

## Retrieve the Notion webhook verification token

Deploy `supabase/migrations/20261010113155_notion_webhook_setup.sql` through the Supabase GitHub integration. Configure the existing private database variables and `ORDERLY_INTEGRATION_KEY` on Vercel. Sign in to Orderly and open Settings → Connected work → Notion webhook verification. Copy your account ID into the Vercel server environment variable `NOTION_WEBHOOK_SETUP_OWNER_ID` and redeploy. This pins setup access to the deployment-owner account, rather than every registered user.

Click **Start verification capture**, copy the generated webhook URL and update your **unverified** Notion webhook subscription to that URL. Click **Resend token** in Notion, then **Retrieve verification token** in Orderly. Copy the token into Notion's Verify subscription form and into Vercel's `NOTION_WEBHOOK_VERIFICATION_TOKEN` server variable, then redeploy. Clear the temporary capture when finished. Keep the configured webhook URL: normal events use the server HMAC secret, and ignore the expired setup query parameter. Notion does not allow editing the URL after verification; a verified subscription requiring a different URL must be recreated.

The ten-minute capture URL is a random single-use capability stored only as a hash. The received token is encrypted, tied to the initiating live Orderly session, excluded from ordinary snapshots/logs, and available only through an explicit same-origin authenticated retrieval. Duplicate deliveries cannot overwrite it. Unsigned captured values are never used automatically as trusted webhook secrets. The original fixed endpoint still acknowledges uncaptured verification deliveries, so an earlier token must be resent using the generated URL. `npm run test:notion-setup` contains unexecuted security fixtures; run only when tests are explicitly authorized.

## Billing and release readiness

Open **Billing** to filter local calendar periods by client/project, preview unbilled stopped entries, save and review a draft, then finalize. The end date is exclusive. Exact UTC milliseconds remain authoritative; PRs and task links never create billable duration. Zero is a valid explicit rate. An entry longer than twelve hours requires acknowledgment; running entries and currency mismatches block finalization. Refresh a draft after any correction or evidence change.

Finalized reports retain labels, evidence URLs, source revisions, hourly rates and allocation boundaries. Previously allocated intervals are subtracted from later drafts. Entry corrections and rate overrides are blocked while any finalized report uses the entry; void all affected reports with reasons, correct the entry, and create a new draft to reissue. Original voided reports and audit history remain available; exported copies must be withdrawn or replaced separately.

Rates use hundredths of currency units/hour. Exact line amounts are summed per currency and rounded half up once to that currency’s minor units. Largest-remainder distribution makes exported line amounts and task subtotals add exactly to UI totals. Recorded and billed durations are exported as integer milliseconds; time is never rounded. CSV formula-like cells are escaped. Printing shows the saved snapshot, including status and supporting URLs; drafts are clearly labelled. This is a work report, not a tax invoice.

Settings **Durable sync monitoring** reads persisted owned source/job status on demand. `npm run config:validate` validates release configuration syntax offline without revealing values or making service calls. It does not prove credentials or deployments work. Deploy the Phase 4 migration through the configured Supabase GitHub integration before using Billing.

When tests are explicitly requested, use `npm run test:billing` and `npm run test:browser` for the authored database and mocked billing UI fixtures. These have not been run for Phase 4. See [Phase 4 handoff](../docs/implementation/handoffs/phase-4.md) and [release runbook](../docs/implementation/release-runbook.md) for remaining acceptance, backup/restore and deployment steps. No release candidate is cleared for deployment yet.

## Connections and Notion timers

Settings has General (`/settings`) and Connections (`/settings/connections`). Connections contains Notion/Asana mapping and GitHub account/repository controls. Selected Notion data sources create distinct projects automatically (EUR, zero rate) unless explicitly mapped to an existing project. OAuth retains workspace and authorizing-person identity; existing connections must reconnect before enabling assigned-person automation. Choose stable status options for Doing. Initial import/reconnect/remap establishes a baseline without starting timers. Later Doing transitions start timers only for the connected person; leaving Doing stops that task, and losing assignment stops a Notion-started timer. Capacity-blocked starts notify without queuing. Manual stops are respected until a later status transition.

`GET /api/timer-events?cursor=…` reports changes and pending notifications. Same-origin `POST /api/timer-events` claims or acknowledges notifications with a per-tab delivery token. Claims expire after 30 seconds if interrupted; acknowledged events are not repeated across tabs. Orderly actions show a toast; external actions also play the bundled alert when browser permissions allow. Closed browsers receive pending toasts on return.

See [Connections and timers handoff](../docs/implementation/handoffs/connections-parallel-timers.md) for migration, setup blockers, and acceptance scenarios. The schema must be deployed before using the new controls.

Vercel queue execution details and production diagnosis are recorded in the [Connections handoff](../docs/implementation/handoffs/connections-parallel-timers.md#vercel-queue-wake-up-follow-up--2026-10-20). The dialog follows refreshed import status; a queued configuration is not yet a completed task scan.
