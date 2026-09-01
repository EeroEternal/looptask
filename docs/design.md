# Product UI Design Specification

`docs/design.md` is the **only UI design entry**. Chapter details live under [`docs/design/`](design/). Do **not** load every chapter by default — use skill [`admin-ui-change`](../.agents/skills/admin-ui-change/SKILL.md).

## Overview

The product UI is a focused operational console, not a marketing site. Every frontend surface should feel controlled, technical, and calm: white and near-neutral surfaces, one clearly recognizable primary accent, and explicit semantic state colors for success, warning, and destructive paths.

The visual baseline is unified across pages. Every page should read as part of the same system by reusing the same semantic tokens, shared layout shell, card treatment, and dialog structure. When a case is not covered by a literal token, prefer consistency with the existing admin UI guidance over introducing a new visual dialect.

The intended tone is pragmatic and high-signal:

- dense enough for operators handling models, routes, providers, logs, and API keys
- restrained enough to avoid dashboard noise
- readable in both English and Chinese without layout breakage
- accessible enough that focus, state, and destructive actions are always unambiguous

## How agents use this file

Inside the repo, this file is **judgment**, not a CSS dump. Three layers:

| Layer | Lives here | Agent must |
| --- | --- | --- |
| **Judgment** | This file: reader job, hierarchy, copy, composition | Frame the page for the operator's job before picking widgets |
| **Vocabulary** | [`design/tokens.md`](design/tokens.md) + product `index.css` + shared `components/ui/*` | Use named tokens and shared components. **Do not invent** colors, radii, or a parallel class set |
| **Checks** | PR checklist below + skill [`admin-ui-change`](../.agents/skills/admin-ui-change/SKILL.md) | Fail closed on mechanical rules. Subjective hierarchy stays a human call |

Do not collapse chapters into one mega-prompt. Load this entry, then **only** the chapter the task needs. Vague phrases ("keep it clean") are not a spec; named anti-patterns in [`design/dos-donts.md`](design/dos-donts.md) are.

**Reader jobs** (same visual language, different structure — do not force one template):

| Job | Page shape |
| --- | --- |
| Scan and act | Entity list + toolbar; create opens a Dialog over the list |
| Inspect one entity | Compact Entity detail dialog |
| Complete a valid object | Create Dialog / multi-step wizard |
| Glance then drill | Dashboard cards with reserved heights |
| Change global config | Settings page only |

New rules enter this file only when a failure **repeats** (promote-lesson: ≥ 2 sessions) or a deterministic check can catch it.

## Agent reading map

Always load this file (Overview + Hard rules + PR checklist below). Then open **only** the matching chapter files.

| Task | Read |
| --- | --- |
| Tokens / brand hex table | [`design/tokens.md`](design/tokens.md) |
| Colors / dark mode / status | [`design/colors.md`](design/colors.md) |
| Titles, density, wrapping | [`design/typography.md`](design/typography.md), [`design/layout.md`](design/layout.md) |
| Shell, cards, dashboard rows, filters | [`design/layout.md`](design/layout.md) |
| Wizard / select height jump | [`design/layout.md`](design/layout.md) → Layout stability |
| List / master–detail / detail dialog / wizard | [`design/components.md`](design/components.md) (+ layout stability when needed) |
| Shadows, radius | [`design/surfaces.md`](design/surfaces.md) |
| Quick anti-patterns | [`design/dos-donts.md`](design/dos-donts.md) |
| Enterprise Visual Spec & Tokens | [`../DESIGN.md`](../DESIGN.md) + [`design/visual-specification.pdf`](design/visual-specification.pdf) |
| Editing the visual baseline | touched chapter(s) + Hard rules / PR checklist; token table in `design/tokens.md` |

## Scope

Applies to all user-facing frontend surfaces in this repository, including `web/app/*`, `web/components/*`, any future `admin/src/*` application, and frontend assets or components added elsewhere. In the current project, `web/` is the Next.js frontend source, and its static export in `web/out/` is served by the Rust application and deployed to Cloudflare Pages. The implementation technology may differ, but the layout, hierarchy, accessibility, responsive, and visual rules apply consistently. Third-party internals and code-highlight themes are out of scope for wrapper-controlled styling only.

## Hard rules

1. No hard-coded page colors (`#hex`, `bg-violet-*`, `text-red-*`, `bg-gray-*`) in product pages.
2. No native `<select>`; use the shared `Select` component.
3. Do not invent a second primary button color system.
4. Dialogs must keep `DialogHeader` / `DialogFooter` structure. Entity **detail / edit** uses the Entity detail dialog pattern (compact `max-w-3xl` Dialog). All entity creation — including create dialogs and operational submissions (such as quota increase requests) — opens as a Dialog/Modal over the page (never flattened/tiled inline across the page or replacing the whole view). API Key create is a compact single-page Dialog (name, project, route, folded call boundaries). Route create remains a multi-step Dialog wizard (`sm:max-w-5xl`, stepper + main panel + summary sidebar). Overlay / Escape dismiss rules apply to both.
5. **Dialog viewport bounds**: All popups and dialogs must never exceed screen height or width (`max-h-[85vh]` or `max-h-[90vh]` with `overflow-y-auto`). Large blocks of examples, technical tokens, or secondary options inside dialogs must use collapsible accordions (or tabs) rather than vertical unconstrained stacking that pushes action buttons or headers off-screen.
6. Popups (Dialog / Sheet / AlertDialog / Popover) must close when the user clicks outside the popup content (overlay / dimmed area) or presses Escape; do not disable overlay dismiss without an explicit, documented exception.
7. Operational submissions, applications, and creation actions (e.g. Quota Increase Application, Token Rotation, Model Bindings) must be triggered via dedicated action buttons opening an interactive modal dialog with validation and cancel/submit footers, leaving the main content area focused on list review, status, and audits rather than stacking flat inline input cards.
8. Never use native browser popups (`window.confirm` / `alert` / `prompt`). Delete and other destructive confirms use `AlertDialog` / `ConfirmAlertDialog`; transient feedback uses toast.
9. Prefer `t()` for copy; reserve wrap/truncate strategy for long IDs, keys, and model names.
10. The canonical brand asset uses `#2744A5`; brand identity, interactive primary, and semantic status colors remain separate roles.
11. Visible keyboard focus is mandatory, and icon-only controls require an accessible name and tooltip.
12. Entity lists and the sidebar follow quiet selection: light primary fill (`bg-primary/10`) and weight only. Do not use theme-colored left borders, vertical accent bars, near-invisible muted grays, or parallel selection dialects.
13. Entity detail / edit dialogs follow the Entity detail dialog pattern (`ApiKeyDetailDialog` / `RouteDetailDialog`): compact overview card + optional two-column operational cards; open from `⋯` Edit by default.
14. Master–detail browsers follow the Master–detail workspace pattern: side-by-side bordered panes on wide screens, Sheet/Dialog on narrow screens, never absolute overlay over the list.
15. Never join organization and project names with `/` in one control, option, cell, or chip. Show organization name or project name alone; when both are required, use separate labeled fields or columns.
16. Select / Combobox options must show only the entity display name (or other single identity). Never concatenate protocol, strategy, counts, or other metadata into option labels. Put those details outside the menu after selection.
17. Layout stability: reserve height for post-selection details and strategy-dependent panels in create wizards and dense forms. Multi-example code switchers must use **fixed-height Tab containers** with internal scrolling rather than layout-shifting toggles. Selection/tab switching must not cause visible vertical jump or dialog resize.
18. Shared overlays must provide dialog semantics, focus trap, initial focus, and focus restore.
19. **No casual subtitles.** Do not add page, card, or section subtitles that restate the title or fill space. Use a subtitle only when it carries an instruction the title cannot express. Prefer no subtitle.

## PR checklist

1. Colors come from semantic tokens (`primary` / `destructive` / `success` / `warning` / `muted`).
2. Buttons use shared `Button` variants; no native selects.
3. Dialogs follow shared structure and overlay accessibility; entity detail dialogs follow the compact Entity detail dialog pattern; overlay / Escape dismiss works; no native `confirm`/`alert`; delete uses `AlertDialog`; selected rows/sidebar use `bg-primary/10` without a theme accent bar.
4. Master–detail pages keep list and detail as independent bordered panes on wide screens and fall back to Sheet/Dialog on narrow screens.
5. Long Chinese/English/key/model text does not overflow or obscure metrics.
6. Table horizontal scroll stays inside the table container.
7. Selecting routes/strategies or toggling optional sections does not jitter dialog or wizard layout (reserved slots / min-height).
8. `npm run lint` passes.
9. New cards and pages do not add decorative subtitles under titles.

Change order when editing the visual baseline: tokens (`index.css` / Tailwind) → `components/ui/*` → pages/components → desktop + mobile screenshot regression.

