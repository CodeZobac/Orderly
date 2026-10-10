# Agent instructions

These instructions apply to every task in this repository. Follow additional instructions in nested `AGENTS.md` files for the relevant directories.

## Serena is required

- Use Serena MCP for every task. Read Serena's `initial_instructions` at the start of a session, then activate this repository with `activate_project` before beginning work.
- Check onboarding status and complete onboarding if needed. Read `core` and any task-relevant Serena memories before making changes.
- Prefer Serena's symbol search, references, diagnostics, and editing tools when applicable. Use shell and file tools for operations Serena does not support.
- If Serena is unavailable, report the blocker rather than silently skipping this requirement.

## Memory updates at task completion

- Before finishing every task, update Serena project memories to reflect what was done, relevant decisions, verification results, and any unresolved follow-up.
- Read `memory_maintenance` before writing memories. Keep durable project knowledge in focused memories and update existing entries instead of duplicating them.
- Maintain a concise `task_status` memory for the latest task's outcome and verification; replace the previous task status rather than accumulating a transcript.
- Keep memory references accurate and do not store secrets.

## When the user asks to "commit"

Treat a request to commit as authorization to carry out this entire workflow:

1. Inspect all tracked and untracked changes and the current branch. Include all pending project changes, including pre-existing changes, in logical groups. Do not discard changes.
2. Inspect the changes, address known failures, and update Serena memories before staging the final changes. Follow the verification rule below; do not run tests automatically.
3. Stage all changes and create separate commits for coherent logical groups, using selective staging as needed. Ensure all pending project changes are included across the commits.
4. Fetch the remote to use the latest `main` when checking integration.
5. If the current branch is **not `main`**, check whether it merges cleanly with the latest remote `main`. Resolve conflicts by integrating `main` into the branch before pushing, then rerun affected checks and commit the resolution. Push the branch, setting its upstream if needed, and create a pull request targeting `main` (or update the existing pull request). A remote pull request requires the pushed branch, so push before creating it. Verify and report the pull request's mergeability; resolve any remaining merge conflicts and push the fix. Do not merge the pull request unless requested.
6. If the current branch **is `main`**, integrate any new remote commits, resolve conflicts and rerun affected checks if necessary, then push `main`.
7. Use ordinary pushes; do not force-push or bypass repository protections. Report the commits, pushed branch, pull request URL where applicable, verification, and any blocker.

## Project layout

- The application and its npm scripts live in `source/`; run application commands there.
- Follow `source/AGENTS.md` before changing application code, including its requirement to consult the installed Next.js documentation.

## Verification preference

- Do not run tests unless the user explicitly requests tests. A request to implement, fix, or commit does not authorize running tests.
- If the user says to stop testing, stop any active test run and perform no further tests. Report existing verification honestly and distinguish interrupted or unperformed checks from completed results.

## Supabase deployment

- When database schema changes are needed, implement them in the `source/supabase/` folder as versioned SQL migrations under `source/supabase/migrations/`. Do not add new schema changes to the legacy `source/migrations/` folder.
- Supabase is Orderly's primary database; retain independent Orderly authentication. Do not introduce Supabase Auth for sign-in or sessions.
- Deploy schema changes through the Supabase GitHub integration for `CodeZobac/Orderly`. Its working directory is `source`, production branch is `main`, and migrations live in `source/supabase/migrations/`.
- Create migration files with the installed Supabase CLI (`supabase migration new`), review and verify them locally, then include them in the normal GitHub pull request workflow. Prefer GitHub deployments over direct production schema mutations. Use Supabase MCP for inspection, diagnostics, and post-deployment verification; only apply migrations directly when explicitly requested.
- The dashboard integration must be enabled before GitHub deployments can run; never claim a deployment succeeded without checking it. Keep migrations compatible with a single transaction and require the Supabase preview check before merging when branch protection is configured.
- Keep server secrets in ignored environment files or deployment secrets. The publishable key cannot access Orderly's private database. Never expose `SUPABASE_SECRET_KEY` to the browser or store it in Serena memories.
- Read `docs/implementation/handoffs/supabase-foundation.md` for setup and unresolved deployment steps.
