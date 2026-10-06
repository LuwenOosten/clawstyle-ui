// Integration tests for ops/server.mjs against a fake loopback backend.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverScript = path.join(here, 'server.mjs')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawstyle-server-test-'))
const distDir = path.join(tempRoot, 'dist')

let upstream
let upstreamPort
let serverProcess
let serverPort
let upstreamBootstrapHtml = true
const serverLogs = { stderr: '', stdout: '' }

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port
      probe.close(() => resolve(port))
    })
  })
}

function waitFor(predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) {
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for condition'))
      } else {
        setTimeout(tick, 50)
      }
    }
    tick()
  })
}

function request(targetPort, { body = null, headers = {}, method = 'GET', requestPath = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        headers: { host: `127.0.0.1:${targetPort}`, ...headers },
        host: '127.0.0.1',
        method,
        path: requestPath,
        port: targetPort
      },
      response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () =>
          resolve({ body: Buffer.concat(chunks).toString('utf8'), headers: response.headers, status: response.statusCode })
        )
      }
    )
    req.on('error', reject)
    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function upgradeRequest(targetPort, { headers = {}, requestPath = '/api/pty' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      headers: {
        connection: 'Upgrade',
        host: `127.0.0.1:${targetPort}`,
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
        upgrade: 'websocket',
        ...headers
      },
      host: '127.0.0.1',
      path: requestPath,
      port: targetPort
    })
    req.on('upgrade', (response, socket, head) => resolve({ head: head.toString('utf8'), response, socket }))
    req.on('response', response => {
      response.resume()
      resolve({ response, socket: null })
    })
    req.on('error', reject)
    req.end()
  })
}

before(async () => {
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>ClawStyle Admin</title></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>'
  )
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("clawstyle-app")\n')
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), 'TOP-SECRET-OUTSIDE-DIST\n')

  upstream = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        upstreamBootstrapHtml
          ? '<!doctype html><html><head><script>window.__HERMES_SESSION_TOKEN__="test-token";window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=true;</script></head><body>backend</body></html>'
          : '<!doctype html><html><head></head><body>headless backend (no bootstrap)</body></html>'
      )
      return
    }
    if (req.url.startsWith('/api/ping')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ host: req.headers.host, ok: true, origin: req.headers.origin ?? null }))
      return
    }
    if (req.url === '/api/echo') {
      let body = ''
      req.on('data', chunk => {
        body += chunk
      })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`echo:${body}`)
      })
      return
    }
    if (req.url === '/dashboard-plugins/plugin.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end('window.__HERMES_PLUGIN__ = true\n')
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('upstream 404')
  })
  upstream.on('upgrade', (req, socket) => {
    socket.on('end', () => socket.destroy())
    socket.resume()
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nupstream-hello')
  })
  upstreamPort = await freePort()
  await new Promise(resolve => upstream.listen(upstreamPort, '127.0.0.1', resolve))

  serverPort = await freePort()
  serverProcess = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      HERMES_CLAWSTYLE_DIST: distDir,
      HERMES_CLAWSTYLE_ALLOWED_HOSTS: 'tail.example,10.0.0.5:1234',
      HERMES_DASHBOARD_URL: `http://127.0.0.1:${upstreamPort}`,
      PORT: String(serverPort)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  serverProcess.stdout.on('data', chunk => {
    serverLogs.stdout += chunk
  })
  serverProcess.stderr.on('data', chunk => {
    serverLogs.stderr += chunk
  })
  await waitFor(() => serverLogs.stdout.includes('listening on'))
})

after(async () => {
  http.globalAgent.destroy()
  if (serverProcess && serverProcess.exitCode === null && serverProcess.signalCode === null) {
    serverProcess.kill('SIGTERM')
    const exited = await Promise.race([
      new Promise(resolve => serverProcess.once('exit', () => resolve(true))),
      new Promise(resolve => setTimeout(() => resolve(false), 3000))
    ])
    if (!exited && serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill('SIGKILL')
      await new Promise(resolve => serverProcess.once('exit', resolve))
    }
  }
  if (upstream) {
    await new Promise(resolve => upstream.close(resolve))
  }
  fs.rmSync(tempRoot, { force: true, recursive: true })
})

test('serves index.html with the backend window.__HERMES_* bootstrap', async () => {
  const response = await request(serverPort, { headers: { accept: 'text/html' } })
  assert.equal(response.status, 200)
  assert.match(response.body, /ClawStyle Admin/)
  assert.match(response.body, /window\.__HERMES_SESSION_TOKEN__="test-token"/)
  assert.match(response.body, /window\.__HERMES_DASHBOARD_EMBEDDED_CHAT__=true/)
  assert.equal(response.headers['cache-control'], 'no-store')
})

test('rejects unknown Host headers', async () => {
  const response = await request(serverPort, { headers: { host: 'evil.example:9130' } })
  assert.equal(response.status, 403)
})

test('rejects unknown Origin headers', async () => {
  const response = await request(serverPort, { headers: { origin: 'http://evil.example' } })
  assert.equal(response.status, 403)
})

test('accepts allowed tailnet Host and Origin from HERMES_CLAWSTYLE_ALLOWED_HOSTS', async () => {
  const host = `tail.example:${serverPort}`
  const page = await request(serverPort, { headers: { accept: 'text/html', host } })
  assert.equal(page.status, 200)
  assert.match(page.body, /window\.__HERMES_SESSION_TOKEN__="test-token"/)

  const api = await request(serverPort, { headers: { host, origin: `http://${host}` }, requestPath: '/api/ping' })
  assert.equal(api.status, 200)
  const body = JSON.parse(api.body)
  assert.equal(body.host, `127.0.0.1:${upstreamPort}`)
  assert.equal(body.origin, `http://127.0.0.1:${upstreamPort}`)
})

test('rejects hosts whose explicit port misses the allowlist', async () => {
  const response = await request(serverPort, { headers: { host: `10.0.0.5:${serverPort}` } })
  assert.equal(response.status, 403)
})

test('refuses to start with malformed HERMES_CLAWSTYLE_ALLOWED_HOSTS entries', () => {
  const result = spawnSync(process.execPath, [serverScript], {
    encoding: 'utf8',
    env: { ...process.env, HERMES_CLAWSTYLE_DIST: distDir, HERMES_CLAWSTYLE_ALLOWED_HOSTS: 'https://evil.example' },
    timeout: 5000
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HERMES_CLAWSTYLE_ALLOWED_HOSTS/)
})

test('refuses to proxy to its own listen port', async () => {
  const port = await freePort()
  const result = spawnSync(process.execPath, [serverScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HERMES_CLAWSTYLE_DIST: distDir,
      HERMES_DASHBOARD_URL: `http://127.0.0.1:${port}`,
      PORT: String(port)
    },
    timeout: 5000
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /own listen port/)
})

test('serves built static assets', async () => {
  const response = await request(serverPort, { requestPath: '/assets/app.js' })
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /text\/javascript/)
  assert.match(response.body, /clawstyle-app/)
})

test('blocks path traversal outside dist', async () => {
  const response = await request(serverPort, { requestPath: '/..%2fsecret.txt' })
  assert.equal(response.status, 404)
  assert.doesNotMatch(response.body, /TOP-SECRET/)
})

test('proxies API requests and rewrites host/origin', async () => {
  const response = await request(serverPort, {
    headers: { origin: `http://127.0.0.1:${serverPort}` },
    requestPath: '/api/ping?token=query-secret'
  })
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.ok, true)
  assert.equal(body.host, `127.0.0.1:${upstreamPort}`)
  assert.equal(body.origin, `http://127.0.0.1:${upstreamPort}`)
})

test('streams request and response bodies', async () => {
  const response = await request(serverPort, { body: 'hello-backend', method: 'POST', requestPath: '/api/echo' })
  assert.equal(response.status, 200)
  assert.equal(response.body, 'echo:hello-backend')
})

test('proxies dashboard plugin scripts', async () => {
  const response = await request(serverPort, { requestPath: '/dashboard-plugins/plugin.js' })
  assert.equal(response.status, 200)
  assert.match(response.body, /__HERMES_PLUGIN__/)
})

test('forwards websocket upgrades and never logs the token', async () => {
  const { head, response, socket } = await upgradeRequest(serverPort, { requestPath: '/api/pty?token=test-token' })
  assert.equal(response.statusCode, 101)
  const received = head || (await new Promise(resolve => {
    socket.once('data', chunk => resolve(chunk.toString('utf8')))
    setTimeout(() => resolve(''), 3000)
  }))
  assert.match(received, /upstream-hello/)
  socket.destroy()
  assert.doesNotMatch(serverLogs.stdout, /test-token/)
  assert.doesNotMatch(serverLogs.stderr, /test-token/)
})

test('rejects websocket upgrades from unknown origins', async () => {
  const { response } = await upgradeRequest(serverPort, { headers: { origin: 'http://evil.example' } })
  assert.equal(response.statusCode, 403)
})

test('healthz reports the frontend config and a live backend probe', async () => {
  const response = await request(serverPort, { requestPath: '/healthz' })
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.service, 'clawstyle-ui')
  assert.equal(body.ok, true)
  assert.equal(body.upstream, `http://127.0.0.1:${upstreamPort}`)
  assert.deepEqual(body.backend, {
    bootstrap: true,
    detail: `http://127.0.0.1:${upstreamPort}/ -> HTTP 200`,
    ok: true,
    status: 200
  })
  assert.equal(body.bootstrap.ok, true)
})

test('healthz reports bootstrap unavailable for a 200 backend without window.__HERMES_*', async () => {
  // Prime the stale last-successful bootstrap record first, so the check
  // cannot pass by trusting it instead of the live probe.
  const page = await request(serverPort, { headers: { accept: 'text/html' } })
  assert.match(page.body, /window\.__HERMES_SESSION_TOKEN__="test-token"/)

  upstreamBootstrapHtml = false
  try {
    const response = await request(serverPort, { requestPath: '/healthz' })
    assert.equal(response.status, 503)
    const body = JSON.parse(response.body)
    assert.equal(body.ok, false)
    assert.equal(body.backend.ok, false)
    assert.equal(body.backend.bootstrap, false)
    assert.equal(body.backend.status, 200)
    assert.match(body.backend.detail, /window\.__HERMES_\*/)
    // The stale injection record may still look healthy; `ok` must not use it.
    assert.equal(body.bootstrap.ok, true)
  } finally {
    upstreamBootstrapHtml = true
  }
})

test('falls back to index.html without bootstrap when the backend is down', async () => {
  await new Promise(resolve => upstream.close(resolve))
  upstream = null
  const page = await request(serverPort, { headers: { accept: 'text/html' } })
  assert.equal(page.status, 200)
  assert.match(page.body, /ClawStyle Admin/)
  assert.doesNotMatch(page.body, /__HERMES_SESSION_TOKEN__/)
  assert.match(serverLogs.stderr, /bootstrap injection failed against backend http:\/\/127\.0\.0\.1:/)
  assert.match(serverLogs.stderr, /serving the SPA without a backend session token/)
  assert.match(serverLogs.stderr, /HERMES_DASHBOARD_URL/)
  const health = await request(serverPort, { requestPath: '/healthz' })
  assert.equal(health.status, 503)
  const healthBody = JSON.parse(health.body)
  assert.equal(healthBody.ok, false)
  assert.equal(healthBody.backend.ok, false)
  assert.equal(healthBody.backend.bootstrap, false)
  assert.match(healthBody.backend.detail, /unreachable/)
  assert.equal(healthBody.bootstrap.ok, false)
  const asset = await request(serverPort, { requestPath: '/assets/app.js' })
  assert.equal(asset.status, 200)
  const api = await request(serverPort, { requestPath: '/api/ping' })
  assert.equal(api.status, 502)
  assert.doesNotMatch(serverLogs.stdout, /test-token/)
})
