# Validation — 2026-10-06

[简体中文](VALIDATION.zh-CN.md)

## Build and automated checks

On macOS, Node 22.22.1 and npm 10.9.4:

- Clean `npm ci` completed successfully.
- Final `npm run check` exited 0: TypeScript, ESLint, tests and production build.
- 698 tests passed: web 540, shared 122, standalone server/deployment 36.
- ESLint: 0 errors, 25 inherited warnings. The build retains a warning about a main chunk above 600 kB.
- The build contains no bundled font binaries. CI runs the same complete check on GitHub. The results above are local; see the repository Actions tab for the latest remote run.

## Isolated Hermes integration

Tested against upstream Hermes commit [`2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc`](https://github.com/NousResearch/hermes-agent/commit/2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc). Dashboard API and gateway source were unchanged. Dedicated temporary Hermes home, profiles, workspaces and ports were used; no real credentials or conversations were imported. A loopback synthetic OpenAI-compatible provider supplied deterministic model replies.

Passed through the real Hermes REST/WebSocket services:

- Authenticated page bootstrap; first message creation, streaming and completion.
- Interrupt during a delayed streaming turn; completion reports interrupted.
- Disconnect and reconnect, then restore persisted session history.
- Actual tool approval: denial leaves a synthetic canary intact; approval once permits only an operation on a disposable test directory.
- Configuration save and readback, including a separate profile whose values do not change the default profile.

The isolated test launcher reused an installed dependency interpreter and bypassed package-manager environment activation because Hermes dependency generations are keyed by `HERMES_HOME`. This is a test-harness accommodation, not a production installation method. The documented user command remains `hermes dashboard --no-open --port 9119`.

## Browser and visual review

Sol used the running frontend and actual isolated backend, and the host independently inspected the public screenshots:

- Enter submits a message; Shift+Enter inserts a newline.
- Config edit shows unsaved state; Save followed by refresh preserves the changed value.
- English and Simplified Chinese navigation; OpenClaw dark and Nous Blue light themes.
- Desktop and 390 × 844 mobile layouts; no horizontal document overflow in Chat or Config.
- System font fallback and readable Chinese text; no captured browser JavaScript errors during the checked flows.
- Screenshot previews use only synthetic data. See [capture notes](assets/README.md).

Stop and approval were exercised through the real WebSocket protocol and automated UI tests; their browser buttons/cards were not separately exercised end to end.

## Public-package review and limits

- Exported selected source into a new Git repository without private development history.
- Public files were checked for personal absolute paths, private host identifiers, private keys and common credential patterns; no matches remained. Markdown file/image links were checked locally.
- The original dashboard service and source checkout remain unchanged.
- macOS was executed; Linux instructions were reviewed but not executed. Native Windows is not supported in this release.
- Deterministic mock-provider coverage is not a test of paid model providers or their network behavior.
- Backend-provided configuration labels/help remain partly English. Documentation is available in English and Simplified Chinese.
- Compatibility beyond the pinned backend commit is unverified. This frontend does not replace the Hermes backend, and some interactive tasks still require its console or CLI.
