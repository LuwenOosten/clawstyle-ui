#!/usr/bin/env node
/**
 * ClawStyle UI — standalone production frontend server.
 *
 * Serves the built dashboard (`dist/`) on loopback, proxies `/api` and
 * `/dashboard-plugins` (HTTP streaming and WebSocket) to the existing Hermes
 * backend, and injects the backend's per-process bootstrap scripts
 * (`window.__HERMES_*`, including the session token) into the served
 * `index.html`. The token is never logged.
 *
 * Environment:
 *   HERMES_CLAWSTYLE_DIST   built dist directory (default: ../dist next to this file)
 *   HERMES_DASHBOARD_URL    backend origin, loopback only (default: http://127.0.0.1:9119)
 *   PORT                    listen port (default: 9130; must differ from the backend port)
 *   HERMES_CLAWSTYLE_HOST   listen address, loopback only (default: 127.0.0.1)
 *   HERMES_CLAWSTYLE_ALLOWED_HOSTS  comma-separated host or host:port entries that are
 *                          additionally accepted in Host/Origin (default: none);
 *                          bare hostnames get PORT appended. Use for trusted local
 *                          front-ends such as `tailscale serve`.
 *
 * Diagnostics: `GET /healthz` reports this server's config plus a live probe of
 * the backend. It is a local operational endpoint, not part of the Hermes API.
 */
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// Deployment snapshots place `dist/` next to this file; a repo checkout keeps it
// at the package root instead.
const defaultDist = fs.existsSync(path.join(here, 'dist')) ? path.join(here, 'dist') : path.resolve(here, '..', 'dist')
const distDir = path.resolve(process.env.HERMES_CLAWSTYLE_DIST || defaultDist)
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const proxyPrefixes = ['/api', '/dashboard-plugins', '/docs', '/redoc', '/openapi.json']
const bootstrapScriptPattern = /<script\b[^>]*>[\s\S]*?<\/script>/gi
const bootstrapBodyLimit = 4 * 1024 * 1024
const connectTimeoutMs = 10_000
const healthProbeTimeoutMs = 2_000
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function log(...parts) {
  console.log('[clawstyle-ui]', ...parts)
}

function logError(...parts) {
  console.error('[clawstyle-ui]', ...parts)
}

function loopbackHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function readPort(raw) {
  const value = String(raw ?? '').trim()
  const port = Number.parseInt(value, 10)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${value}"`)
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
    throw new Error(`HERMES_DASHBOARD_URL must be a valid URL, got "${raw}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`HERMES_DASHBOARD_URL must use http or https, got "${url.protocol}"`)
  }
  if (!loopbackHosts.has(loopbackHostname(url.hostname))) {
    throw new Error(`HERMES_DASHBOARD_URL must point at loopback (127.0.0.1, localhost or ::1), got "${url.host}"`)
  }
  return url
}

function readListenHost(raw) {
  const host = raw || '127.0.0.1'
  const normalized = loopbackHostname(host)
  if (!loopbackHosts.has(normalized)) {
    throw new Error(`HERMES_CLAWSTYLE_HOST must be loopback, got "${host}"`)
  }
  return host
}

function readAllowedHosts(raw, port) {
  const allowed = new Set()
  for (const entry of String(raw ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
    if (!/^[A-Za-z0-9.:[\]-]+$/.test(entry)) {
      throw new Error(`HERMES_CLAWSTYLE_ALLOWED_HOSTS entries must be host or host:port, got "${entry}"`)
    }
    allowed.add(/:\d+$/.test(entry) ? entry : `${entry}:${port}`)
  }
  return allowed
}

let port
let upstream
let listenHost
let allowedHostsExtra
try {
  port = readPort(process.env.PORT ?? 9130)
  upstream = readUpstream(process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119')
  listenHost = readListenHost(process.env.HERMES_CLAWSTYLE_HOST)
  allowedHostsExtra = readAllowedHosts(process.env.HERMES_CLAWSTYLE_ALLOWED_HOSTS, port)
} catch (error) {
  logError(`invalid configuration: ${error.message}`)
  process.exit(1)
}

// A proxy whose upstream is this same loopback port would forward every API
// request back into itself. That is a configuration mistake, not a supported
// topology, so reject it instead of reserving specific port numbers.
if (upstreamPort(upstream) === port) {
  logError(
    `invalid configuration: HERMES_DASHBOARD_URL (${upstream.origin}) points at this server's own listen port; ` +
      'point it at the Hermes backend instead'
  )
  process.exit(1)
}

const indexTemplatePath = path.join(distDir, 'index.html')
if (!fs.statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
  logError(`dist directory not found: ${distDir}`)
  process.exit(1)
}
let indexTemplate
try {
  indexTemplate = fs.readFileSync(indexTemplatePath, 'utf8')
} catch (error) {
  logError(`failed to read ${indexTemplatePath}: ${error.message}`)
  process.exit(1)
}
const allowedHosts = new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  `[::1]:${port}`,
  ...(port === 80 ? ['127.0.0.1', 'localhost', '[::1]'] : []),
  ...allowedHostsExtra
])

function allowedRequest(req) {
  const host = req.headers.host
  if (!host || !allowedHosts.has(host)) {
    return false
  }
  const origin = req.headers.origin
  if (!origin) {
    return true
  }
  try {
    const parsed = new URL(origin)
    // The allowlist is the trust boundary; https is accepted for entries
    // served through TLS-terminating front-ends such as `tailscale serve`.
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && allowedHosts.has(parsed.host)
  } catch {
    return false
  }
}

function upstreamHeaders(req, { websocket = false } = {}) {
  const headers = { ...req.headers }
  headers.host = upstream.host
  delete headers['accept-encoding']
  for (const key of Object.keys(headers)) {
    if (key.startsWith('x-forwarded-')) {
      delete headers[key]
    }
  }
  if (headers.origin) {
    try {
      headers.origin = allowedHosts.has(new URL(headers.origin).host) ? upstream.origin : undefined
    } catch {
      headers.origin = undefined
    }

    if (headers.origin === undefined) {
      delete headers.origin
    }
  }
  if (headers.referer) {
    try {
      const referer = new URL(headers.referer)
      headers.referer = allowedHosts.has(referer.host) ? upstream.origin + referer.pathname + referer.search : undefined
    } catch {
      headers.referer = undefined
    }

    if (headers.referer === undefined) {
      delete headers.referer
    }
  }
  if (!websocket) {
    delete headers.connection
    delete headers.upgrade
  }
  return headers
}

function isProxyPath(pathname) {
  return proxyPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function resolveStaticPath(pathname) {
  const file = path.resolve(distDir, `.${pathname}`)
  if (file !== distDir && !file.startsWith(distDir + path.sep)) {
    return null
  }
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  return stat?.isFile() ? file : null
}

function sendPlain(res, status, message, method = 'GET') {
  const body = `${message}\n`
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(method === 'HEAD' ? undefined : body)
}

function wantsHtml(req, pathname) {
  const accept = req.headers.accept || ''
  return accept.includes('text/html') || !path.extname(pathname)
}

async function fetchBootstrapScripts(req) {
  const response = await fetch(new URL('/', upstream), {
    headers: { ...upstreamHeaders(req), accept: 'text/html', 'accept-encoding': 'identity' },
    redirect: 'error',
    signal: AbortSignal.timeout(connectTimeoutMs)
  })
  if (!response.ok) {
    throw new Error(`backend returned HTTP ${response.status} for bootstrap HTML`)
  }
  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.byteLength > bootstrapBodyLimit) {
    throw new Error(`bootstrap HTML exceeds ${bootstrapBodyLimit} bytes`)
  }
  const html = raw.toString('utf8')
  const scripts = [...html.matchAll(bootstrapScriptPattern)]
    .map(match => match[0])
    .filter(script => script.includes('window.__HERMES_'))
    .join('')
  if (!html.includes('window.__HERMES_')) {
    throw new Error('backend bootstrap HTML did not contain window.__HERMES_* values')
  }
  return scripts
}

function injectBootstrap(scripts) {
  if (!scripts) {
    return indexTemplate
  }
  if (indexTemplate.includes('</head>')) {
    return indexTemplate.replace('</head>', `${scripts}</head>`)
  }
  return `${scripts}${indexTemplate}`
}

async function sendIndex(req, res) {
  let scripts = ''
  try {
    scripts = await fetchBootstrapScripts(req)
    lastBootstrap = { at: new Date().toISOString(), detail: 'ok', ok: true }
  } catch (error) {
    lastBootstrap = { at: new Date().toISOString(), detail: error.message, ok: false }
    logError(`bootstrap injection failed against backend ${upstream.origin}: ${error.message}`)
    logError(
      `serving the SPA without a backend session token; start the Hermes Agent backend or point HERMES_DASHBOARD_URL at it (current: ${upstream.origin})`
    )
  }
  const body = injectBootstrap(scripts)
  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

/** Result of the last backend bootstrap fetch, surfaced by /healthz. */
let lastBootstrap = { at: null, detail: 'not attempted yet', ok: null }

/** Live, bounded probe of the backend root so /healthz cannot hang. An HTTP
 *  200 alone is not healthy: the root must also serve the dashboard HTML with
 *  the window.__HERMES_* bootstrap, otherwise the upstream is headless or the
 *  wrong server and the SPA cannot authenticate. */
async function probeBackend(req) {
  const url = new URL('/', upstream)
  try {
    const response = await fetch(url, {
      headers: { ...upstreamHeaders(req), accept: 'text/html', 'accept-encoding': 'identity' },
      redirect: 'error',
      signal: AbortSignal.timeout(healthProbeTimeoutMs)
    })
    if (!response.ok) {
      return {
        bootstrap: false,
        detail: `${url.href} -> HTTP ${response.status}`,
        ok: false,
        status: response.status
      }
    }
    const html = Buffer.from(await response.arrayBuffer()).toString('utf8')
    if (!html.includes('window.__HERMES_')) {
      return {
        bootstrap: false,
        detail: `${url.href} -> HTTP ${response.status} without the window.__HERMES_* bootstrap (headless or wrong upstream)`,
        ok: false,
        status: response.status
      }
    }
    return {
      bootstrap: true,
      detail: `${url.href} -> HTTP ${response.status}`,
      ok: true,
      status: response.status
    }
  } catch (error) {
    return {
      bootstrap: false,
      detail: `${url.href} unreachable: ${error.message}`,
      ok: false,
      status: null
    }
  }
}

async function sendHealthz(req, res) {
  const backend = await probeBackend(req)
  const body = `${JSON.stringify(
    {
      backend,
      bootstrap: lastBootstrap,
      dist: distDir,
      ok: backend.ok,
      service: 'clawstyle-ui',
      upstream: upstream.origin
    },
    null,
    2
  )}\n`
  res.writeHead(backend.ok ? 200 : 503, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

function serveStatic(req, res, file) {
  const stat = fs.statSync(file)
  const headers = {
    'Cache-Control': file.startsWith(path.join(distDir, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Length': stat.size,
    'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff'
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()

    return
  }
  const stream = fs.createReadStream(file)
  stream.on('error', error => {
    logError(`failed to read ${path.basename(file)}: ${error.message}`)
    res.destroy()
  })
  stream.pipe(res)
}

function requestModule() {
  return upstream.protocol === 'https:' ? https : http
}

function proxyRequest(req, res, pathname, search, method = req.method) {
  const upstreamRequest = requestModule().request(
    {
      headers: upstreamHeaders(req),
      hostname: upstream.hostname,
      method,
      path: `${pathname}${search}`,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      protocol: upstream.protocol
    },
    upstreamResponse => {
      upstreamRequest.setTimeout(0)
      const headers = { ...upstreamResponse.headers }
      delete headers.connection
      if (typeof headers.location === 'string') {
        headers.location = headers.location.replace(upstream.origin, `http://${req.headers.host}`)
      }
      res.writeHead(upstreamResponse.statusCode || 502, headers)
      upstreamResponse.pipe(res)
      upstreamResponse.on('error', error => {
        logError(`upstream response error for ${method} ${pathname}: ${error.message}`)
        res.destroy()
      })
    }
  )
  upstreamRequest.setTimeout(connectTimeoutMs, () => upstreamRequest.destroy(new Error('backend connection timed out')))
  upstreamRequest.on('error', error => {
    logError(`backend unavailable for ${method} ${pathname}: ${error.message}`)
    if (!res.headersSent) {
      sendPlain(res, 502, 'Hermes backend is unavailable', method)
    } else {
      res.destroy()
    }
  })
  res.on('close', () => upstreamRequest.destroy())
  req.pipe(upstreamRequest)
}

async function handleRequest(req, res) {
  if (!allowedRequest(req)) {
    sendPlain(res, 403, 'Local dashboard origin required', req.method)
    return
  }
  let url
  try {
    url = new URL(req.url, upstream)
  } catch {
    sendPlain(res, 400, 'Malformed request URL', req.method)
    return
  }
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    sendPlain(res, 400, 'Malformed request path', req.method)
    return
  }
  if (pathname.includes('\0')) {
    sendPlain(res, 400, 'Malformed request path', req.method)
    return
  }
  if (pathname === '/healthz') {
    await sendHealthz(req, res)
    return
  }
  if (isProxyPath(pathname)) {
    proxyRequest(req, res, url.pathname, url.search)
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendPlain(res, 405, 'Method not allowed', req.method)
    return
  }
  if (pathname === '/index.html') {
    await sendIndex(req, res)
    return
  }
  const file = resolveStaticPath(pathname)
  if (file) {
    serveStatic(req, res, file)
    return
  }
  if (wantsHtml(req, pathname)) {
    await sendIndex(req, res)
    return
  }
  sendPlain(res, 404, 'Not found', req.method)
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    logError(`request failed for ${req.method} ${req.url?.split('?')[0] || '/'}: ${error.message}`)
    if (!res.headersSent) {
      sendPlain(res, 500, 'Internal server error', req.method)
    } else {
      res.destroy()
    }
  })
})

server.on('clientError', (error, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  }
  if (error.code !== 'ECONNRESET') {
    logError(`client error: ${error.message}`)
  }
})

server.on('upgrade', (req, socket, head) => {
  if (!allowedRequest(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  let url
  try {
    url = new URL(req.url, upstream)
  } catch {
    socket.destroy()
    return
  }
  if (!isProxyPath(url.pathname)) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    return
  }
  const upstreamRequest = requestModule().request({
    headers: upstreamHeaders(req, { websocket: true }),
    hostname: upstream.hostname,
    method: 'GET',
    path: `${url.pathname}${url.search}`,
    port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
    protocol: upstream.protocol
  })
  upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const rawHeaders = []
    for (let index = 0; index < upstreamResponse.rawHeaders.length; index += 2) {
      if (!/^(connection|upgrade)$/i.test(upstreamResponse.rawHeaders[index])) {
        rawHeaders.push(`${upstreamResponse.rawHeaders[index]}: ${upstreamResponse.rawHeaders[index + 1]}`)
      }
    }
    rawHeaders.push('Connection: Upgrade', 'Upgrade: websocket')
    socket.write(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n${rawHeaders.join('\r\n')}\r\n\r\n`)
    if (upstreamHead.length) {
      socket.write(upstreamHead)
    }
    if (head.length) {
      upstreamSocket.write(head)
    }
    upstreamSocket.pipe(socket)
    socket.pipe(upstreamSocket)
    socket.on('error', () => upstreamSocket.destroy())
    upstreamSocket.on('error', () => socket.destroy())
    socket.on('close', () => upstreamSocket.destroy())
    upstreamSocket.on('close', () => socket.destroy())
  })
  upstreamRequest.on('response', upstreamResponse => {
    socket.end(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\nConnection: close\r\n\r\n`)
    upstreamResponse.resume()
  })
  upstreamRequest.on('error', error => {
    logError(`websocket backend unavailable for ${url.pathname}: ${error.message}`)
    socket.destroy()
  })
  upstreamRequest.end()
})

server.on('error', error => {
  logError(`server error: ${error.message}`)
  process.exit(1)
})

let closing = false
function shutdown(signal) {
  if (closing) {
    return
  }
  closing = true
  log(`received ${signal}, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.listen(port, listenHost, () => {
  const address = server.address()
  log(`serving ${distDir}`)
  log(`listening on http://${listenHost === '::1' ? '[::1]' : listenHost}:${address.port}`)
  log(`proxying /api and /dashboard-plugins to ${upstream.origin}`)
})
