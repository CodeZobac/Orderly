# Supabase foundation follow-up

Status: implemented locally; live activation blocked by missing server secret and dashboard integration access. The historical Phase 1 handoff records the original SQLite verification. No live Supabase migration, import, or GitHub deployment has been performed.

## Implemented

- Replaced runtime SQLite with private Supabase PostgREST RPC using pinned `@supabase/supabase-js` 2.117.3. `source/lib/db.ts` accepts the base URL or REST URL, disables SDK auth persistence, and returns a clear 503 for incomplete setup or unavailable database access. The publishable key is retained in ignored local configuration; private operations require the server secret.
- Retained independent Orderly authentication: Node scrypt passwords, opaque SHA256-hashed sessions, persistent attempt throttling, HttpOnly/Strict cookies and logout revocation. No Supabase Auth dependency or browser database access.
- `source/supabase/migrations/20261009224717_orderly_foundation.sql` creates private relational tables, ownership foreign keys, RLS, service-role-only SECURITY INVOKER RPCs, owner-row locking, idempotent writes, atomic timer switch, overlap checks, rate history and correction audit.
- `npm run db:import -- /absolute/path/orderly.sqlite` reads an existing SQLite file without modifying it and imports in one transaction into an empty target. It preserves identities/password/session hashes, IDs, timestamps, audit and retry history. Stop the old app and back up first. The old SQLite migrations remain for import compatibility; runtime has no fallback to SQLite.
- Prepared `source/supabase/config.toml` for GitHub deployment. Local Supabase Auth and seeding are disabled; private schema stays unexposed. Production config settings are not automatically changed by the GitHub migration deployment.
- Preserved Phase 1 Hallmark amber UI and API contracts. The GitHub deployment integration is infrastructure; Phase 3's GitHub work-evidence feature remains unimplemented.

## Finish external setup

1. Replace `SUPABASE_SECRET_KEY` in ignored `source/.env.local` with a Supabase server secret. The supplied URL and publishable key are already configured. Never place the server secret in chat, Git, browser variables or Serena memories. Configure the same server variables in the app deployment, plus the exact HTTPS `ORDERLY_ORIGIN`.
2. In the Supabase project's Settings → Integrations, authorize GitHub and select `CodeZobac/Orderly`. Set **Working directory: `source`**, **Production branch: `main`**, and enable production deployment. Preview branching is optional and can affect billing; if enabled, require the Supabase preview check before merging. See [official GitHub integration setup](https://supabase.com/docs/guides/deployment/branching/github-integration).
3. Deploy the committed migrations through GitHub. Future schema changes must be generated with the installed CLI's `supabase migration new`, reviewed in Git and deployed through this integration. Use Supabase MCP for inspection/advisors and deployment verification. Direct migration application requires an explicit request; do not deploy the same initial migration through two independent paths without reconciling history.
4. After granting project access to the Supabase connector, inspect deployed tables, migration history and security advisors. Run connection or live checks only when explicitly requested under the user's verification rule. Import legacy data explicitly if needed; don't create an account in the target before an empty-target import.

The connector returned “You do not have permission to perform this action” for this project. No browser was available to configure dashboard integration, so it is prepared in the repository but **not enabled or verified remotely**. A publishable key cannot substitute for server access to Orderly private records.

## Verification completed before the stop-testing instruction

- Lint, route type generation/TypeScript, and production build passed.
- Seven domain groups passed on actual embedded PostgreSQL SQL/PLpgSQL: timer retry/switch/stop; intervals/rates; ownership/auth/corrections; DST; durable histories/throttling; RLS/function grants and concurrent retries; legacy SQLite import preserving authentication and sessions.
- Production npm audit: zero vulnerabilities. Full dependency audit retains five inherited high development-toolchain findings; no incompatible forced downgrade applied.
- These tests use PGlite and a test-only local RPC facade, not live Supabase. PGlite has a single connection; live multi-worker contention and Supabase advisor verification remain unperformed.
- New browser runs could not start because another Next development server already owns this application directory. The attempt on port 3200 also encountered Next's single-directory development lock. No post-migration browser or production smoke pass is claimed. The user then prohibited further tests; no additional tests were run.

## Current commands and rules

Application commands run in `source/`: `npm ci`, `npm run dev`, `npm run build`, `npm start`. `npm run db:check` loads `.env.local` and checks RPC connectivity without applying migrations. Browser fixture configuration is app port 3200 and RPC port 3001 and requires exclusive use of this app's Next dev directory.

Root `AGENTS.md` and Serena memories now require GitHub-based schema deployment and prohibit tests unless the user explicitly requests them. An implementation, fix, or commit request alone does not authorize tests. No commits should include local environment files or database data.
