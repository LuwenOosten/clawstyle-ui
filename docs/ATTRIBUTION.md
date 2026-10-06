# Attribution, licenses and compatibility

## Upstream source

ClawStyle UI is a community frontend derived from the upstream Hermes Agent dashboard:

- Upstream project: [NousResearch/Hermes-Agent](https://github.com/NousResearch/Hermes-Agent)
- Frontend source: a snapshot of the upstream `web/` tree taken from a **local** snapshot commit
  `48799de49`, based on upstream commit `2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc`.
  `48799de49` is a local snapshot identifier, **not** a public upstream commit.
- License: MIT, Copyright (c) 2025 Nous Research — see [../LICENSE](../LICENSE)

The quickstart/docs/standalone-server/deploy tooling in this repository was written for this
project; the dashboard UI, shared TypeScript library, protocol client and test suite come from the
upstream snapshot and keep the upstream MIT notice.

### What this fork changed

- Renamed the package, server/deploy labels and user-facing branding to `clawstyle-ui` /
  "ClawStyle UI" (backend labels and ports are untouched).
- Added the OpenClaw/ClawStyle theme as the default for new installs, with an explicit preference
  for already saved themes.
- Readable system/CJK font stacks and OpenClaw typography; code stays in a real monospace stack.
- No webfont binaries are redistributed: the upstream design-system brand fonts (Collapse, Rules,
  Mondwest) and the former terminal font are removed, and the DS font variables are remapped to the
  active theme's system stacks (see below).
- Backend reachability diagnostics (`/healthz`, in-app banner) and public documentation
  (English + Simplified Chinese).
- Productization metadata, CI, contribution templates and docs for an open-source repository.

The REST/WebSocket protocol, authentication/session-token handling, profile isolation and backend
API surface are unchanged from the snapshot.

## Design references (inspiration only)

The ClawStyle visual language was informed by these community projects. **No assets, code or
stylesheets were copied from them**; palettes, selectors and components in this repository are
implemented here (see `web/src/themes/openclaw.css`, `web/src/themes/presets.ts`).

- [itq5/OpenClaw-Admin](https://github.com/itq5/OpenClaw-Admin)
- [NextAgentX/HermesClaw](https://github.com/NextAgentX/HermesClaw)

"OpenClaw" is the name of the theme preset this project ships; the name and any third-party marks
belong to their respective owners.

## Third-party components and fonts

- npm dependencies keep their own licenses (React, Vite, Tailwind CSS, TypeScript, xterm.js,
  Observable Plot, three.js, lucide-react, qrcode, motion/GSAP and others). The installed versions
  and license identifiers are listed in `node_modules/*/package.json` and `package-lock.json`;
  verify there before redistributing.
- **`@nous-research/ui` (MIT)** is the upstream dashboard's design-system component library. This
  project imports its CSS variable/utility declarations (and, at runtime, its compiled component
  code) but **does not redistribute the brand display webfonts** that the package bundles
  (Collapse, Rules Compressed/Expanded, Mondwest). Their license terms could not be established for
  this snapshot, so the binaries are removed and every DS font slot is remapped in
  `web/src/index.css` to the active theme's system sans/mono stacks. No theme depends on those
  files.
- **No webfont binaries are bundled in this repository.** `web/public/` ships only the favicon. The
  production build (`scripts/build/web.mjs`) fails if an `@font-face` source or a copied public
  asset would emit a `.woff`, `.woff2`, `.ttf`, `.otf` or `.eot` file implicitly. The former
  terminal font files are gone; the optional xterm console uses the operating system's monospace
  stack (`web/src/lib/terminal-font.ts`).
- **Fonts fetched by the browser, optionally.** The curated font-override catalog
  (`web/src/themes/fonts.ts`) and a few built-in themes reference Google Fonts stylesheets (Inter,
  IBM Plex, Work Sans, Spectral, JetBrains Mono and others). Those files are served by Google under
  their own open font licenses; this project neither hosts nor redistributes them. They load only
  when the user explicitly selects that font or theme, and every stack ends in a generic system
  fallback so an offline or blocked fetch still renders.

## Compatibility

**Verified against upstream Hermes Agent at commit
[`2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc`](https://github.com/NousResearch/hermes-agent/commit/2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc)
(2026-10-02).** Verification covered the dashboard REST API, the JSON-RPC/WebSocket gateway and
config persistence against a dedicated test home and backend port; `web_server.py` and
`tui_gateway` were unmodified. This is a community best-effort result, not an upstream endorsement.
Newer Hermes Agent commits are **unverified**; re-check with your backend version before relying on
this frontend.

What is known and required:

- The frontend expects a running Hermes dashboard backend on loopback
  (`HERMES_DASHBOARD_URL`, default `http://127.0.0.1:9119`).
- The standalone server and Vite dev server fetch the backend's dashboard `index.html` and forward
  the `window.__HERMES_*` bootstrap values to the SPA. A backend that does not inject those values
  (or that is unreachable) cannot authenticate the frontend; the standalone server reports this
  through `GET /healthz` and the in-app backend banner.
- Chat uses the backend's JSON-RPC gateway over `/api/ws` (`session.*`, `message.*`, `tool.*`,
  `approval`, `clarify`, `config.set --session`, `image.attach_bytes`, …). REST endpoints under
  `/api/*` and the `/dashboard-plugins/*` script endpoints are proxied unchanged.
- The npm workspace is based on the local snapshot `48799de49` (based on `2f80ae0a6`). The generated
  contract lives in `apps/shared/src/gateway-contract.generated.ts`.
- The default `/chat` is the native structured JSON-RPC client. The legacy terminal chat page is not
  routed in this build, but `HermesConsoleModal` still imports xterm and the build emits an xterm
  chunk for the optional **System → Open console** PTY console; interactive PTY-only flows are not
  part of the native chat.

Compatibility with the upstream Python backend is a community best-effort; report mismatches with the
backend version, the failing route/gateway method and the error text.

## Reporting attribution or licensing issues

If something here is mis-attributed or you believe an asset should not be included, open an issue in
the repository with the path and reason. Corrections are welcome.
