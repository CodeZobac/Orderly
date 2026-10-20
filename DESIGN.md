# Design — Orderly

## Summary and provenance

**Chromatic Precision**, created with Stitch for Orderly on 2026-10-15 and adapted for accessible controls and the existing application. [Stitch project](https://stitch.withgoogle.com/projects/5081611970362115756). System asset: `28c0468c0ee14270be08eb4041764064`. Logo exploration: `f11641b62b7d4fae8211f930df1c787c`. Source recommendations and adaptations: [Stitch handoff](docs/implementation/handoffs/stitch-design-system.md).

This is the shared system for every app route. Amend it before introducing another palette. **No greyish colors:** no slate, zinc, charcoal, neutral grey, greige or opacity-washed text. Use plum ink, honey-colored separators, cream/pale-gold surfaces and chromatic semantic colors. Native forced-colors accessibility settings remain under user control.

## Genre and layout

Modern-minimal Workbench with bold precision: existing workspace rail, page heading, timer/ledger, readable forms and rows. Today, Projects, Timesheet, Billing, Settings and task detail share typography, controls, navigation and status roles. Authentication and both loading fallbacks share the logo and cream canvas. No new marketing content, fabricated metrics or workflow changes.

Mobile baseline: 16px horizontal padding, single-column forms and timer panel, wrapping action groups and unwrapped button labels. Desktop uses the existing 769px breakpoint with a 220px rail; at 1024px the rail becomes 248px. Grid tracks shrink with minmax(0, 1fr). Long data wraps; the root clips horizontal overflow. Keep billable reports printable.

## Palette

| Token | Reference | Role |
| --- | --- | --- |
| `--color-paper` | `#FFFDF7` | page background |
| `--color-surface` | `#FEF9EB` | surface |
| `--color-paper-2` | `#FDF2D5` | paper 2 |
| `--color-ink` | `#300E2C` | ink |
| `--color-muted` | `#581845` | muted |
| `--color-rule` | `#721C58` | rule |
| `--color-divider` | `#E7C665` | divider |
| `--color-accent` | `#FBBF24` | accent |
| `--color-accent-hover` | `#F6AD12` | accent hover |
| `--color-accent-active` | `#E99B0C` | accent active |
| `--color-focus` | `#721C58` | focus |
| `--color-error` | `#BE123C` | error |
| `--color-error-paper` | `#FFE4E6` | error paper |
| `--color-success` | `#047857` | success |
| `--color-success-paper` | `#D1FAE5` | success paper |
| `--color-info` | `#3730A3` | info |
| `--color-info-paper` | `#EEF2FF` | info paper |
| `--color-warning` | `#9A3412` | warning |
| `--color-warning-paper` | `#FFEDD5` | warning paper |
| `--color-disabled` | `#F6DF9C` | disabled |
| `--color-rail` | `#FFEFF7` | rail |
| `--color-rail-ink` | `#300E2C` | rail ink |
| `--color-rail-muted` | `#581845` | rail muted |
| `--color-rail-rule` | `#721C58` | rail rule |

Canonical tokens live in `source/tokens.css`. The user-specified palette takes precedence over the original Stitch palette: page background #FFFDF7 and card content #FEF9EB; card top and bottom #FDF2D5; left sidebar #FFEFF7. The light pink rail uses plum text, berry secondary text, plum outlines and soft rose selection (#F7DCEB). Decorative dividers do not replace control outlines.

## Typography and spacing

Self-hosted Geist Sans, 400 body / 650 controls / 750 headings; Geist Mono for timers, amounts and tabular data. Headings stay roman with -0.03em tracking. Keep the existing responsive type scale, 44px minimum control height, 4/8/16/24/32/48/64px named spacing scale. Controls have 8px corners, panels 16px. Reserve pills for compact state badges.

## Components and states

- Primary: amber fill, plum text and outline; deeper golden hover/press. Secondary: cream fill, plum text/border and golden hover.
- Focus: immediate 3px plum ring with 3px offset; plum ring on the pink rail. Never animate focus appearance.
- Disabled: gold-tinted fill, opaque berry text, native disabled behavior and no displacement. Pending buttons preserve existing labels/aria-busy behavior.
- Inputs: cream fill and 1.5px plum border; berry placeholder at full opacity; focused border uses focus token. Errors use berry outline and rose background, retaining written messages.
- Running timer: emerald outline, emerald counter and stop action; existing running label carries meaning without color. Ordinary primary actions remain amber.
- Success uses emerald/mint, errors berry/rose, information indigo/lavender and warnings burnt-orange/peach. Preserve explicit text and existing live regions.
- Rows remain clean ledgers with golden hover; totals use an amber/indigo edge, not fabricated charts. Billing and auth panels use cream surfaces. Keep destructive operations' existing safeguards.

## Logo

Use `source/public/brand/orderly-supplied.png`, an unchanged copy of the user-supplied `screen.png`. The shared Logo uses the original raster rather than the edited SVG. Its square display frame aligns the PNG to the top and crops only the unused lower canvas with CSS. Preserve the supplied numeral and clock proportions. Sidebar is 56px; auth/loading branding is 64px. Older vector assets remain inactive references.

Headings and the Orderly wordmark retain `--color-heading` (#5C061C), matching the logo burgundy.

## Motion

Keep the assembling workspace cards' existing 3s transform/opacity loop and stable loading text. Use named easing tokens. No page entrance choreography, progress percentages, blinking status dots or synthetic loading delay. Gradients are reserved for the requested sidebar-to-canvas fade. Reduced motion shows the assembled cards and removes active displacement.

## Verification

Source and rendered verification outcomes are recorded in `.hallmark/preflight.md` and `mem:task_status`. Contrast targets: body aim 7:1, other text at least 4.5:1, controls/focus at least 3:1. No test suites run unless explicitly requested. Review viewports 320/375/414/768/1440px without changing real workspace data.

## Card composition

Cards use `--color-card-content` (#FEF9EB) for their main content and `--color-card-band` (#FDF2D5) for 16px top and bottom bands. Apply this treatment to timer, billing, summary and authentication cards. Rounded corners clip the background naturally; 32px block padding keeps content inside the cream region. Keep semantic running/error states and readable plum outlines. Ledger rows remain rows.

## Exports

The canonical portable CSS export is [source/tokens.css](source/tokens.css), imported by the application global stylesheet. It includes colors, fonts, spacing, typography, radii, shadows and motion tokens. Use these named tokens when extending components; avoid duplicated palette literals. Tailwind's existing inline theme maps the background and foreground to the same shared tokens.

## Latest palette revision

2026-10-15: follow-up screenshot refinement sets the canvas to #FFFDF7 and selected navigation fill to soft rose #F7DCEB. Remove the sidebar dividing border and fade the last 32px of pink into the canvas horizontally on desktop, vertically on mobile. Card content remains #FEF9EB. The supplied Today screenshot is the visual reference for the existing layout. Earlier screenshots and contrast records predate this palette; they are historical evidence, not verification of the revision.

Sidebar branch connectors and the active branch marker use berry `--color-rail-muted`, with plum base lines. Keep golden amber reserved for primary actions rather than navigation branches.

Sidebar hover uses `--color-rail-hover` (#FBE5F1), between the sidebar #FFEFF7 and selected fill #F7DCEB. Selected navigation keeps its stronger pink fill when hovered.

## Connections and timer notifications

The rail groups Workspace routes separately from Settings (General and Connections). Both groups start expanded. Running tasks each get an existing timer panel and individual stop control; a separate start form shows account capacity. Imported project tasks retain list presentation with status, assignee, and provider links. Timer notifications use the existing surface, ink, rule, and card-band tokens in a bottom-right stack, constrained to the mobile viewport and half its height with scrolling. Use a polite live region, explicit dismiss actions, and an Enable sound control when audio is blocked. No new palette values or motion are introduced.

## Projects and guided Notion setup

Projects uses a catalogue-first Workbench: on desktop (1024px and up), approximately 62% project ledger and 38% creation panel; on mobile, projects precede creation. Three independent native accordions contain client/project/task forms. Keep drafts mounted when collapsed. Existing projects start with creation closed; empty workspaces start with client creation open. Project headers keep client, task count, currency and rate visible; task rows and rate changes have separate disclosures.

Notion source cards open a native modal dialog rather than extending the Connections page. Two steps: Project & fields, then Automatic timers. Use warm-white paper and gold header/footer bands; the backdrop mixes the existing sidebar pink with transparency and applies a static 12px blur. Canonical backdrop/width/blur tokens live in source/tokens.css. The modal body scrolls inside the viewport while navigation remains visible. Restore focus to the source card after dismissal, make the background inert, keep Escape available before saving, and lock dismissal during the save. No entrance animation is needed.

Summarize Task name, Status, Assigned to and Due date using their original Notion names. Raw property types, unrelated relations and server implementation details stay out of the setup. Adjust fields is collapsed unless mapping needs attention. Automatic timer status choices appear only after enabling automation. Existing mappings select their linked project; do not offer accidental duplicate project creation. Distinguish Accessible, Selected for import, Import queued and Synced using text plus existing semantic colors. Never imply a task import completed merely because configuration was saved.

## Notion import validation

Connections replaces the Notion task-by-task billing forms with a compact source summary and a native review dialog. Reuse the existing paper/gold modal and pink blurred backdrop. Three semantic groups combine symbols, labels and counts: emerald Ready, gold Pending review, berry Discarded. Counts stay unset until the initial scan and analysis finish; errors offer manual review. Keep category detail behind Expand review, compact task rows with visible decision labels, and Accept all controls for pending/discarded groups. Draft decisions remain in their saved group while editing to preserve keyboard focus. Apply changes is the only manual-save action; dismissal cancels drafts. Existing automatic green decisions remain saved. Preserve historical task context in reports and active timer stop controls.

A standalone `source/components/notion-import-review.preview.html` demonstrates the eight interaction states with labelled sample content and no provider requests. This is a CSS/layout preview, not evidence of authenticated application or database acceptance.

## Global search, filterable selects and project-first timer

2026-10-21. Every former native `<select>` uses the shared `Select` (`source/components/select.tsx`): an editable WAI-ARIA combobox with keyword filtering (case- and accent-insensitive, every typed word must match), project group headings, amber `<mark>` match highlights, a plum check on the chosen row, berry hints and disabled rows explained by an emerald "Running" pill. Field: cream fill, 1.5px plum border, soft rose (#F7DCEB) ring while open. Popover: paper surface, plum outline, 12px corners, float shadow, gold card-band footer with keycaps and "n of m". It is fixed-positioned so dialog bodies never clip it, and flips upward when space is short. A hidden input keeps `name`, so FormData submissions, `required` validation (custom validity on the visible field) and form reset behave as before.

`Kbd`/`ModKbd` (`source/components/kbd.tsx`) render Geist Mono keycaps on paper with a honey border. ⌘ appears on Apple platforms and Ctrl elsewhere; the server renders Ctrl. The rail shows a Search trigger under the wordmark (paper fill, rail-rule outline, rail-hover on hover). The keycap hint is hidden on coarse pointers.

⌘K / Ctrl K opens the command palette (`source/components/command-palette.tsx`) from anywhere. It reuses the native modal pattern with the pink blurred backdrop, gold header and footer bands, and no entrance animation. It searches clients, projects and tasks client-side from the workspace snapshot. An empty query lists Running now, Projects and Clients; a typed query lists Tasks, Projects and Clients. Arrow keys move between rows, and Tab or ArrowRight cycles a row's actions. Enter runs the highlighted action, and the footer names it or explains why it is unavailable. Statuses: emerald Running, indigo Done, burnt-orange Needs review. Micro actions:

- Open task: Start timer and Open task.
- Running task: Stop timer and Open task.
- Finished task (time logged and no running timer): Billable summary, Resume timer and Open task.
- Project: Billable items and Track time.
- Client: Billable items.

Billable links go to `/billing?clientId&projectId&from&task`. Billing seeds its filters, widens `from` to the earliest logged entry when that is older than the current month, runs a read-only preview and highlights the task's subtotal and lines with an amber edge. A link never saves a report.

Today/Task timer is project-first. "Your projects" replaces the task list, with clean selectable cards (client, task count, Geist Mono rate, emerald running task names, Running/Selected pills) and a Billable items link. The selected card gets a plum outline, a 4px plum inset edge and a rail-pink fill. The selected project, remembered per browser, scopes the start form's task dropdown. Choosing a project focuses that dropdown on fine pointers and only scrolls on touch. Starting a timer clears the task but keeps the project, so timers can be started across projects back and forth. The account timer limit still applies. Imported task status and assignee now appear as dropdown hints. No new palette values or tokens.

Running timer panels (2026-10-21): the stop action is a compact emerald button (auto width, 44px, stop icon) at the top right, no longer a stretched amber block. Below it, an "Earned so far" block with an emerald left edge shows a live Geist Mono amount, ticking with the elapsed clock, plus the hourly rate. The amount uses the running entry's snapshotted project rate and currency (the same values Billing charges), in integer minor units rounded half up. Non-billable timers say "Non-billable"; a zero rate links to Projects. On mobile the amount and stop button share one row under the clock. Display-only estimate; the billing preview stays authoritative.
