# Notion import review — 2026-10-20

## Implementation

One durable batch per Notion source, introduced by CLI-generated `20261020193128_notion_import_review.sql`. Existing accessible memberships are seeded once; new sources collect their initial full scan. Source completion queues review; the existing worker's `workOnce` first consumes one review under a 3-minute lease. Expired leases can be reclaimed. Reconnect/remap/resync do not reset decisions. Tasks discovered after the initial batch import normally without AI, per user choice.

Notion status option groups are retained in provider metadata. Canonical To-do / In progress / Complete groups map directly to ready / pending / discarded; other distinct labels/groups use DeepSeek V4.1 Flash (`deepseek-flash`). Only status vocabulary and opaque status hashes leave Orderly, never task names, descriptions, people or source/project names. Missing statuses stay pending. JSON is validated per requested hash; duplicate/missing/invalid results become pending. Configuration/network/malformed-response failures leave manual review and explicit retry available. Fixed HTTPS API host; 30-second request and 90-second total budgets; 50 statuses per chunk; no provider-payload logging. Server environment: `DEEPSEEK_API_KEY`.

Private batches and items retain original classification, snapshot, reason, manual override, model and revision. Completion atomically activates green decisions. `orderly_review` is service-role-only, security invoker, empty search path. Browser routes authenticate independent Orderly sessions and reject cross-origin writes; browser input cannot invoke worker claim/finish/error. Manual Apply requires expected revision and an idempotency request ID; exact retries return the prior committed result. Manual decisions survive AI retry. No review action starts a timer or moves billing attribution.

Snapshots retain all tasks for history, billing, evidence and running-timer stop controls, adding `review_blocked`. Projects, Today, new-entry selectors and GitHub timer selectors omit blocked tasks. An owner-locked entry trigger blocks new recording, timer starts/reopening, and moving entries onto blocked tasks. Existing interval edits/stops/restores remain possible. Notion observations retain baseline/stop logic and suppress starts for blocked tasks. Accepting does not reset observation state or start a retroactive timer. Existing project conflicts become yellow; acceptance keeps their original billing assignment.

Connections retains Asana's assignment forms and replaces Notion forms with source summaries. The native dialog opens once per browser/source after setup closes (dismissal remembered locally), can always be reopened, and follows visible/focus polling. Review revisions refresh the workspace. Native modality contains keyboard focus; busy dismissal is locked; opener focus is restored. Manual errors retain drafts, with explicit reload after revision conflict. A committed server save followed by a failed refresh does not automatically resubmit a mutation.

## Deployment

1. Deliver code and migration through the normal GitHub workflow. Supabase integration uses `source`, main, and `source/supabase/migrations`; do not apply production SQL directly.
2. Configure server-only `DEEPSEEK_API_KEY` in deployment secrets. Never place it in browser configuration, logs, committed files or memories.
3. Verify Supabase migration and Vercel application deployments separately. During staggered deployment, missing review RPC leaves ordinary sync available and displays a migration-pending message.
4. Open Connections or run the supervised worker to process analysis. Confirm IN Sintonia's existing task/project/client reuse and actual review results before claiming it live.
5. Unattended operation still requires the existing supervised worker/scheduler; bounded Vercel callbacks are not a permanent scheduler.

No migration execution, live AI request, production review mutation, deployment, commit or push was performed during implementation. Preview uses labelled sample data only.

## Acceptance scenarios — prepared, not executed

| Scenario | Expected result |
| --- | --- |
| Existing 42-item import | One summary, collapsed groups, existing canonical tasks/project/client reused; no duplicate tasks or billing changes. |
| Portuguese and multilingual statuses | Not-started equivalents green, Doing yellow, completed red; “not done” never matched as done by substring. |
| Structured Notion groups | Canonical workflow groups take precedence; original labels remain visible. |
| Missing, unknown, blocked or cancelled status | Yellow with reason. |
| Duplicate, missing, unknown or invalid model IDs | Unknown IDs ignored; invalid/missing/duplicate requested results yellow. |
| Missing key, timeout, provider error, malformed JSON | Inline error, manual review and explicit retry; no secrets or payload disclosure. |
| Automatic green activation | Available in mapped project using existing client/rate attribution; no timer starts. |
| Individual decisions and bulk yellow/red acceptance | Draft until Apply; atomic save; updated counts/groups; discarded items recoverable. |
| Cancel/Escape/close | Unsaved manual draft discarded, automatic greens retained, focus restored. |
| Busy save | Close/Escape dismissal blocked; actions remain visible. |
| Lost response and retry | Same request ID/payload returns committed result; no duplicate change. |
| Concurrent tabs | Stale revision rejected; draft retained; reload available. |
| Historical entries/running timer | Billing, rates, history and evidence retained; timer can stop; new recording blocked until acceptance. |
| Manual/API/GitHub/Notion timer attempts | Yellow/red cannot bypass server guard; acceptance never starts work. |
| Later status changes/reconnect | Original decisions survive; ordinary transition-based timing continues for accepted tasks. |
| Later new task | Imports normally with no second AI batch. |
| Different owner or billing project | Cross-owner access rejected; existing attribution preserved and conflict flagged. |
| Import failure during collection | No final counts; source error appears in dialog; connection can be resolved after closing. |
| Long names and 320/375/414/768/1440px | Wrapping content, scrolling body, visible navigation; inspect real application separately from static preview. |

## Verification recorded

- Existing provider/worker/timer/link contracts and modified migration/code inspected manually.
- Edited TS/TSX/CSS/preview files formatted with Prettier write mode.
- Standalone CSS preview visually inspected at mobile/desktop dimensions. Side-panel captures clipped some larger viewport images; full desktop and narrow mobile captures showed intended layout. This does not validate React behavior, production typography or SQL.
- No tests, builds, lint, type checks, automated assertions, SQL execution or live model calls, per user restriction. Authenticated acceptance, migration SQL execution, concurrency/API behavior and production deployment remain unverified.
