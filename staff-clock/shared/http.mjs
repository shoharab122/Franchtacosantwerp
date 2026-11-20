import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}
const maxBodyBytes = 36_000

export function localPort(value, fallback) {
  const port = Number(value ?? fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port from 1 to 65535.')
  return port
}

export function localRequestUrl(request, port) {
  const host = request.headers.host?.toLowerCase()
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`].map(value => new URL(value))
  const origin = origins.find(candidate => candidate.host === host)
  if (!origin || !request.url?.startsWith('/')) return null
  const url = new URL(request.url, origin)
  return url.origin === origin.origin ? url : null
}

export async function readRequest(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > maxBodyBytes) {
      request.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function jsonError(response, status, error) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }).end(JSON.stringify({ error }))
}

export async function serveFrontend(request, response, buildDir, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) return false
  const path = pathname === '/' ? '/index.html' : pathname
  if (path !== '/index.html' && path !== '/brand.svg' && !path.startsWith('/assets/')) return false
  const filename = resolve(buildDir, '.' + path)
  const type = contentTypes[extname(filename)]
  if (!filename.startsWith(buildDir + sep) || !type) return false
  let data
  try { data = await readFile(filename) } catch (cause) {
    if (cause.code === 'ENOENT' || cause.code === 'EISDIR') return false
    throw cause
  }
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }).end(request.method === 'HEAD' ? undefined : data)
  return true
}

export function listenLocal(server, port) {
  return new Promise((ready, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail)
      ready()
    })
  })
}
