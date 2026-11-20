
import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { jsonError, listenLocal, localPort, localRequestUrl, readRequest, serveFrontend } from './shared/http.mjs'

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('French Tacos Antwerp needs Node.js 24 or newer.')
  process.exit(1)
}
process.chdir(fileURLToPath(new URL('.', import.meta.url)))

const buildDir = fileURLToPath(new URL('./dist', import.meta.url))
const clockRoutes = new Set(['/api/clock/lookup', '/api/clock/punch'])

async function readSettings() {
  try { return parseEnv(await readFile('.env', 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

async function clockRequest(req, res, url, ownerPort) {
  if (req.method !== 'POST') return jsonError(res, 405, 'Use the staff clock to make this request.')
  if ((req.headers.origin && req.headers.origin !== url.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
    return jsonError(res, 403, 'This request must come from the staff clock.')
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return jsonError(res, 415, 'Send a JSON request.')
  }
  const body = await readRequest(req)
  if (body === null) return jsonError(res, 413, 'This request is too large.')
  try {
    const upstream = await fetch(`http://127.0.0.1:${ownerPort}${url.pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
    const data = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).end(data)
  } catch {
    jsonError(res, 503, 'The staff clock could not reach the owner app. Keep the owner app running and try again.')
  }
}

try {
  await access('dist/index.html')
  const settings = await readSettings()
  const port = localPort(settings.STAFF_CLOCK_PORT, 4174)
  const ownerPort = localPort(settings.OWNER_API_PORT, 4173)
  if (port === ownerPort) throw new Error('Choose different ports for the staff clock and the owner app.')
  const server = createServer(async (req, res) => {
    try {
      const url = localRequestUrl(req, port)
      if (!url) return jsonError(res, 403, 'Open the staff clock on this laptop.')
      if (clockRoutes.has(url.pathname)) return await clockRequest(req, res, url, ownerPort)
      if (url.pathname.startsWith('/api/')) return jsonError(res, 404, 'This action is unavailable in the staff clock.')
      if (!await serveFrontend(req, res, buildDir, url.pathname)) res.writeHead(404).end('Page not found')
    } catch (error) {
      console.error('Staff clock request failed.', error.name)
      jsonError(res, 500, 'The staff clock could not complete the request.')
    }
  })
  await listenLocal(server, port)
  console.log(`Staff clock: http://127.0.0.1:${port}/`)
  console.log('Keep this window and the owner app window open while staff use the clock.')
} catch (error) {
  if (error.code === 'EADDRINUSE') console.error('The staff clock port is already in use. Check the other windows or change STAFF_CLOCK_PORT.')
  else if (error.code === 'ENOENT') console.error('The app files could not be found. Extract the entire ZIP to a folder before launching.')
  else console.error(error.message)
  process.exitCode = 1
}
