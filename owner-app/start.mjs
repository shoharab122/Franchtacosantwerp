import { access, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { jsonError, listenLocal, localPort, localRequestUrl, readRequest, serveFrontend } from './shared/http.mjs'

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('French Tacos Antwerp needs Node.js 24 or newer.')
  process.exit(1)
}
process.chdir(fileURLToPath(new URL('.', import.meta.url)))

// AUTOMATIC RENDER ENVIRONMENT SETUP
if (process.env.RENDER) {
  try {
    const envContent = `APP_KEY=${process.env.APP_KEY || ''}\nOWNER_PASSWORD_HASH=${process.env.OWNER_PASSWORD_HASH || ''}\nDB_PATH=${process.env.DB_PATH || 'data/minhaj-shift.sqlite'}\n`;
    await writeFile('.env', envContent);
    console.log("✅ Created .env file from Render environment variables");
  } catch (err) {
    console.error("Failed to create .env", err);
  }
}

const buildDir = fileURLToPath(new URL('./dist', import.meta.url))
const clockRoutes = new Set(['/api/clock/lookup', '/api/clock/punch'])

async function readSettings() {
  try { return { ...parseEnv(await readFile('.env', 'utf8')), ...process.env } } catch (error) {
    if (error.code === 'ENOENT') return process.env
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
  const port = process.env.PORT || localPort(settings.OWNER_PORT, 4173)
  const server = createServer(async (req, res) => {
    try {
      const url = localRequestUrl(req, port)
      if (!url) return jsonError(res, 403, 'Open the owner app on this laptop.')
      if (clockRoutes.has(url.pathname)) return await clockRequest(req, res, url, port)
      if (url.pathname.startsWith('/api/')) return jsonError(res, 404, 'This action is unavailable in the owner app.')
      if (!await serveFrontend(req, res, buildDir, url.pathname)) res.writeHead(404).end('Page not found')
    } catch (error) {
      console.error('Owner app request failed.', error.name)
      jsonError(res, 500, 'The owner app could not complete the request.')
    }
  })
  await listenLocal(server, port)
  console.log(`Owner app: http://127.0.0.1:${port}/`)
  console.log('Keep this window open while using French Tacos Antwerp.')
} catch (error) {
  if (error.code === 'EADDRINUSE') console.error('The owner app port is already in use. Check the other windows or change OWNER_PORT.')
  else if (error.code === 'ENOENT') console.error('The app files could not be found. Extract the entire ZIP to a folder before launching.')
  else console.error(error.message)
  process.exitCode = 1
}
