+# Stitch design handoff — Orderly

Project: https://stitch.withgoogle.com/projects/5081611970362115756

Stitch system: `assets/28c0468c0ee14270be08eb4041764064` — Chromatic Precision.
Logo direction: `assets/f11641b62b7d4fae8211f930df1c787c` — Orderly Bold.

The user asked for a design system with no greyish colors, its application to Orderly, and a bolder logo derived from the current one. The current PNG was sent to Stitch embedded in a DESIGN.md reference; its triangle, 13 and two-dial chess clock were explicitly included in the brief. Stitch generated the system and the inline-SVG [logo specimen](https://stitch.withgoogle.com/projects/5081611970362115756?screen=7d872e1185ef46d88c9a4b3f093f05c2). It reported that the embedded PNG bytes were abstracted, so the mark followed the written geometry description. Locally corrected the numeral overlap and moved plungers onto the clock housing before exporting primary/inverse/micro SVGs and favicons.

## Implementation decisions

The authoritative implementation is [design.md](../../../design.md) and `source/tokens.css` at repository root. Adopt Stitch's warm cream, gold, deep plum and colorful semantic roles. Correct generated suggestions that would reduce contrast: use bright amber with plum lettering, strong plum control borders, and fully opaque berry metadata/disabled text. Retain the already self-hosted Geist Sans and Geist Mono instead of introducing the generated JetBrains Mono/Anton suggestions. Preserve application workflows; generated dashboard examples and invented metrics are not production content.

The first detailed brief was blocked by automatic approval review. Only a reduced generic design brief and the expressly authorized logo reference were transmitted. No repository code, credentials, user records or integration configuration was sent.

## Stitch's original style recommendations

## Brand & Style

This design system establishes an unapologetically chromatic, high-contrast, professional workspace tailored for precision time-tracking and operational clarity. It rejects sterile monochromatic grays and default tech neutrality in favor of rich, energetic, and dignified pigments. 

The aesthetic marries bold graphic authority with crisp mathematical rhythm. Deep aubergines replace traditional carbon inks, radiant amber fuels primary interactive energy, and warm luminous cream foundations prevent ocular fatigue while preserving vibrancy. The target audience comprises exacting knowledge workers, creative directors, legal consultants, and engineering leads who view their billable time not merely as an administrative chore, but as their most valuable asset. The interface evokes relentless momentum, focused discipline, tactile satisfaction, and unambiguous clarity.

## Layout & Spacing

The interface employs a mathematical 8pt baseline spacing system anchored to an adaptive fluid grid:

- **Desktop (1200px+):** 12-column grid, `margin`: `2rem` (32px), `gutter`: `1.5rem` (24px). Sidebar navigations remain fixed at 280px width, while time-entry canvas and log panels scale dynamically.
- **Tablet (768px – 1199px):** 8-column grid, `margin`: `1.5rem` (24px), `gutter`: `1rem` (16px). Navigation collapses to an icon rail or top app bar.
- **Mobile (Below 768px):** 4-column grid, `margin`: `1rem` (16px), `gutter`: `0.75rem` (12px). Time log views stack vertically; the running stopwatch pins persistently to either the immediate top app bar or bottom action dock.

Every spatial gap, padding metric, and cell offset is expressed strictly through the defined space tokens. Compact density options in operational tables collapse internal cell row padding using `space-xs` (top/bottom) and `space-sm` (left/right) without sacrificing line height.

## Elevation & Depth

Visual hierarchy is constructed via **tactile tonal layering** and **warm, low-opacity pigmented shadows**. Traditional black or gray drop-shadows are strictly forbidden.

- **Level 0 (App Canvas):** Ground level tinted `#FFFDF5`. Non-elevated, foundational canvas.
- **Level 1 (Card & Modular Panels):** Tinted `#FEF8E7` bordered by `#F6DF9C` (1px solid). Ambient shadow: `0 2px 4px -1px rgba(42, 8, 38, 0.04), 0 4px 8px -2px rgba(88, 24, 69, 0.06)`.
- **Level 2 (Popovers, Select Menus, Active Timer Tray):** Tinted `#FEF8E7` bordered by `#E7C665` (1.5px solid). Directional depth: `0 8px 16px -4px rgba(42, 8, 38, 0.08), 0 16px 28px -6px rgba(88, 24, 69, 0.10)`.
- **Level 3 (Modal Dialogs & Critical Alerts):** Tinted `#FFFDF5` with `#3B0D36` outer outline (1px) and an aubergine-tinted backdrop scrim: `rgba(31, 5, 28, 0.65)` layered over an 8px blur.
- **Active Live State Accent:** Running timers utilize a luminous focus ring: `0 0 0 3px rgba(4, 120, 87, 0.25)` accompanied by a 1.5px border of `#047857`.

## Components

### Buttons
- **Primary Action (Start Timer / Log Time):** Solid fill `#D97706`, ink `#FFFDF5` (bold weight), with hover fill `#B45309`. Focus ring: 2px offset with `#FBBF24`.
- **Secondary Action:** Transparent fill, border 1.5px solid `#3B0D36`, ink `#3B0D36`. Hover: surface `#FDF0D0`.
- **Destructive Action:** Fill `#FFE4E6`, border 1px solid `#BE123C`, ink `#BE123C`. Hover: fill `#BE123C`, ink `#FFFDF5`.
- **Active Running Stopwatch Button:** Solid `#047857` with pulsing `#D1FAE5` icon; active click triggers pause/save state.

### Input Fields & Selectors
- **Base State:** Background `#FEF8E7`, border 1px solid `#F6DF9C`, typography `body-md` in `#1F051C`. Placeholder copy set in `#581845` at 65% opacity.
- **Focused State:** Background `#FFFDF5`, border 1.5px solid `#D97706`, box-shadow `0 0 0 3px rgba(217, 119, 6, 0.20)`. No gray browser focus outlines permitted.

### Chips & Status Tags
- **Billable Badge:** Background `#EEF2FF`, border 1px solid `#4F46E5`, ink `#3730A3` (`label-sm`).
- **Non-Billable Badge:** Background `#FDF0D0`, border 1px solid `#F6DF9C`, ink `#581845`.
- **Live Active Tracking Pill:** Background `#D1FAE5`, border 1px solid `#059669`, ink `#047857`, prepended by a 6px blinking emerald indicator dot.

### Lists & Data Rows
- **List Container:** Background `#FEF8E7`, border 1px solid `#F6DF9C`, divider lines 1px solid `#F6DF9C`.
- **Row Interaction:** Hover invokes `#FDF0D0` seamlessly. Selected row displays a 3px vertical left accent bar in `#D97706`.
- **Columns:** Project name uses Geist semi-bold `#1F051C`; category tags use plum `#581845`; start/end timestamps and running totals use tabular JetBrains Mono.

### Checkboxes & Radio Controls
- **Unchecked:** Background `#FFFDF5`, border 1.5px solid `#721C58`, radius 4px (checkbox) or circle (radio).
- **Checked:** Background `#3B0D36`, border 1.5px solid `#3B0D36`, checkmark/pip `#FEF8E7`.

### Cards & Metrics Tiles
- **Structure:** Level 1 elevation, padding `space-lg`, corner radius `1rem`. Header featuring micro-label in `label-md` uppercase `#581845`, followed by monetary or hourly totals rendered in JetBrains Mono (`timer-display` or `headline-md`).

### Real-Time Timer Bar (Persistent Component)
- Docked panel pinned to the viewport header or footer. Background `#FEF8E7`, bordered by 2px solid `#E7C665`. Displays full-width progress timeline, monospaced millisecond-accurate counter in `#1F051C`, quick-select project picker, billable toggle, and amber-to-emerald state change trigger button.

