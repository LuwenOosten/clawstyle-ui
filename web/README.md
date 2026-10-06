# ClawStyle UI — web frontend

The browser dashboard for this project: React 19 + Vite + TypeScript, Tailwind CSS v4,
and a small hand-rolled component layer. It talks to a running Hermes Agent dashboard
backend over REST and WebSocket (JSON-RPC); it is not a standalone product.

Project overview, quickstart, configuration and troubleshooting live in the
[root README](../README.md) and [docs/](../docs/). This file covers frontend-specific
conventions for contributors.

## Stack

- **Vite** + **React 19** + **TypeScript**
- **Tailwind CSS v4** with theme-driven CSS variables
- Hand-rolled UI primitives (no component-library dependency required)

## Development

Start the Hermes Agent backend first (it serves the dashboard API and injects the
per-process session token), then run the Vite dev server from the repository root:

```bash
npm ci
npm run dev        # Vite dev server on http://127.0.0.1:9130; /api proxies to http://127.0.0.1:9119
```

The dev server defaults to the same port as the standalone server (9130, `strictPort`) and
reads `HERMES_CLAWSTYLE_DEV_PORT` for test runs. Use `HERMES_DASHBOARD_URL` to change the
proxy target for both the dev server and `npm start`; the Vite proxy target is set in
`web/vite.config.ts`.

Useful workspace commands (also available from the repository root):

```bash
npm run typecheck --workspace web
npm run lint --workspace web
npm run test --workspace web
npm run build --workspace web   # writes the repository-root dist/
```

## Structure

```
src/
├── components/      # UI primitives and feature components (chat, pickers, dialogs)
├── contexts/        # App-level providers (profile scope, page header, system actions)
├── features/chat/   # Native JSON-RPC chat controller, reducer and drafts
├── hooks/
├── i18n/            # Locale catalogs (English is the fallback catalogue)
├── lib/             # API client, gateway client and small pure helpers
├── pages/           # Route-level pages (chat, config, models, profiles, …)
├── themes/          # Theme presets and the OpenClaw/ClawStyle stylesheet
├── ui/              # Layout, inputs, modals, status primitives
├── App.tsx          # Shell, navigation and routing
├── main.tsx         # React entry point
└── index.css        # Tailwind imports and theme variables
```

## Typography & contrast rules

Read before adding or editing UI styles. These rules keep the dashboard legible across all
built-in themes and stop drift back into the patterns the design system was refactored out of.

### Text size floor

- **Minimum body size: `text-xs` (12px / 0.75rem).** Do not use arbitrary `text-[0.6rem]`, `text-[0.65rem]`, `text-[9px]`, `text-[10px]`, or `text-[11px]` on copy, hints, labels, counts, or badges. Use the standard scale: `text-xs`, `text-sm`, `text-base`.
- Smaller sizes are only acceptable on **decorative overlays** (chart stripes, empty-state icons) — never on text the user is meant to read.

### Opacity floor on text

- **Never apply opacity below 0.7 to text.** No `opacity-30`, `opacity-50`, `opacity-60` on `<span>`s, `<p>`s, labels, etc.
- **Do not stack opacity tokens.** Patterns like `text-muted-foreground/60`, `text-midground/70`, `text-foreground/50` create unpredictable WCAG failures because the parent token already has alpha.
- Use the **semantic text tokens** from the design-system layer:
  - `text-text-primary` — default body text.
  - `text-text-secondary` — subtitles, meta, inactive nav.
  - `text-text-tertiary` — small chrome labels, counts, footnotes.
  - `text-text-disabled` — disabled states.
  - `text-text-on-accent` — text on filled accent surfaces.

### Brand uppercase via `text-display`, not raw `uppercase`

- The dashboard preserves the brand uppercase aesthetic, but it is **opt-in per element, not global**.
- Apply uppercase via the design-system utility `text-display` on **brand chrome only** — page titles, nav section headings, badges, brand wordmark. DS components (`Button`, `Badge`, `Tabs`, `Segmented`, etc.) already self-apply `text-display`.
- **Do not introduce new `uppercase`** (the literal Tailwind class). Prefer `text-display` for new brand chrome. Legacy `uppercase` call sites (e.g. `components/ui/label.tsx`, `card.tsx`) remain until migrated.
- The app shell does not force uppercase globally, so blanket `normal-case` opt-outs are unnecessary. Use `normal-case` only where a DS component applies `text-display` but the label should stay sentence case — e.g. dynamic user content (model slugs, theme names) **or** fixed UI copy that is not brand chrome.

### Fonts

Typography is **opt-in per surface**, not global on layout shells — the app shell and page header keep their original theme/expanded fonts; the display face applies only where explicitly set.

The design system's display utilities (`font-mondwest`, `font-expanded`, `font-compressed`) are
class names only: the upstream brand webfonts are **not bundled** here. `:root` in
`src/index.css` remaps `--font-mondwest`, `--font-rules-expanded` and `--font-rules-compressed` to
the active theme's sans stack, so the classes below render in theme-appropriate text on every
theme.

| Tier | Classes | Use for |
|------|---------|---------|
| Brand chrome | `font-mondwest text-display` (or `themedChrome`) | Sidebar nav, card section headers (`CardTitle`), Segmented filter buttons, filter panel headings |
| Themed body | `font-mondwest normal-case` (or `themedBody`) | Card content (`Card`, `CardDescription`), session/platform rows, analytics tables — **scoped to the component** |
| Page chrome | `font-expanded` | Page header h1 (`PageHeaderProvider`) — sentence case, not `text-display` |
| Wordmark | `Typography` + size/tracking only | Sidebar/mobile “Hermes” — mixed case, no display face, no `text-display` |
| Technical | `font-mono-ui` / `font-mono` / `font-courier` | Model slugs, env keys, schedules, YAML, repo URLs |

- Do **not** put `themedBody` or `themedFont` on `<main>`, `App`, or other layout wrappers — it overrides component-scoped styles.
- **`Card`** applies `themedBody`; **`CardTitle`** uses `text-display` (uppercase chrome); **`CardDescription`** uses `themedBody`.
- **`NouiTypography`** defaults to `font-sans` unless a font prop is passed.
- Do **not** use raw `font-sans` or `font-display` (theme sans variable) on new dashboard UI — prefer the tiers above where brand-appropriate.

### Color tokens

- Prefer **semantic tokens** (`text-text-*`, `bg-card`, `border-border`, `text-foreground`, `text-destructive`, `text-success`, `text-warning`) over raw layer references (`text-midground`, `text-foreground`).
- `text-muted-foreground` is wired to `--color-text-secondary`, so existing call sites stay correct, but new code should prefer the semantic name.
- When you genuinely need a non-token color (icon de-emphasis on a chart, terminal foreground via inline style), keep alpha at `≥ 0.7` for any text.

## Theme notes

The OpenClaw/ClawStyle theme is defined in `src/themes/presets.ts` (tokens) and
`src/themes/openclaw.css` (selector-level presentation). Both are gated on
`:root[data-dashboard-theme="openclaw"]`, so no rule can leak into another theme.
`src/themes/fonts.ts` holds the curated font-override catalog; stacks always end in a
system fallback so a failed webfont load stays usable. Google Fonts entries are fetched
only when a user selects them; nothing is redistributed with the build (the build fails if
font binaries are emitted).
