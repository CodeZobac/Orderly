# Phase 1 handoff

Historical Phase 1 verification below describes the original SQLite implementation. The later [Supabase follow-up](supabase-foundation.md) supersedes its database/setup guidance and records current verification and deployment blockers.

Status: **complete** (2026-10-09). Phase 2 has not started. This is a working local/persistent-host MVP, not a verified public deployment.

## Delivered

- Registration/sign-in/logout, hashed passwords, expiring hashed cookie sessions and login throttling; one private workspace per user.
- Clients → projects with currency/default hourly rate → canonical tasks. Integer minor-unit rates, durable project rate history and per-entry rate/currency snapshots.
- Server-backed start/stop/resume, explicit atomic switching, refresh/browser-process restoration, one active timer across tabs, idempotent retries and stale-write detection.
- Manual UTC intervals with millisecond precision, notes, billability, audited corrections, soft deletion/Undo, overlap validation including running work, timezone-aware daily totals and Monday-based weekly totals. Boundary-touching intervals allowed. Active time excluded from finalized totals; timers over 12 hours flagged without idle deductions.
- Hallmark amber workspace: Today, Projects, task detail, Timesheet, Settings. Responsive navigation, shared labelled fields and submit/entry forms, honest empty/pending/error/saved states; upcoming integrations are explicitly not connected.
- Reproducible SQL migrations, setup/environment examples, automated domain/browser tests, production smoke script, portable tokens and retained design evidence.

## Architecture and paths

Next.js 16.4 / React 19.3 / strict TypeScript, Node 24+ with `node:sqlite` and Node crypto. No external service credentials needed. SQLite WAL on a persistent local disk, `BEGIN IMMEDIATE` writes, partial unique active-timer index. A user's ID is its solo-workspace ownership key; every operation scopes reads and validates related record ownership. Multi-host/ephemeral serverless storage is unsupported.

- `source/lib/db.ts`: database, ordered transactional migrations; `source/migrations/001-foundation.sql`, `002-rate-history.sql`.
- Schema: users, sessions, auth_attempts, clients, projects, tasks, entries, audit, requests, project_rates; migrations applied once and checked again under the write lock. Existing projects migrated into rate history have unknown initial timestamp represented by `at=0`; newly created/changed rates have real server timestamps.
- `source/lib/auth.ts`: salted scrypt credentials, random session token/hash, 30-day cookie expiry, persisted per-email throttling. Production cookie: HttpOnly, Secure, SameSite Strict. No account recovery/email-verification workflow in Phase 1.
- `source/lib/domain.ts`: ownership, CRUD creation, rate history, transactional timer/correction contracts, audit and request-key dedupe. `lib/time.ts`: exact durations, DST-aware date splitting; `lib/http.ts`: JSON/origin/errors; `lib/types.ts`: shared snapshot types.
- UI: `source/components/tracker.tsx`, `components/fields.tsx`; `/` Today, `/projects`, `/tasks/:id`, `/timesheet`, `/settings`. Page-level Suspense preserves the installed Next.js streaming/navigation contract.
- API: `source/app/api/auth/route.ts` and `api/work/route.ts`.
- Design: `source/tokens.css`, imported from `app/globals.css`; self-hosted Geist/Geist Mono through Fontsource/next/font/local. Framework directives and starter CSS preserved; additions use the named amber tokens. `.hallmark/preflight.md`, `log.json`, `contrast.json`. Visual examples: [mobile](assets/phase-1-mobile.png), [desktop](assets/phase-1-desktop.png).

## API / timer contract

`POST /api/auth`: `register|login {email,password}` or `logout`. `GET /api/work`: owned snapshot, audit, server `now`, no-store. `POST /api/work`: `action` + unique `key`, returning `{result,data}`. Errors use `{error}` with 400 validation, 401 session, 403 origin, 404 unknown/unowned record, 409 overlap/stale state/key collision, 429 auth throttle, 500 transactional save failure.

Actions/arguments are documented exhaustively in `source/README.md`. UTC timestamps are integer epoch milliseconds; rates are decimal strings converted without float monetary arithmetic. All writes require the configured Origin. Workspace IDs are never accepted from the client.

A start while any timer exists returns 409. Switch includes the expected active `entryId`, stops it and starts the target at the same server timestamp atomically. Resume is a new interval; it never extends earlier finalized work. Stop includes the target entry ID, so a retry cannot accidentally stop a newer timer. Request keys are scoped by user and bind to the original payload; successful retries return the original result. Uncertain network requests retain the same payload/key for explicit Retry save. No offline start queue.

Corrections/delete/restore require entry versions. Overlap checks consider undeleted unfinished and finalized intervals; endpoint equality is allowed. Audit stores original/updated entry JSON. Rate changes leave historical entries intact; moving an entry to another task snapshots the destination project's current rate/currency and is audited. No rounding or billing/export calculations implemented.

Manual/edit inputs explicitly use UTC to avoid ambiguous DST wall times; display follows the selected IANA timezone. Daily totals split at actual local midnight; weeks begin Monday. The UI polls every 15 seconds and refreshes on focus, displaying elapsed time derived from start/server-clock offset rather than browser ticks.

Future jobs decision: in Phase 2 add a separate Node worker with a durable SQLite jobs table, leases, connection/provider-scoped dedupe and retry/backoff. No in-memory jobs or request timers. Jobs/encrypted provider credentials are not implemented yet.

## Exact setup and verification commands

Run application commands from `source/`:

```sh
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Variables: `ORDERLY_DB_PATH` (persistent file; default `./data/orderly.sqlite`), `ORDERLY_ORIGIN` (exact allowed origin; example `http://localhost:3000`). The migration script reads the process environment rather than `.env.local`; prefix custom paths explicitly. No secrets in examples. Production requires HTTPS and persistent disk; use `npm start` after building. Backups/restoration and multi-host database migration are deployment work, not verified here.

Production smoke commands used with an isolated database:

```sh
ORDERLY_DB_PATH=/tmp/orderly-production-smoke.sqlite ORDERLY_ORIGIN=http://localhost:3100 npm start -- --port 3100
npm run smoke:production
```

`ORDERLY_SMOKE_ORIGIN` optionally changes the smoke URL (default `http://localhost:3100`). The script creates a fixture account/client. Localhost browser behavior permits testing Secure cookies; this is not a live HTTPS deployment verification. The temporary production server was stopped after verification.

Webpack is the explicit dev/build default with Tailwind's official PostCSS adapter: this execution environment blocked Turbopack CSS-worker IPC, even on a permission-enabled attempt. No application workaround depends on remote fonts. Tests/builds requiring subprocess/local-server access were run with appropriate execution permissions.

## Acceptance results

| Check | Actual result |
| --- | --- |
| New account → client/project/task → timer → timesheet | Passed with real UI/API/SQLite, saved correction and Undo |
| Two simultaneous tabs / idempotent start and stop | Passed: simultaneous start responses 200/409; one entry; stale switch rejected; repeated stops unchanged |
| Reload and browser restart | Passed: timer restored after reload and a separately launched Chromium process with persisted session state |
| Lost save response | Passed: server committed start, browser response aborted, same-key retry restored the single existing interval |
| Negative/overlapping/boundary intervals | Passed: reversed interval rejected in UI/server; overlap and active overlap rejected; touching intervals accepted |
| Timezone / DST / midnight / weekly boundaries | Passed: Europe/Lisbon spring 23-hour day, fall 25-hour day, UTC midnight split; active time excluded; timezone persisted from UI |
| Ownership / unauthenticated / origin | Passed: other user cannot read workspace tasks or mutate foreign IDs; direct requests rejected; unauthenticated 401, bad Origin 403 |
| Rate snapshots / rate history / audit | Passed: default-rate change preserves old snapshots, new timer uses new rate; corrections versioned; delete/restore audited |
| Hallmark UI / keyboard / motion / mobile | Passed: all five routes at 320/375/414/768/1440; no root scroll/clipped product controls; rendered screenshots inspected; skip-link and keyboard focus, native labels, reduced motion verified |
| Contrast | Passed: actual browser-resolved WCAG ratios saved in `.hallmark/contrast.json`; body 15.71, muted/paper 7.49, button normal/hover/active 8.28/6.94/5.77, disabled 5.63, error 8.65, focus/paper 7.73, focus/amber 4.07, control-rule/surface 4.75 |
| Lint / TypeScript / production build | Passed (lint has zero errors/warnings after PostCSS export cleanup) |
| Domain tests | 5 groups passed against real SQLite; includes two database connections, ownership, rate history, authentication throttling, UTC/DST |
| Browser tests | 2 passed: full journey/concurrency/viewport/contrast; manual/timezone/lost-response retry (final run 58.1s) |
| Production browser smoke | Passed: registration, persisted client, navigation, Secure/HttpOnly/Strict cookie, no page exceptions |
| Migrations | Both applied to a fresh isolated database; rerun passed without duplicate execution |
| Handoff / memory integrity | Index/status/Serena updated; `serena memories check` found no reference issues; package-lock consistency and `git diff --check` passed |

## Limits / next session

No known failing Phase 1 acceptance criterion. Public deployment, backup recovery, load testing, email verification/password recovery and provider integrations are not verified/implemented. All browser accounts and data used for verification are fixtures; no live provider claims. Integration UI remains “Upcoming · not connected”.

`npm audit` additionally reports five high-severity **development-toolchain** findings through `eslint-config-next → fast-glob → micromatch → braces`; its suggested automatic fix downgrades Next's ESLint config to 14.2.35, so it was not applied to this Next 16.4 project. Revisit a compatible patched dependency before release; no forced/downgrade fix or runtime vulnerability was reported by this audit. This is recorded as release follow-up rather than a false clean-audit claim.

Phase 2 starts by rereading `AGENTS.md`, `docs/implementation/README.md`, `phase-2.md`, this handoff, current code and Serena memories. Preserve timer/rate/audit invariants and amber tokens. Add Asana **and** Notion connections, encrypted credentials, durable sync jobs/worker and provider-scoped canonical links with real verification. Do not generate time from board states or PR lifetime. Do not assume deployment/provider services exist. No commit/push/PR was requested or performed.
