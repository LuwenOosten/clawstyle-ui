#!/usr/bin/env node
/**
 * ClawStyle UI — local deployment helper (macOS user LaunchAgent).
 *
 * Snapshots the built dist plus the standalone server into an immutable,
 * versioned directory under the user's Application Support folder, flips an
 * atomic `current` symlink and (re)loads the per-user LaunchAgent
 * `local.hermes.clawstyle-ui`.
 *
 * Commands:
 *   install  --dist <dir> [--port <n>] [--upstream <url>] [--allowed-hosts <host,host:port>] [--skip-service]
 *   check    [--skip-service] [--json]
 *   rollback [--to <version>] [--skip-service]
 *
 * Overrides for testing:
 *   HERMES_CLAWSTYLE_APP_ROOT, HERMES_CLAWSTYLE_LAUNCH_AGENTS_DIR
 *   HERMES_CLAWSTYLE_LAUNCHCTL             launchctl binary; also enables the launchd
 *                                     path on non-macOS so tests can fake it
 *   HERMES_CLAWSTYLE_RELOAD_RETRY_DELAY_MS base backoff between bootstrap retries
 *   HERMES_CLAWSTYLE_HTTP_READY_TIMEOUT_MS bounded wait for the HTTP probe in `check`
 *
 * This script never touches the existing Hermes backend or any launchd
 * service other than its own label.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const label = 'local.hermes.clawstyle-ui'
const owner = 'hermes-clawstyle-ui'
const receiptName = 'receipt.json'
const stateName = 'state.json'
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const reloadMaxAttempts = 6
const reloadRetryBaseDelayMs = 250
const httpReadyTimeoutMs = 10_000
const httpReadyPollIntervalMs = 500

function appRootPath() {
  return path.resolve(
    process.env.HERMES_CLAWSTYLE_APP_ROOT || path.join(os.homedir(), 'Library', 'Application Support', 'HermesClawStyleUI')
  )
}

function launchAgentsPath() {
  return path.resolve(process.env.HERMES_CLAWSTYLE_LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents'))
}

function plistPath() {
  return path.join(launchAgentsPath(), `${label}.plist`)
}

function log(...parts) {
  console.log('[clawstyle-ui-deploy]', ...parts)
}

function fail(message) {
  throw new Error(message)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporary, file)
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function listRelativeFiles(dir, prefix = '') {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...listRelativeFiles(absolute, relative))
    } else if (entry.isFile()) {
      result.push(relative)
    } else {
      fail(`unsupported file type in snapshot: ${absolute}`)
    }
  }
  return result
}

function checksumTree(dir, { exclude = new Set([receiptName]) } = {}) {
  const files = {}
  for (const relative of listRelativeFiles(dir)) {
    if (!exclude.has(relative)) {
      files[relative] = sha256(path.join(dir, relative))
    }
  }
  return files
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, { dereference: true, recursive: true })
}

function freezeTree(dir) {
  // Snapshot contents are read-only; directories stay writable so the version
  // store can be cleaned up and snapshots can be removed by their owner.
  for (const relative of listRelativeFiles(dir)) {
    fs.chmodSync(path.join(dir, relative), 0o444)
  }
  const directories = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(path.join(current, entry.name))
      }
    }
    directories.push(current)
  }
  visit(dir)
  for (const directory of directories) {
    fs.chmodSync(directory, 0o755)
  }
}

function loopbackHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function readPort(raw) {
  const value = String(raw ?? '').trim()
  const port = Number.parseInt(value, 10)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`port must be an integer between 1 and 65535, got "${value}"`)
  }
  return port
}

/** Effective port of a loopback upstream URL, including protocol defaults. */
function upstreamPort(url) {
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80))
}

function readUpstream(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    fail(`upstream must be a valid URL, got "${raw}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`upstream must use http or https, got "${url.protocol}"`)
  }
  if (!loopbackHosts.has(loopbackHostname(url.hostname))) {
    fail(`upstream must point at loopback (127.0.0.1, localhost or ::1), got "${url.host}"`)
  }
  return url.href.replace(/\/$/, '')
}

// Trusted non-loopback Host/Origin entries for the server, typically the
// tailnet names served by `tailscale serve`. Stored verbatim (deduplicated).
function readAllowedHosts(raw) {
  const entries = String(raw ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  for (const entry of entries) {
    if (!/^[A-Za-z0-9.:[\]-]+$/.test(entry)) {
      fail(`allowed host entries must be host or host:port, got "${entry}"`)
    }
  }
  return [...new Set(entries)].join(',')
}

function assertBuiltDist(dist) {
  if (!fs.statSync(dist, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`built dist not found: ${dist} (run "npm run build" first)`)
  }
  if (!fs.statSync(path.join(dist, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
    fail(`built dist is missing index.html: ${dist}`)
  }
  const receipt = path.join(dist, 'hermes-build.json')
  if (!fs.statSync(receipt, { throwIfNoEntry: false })?.isFile()) {
    fail(`built dist is missing the build receipt hermes-build.json: ${dist}`)
  }
  return readJson(receipt)
}

function isOwnedAppRoot(root) {
  const marker = path.join(root, 'owner.json')
  if (!fs.statSync(marker, { throwIfNoEntry: false })?.isFile()) {
    return false
  }
  try {
    return readJson(marker).owner === owner
  } catch {
    return false
  }
}

function ensureOwnedAppRoot() {
  const root = appRootPath()
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    writeJsonAtomic(path.join(root, 'owner.json'), { schema: 1, owner, createdAt: new Date().toISOString() })
    return root
  }
  if (!fs.statSync(root).isDirectory() || !isOwnedAppRoot(root)) {
    fail(`refusing to manage non-owned directory: ${root} (missing owner.json owned by ${owner})`)
  }
  return root
}

function assertOwnedAppRoot() {
  const root = appRootPath()
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || !isOwnedAppRoot(root)) {
    fail(`no owned ClawStyle UI installation at ${root}`)
  }
  return root
}

function assertOwnedPlist() {
  const file = plistPath()
  if (!fs.existsSync(file)) {
    return
  }
  const body = fs.readFileSync(file, 'utf8')
  if (!body.includes(`<string>${label}</string>`) || !body.includes(appRootPath())) {
    fail(`refusing to overwrite non-owned LaunchAgent plist: ${file}`)
  }
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderPlist({ allowedHosts = '', node, port, root, upstream }) {
  const values = [label, node, `${root}/current/server.mjs`, `${root}/current`, 'HERMES_CLAWSTYLE_DIST', `${root}/current/dist`,
    'HERMES_DASHBOARD_URL', upstream, 'PORT', String(port), `${root}/logs/stdout.log`, `${root}/logs/stderr.log`]
  const [plabel, pnode, pscript, pworkdir, distKey, distValue, upstreamKey, upstreamValue, portKey, portValue, outLog, errLog] =
    values.map(escapeXml)
  const allowedHostsEntry = allowedHosts
    ? `\n    <key>HERMES_CLAWSTYLE_ALLOWED_HOSTS</key>\n    <string>${escapeXml(allowedHosts)}</string>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- managed by ${owner}; do not edit by hand -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${pnode}</string>
    <string>${pscript}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${pworkdir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>${distKey}</key>
    <string>${distValue}</string>
    <key>${upstreamKey}</key>
    <string>${upstreamValue}</string>
    <key>${portKey}</key>
    <string>${portValue}</string>${allowedHostsEntry}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${outLog}</string>
  <key>StandardErrorPath</key>
  <string>${errLog}</string>
</dict>
</plist>
`
}

function writePlist(config) {
  assertOwnedPlist()
  const root = appRootPath()
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  fs.mkdirSync(launchAgentsPath(), { recursive: true })
  const file = plistPath()
  const temporary = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temporary, renderPlist({ ...config, root }))
  fs.renameSync(temporary, file)
}

function readState() {
  const file = path.join(appRootPath(), stateName)
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    return null
  }
  return readJson(file)
}

function switchCurrent(version) {
  const root = appRootPath()
  const versionDir = path.join(root, 'versions', version)
  if (!fs.statSync(versionDir, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`version not installed: ${version}`)
  }
  const current = path.join(root, 'current')
  const temporary = path.join(root, `.current-${process.pid}-${Date.now()}`)
  fs.rmSync(temporary, { force: true })
  fs.symlinkSync(path.join('versions', version), temporary, 'dir')
  fs.renameSync(temporary, current)
}

function resolveCurrentVersion() {
  const root = appRootPath()
  const current = path.join(root, 'current')
  const stat = fs.lstatSync(current, { throwIfNoEntry: false })
  if (!stat) {
    return null
  }
  if (!stat.isSymbolicLink()) {
    fail(`current is not a symlink: ${current}`)
  }
  const target = fs.readlinkSync(current)
  const resolved = path.resolve(root, target)
  const versions = path.join(root, 'versions')
  if (resolved !== versions && !resolved.startsWith(versions + path.sep)) {
    fail(`current points outside the version store: ${target}`)
  }
  return path.basename(resolved)
}

function verifyVersion(version) {
  const root = appRootPath()
  const versionDir = path.join(root, 'versions', version)
  const problems = []
  if (!fs.statSync(versionDir, { throwIfNoEntry: false })?.isDirectory()) {
    return [`version directory missing: ${versionDir}`]
  }
  const receiptFile = path.join(versionDir, receiptName)
  if (!fs.statSync(receiptFile, { throwIfNoEntry: false })?.isFile()) {
    return [`receipt missing: ${receiptFile}`]
  }
  let receipt
  try {
    receipt = readJson(receiptFile)
  } catch (error) {
    return [`receipt is not valid JSON: ${error.message}`]
  }
  if (receipt.owner !== owner || receipt.version !== version) {
    problems.push(`receipt identity mismatch in ${receiptFile}`)
  }
  for (const [relative, digest] of Object.entries(receipt.files || {})) {
    const file = path.join(versionDir, relative)
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      problems.push(`snapshot file missing: ${relative}`)
    } else if (sha256(file) !== digest) {
      problems.push(`checksum mismatch: ${relative}`)
    }
  }
  for (const required of ['dist/index.html', 'server.mjs']) {
    if (!fs.statSync(path.join(versionDir, required), { throwIfNoEntry: false })?.isFile()) {
      problems.push(`snapshot is missing ${required}`)
    }
  }
  return problems
}

function readNonNegativeEnvMs(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    fail(`${name} must be a non-negative number of milliseconds, got "${raw}"`)
  }
  return Math.floor(value)
}

function launchctlExecutable() {
  return process.env.HERMES_CLAWSTYLE_LAUNCHCTL?.trim() || 'launchctl'
}

// Setting HERMES_CLAWSTYLE_LAUNCHCTL also enables the launchd code path on
// non-macOS so tests can substitute a fake launchctl without touching launchd.
function serviceManagementEnabled() {
  return process.platform === 'darwin' || Boolean(process.env.HERMES_CLAWSTYLE_LAUNCHCTL?.trim())
}

function launchctl(args) {
  return execFileSync(launchctlExecutable(), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function launchctlFailureDetail(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
  return (stderr || stdout || error?.message || 'unknown launchctl error').replace(/\s+/g, ' ').slice(0, 400)
}

// bootout returns while launchd may still be tearing the old job down, so a
// bootstrap right after can fail with EIO (5, "Input/output error") or EEXIST
// (17, "File exists"). Those are the only failures worth retrying; everything
// else (missing plist, permissions, unsupported domain) fails immediately.
function isTransientBootstrapFailure(error) {
  const detail = launchctlFailureDetail(error)
  return /bootstrap failed: (?:5|17)\b/i.test(detail) || /input\/output error/i.test(detail) || /file exists/i.test(detail)
}

function sleepSync(ms) {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  }
}

function serviceDomain() {
  return `gui/${process.getuid()}`
}

function reloadService() {
  if (!serviceManagementEnabled()) {
    log('launchctl is only available on macOS; skipping service reload')
    return
  }
  const domain = serviceDomain()
  const plist = plistPath()
  const retryBaseDelayMs = readNonNegativeEnvMs('HERMES_CLAWSTYLE_RELOAD_RETRY_DELAY_MS', reloadRetryBaseDelayMs)
  let attempts = 0
  let lastError = null
  for (attempts = 1; attempts <= reloadMaxAttempts; attempts += 1) {
    try {
      launchctl(['bootout', `${domain}/${label}`])
    } catch {
      // The service may not be loaded yet; bootstrap below is the source of truth.
    }
    try {
      launchctl(['bootstrap', domain, plist])
      log(attempts === 1 ? `launchd service ${label} reloaded` : `launchd service ${label} reloaded after ${attempts} attempts`)
      return
    } catch (error) {
      lastError = error
      if (!isTransientBootstrapFailure(error) || attempts === reloadMaxAttempts) {
        break
      }
      const delay = retryBaseDelayMs * attempts
      log(`launchd bootstrap attempt ${attempts}/${reloadMaxAttempts} failed (${launchctlFailureDetail(error)}); retrying in ${delay}ms`)
      sleepSync(delay)
    }
  }
  const executable = launchctlExecutable()
  throw new Error(
    `launchctl bootstrap failed after ${attempts} attempt(s): ${launchctlFailureDetail(lastError)}\n` +
      `  inspect: ${executable} print ${domain}/${label}\n` +
      `  retry:   ${executable} bootout ${domain}/${label}; ${executable} bootstrap ${domain} ${plist}`
  )
}

function serviceStatus() {
  if (!serviceManagementEnabled()) {
    return 'not applicable (non-macOS)'
  }
  try {
    launchctl(['print', `${serviceDomain()}/${label}`])
    return 'loaded'
  } catch {
    return 'not loaded'
  }
}

function commandInstall(options) {
  const dist = path.resolve(options.dist || path.join(repoRoot, 'dist'))
  const port = readPort(options.port ?? process.env.PORT ?? 9130)
  const upstream = readUpstream(options.upstream || process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119')
  if (upstreamPort(new URL(upstream)) === port) {
    fail(`upstream ${upstream} uses the frontend listen port ${port}; point it at the Hermes backend instead`)
  }
  const allowedHosts = readAllowedHosts(options.allowedHosts ?? process.env.HERMES_CLAWSTYLE_ALLOWED_HOSTS)
  const buildReceipt = assertBuiltDist(dist)
  const root = ensureOwnedAppRoot()
  assertOwnedPlist()
  const sourceHash = String(buildReceipt?.inputs?.sourceHash || '').slice(0, 12) || 'nosource'
  const version = `${new Date().toISOString().replace(/[-:]/g, '').replace('.', '')}-${sourceHash}`
  const versionsDir = path.join(root, 'versions')
  fs.mkdirSync(versionsDir, { recursive: true })
  const versionDir = path.join(versionsDir, version)
  if (fs.existsSync(versionDir)) {
    fail(`version already exists: ${versionDir}`)
  }
  const staging = path.join(root, `.staging-${version}-${process.pid}`)
  fs.rmSync(staging, { force: true, recursive: true })
  fs.mkdirSync(staging, { recursive: true })
  try {
    copyTree(dist, path.join(staging, 'dist'))
    fs.copyFileSync(path.join(here, 'server.mjs'), path.join(staging, 'server.mjs'))
    writeJsonAtomic(path.join(staging, receiptName), {
      schema: 1,
      owner,
      version,
      label,
      createdAt: new Date().toISOString(),
      sourceHash: buildReceipt?.inputs?.sourceHash ?? null,
      distOutputHash: buildReceipt?.outputHash ?? null,
      backend: upstream,
      port,
      allowedHosts: allowedHosts || null,
      listenHost: '127.0.0.1',
      node: process.execPath,
      files: checksumTree(staging)
    })
    freezeTree(staging)
    fs.renameSync(staging, versionDir)
  } catch (error) {
    fs.rmSync(staging, { force: true, recursive: true })
    throw error
  }
  const previousState = readState()
  const previous = previousState?.current ?? resolveCurrentVersion()
  const previousPlist = fs.existsSync(plistPath()) ? fs.readFileSync(plistPath()) : null
  try {
  switchCurrent(version)
  writeJsonAtomic(path.join(root, stateName), {
    schema: 1,
    owner,
    current: version,
    previous: previous && previous !== version ? previous : null,
    backend: upstream,
    port,
    allowedHosts: allowedHosts || null,
    updatedAt: new Date().toISOString()
  })
  writePlist({ allowedHosts, node: process.execPath, port, upstream })
  if (!options.skipService) {
    reloadService()
  }
  } catch (error) {
    if (previous) switchCurrent(previous)
    else fs.rmSync(path.join(root, 'current'), { force: true })
    if (previousState) writeJsonAtomic(path.join(root, stateName), previousState)
    else fs.rmSync(path.join(root, stateName), { force: true })
    if (previousPlist) fs.writeFileSync(plistPath(), previousPlist)
    else fs.rmSync(plistPath(), { force: true })
    if (previous && !options.skipService) {
      try { reloadService() } catch (restoreError) { log(`previous service restore failed: ${restoreError.message}`) }
    }
    throw error
  }
  log(`installed ${version}`)
  log(`current -> versions/${version}`)
  log(`dist: ${path.join(versionDir, 'dist')}`)
  log(`plist: ${plistPath()}`)
  if (options.skipService) {
    log('service reload skipped (--skip-service)')
  }
  if (previous) {
    log(`previous version kept for rollback: ${previous}`)
  }
  return 0
}

async function commandCheck(options) {
  const root = appRootPath()
  const results = []
  const check = (name, ok, detail = '') => results.push({ name, ok, detail })

  check('app root owned', fs.existsSync(root) && isOwnedAppRoot(root), root)
  let state = null
  try {
    state = readState()
  } catch (error) {
    check('state.json readable', false, error.message)
  }
  check('state.json present', Boolean(state), state ? `current=${state.current}` : 'missing')
  let current = null
  let currentError = ''
  try {
    current = resolveCurrentVersion()
  } catch (error) {
    currentError = error.message
  }
  check('current symlink valid', Boolean(current) && !currentError, currentError || current || 'missing')
  if (current) {
    const problems = verifyVersion(current)
    check('current snapshot checksums', problems.length === 0, problems.join('; ') || current)
  }
  const plist = plistPath()
  const plistBody = fs.existsSync(plist) ? fs.readFileSync(plist, 'utf8') : ''
  check('LaunchAgent plist owned', Boolean(plistBody) && plistBody.includes(`<string>${label}</string>`), plist)
  const port = state?.port ?? 9130
  let upstreamPortValue = null
  if (state?.backend) {
    try {
      upstreamPortValue = upstreamPort(new URL(state.backend))
    } catch {
      upstreamPortValue = null
    }
  }
  const selfProxy = upstreamPortValue !== null && upstreamPortValue === port
  check(
    'upstream is not the frontend port',
    !selfProxy,
    selfProxy ? `upstream ${state.backend} equals listen port ${port}` : `${state?.backend ?? 'unknown'} -> ${port}`
  )
  const status = options.skipService ? 'skipped (--skip-service)' : serviceStatus()
  check('launchd service query', Boolean(options.skipService) || status === 'loaded' || process.platform !== 'darwin', status)
  const probe = options.skipService ? { ok: true, detail: 'skipped (--skip-service)' } : await probeHttp(port)
  results.push({ name: 'http probe', ...probe })

  if (options.json) {
    console.log(JSON.stringify({ ok: results.every(result => result.ok), results }, null, 2))
  } else {
    for (const result of results) {
      log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
    }
  }
  return results.every(result => result.ok) ? 0 : 1
}

async function probeHttp(port) {
  if (port === 0) {
    return { ok: false, detail: 'no fixed port to probe' }
  }
  const url = `http://127.0.0.1:${port}/`
  const readyTimeoutMs = readNonNegativeEnvMs('HERMES_CLAWSTYLE_HTTP_READY_TIMEOUT_MS', httpReadyTimeoutMs)
  const deadline = Date.now() + readyTimeoutMs
  let lastFailure = 'no response yet'
  for (;;) {
    try {
      const budget = Math.max(1, Math.min(2000, deadline - Date.now() + 1))
      const response = await fetch(url, { signal: AbortSignal.timeout(budget) })
      if (response.ok) {
        return { ok: true, detail: `${url} -> HTTP ${response.status}` }
      }
      lastFailure = `HTTP ${response.status}`
    } catch (error) {
      lastFailure = error.message
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      break
    }
    await sleep(Math.min(httpReadyPollIntervalMs, remaining))
  }
  return { ok: false, detail: `${url} not ready within ${readyTimeoutMs}ms (last: ${lastFailure})` }
}

function commandRollback(options) {
  const root = assertOwnedAppRoot()
  const state = readState()
  if (!state?.current) {
    fail('no deployment state found; nothing to roll back')
  }
  const target = options.to || state.previous
  if (!target) {
    fail('no previous version recorded; pass --to <version> explicitly')
  }
  const problems = verifyVersion(target)
  if (problems.length > 0) {
    fail(`refusing to roll back to a broken snapshot: ${problems.join('; ')}`)
  }
  assertOwnedPlist()
  const targetReceipt = readJson(path.join(root, 'versions', target, receiptName))
  switchCurrent(target)
  writePlist({
    allowedHosts: targetReceipt.allowedHosts ?? '',
    node: targetReceipt.node,
    port: targetReceipt.port,
    upstream: targetReceipt.backend
  })
  writeJsonAtomic(path.join(root, stateName), {
    ...state,
    current: target,
    previous: state.current,
    backend: targetReceipt.backend,
    port: targetReceipt.port,
    allowedHosts: targetReceipt.allowedHosts ?? null,
    updatedAt: new Date().toISOString()
  })
  if (!options.skipService) {
    reloadService()
  }
  log(`rolled back to ${target}`)
  log(`previous kept: ${state.current}`)
  return 0
}

function parseOptions(args) {
  const options = { _: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--skip-service' || arg === '--json') {
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) {
        fail(`missing value for ${arg}`)
      }
      options[key] = value
      index += 1
    } else {
      options._.push(arg)
    }
  }
  return options
}

function usage() {
  console.log(`Usage:
  node ops/deploy.mjs install  [--dist <dir>] [--port <n>] [--upstream <url>] [--allowed-hosts <host,host:port>] [--skip-service]
  node ops/deploy.mjs check    [--skip-service] [--json]
  node ops/deploy.mjs rollback [--to <version>] [--skip-service]

Snapshots go to ${appRootPath()}
LaunchAgent goes to ${plistPath()}`)
}

const command = process.argv[2]
const options = parseOptions(process.argv.slice(3))
try {
  let exitCode = 0
  if (command === 'install') {
    exitCode = commandInstall(options)
  } else if (command === 'check') {
    exitCode = await commandCheck(options)
  } else if (command === 'rollback') {
    exitCode = commandRollback(options)
  } else {
    usage()
    exitCode = command ? 1 : 0
  }
  process.exitCode = exitCode
} catch (error) {
  console.error(`[clawstyle-ui-deploy] error: ${error.message}`)
  process.exitCode = 1
}
