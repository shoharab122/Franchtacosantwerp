import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { handleApi } from './api.mjs'
import { openSqlite } from './sqlite.mjs'
import { jsonError, listenLocal, localPort, localRequestUrl, readRequest, serveFrontend } from '../shared/http.mjs'

const buildDir = fileURLToPath(new URL('../dist', import.meta.url))

export async function startOwner(settings) {
  if (!/^[a-f0-9]{64}$/i.test(settings.APP_KEY ?? '') || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(settings.OWNER_PASSWORD_HASH ?? '')) {
    throw new Error('The owner settings in .env are incomplete. Keep the original APP_KEY and password hash if you already have staff records.')
  }
  const port = localPort(settings.OWNER_PORT, 4173)
  const staffClockPort = localPort(settings.STAFF_CLOCK_PORT, 4174)
  if (port === staffClockPort) throw new Error('Choose different ports for the owner app and the staff clock.')
  const clockUrl = `http://127.0.0.1:${staffClockPort}/`
  const DB = openSqlite(settings.DB_PATH ?? 'data/minhaj-shift.sqlite')
  const env = { ...settings, DB, STAFF_CLOCK_URL: clockUrl, SITE_OWNER_ONLY: undefined }
  const server = createServer(async (req, res) => {
    try {
      const url = localRequestUrl(req, port)
      if (!url) return jsonError(res, 403, 'Open the owner app on this laptop.')
      if (url.pathname.startsWith('/api/')) {
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRequest(req)
        if (body === null) return jsonError(res, 413, 'This request is too large.')
        const result = await handleApi(new Request(url, { method: req.method, headers: req.headers, body }),
          env, { client: req.socket.remoteAddress })
        res.writeHead(result.status, Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()))
        return
      }
      if (['GET', 'HEAD'].includes(req.method) && ['/clock', '/clock/'].includes(url.pathname)) {
        return res.writeHead(302, { Location: clockUrl }).end()
      }
      if (!await serveFrontend(req, res, buildDir, url.pathname)) res.writeHead(404).end('Page not found')
    } catch (error) {
      console.error('Owner request failed.', error.name)
      jsonError(res, 500, 'The owner app could not complete the request.')
    }
  })

  try { await listenLocal(server, port) } catch (error) { DB.close(); throw error }
  const close = () => server.close(() => { DB.close() })
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  console.log(`Owner app: http://localhost:${port}/`)
  console.log('Keep this window open while using French Tacos Antwerp.')
}
