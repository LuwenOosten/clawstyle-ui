# Agent guidance

This repository is **ClawStyle UI**, an unofficial, community-built alternative
frontend for the Hermes Agent dashboard. It preserves the upstream REST/WebSocket
protocol, authentication and profile isolation. Work directly in the repository; do not
delegate recursively.

## Commands

```bash
npm ci          # reproducible install
npm run dev     # Vite dev server (needs a Hermes Agent backend)
npm run check   # typecheck + lint + tests + build
npm start       # standalone frontend server for the built dist/
```

`npm run check` is the required gate for changes. Keep typecheck, lint, tests and build
green.

## Rules

- Do not commit user configuration, credentials, session tokens, real chats, runtime
  logs, or private infrastructure identifiers.
- Public screenshots and docs must use synthetic data only.
- Preserve upstream MIT attribution (see `LICENSE` and `docs/ATTRIBUTION.md`).
- Keep public documentation in English and Simplified Chinese where a counterpart exists.
- Do not start, stop or reconfigure the Hermes Agent backend as part of frontend work.
  Bootstrap/session tokens are injected by the backend at serve time.
- Keep protocol fixtures and upstream tests unless there is a documented reason to
  change them.
- Only touch the files needed for the task; no drive-by refactors.
