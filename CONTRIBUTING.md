# Contributing

Thanks for helping improve ClawStyle UI. This is a community frontend for the Hermes Agent
dashboard; contributions are welcome as long as they keep the upstream protocol and the backend
untouched.

## Scope and ground rules

- **Frontend only.** Do not change the Hermes Agent backend, its config, or its services. The
  frontend talks to it over the same REST/WebSocket contract the upstream dashboard uses.
- **Preserve the contract.** Keep authentication, profile scoping and the JSON-RPC gateway contract
  intact. Don't fork the protocol to make a UI feature work.
- **Preserve attribution.** Derived code keeps the upstream MIT notice (`LICENSE`). New third-party
  assets need a license note in [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md).
- **No private data.** Never commit credentials, tokens, real chats, runtime logs, personal paths or
  private hostnames. Screenshots must use synthetic data.
- **Keep the surface small.** One change per PR; no drive-by refactors. Ask first if a change would
  touch the backend API surface or the shared library behavior for other consumers.

## Setup

Requires Node.js `^22.22.0 || ^24.11.0 || >=26.0.0` and npm `<11.10.0 || >=11.17.0`, plus a running
Hermes Agent backend for manual testing (see [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)).

```bash
npm ci
npm run dev        # Vite dev server with the /api proxy
```

## Checks

Every PR must keep these green:

```bash
npm run check      # typecheck + lint + test + build
```

Individual targets:

```bash
npm run typecheck
npm run lint
npm test           # web vitest + apps/shared vitest + ops node:test
npm run build
```

Useful workspace-scoped commands:

```bash
npm run test --workspace web
npm run test --workspace @hermes/shared
npm run test:ops
```

Add or update tests for behavior you change. Upstream tests and protocol fixtures are kept unless a
change documents why they must change; don't delete them just to go green.

## Conventions

- TypeScript strictness and ESLint are enforced; run `npm run lint:fix` before opening a PR.
- Follow the existing component/state split: pure reducers and transport logic under
  `web/src/features/` and `web/src/lib/`, UI under `web/src/components/` and `web/src/pages/`.
- UI primitives live in `web/src/ui/`; theme tokens in `web/src/themes/`. Don't hard-code colors that
  a theme is supposed to control.
- The OpenClaw/ClawStyle theme is gated on `:root[data-dashboard-theme="openclaw"]`; never leak rules
  into other themes.
- User-facing strings belong in `web/src/i18n/` (English is the fallback catalogue; add Chinese
  translations for Simplified Chinese when possible).
- Public docs are maintained in English and Simplified Chinese pairs:
  `README.md` / `README.zh-CN.md`, `docs/GETTING_STARTED.md` / `docs/GETTING_STARTED.zh-CN.md`,
  `docs/AGENT_SETUP.md` / `docs/AGENT_SETUP.zh-CN.md`. Update both sides of a pair.
- Screenshot references use `docs/assets/chat-preview.png` and `docs/assets/config-preview.png`.
  Only replace them with captures of synthetic data.

## Pull requests

1. Branch from `main` (e.g. `feat/…`, `fix/…`, `docs/…`).
2. Keep the PR description aligned with `.github/PULL_REQUEST_TEMPLATE.md`: summary, user-visible
   changes, verification commands, screenshots for UI changes, and known limitations.
3. Make sure `npm run check` passes locally and CI is green.
4. Note any compatibility impact explicitly: gateways/REST routes used, backend version assumptions,
   or changed docs.

Reviewers check behavior against a real Hermes backend when possible. If you cannot test a path,
say so in the PR instead of implying it was verified.

## Reporting issues

Include the frontend commit, Node/npm version, OS, the backend version if known, what you did, what
you expected, and the actual output. For gateway/chat issues include the method/event names and the
error text (redact tokens and personal data).
