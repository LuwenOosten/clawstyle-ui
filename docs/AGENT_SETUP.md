# Agent setup and configuration

This page is for users who want an AI coding agent (Codex, Claude Code, Cursor, Pi, …) to install
and run ClawStyle UI, and for anyone who needs an accurate map of where models, providers and
profiles are configured.

ClawStyle UI is a **frontend only**. It needs an already-installed and running Hermes Agent
dashboard backend and must not modify it. The agent workflow below is deliberately conservative about
that backend.

## Copyable prompt for an AI coding agent

Copy the block below into your agent. Replace the checkout URL/path if you keep a local copy.

```text
Set up the ClawStyle UI frontend on this machine and run it against the existing Hermes
Agent dashboard backend.

Goal
- A locally running ClawStyle UI at http://127.0.0.1:9130 backed by a Hermes backend on
  this machine (backend and frontend may use different loopback ports).
- Report the exact commands you ran, the health-check output, the URL, and anything still broken.

Authorized without further check-ins
- Inspecting processes, ports and installed tools; cloning this repository; running npm ci, the
  build and the frontend.
- If Hermes is installed but no backend is running, start one yourself on a free loopback port:
  hermes dashboard --no-open --port <free-port> > /tmp/hermes-dashboard.log 2>&1 &
  Check first whether a backend already answers, and never stop, restart or interrupt an existing
  service — reuse it instead.

Ask first
- Installing anything system-wide, using sudo, exposing anything beyond 127.0.0.1, or replacing a
  backend that is already running.

Never (do not skip)
- Modify backend configuration (config.yaml, .env, provider defaults, API keys, models, memory,
  skills, sessions) or stop/restart/reconfigure an existing backend or gateway.
- "Fix" a frontend problem by changing backend configuration.

Steps
1. Inspect first and report:
   - uname -s; node -v; npm -v
   - curl -sI http://127.0.0.1:9119 | head -n 1   (is a backend already running?)
   - command -v hermes
   - whether ports 9119 and 9130 are already in use
2. Get the frontend (skip if you already have the checkout):
   git clone https://github.com/LuwenOosten/hermes-clawstyle-ui.git
   cd hermes-clawstyle-ui
3. Install dependencies:
   npm ci
   If the npm version is outside the supported range, use: npx npm@11.17.0 ci
4. Ensure a backend is available. Reuse a running backend if one answers. Otherwise, if `hermes`
   is installed, start one on a free loopback port (for example 19119) with the command above and
   wait until its root returns HTTP 200 including window.__HERMES_*. If Hermes is not installed,
   stop and tell me.
5. Build and start the frontend. Plain `npm start` runs in the foreground: either keep it in this
   terminal and use a second terminal for the health check, or start it detached and keep the
   process handle/log for cleanup.
   npm run build
   PORT=9130 HERMES_DASHBOARD_URL=http://127.0.0.1:<backend-port> npm start
6. Health check (second terminal, or after detaching):
   curl -s http://127.0.0.1:9130/healthz
   Confirm the JSON shows "ok": true and "backend": { "ok": true, "bootstrap": true }. If it is
   503, read backend.detail and the server stderr; fix only frontend-side causes (PORT,
   HERMES_DASHBOARD_URL, whether the backend answers with the bootstrap).
7. Tell me the URL http://127.0.0.1:9130, the exact commands, and the health-check output. Note any
   warnings from npm/build.

Do not configure models, providers, keys or profiles as part of setup. If I later ask for a
specific configuration change, follow the "Configuration management guide" in docs/AGENT_SETUP.md:
summarize the exact scope, save only the values I authorized, and ask only when a required value is
missing or a new choice is needed.
```

The rest of this page is the manual version of that workflow plus the configuration map the prompt
refers to.

## Environment inspection

Run these before installing anything:

```bash
uname -s                              # macOS/Linux expected
node -v                               # ^22.22.0 || ^24.11.0 || >=26.0.0
npm -v                                # <11.10.0 || >=11.17.0
curl -sI http://127.0.0.1:9119 | head -n 1   # backend already running?
command -v hermes                     # how the backend is normally started
lsof -nP -iTCP:9130 -sTCP:LISTEN 2>/dev/null || true   # frontend port free?
```

If the backend is not running, start it with your usual method (usually `hermes dashboard`; add
`--no-open --port <free-port>` if another backend already owns the default port) and wait until
`curl -I http://127.0.0.1:9119` answers. Do not install a second backend or change backend
configuration to make the frontend work.

## Install, start, health check

```bash
git clone https://github.com/LuwenOosten/hermes-clawstyle-ui.git
cd hermes-clawstyle-ui
npm ci
npm run build
PORT=9130 HERMES_DASHBOARD_URL=http://127.0.0.1:9119 npm start
```

Health check in a second shell:

```bash
curl -s http://127.0.0.1:9130/healthz | jq
# expect: { "ok": true, "backend": { "ok": true, ... }, ... }
```

For UI development use `npm run dev` instead (Vite on `http://127.0.0.1:9130`, `strictPort`); it
proxies to the backend and forwards the session-token bootstrap. Set
`HERMES_CLAWSTYLE_DEV_PORT` if 9130 is busy.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/healthz` returns `503`, `backend.ok: false` | Backend stopped, `HERMES_DASHBOARD_URL` wrong, or a 200 backend without `window.__HERMES_*` (headless) | Start/reuse a Hermes dashboard backend; make `HERMES_DASHBOARD_URL` a loopback URL whose root includes the bootstrap (`backend.bootstrap: true`). |
| Page loads but requests 401 | Standalone/dev server could not inject the backend session token | Check `/healthz`, then reload after the backend is reachable; tokens rotate on backend restart. |
| "Cannot reach the Hermes Agent backend" banner | Sidebar status poll failed | Fix the backend reachability, then click **Retry now**. |
| `npm start` exits with "uses the frontend listen port" | `HERMES_DASHBOARD_URL` equals the frontend `PORT` (self-proxy) | Point `HERMES_DASHBOARD_URL` at the backend, or change `PORT`, e.g. `PORT=9130`. |
| `HERMES_DASHBOARD_URL` rejected | Non-loopback host, or it equals the frontend dev/listen port | Use `http://127.0.0.1:9119` or another loopback backend port. |
| `npm ci` fails on Node/npm | Version outside engines range | Install a supported Node/npm, or `npx npm@11.17.0 ci`. |
| Chat asks for sudo / secret / browser preview | PTY-only interactive flow, unsupported in native chat | Use **System → Open console**, the upstream dashboard, or the CLI terminal. |

## Configuration management guide

All of the following is stored by the **Hermes backend** and shared with the upstream dashboard. In
this UI, every request is scoped to the currently selected management profile (visible in the sidebar
profile switcher).

### Routes at a glance

| Route | What it manages | Persistence |
| --- | --- | --- |
| `/models` | Model usage/analytics; **Model Settings** (main model, auxiliary task overrides, Mixture-of-Agents presets) | Persistent config, applied to **new sessions** |
| `/env` | API keys in `.env`; OAuth provider logins; custom env vars | Persistent, saved to disk immediately |
| `/profiles` | Profiles: create/clone, rename, delete, set active, `SOUL.md`, per-profile model | Persistent, per profile |
| `/config` | Typed `config.yaml` editor; raw YAML; export/import; reset-to-defaults per section | Persistent after Save |
| `/chat` | Sessions and their live model/tools | Session-scoped while the session runs |

The sidebar **profile switcher** is not a setting: it selects which profile the management pages read
and write. "this dashboard (<name>)" means the profile the backend process itself serves.

### Models

**Persistent (default for new sessions)** — `/models` → **Model Settings** card:

- **Main model** — click **Change** and pick provider + model in the picker. Any expensive-model
  confirmation the backend requests is part of the flow; confirm only if that is intended.
- **Auxiliary tasks** — tasks such as vision or session search can inherit the main model or use an
  override; the card shows the override count and opens a per-task picker modal.
- **Mixture of Agents** — presets made of reference models plus one aggregator. The aggregator is the
  acting model (answers and calls tools); references provide perspectives.

These assignments are backend configuration and apply to sessions created afterwards.

**Per session** — in a live `/chat` conversation, the model pill in the chat header opens
**Switch model**. This changes the model for that running session only; it does **not** rewrite the
profile's default model. `ModelPickerDialog` talks to the live gateway with the session id, so no
persistent model preference is changed. Some tasks cannot use an in-session switch; use `/models` for
those.

### Providers and keys

**`/env` (Keys)**:

- **LLM Providers** — set/replace/clear API keys stored in `.env`. Stored values are masked by
  default and can be revealed on demand; saving is immediate.
- **OAuth provider logins** — `Login`/`Disconnect` per provider, with a CLI-command fallback shown
  for flows the dashboard cannot run.
- **Custom keys** — arbitrary `.env` variables for skills, MCP servers or tooling.

Provider defaults (which provider a model maps to, base URLs, etc.) live in `/config`, not `/env`.
Never overwrite a provider default unless the user explicitly asks; the UI will happily persist it
and the agent will use the new value on the next session.

### Profiles

**`/profiles`**:

- **New Profile** — name (lowercase letters, digits, `_`, `-`; up to 64 chars) and optionally clone
  config from an existing profile or start blank.
- Each profile card offers model editing, rename, delete, `SOUL.md` editing, copying the equivalent
  CLI command, and **Set as active**.
- Deleting a profile removes its config, keys, memories, sessions, skills and cron jobs — treat it as
  destructive and confirm with the user.
- A profile with a running gateway shows a warning before changes that stop it.

**Scope** — selecting a profile in the sidebar switcher changes what every management page reads and
writes (config, keys, skills, MCP, model settings, new chats). It does not change the backend process
itself. Profiles are the right way to keep agents isolated; do not move configuration between
profiles by hand-editing files when the UI offers the operation.

### What an agent must never do unprompted

- Set or change a provider default, API key, model assignment or profile on the user's behalf.
- Edit `~/.hermes/config.yaml`, `~/.hermes/.env`, profile directories or session stores directly.
- Delete a profile, clear a key, reset a config section, or trigger **Update Hermes** /
  **Restart gateway** from the System page.
- Stop, start, update or reconfigure the Hermes backend to "make the frontend work".

If the user explicitly asks for one of these, do exactly what was requested: state the scope (which
profile and which values), save only the authorized values, and do not re-confirm each already
explicitly requested change. Ask only when a required value is missing or a different choice must
be made. Use the UI/API path rather than editing files behind the backend's back.
