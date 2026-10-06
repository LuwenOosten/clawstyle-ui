# Getting started

This guide takes you from a clean checkout to a running ClawStyle UI against a local Hermes
Agent backend, then covers configuration, health checks and troubleshooting.

ClawStyle UI is a browser frontend only. It **requires a running Hermes Agent dashboard
backend** (default `http://127.0.0.1:9119`). Installing and starting it does not change the backend's
configuration or services; the Config/Keys/Models pages only write backend configuration when you
explicitly save, as described in [AGENT_SETUP.md](AGENT_SETUP.md#configuration-management-guide).

## 1. Prerequisites

| Requirement | Version / notes |
| --- | --- |
| Node.js | `^22.22.0 || ^24.11.0 || >=26.0.0` (`node -v`) |
| npm | `<11.10.0 || >=11.17.0` (`npm -v`); the repo is installed with `npm ci` |
| Hermes Agent backend | Running and reachable on loopback; `hermes dashboard` serves it on `http://127.0.0.1:9119` |
| OS | macOS or Linux. Native Windows is not supported (POSIX scripts; WSL untested) |

The frontend port must differ from the backend port; the standalone server and the Vite dev server
reject a configuration where `HERMES_DASHBOARD_URL` points at the frontend's own listen port
(self-proxy). The default backend port is `9119`, the default frontend port is `9130`.

## 2. Install

```bash
git clone https://github.com/LuwenOosten/clawstyle-ui.git
cd clawstyle-ui
npm ci
```

`npm ci` uses the committed `package-lock.json` and installs the `web` and `apps/shared` workspaces.

## 3. Run

### Production-style standalone server (recommended for daily use)

```bash
npm run build      # typechecks and writes ./dist (build receipt included)
npm start          # serves ./dist and proxies to the backend, default http://127.0.0.1:9130
```

`npm run preview` is an alias for the same server. The server injects the backend's
`window.__HERMES_*` bootstrap script into `index.html` at request time. This is why it cannot run
without a dashboard backend: without the injected session token, API requests are unauthenticated.
A `hermes serve` (headless) backend answers HTTP 200 but does not inject the bootstrap, so it is not
usable as the upstream here.

### Development (while changing UI)

Start the backend first, then:

```bash
npm run dev        # Vite dev server, http://127.0.0.1:9130 by default (strictPort)
```

The dev server:

- proxies `/api` and `/dashboard-plugins` (including WebSockets) to `HERMES_DASHBOARD_URL`;
- fetches the backend dashboard HTML to inject `window.__HERMES_SESSION_TOKEN__` and the other
  bootstrap flags. If the backend is down, the console prints a warning and `/api` calls will 401;
- uses `HERMES_CLAWSTYLE_DEV_PORT` if 9130 is taken.

## 4. Configure

### Environment variables

| Variable | Default | Applies to | Notes |
| --- | --- | --- | --- |
| `PORT` | `9130` | `npm start`, `npm run preview` | Listen port. Must differ from the backend port; a self-proxy (`HERMES_DASHBOARD_URL` equal to this port) is rejected. |
| `HERMES_DASHBOARD_URL` | `http://127.0.0.1:9119` | dev proxy + standalone server | Backend origin. Loopback only (`127.0.0.1`, `localhost`, `::1`). Must not equal the frontend listen/dev port. |
| `HERMES_CLAWSTYLE_DEV_PORT` | `9130` | `npm run dev` | Vite dev-server port (`strictPort`); useful for tests or when 9130 is busy. |
| `HERMES_CLAWSTYLE_DIST` | `./dist` (next to `ops/server.mjs`, or the repo `dist/`) | standalone server | Built bundle directory. |
| `HERMES_CLAWSTYLE_HOST` | `127.0.0.1` | standalone server | Listen address; loopback only. |
| `HERMES_CLAWSTYLE_ALLOWED_HOSTS` | *(empty)* | standalone server | Extra trusted `Host`/`Origin` values, comma-separated. Useful when a TLS-terminating local proxy (for example `tailscale serve`) fronts the UI. A bare hostname gets `PORT` appended. |

Example against a backend on a non-default loopback port:

```bash
HERMES_DASHBOARD_URL=http://127.0.0.1:9199 PORT=9130 npm start
```

### Deploy-time overrides (macOS LaunchAgent helper)

These are read by `ops/deploy.mjs`; they exist for scripted installs and tests.

| Variable | Meaning |
| --- | --- |
| `HERMES_CLAWSTYLE_APP_ROOT` | Version store root (default `~/Library/Application Support/HermesClawStyleUI`) |
| `HERMES_CLAWSTYLE_LAUNCH_AGENTS_DIR` | LaunchAgent directory (default `~/Library/LaunchAgents`) |
| `HERMES_CLAWSTYLE_LAUNCHCTL` | `launchctl` binary; setting it also enables the launchd path for tests |
| `HERMES_CLAWSTYLE_RELOAD_RETRY_DELAY_MS` | Base backoff between service reload retries |
| `HERMES_CLAWSTYLE_HTTP_READY_TIMEOUT_MS` | Bounded wait for the HTTP probe during `check` |

### In-app configuration

Day-to-day configuration (models, providers, profiles, keys, skills, MCP, channels, config YAML) is
done against the backend through the UI. The exact pages and controls are documented in
[AGENT_SETUP.md](AGENT_SETUP.md#configuration-management-guide). Highlights:

- `/config` — typed configuration form plus a raw YAML editor.
- `/env` — API keys in `.env` and OAuth provider logins.
- `/models` — main model, auxiliary task overrides and Mixture-of-Agents presets.
- `/profiles` — create/clone/rename/delete profiles, edit `SOUL.md`, set a profile model.
- Sidebar profile switcher — every management page follows the selected profile.

## 5. Health checks

1. **Standalone server probe** — while it is running:

   ```bash
   curl -s http://127.0.0.1:9130/healthz | jq
   ```

   Returns `200` with the frontend config, the last bootstrap injection result, and a live backend
   probe (`backend.ok`, `backend.bootstrap`). Returns `503` when the backend is unreachable **or**
   when it answers 200 without the `window.__HERMES_*` bootstrap (headless/wrong upstream);
   `backend.detail` names the URL and the failure.

2. **In-app diagnostics** — when the sidebar status poll fails, the app shell shows a
   "Cannot reach the Hermes Agent backend" banner with a Retry action. Per-page load failures show a
   "Could not load …" card with Retry.

3. **Deployment health (macOS LaunchAgent)**:

   ```bash
   node ops/deploy.mjs check          # human-readable PASS/FAIL lines
   node ops/deploy.mjs check --json   # machine-readable
   ```

4. **Workspace gate**:

   ```bash
   npm run check                      # typecheck + lint + tests + build
   ```

## 6. Troubleshooting

### The page loads but every request fails / "Your dashboard session has expired"

The frontend could not get a session token from the backend. For `npm start`, the standalone server
fetch failed; for `npm run dev`, the dev-server bootstrap fetch failed.

- Confirm the backend is running: `curl -I http://127.0.0.1:9119` (or `hermes dashboard`).
- Confirm `HERMES_DASHBOARD_URL` points at that backend **on loopback**.
- `curl -s http://127.0.0.1:9130/healthz` and read `backend.detail`.
- Reload once after fixing: loopback session tokens rotate on every backend restart, so a tab opened
  before a restart holds a stale token. The app already tries one automatic reload on a stale-token
  401; if it still fails, reload manually.

### "Cannot reach the Hermes Agent backend" banner

The sidebar status poll failed. Start the backend, or fix `HERMES_DASHBOARD_URL` / the port, then
click **Retry now** (or wait for the next 10-second poll).

### `npm start` exits with "uses the frontend listen port"

`HERMES_DASHBOARD_URL` and the frontend listen port are the same, which would proxy the frontend
to itself. Point `HERMES_DASHBOARD_URL` at the backend (default `http://127.0.0.1:9119`) or change
`PORT`, e.g. `PORT=9131 npm start`.

### `HERMES_DASHBOARD_URL` rejected

The server only accepts loopback origins. It also rejects a URL that equals the frontend listen
port. Use `http://127.0.0.1:9119` (or your own loopback backend port).

### `npm ci` fails on Node/npm version

Check `node -v` and `npm -v` against the requirement table. The lockfile expects a modern npm; use
`npm ci` from a supported version, or `npx npm@11.17.0 ci` if your default npm is outside the
supported range.

### Chat: a request prompts for sudo / a secret / a browser preview

Those interactive flows are PTY-only and are not implemented in the native chat; the UI fails them
explicitly. Use **System → Open console** in this UI (the build still ships the xterm console
chunk), or the upstream dashboard / CLI terminal.

### Restoring the original dashboard

Nothing in the backend was modified. Stop the frontend and browse to the backend:

```bash
# foreground `npm start`: Ctrl+C
launchctl bootout gui/$(id -u)/local.hermes.clawstyle-ui   # macOS LaunchAgent only
open http://127.0.0.1:9119
```

### Cleanup of the macOS deployment

Only remove paths the deploy helper owns (check `owner.json` inside the app root first):

```bash
launchctl bootout gui/$(id -u)/local.hermes.clawstyle-ui 2>/dev/null || true
rm -f ~/Library/LaunchAgents/local.hermes.clawstyle-ui.plist
rm -rf ~/Library/Application\ Support/HermesClawStyleUI
```
