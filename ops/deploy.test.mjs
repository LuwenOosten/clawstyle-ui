// Tests for ops/deploy.mjs using throwaway app roots and LaunchAgent dirs.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const deployScript = path.join(here, 'deploy.mjs')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawstyle-deploy-test-'))
let counter = 0

function makeCase() {
  counter += 1
  const root = path.join(tempRoot, `case-${counter}`)
  const appRoot = path.join(root, 'app')
  const agents = path.join(root, 'agents')
  const dist = path.join(root, 'dist')
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(dist, 'index.html'),
    '<!doctype html><html><head><title>ClawStyle</title></head><body>/body></html>'
  )
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)\n')
  fs.writeFileSync(
    path.join(dist, 'hermes-build.json'),
    `${JSON.stringify({ inputs: { sourceHash: 'abcdef0123456789' }, outputHash: 'out', product: 'web', schema: 1 })}\n`
  )
  // A fake launchctl on PATH keeps every test away from the real launchd,
  // even on macOS where a service with the same label may be installed.
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const launchctl = path.join(bin, 'launchctl')
  fs.writeFileSync(
    launchctl,
    `#!/bin/sh
bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\\n' "$*" >> "$bin_dir/calls.log"
case "$1" in
  bootstrap)
    count=0
    [ -f "$bin_dir/bootstrap-count" ] && count=$(cat "$bin_dir/bootstrap-count")
    count=$((count + 1))
    printf '%s' "$count" > "$bin_dir/bootstrap-count"
    if [ "\${FAKE_LAUNCHCTL_FATAL:-0}" = "1" ]; then
      echo "Bootstrap failed: 2: No such file or directory" >&2
      exit 2
    fi
    if [ "$count" -le "\${FAKE_LAUNCHCTL_FAIL_BOOTSTRAPS:-0}" ]; then
      echo "Bootstrap failed: 5: Input/output error" >&2
      exit 5
    fi
    ;;
  print)
    [ "\${FAKE_LAUNCHCTL_PRINT_FAIL:-0}" = "1" ] && exit 3
    ;;
esac
exit 0
`
  )
  fs.chmodSync(launchctl, 0o755)
  return { agents, appRoot, bin, dist, root }
}

function deployEnv(caseDir, env = {}) {
  return {
    ...process.env,
    HERMES_CLAWSTYLE_APP_ROOT: caseDir.appRoot,
    HERMES_CLAWSTYLE_LAUNCH_AGENTS_DIR: caseDir.agents,
    PATH: `${caseDir.bin}${path.delimiter}${process.env.PATH}`,
    ...env
  }
}

function deploy(caseDir, args, env = {}) {
  return spawnSync(process.execPath, [deployScript, ...args], { encoding: 'utf8', env: deployEnv(caseDir, env) })
}

// Async variant for tests that need the parent event loop alive (local HTTP server).
function deployAsync(caseDir, args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [deployScript, ...args], { env: deployEnv(caseDir, env) })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('close', status => resolve({ status, stderr, stdout }))
  })
}

function installArgs(caseDir, extra = []) {
  return ['install', '--dist', caseDir.dist, '--port', '18899', '--upstream', 'http://127.0.0.1:9119', '--skip-service', ...extra]
}

function serviceInstallArgs(caseDir, extra = []) {
  return ['install', '--dist', caseDir.dist, '--port', '18899', '--upstream', 'http://127.0.0.1:9119', ...extra]
}

function fakeServiceEnv(extra = {}) {
  return {
    HERMES_CLAWSTYLE_LAUNCHCTL: 'launchctl',
    HERMES_CLAWSTYLE_RELOAD_RETRY_DELAY_MS: '5',
    ...extra
  }
}

function plistFile(caseDir) {
  return path.join(caseDir.agents, 'local.hermes.clawstyle-ui.plist')
}

function bootstrapCalls(caseDir) {
  const file = path.join(caseDir.bin, 'bootstrap-count')
  return fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0
}

function versions(caseDir) {
  return fs.readdirSync(path.join(caseDir.appRoot, 'versions')).sort()
}

function state(caseDir) {
  return JSON.parse(fs.readFileSync(path.join(caseDir.appRoot, 'state.json'), 'utf8'))
}

after(() => {
  fs.rmSync(tempRoot, { force: true, recursive: true })
})

test('install creates a frozen version, atomic current symlink, state and plist', () => {
  const caseDir = makeCase()
  const result = deploy(caseDir, installArgs(caseDir))
  assert.equal(result.status, 0, result.stderr)
  assert.ok(fs.existsSync(path.join(caseDir.appRoot, 'owner.json')))
  const installed = versions(caseDir)
  assert.equal(installed.length, 1)
  const versionDir = path.join(caseDir.appRoot, 'versions', installed[0])
  const receipt = JSON.parse(fs.readFileSync(path.join(versionDir, 'receipt.json'), 'utf8'))
  assert.equal(receipt.owner, 'hermes-clawstyle-ui')
  assert.equal(receipt.port, 18899)
  assert.equal(receipt.backend, 'http://127.0.0.1:9119')
  assert.ok(receipt.files['dist/index.html'])
  assert.ok(receipt.files['dist/hermes-build.json'])
  assert.ok(receipt.files['server.mjs'])
  assert.ok(fs.existsSync(path.join(versionDir, 'dist', 'index.html')))
  assert.ok(fs.existsSync(path.join(versionDir, 'server.mjs')))
  assert.equal(fs.statSync(path.join(versionDir, 'dist', 'index.html')).mode & 0o222, 0)
  assert.equal(fs.readlinkSync(path.join(caseDir.appRoot, 'current')), path.join('versions', installed[0]))
  assert.equal(state(caseDir).current, installed[0])
  assert.equal(state(caseDir).previous, null)
  const plist = fs.readFileSync(path.join(caseDir.agents, 'local.hermes.clawstyle-ui.plist'), 'utf8')
  assert.match(plist, /<string>local\.hermes\.clawstyle-ui<\/string>/)
  assert.match(plist, /current\/server\.mjs/)
  assert.match(plist, /<string>18899<\/string>/)
  assert.doesNotMatch(plist, /HERMES_CLAWSTYLE_ALLOWED_HOSTS/)
  assert.match(plist, new RegExp(`<string>${caseDir.appRoot}/current/dist</string>`))
})

test('check reports a healthy installation as JSON', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const result = deploy(caseDir, ['check', '--skip-service', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ok, true)
  assert.ok(parsed.results.every(entry => entry.ok))
})

test('second install keeps the previous version for rollback', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const first = versions(caseDir)[0]
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const installed = versions(caseDir)
  assert.equal(installed.length, 2)
  const current = state(caseDir).current
  assert.equal(state(caseDir).previous, first)
  const rollback = deploy(caseDir, ['rollback', '--skip-service'])
  assert.equal(rollback.status, 0, rollback.stderr)
  assert.equal(state(caseDir).current, first)
  assert.equal(state(caseDir).previous, current)
  assert.equal(fs.readlinkSync(path.join(caseDir.appRoot, 'current')), path.join('versions', first))
})

test('refuses a non-owned app root', () => {
  const caseDir = makeCase()
  fs.mkdirSync(caseDir.appRoot, { recursive: true })
  const result = deploy(caseDir, installArgs(caseDir))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /non-owned/)
})

test('refuses a dist without a build receipt', () => {
  const caseDir = makeCase()
  fs.rmSync(path.join(caseDir.dist, 'hermes-build.json'))
  const result = deploy(caseDir, installArgs(caseDir))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /hermes-build\.json/)
})

test('refuses an upstream that equals the frontend listen port', () => {
  const caseDir = makeCase()
  const result = deploy(caseDir, ['install', '--dist', caseDir.dist, '--port', '9119', '--skip-service'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /upstream .*uses the frontend listen port/)
})

test('allows a frontend on the backend default port when the upstream differs', () => {
  const caseDir = makeCase()
  const result = deploy(caseDir, [
    'install', '--dist', caseDir.dist, '--port', '9119', '--upstream', 'http://127.0.0.1:19119', '--skip-service'
  ])
  assert.equal(result.status, 0, result.stderr)
  const receipt = JSON.parse(
    fs.readFileSync(path.join(caseDir.appRoot, 'versions', versions(caseDir)[0], 'receipt.json'), 'utf8')
  )
  assert.equal(receipt.port, 9119)
  assert.equal(receipt.backend, 'http://127.0.0.1:19119')
})

test('refuses a non-owned LaunchAgent plist', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  fs.writeFileSync(path.join(caseDir.agents, 'local.hermes.clawstyle-ui.plist'), '<plist>someone else</plist>\n')
  const result = deploy(caseDir, installArgs(caseDir))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /non-owned LaunchAgent/)
})

test('rollback without a state file fails', () => {
  const caseDir = makeCase()
  const result = deploy(caseDir, ['rollback', '--skip-service'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /no owned/)
})

test('check fails after snapshot tampering and rollback refuses it', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const first = versions(caseDir)[0]
  const target = path.join(caseDir.appRoot, 'versions', first, 'dist', 'index.html')
  fs.chmodSync(target, 0o644)
  fs.appendFileSync(target, '<!-- tampered -->\n')
  const check = deploy(caseDir, ['check', '--skip-service', '--json'])
  assert.notEqual(check.status, 0)
  const parsed = JSON.parse(check.stdout)
  assert.equal(parsed.ok, false)
  assert.ok(parsed.results.some(entry => !entry.ok && /checksum mismatch/.test(entry.detail)))
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const rollback = deploy(caseDir, ['rollback', '--skip-service'])
  assert.notEqual(rollback.status, 0)
  assert.match(rollback.stderr, /broken snapshot/)
})

test('rollback --to an explicit healthy version succeeds', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const first = versions(caseDir)[0]
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const rollback = deploy(caseDir, ['rollback', '--to', first, '--skip-service'])
  assert.equal(rollback.status, 0, rollback.stderr)
  assert.equal(state(caseDir).current, first)
})

test('rollback restores the target version port and backend configuration', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const original = state(caseDir)
  assert.equal(deploy(caseDir, installArgs(caseDir, ['--port', '18900', '--upstream', 'http://127.0.0.1:19119'])).status, 0)
  assert.equal(deploy(caseDir, ['rollback', '--skip-service']).status, 0)
  assert.equal(state(caseDir).current, original.current)
  assert.equal(state(caseDir).port, original.port)
  assert.equal(state(caseDir).backend, original.backend)
  const plist = fs.readFileSync(plistFile(caseDir), 'utf8')
  assert.match(plist, /18899/)
  assert.doesNotMatch(plist, /18900|19119/)
})

test('install records allowed hosts in receipt, state and plist and rollback restores them', () => {
  const caseDir = makeCase()
  const hosts = 'hermes.example.ts.net,hermes-host'
  assert.equal(deploy(caseDir, installArgs(caseDir, ['--allowed-hosts', hosts])).status, 0)
  const first = versions(caseDir)[0]
  const receipt = JSON.parse(fs.readFileSync(path.join(caseDir.appRoot, 'versions', first, 'receipt.json'), 'utf8'))
  assert.equal(receipt.allowedHosts, hosts)
  assert.equal(state(caseDir).allowedHosts, hosts)
  let plist = fs.readFileSync(plistFile(caseDir), 'utf8')
  assert.match(plist, /<key>HERMES_CLAWSTYLE_ALLOWED_HOSTS<\/key>/)
  assert.match(plist, /<string>hermes.example.ts.net,hermes-host<\/string>/)

  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  plist = fs.readFileSync(plistFile(caseDir), 'utf8')
  assert.doesNotMatch(plist, /HERMES_CLAWSTYLE_ALLOWED_HOSTS/)

  assert.equal(deploy(caseDir, ['rollback', '--skip-service']).status, 0)
  plist = fs.readFileSync(plistFile(caseDir), 'utf8')
  assert.match(plist, /<key>HERMES_CLAWSTYLE_ALLOWED_HOSTS<\/key>/)
  assert.equal(state(caseDir).allowedHosts, hosts)
})

test('refuses malformed --allowed-hosts entries', () => {
  const caseDir = makeCase()
  const result = deploy(caseDir, installArgs(caseDir, ['--allowed-hosts', 'https://evil.example']))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /allowed host/)
})

test('install retries a transient launchd bootstrap failure and succeeds', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const first = versions(caseDir)[0]
  const result = deploy(caseDir, serviceInstallArgs(caseDir), fakeServiceEnv({ FAKE_LAUNCHCTL_FAIL_BOOTSTRAPS: '1' }))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(bootstrapCalls(caseDir), 2)
  assert.match(result.stdout, /retrying in 5ms/)
  assert.match(result.stdout, /reloaded after 2 attempts/)
  const current = state(caseDir).current
  assert.notEqual(current, first)
  assert.equal(state(caseDir).previous, first)
  assert.equal(fs.readlinkSync(path.join(caseDir.appRoot, 'current')), path.join('versions', current))
})

test('persistent launchd bootstrap failure restores the previous deployment', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const previous = state(caseDir)
  const previousPlist = fs.readFileSync(plistFile(caseDir))
  const result = deploy(caseDir, serviceInstallArgs(caseDir), fakeServiceEnv({ FAKE_LAUNCHCTL_FAIL_BOOTSTRAPS: '99' }))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /launchctl bootstrap failed after 6 attempt\(s\)/)
  assert.match(result.stderr, /Bootstrap failed: 5: Input\/output error/)
  assert.match(result.stderr, /inspect: launchctl print gui\/\d+\/local\.hermes\.clawstyle-ui/)
  assert.deepEqual(state(caseDir), previous)
  assert.equal(fs.readlinkSync(path.join(caseDir.appRoot, 'current')), path.join('versions', previous.current))
  assert.deepEqual(fs.readFileSync(plistFile(caseDir)), previousPlist)
})

test('a permanent launchd bootstrap error is not retried', () => {
  const caseDir = makeCase()
  const result = deploy(caseDir, serviceInstallArgs(caseDir), fakeServiceEnv({ FAKE_LAUNCHCTL_FATAL: '1' }))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /launchctl bootstrap failed after 1 attempt\(s\)/)
  assert.match(result.stderr, /Bootstrap failed: 2: No such file or directory/)
  assert.equal(bootstrapCalls(caseDir), 1)
})

test('check waits for the service HTTP endpoint to become ready', async () => {
  const caseDir = makeCase()
  let ready = false
  const server = http.createServer((request, response) => {
    if (ready) {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    } else {
      response.writeHead(503, { 'content-type': 'text/plain' })
      response.end('starting')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const install = deploy(caseDir, [
      'install', '--dist', caseDir.dist, '--port', String(port), '--upstream', 'http://127.0.0.1:9119', '--skip-service'
    ])
    assert.equal(install.status, 0, install.stderr)
    setTimeout(() => {
      ready = true
    }, 250)
    const result = await deployAsync(caseDir, ['check', '--json'], fakeServiceEnv({ HERMES_CLAWSTYLE_HTTP_READY_TIMEOUT_MS: '5000' }))
    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    const probe = parsed.results.find(entry => entry.name === 'http probe')
    assert.equal(probe.ok, true)
    assert.match(probe.detail, /HTTP 200/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('check fails with a bounded wait when HTTP never becomes ready', () => {
  const caseDir = makeCase()
  assert.equal(deploy(caseDir, installArgs(caseDir)).status, 0)
  const started = Date.now()
  const result = deploy(caseDir, ['check', '--json'], fakeServiceEnv({ HERMES_CLAWSTYLE_HTTP_READY_TIMEOUT_MS: '250' }))
  assert.equal(result.status, 1)
  assert.ok(Date.now() - started < 5000, 'check must not wait past its bounded HTTP timeout')
  const probe = JSON.parse(result.stdout).results.find(entry => entry.name === 'http probe')
  assert.equal(probe.ok, false)
  assert.match(probe.detail, /http:\/\/127\.0\.0\.1:18899\/ not ready within 250ms/)
})
