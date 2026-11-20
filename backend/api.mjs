import { dateKey, fromLocal, periodStart, plusDays, plusMonths, weekRange } from '../shared/time.mjs'
import { CLOCK_CODE_LENGTH, isClockCode } from '../shared/clock.mjs'
import { database, STAFF_FIELDS, ENTRY_FIELDS, SHIFT_FIELDS } from './database.mjs'
import { checkPassword, decrypt, digest, encrypt, randomToken } from './security.mjs'
import { ApiError, fail, niss, phone, pin, revisions, signature, stamp, text, validDate, validWeek } from './validation.mjs'
import { seedDemo } from './demo.mjs'
import { smsEnabled, submitShiftSms } from './sms.mjs'

const minute = 60_000
const hour = 60 * minute
const cookieName = 'minhaj_owner'
const entryQuery = `SELECT ${ENTRY_FIELDS} FROM time_entries t JOIN staff s ON s.id = t.staff_id`
const shiftQuery = `SELECT ${SHIFT_FIELDS}, staff.name, staff.phone FROM shifts s
  JOIN staff ON staff.id = s.staff_id
  LEFT JOIN published_shifts p ON p.shift_id = s.id
  LEFT JOIN shift_messages m ON m.shift_id = s.id AND m.revision = s.revision`

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status, headers: {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin', ...headers,
    },
  })
}

function loggableError(error) {
  const message = String(error?.message ?? error)
  if (message.includes('code_hash')) return new ApiError(409, 'That clock PIN is already assigned. Choose another PIN.')
  if (message.includes('shift_overlap')) return new ApiError(409, 'This staff member already has an overlapping shift.')
  if (message.includes('attendance_overlap') || message.includes('time_one_open')) {
    return new ApiError(409, 'That time overlaps another attendance entry for this staff member.')
  }
  return error
}

async function payload(request, url) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) fail(403, 'This request must come from the same site.')
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'This request must come from the same site.')
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') fail(415, 'Send a JSON request.')
  const body = await request.text()
  if (body.length > 36_000) fail(413, 'This request is too large.')
  let parsed
  try { parsed = JSON.parse(body) } catch { fail(400, 'The request could not be read.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'The request could not be read.')
  return parsed
}

function cookie(request, value, seconds, secure) {
  const useSecure = secure || new URL(request.url).protocol === 'https:'
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${useSecure ? '; Secure' : ''}`
}

function getToken(request) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)minhaj_owner=([0-9a-f]{64})(?:;|$)/)
  return token?.[1]
}

async function isOwner({ request, db, env, now }) {
  if (env.SITE_OWNER_ONLY === '1') {
    const user = request.headers.get('oai-authenticated-user-id')
    if (!user) return false
    const current = await db.one("SELECT value FROM settings WHERE key = 'platform_owner'")
    if (current) return current.value === user
    await db.run("INSERT INTO settings (key, value) VALUES ('platform_owner', ?) ON CONFLICT DO NOTHING", user)
    return (await db.one("SELECT value FROM settings WHERE key = 'platform_owner'")).value === user
  }
  const token = getToken(request)
  if (!token) return false
  const hash = await digest(env.APP_KEY, 'session', token)
  return Boolean(await db.one('SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?', hash, now))
}

async function attempt(db, bucket, window, limit) {
  const row = await db.one(`
    INSERT INTO rate_limits (bucket, window, attempts) VALUES (?, ?, 1)
    ON CONFLICT (bucket) DO UPDATE SET window = excluded.window,
      attempts = CASE WHEN rate_limits.window = excluded.window THEN rate_limits.attempts + 1 ELSE 1 END
    RETURNING attempts
  `, bucket, window)
  if (row.attempts > limit) fail(429, 'Too many attempts. Please wait a few minutes and try again.')
}

async function login({ request, db, env, now, client, body }) {
  if (env.SITE_OWNER_ONLY === '1') fail(400, 'Use your workspace sign-in.')
  if (!env.OWNER_PASSWORD_HASH) fail(503, 'The owner account needs to be configured.')
  const bucket = await digest(env.APP_KEY, 'login-rate', client)
  await attempt(db, bucket, Math.floor(now / (5 * minute)), 10)
  if (!await checkPassword(body.password, env.OWNER_PASSWORD_HASH)) fail(401, 'That owner password is incorrect.')
  const token = randomToken()
  const hash = await digest(env.APP_KEY, 'session', token)
  const expires = 12 * hour
  await db.batch([
    ['DELETE FROM sessions WHERE expires_at <= ?', now],
    ['DELETE FROM rate_limits WHERE window < ?', Math.floor(now / (5 * minute)) - 288],
    ['INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)', hash, now + expires],
  ])
  return json({ authenticated: true }, 200, { 'Set-Cookie': cookie(request, token, expires / 1000, env.SECURE_COOKIE === '1') })
}

async function logout({ request, db, env }) {
  const token = getToken(request)
  if (token && env.SITE_OWNER_ONLY !== '1') {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', await digest(env.APP_KEY, 'session', token))
  }
  return json({ authenticated: false }, 200, { 'Set-Cookie': cookie(request, '', 0, env.SECURE_COOKIE === '1') })
}

async function hoursByStaff(db, period, key) {
  const endKey = period === 'week' ? plusDays(key, 7) : plusMonths(key, period === 'month' ? 1 : 12)
  const start = fromLocal(key + 'T00:00')
  const end = fromLocal(endKey + 'T00:00')
  const totals = await db.all(`WITH worked AS (
      SELECT staff_id, approved_at, min(clock_out, ?) - max(clock_in, ?) AS duration
      FROM time_entries WHERE clock_in < ? AND clock_out > ?
    )
    SELECT staff_id AS staffId, SUM(duration) AS recorded,
      SUM(CASE WHEN approved_at IS NULL THEN 0 ELSE duration END) AS approved
    FROM worked GROUP BY staff_id`, end, start, end, start)
  return { period, key, totals }
}

async function workspace({ db, env, now, url }) {
  const week = validWeek(url.searchParams.get('week'), now)
  const [start, end] = weekRange(week)
  const today = dateKey(now)
  const todayStart = fromLocal(today + 'T00:00')
  const tomorrowStart = fromLocal(plusDays(today, 1) + 'T00:00')
  const period = url.searchParams.get('hours')
  if (period !== null && !['week', 'month', 'year'].includes(period)) fail(400, 'Choose week, month or year for staff hours.')
  const hoursKey = period && (period === 'week' ? week : periodStart(period, validDate(url.searchParams.get('date') ?? today)))
  const [staff, entries, shifts, todayShifts, hours] = await Promise.all([
    db.all(`SELECT ${STAFF_FIELDS} FROM staff ORDER BY active DESC, name COLLATE NOCASE`),
    db.all(`${entryQuery} WHERE t.clock_out IS NULL OR (t.clock_in < ? AND t.clock_out > ?) ORDER BY t.clock_in DESC`, end, start),
    db.all(`${shiftQuery} WHERE s.cancelled_at IS NULL AND s.start_at < ? AND s.end_at > ? ORDER BY s.start_at`, end, start),
    db.all(`${shiftQuery} WHERE s.cancelled_at IS NULL AND s.start_at < ? AND s.end_at > ? ORDER BY s.start_at`, tomorrowStart, todayStart),
    period === null ? undefined : hoursByStaff(db, period, hoursKey),
  ])
  const withoutPhone = ({ phone: _phone, ...shift }) => shift
  return json({
    week, start, end, now, today, staff, entries, shifts: shifts.map(withoutPhone),
    todayShifts: todayShifts.map(withoutPhone), hours, smsEnabled: smsEnabled(env),
  })
}

async function staffDetails({ db, env }, id, reveal = false) {
  const staff = await db.one(`SELECT ${STAFF_FIELDS}, phone, address_encrypted, niss_encrypted FROM staff WHERE id = ?`, id)
  if (!staff) fail(404, 'Staff member not found.')
  if (reveal) return json({ niss: await decrypt(env.APP_KEY, staff.niss_encrypted, id + ':niss') })
  const { address_encrypted, niss_encrypted: _niss, ...publicFields } = staff
  return json({ ...publicFields, address: await decrypt(env.APP_KEY, address_encrypted, id + ':address') })
}

async function saveStaff({ db, env, now, body }, id) {
  const name = text(body.name, 'Full name', 100)
  const role = text(body.role, 'Role', 60, false) || 'Team member'
  const telephone = phone(body.phone)
  const address = text(body.address, 'Address', 350)
  const previous = id ? await db.one('SELECT * FROM staff WHERE id = ?', id) : null
  if (id && !previous) fail(404, 'Staff member not found.')
  if (env.DEMO_MODE === '1' && body.niss) fail(400, 'Use synthetic details in this demo. National numbers can be saved in a configured workspace.')
  const normalized = Object.hasOwn(body, 'niss') ? niss(body.niss) : undefined
  const staffId = id ?? crypto.randomUUID()
  const active = body.active === false ? 0 : 1
  const code = !previous || (body.code != null && body.code !== '') ? pin(body.code) : null
  const [addressEncrypted, nissEncrypted, codeHash] = await Promise.all([
    encrypt(env.APP_KEY, address, staffId + ':address'),
    normalized === undefined ? previous?.niss_encrypted ?? null
      : normalized == null ? null : encrypt(env.APP_KEY, normalized, staffId + ':niss'),
    code === null ? null : digest(env.APP_KEY, 'code', code),
  ])
  const lastFour = normalized === undefined ? previous?.niss_last_four ?? null : normalized?.slice(-4) ?? null
  if (previous) {
    const updated = await db.run(`UPDATE staff SET name = ?, role = ?, phone = ?, address_encrypted = ?,
      niss_encrypted = ?, niss_last_four = ?, code_hash = coalesce(?, code_hash),
      code_digits = coalesce(?, code_digits), active = ? WHERE id = ?
      AND (? = 1 OR (NOT EXISTS (SELECT 1 FROM time_entries WHERE staff_id = ? AND clock_out IS NULL)
        AND NOT EXISTS (SELECT 1 FROM shifts WHERE staff_id = ? AND cancelled_at IS NULL AND end_at > ?)))`,
    name, role, telephone, addressEncrypted, nissEncrypted, lastFour, codeHash,
    code === null ? null : CLOCK_CODE_LENGTH, active, id, active, id, id, now)
    if (!updated) fail(409, 'Close the open clock entry and cancel or reassign upcoming shifts before deactivating this staff member.')
  } else {
    await db.run(`INSERT INTO staff (id, name, role, phone, address_encrypted,
      niss_encrypted, niss_last_four, code_hash, code_digits, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    staffId, name, role, telephone, addressEncrypted, nissEncrypted, lastFour, codeHash, CLOCK_CODE_LENGTH, active, now)
  }
  return json({ id: staffId }, id ? 200 : 201)
}

async function clockStaff({ env, db, client, now, body }) {
  const clockBucket = await digest(env.APP_KEY, 'clock-rate', client)
  const window = Math.floor(now / (5 * minute))
  const previous = await db.one('SELECT attempts FROM rate_limits WHERE bucket = ? AND window = ?', clockBucket, window)
  if (previous?.attempts >= 8) fail(429, 'Too many incorrect PINs. Please wait a few minutes and try again.')
  const staff = isClockCode(body.code) && await db.one(`SELECT id, name, code_hash AS codeHash FROM staff
    WHERE code_hash = ? AND code_digits = ? AND active = 1`, await digest(env.APP_KEY, 'code', body.code), CLOCK_CODE_LENGTH)
  if (staff) return staff
  await attempt(db, clockBucket, window, 8)
  fail(401, 'That PIN was not recognised. Ask your employer to check it.')
}

async function clockLookup(context) {
  const { db, now } = context
  const staff = await clockStaff(context)
  const active = await db.one('SELECT id, clock_in AS clockIn FROM time_entries WHERE staff_id = ? AND clock_out IS NULL', staff.id)
  const shifts = await db.all(`SELECT p.shift_id AS id, p.start_at AS startAt, p.end_at AS endAt, p.role, p.note
    FROM published_shifts p JOIN shifts s ON s.id = p.shift_id
    WHERE p.staff_id = ? AND p.end_at > ? AND s.cancelled_at IS NULL ORDER BY p.start_at LIMIT 12`, staff.id, now)
  return json({ name: staff.name.split(/\s+/)[0], active, shifts })
}

const signatureContext = (id, action, at) => `${id}:signature:${action}:${at}`

async function signedPunch(key, id, action, at, strokes) {
  const encrypted = await encrypt(key, JSON.stringify(strokes), signatureContext(id, action, at))
  return { action, at, encrypted }
}

async function entrySignatures({ db, env }, id) {
  const entry = await db.one('SELECT signatures FROM time_entries WHERE id = ?', id)
  if (!entry) fail(404, 'Clock entry not found.')
  const signatures = await Promise.all(JSON.parse(entry.signatures).map(async ({ action, at, encrypted }) => ({
    action, at, strokes: JSON.parse(await decrypt(env.APP_KEY, encrypted, signatureContext(id, action, at))),
  })))
  return json({ signatures })
}

async function clockPunch(context) {
  const { db, env, now, body } = context
  const staff = await clockStaff(context)
  const name = staff.name.split(/\s+/)[0]
  if (body.action !== 'in' && body.action !== 'out') fail(400, 'Choose clock in or clock out.')
  const strokes = signature(body.signature)
  if (body.action === 'in') {
    const id = crypto.randomUUID()
    const record = await signedPunch(env.APP_KEY, id, 'in', now, strokes)
    const changed = await db.run(`INSERT INTO time_entries (id, staff_id, clock_in, original_in, signatures)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM staff WHERE id = ? AND active = 1 AND code_hash = ?)
      AND NOT EXISTS (SELECT 1 FROM time_entries WHERE staff_id = ? AND clock_out IS NULL)`,
    id, staff.id, now, now, JSON.stringify([record]), staff.id, staff.codeHash, staff.id)
    if (!changed) fail(409, 'The clock status has changed. Enter your PIN again.')
    return json({ name, at: now, action: 'in' }, 201)
  }
  const id = text(body.entryId, 'Clock entry', 100)
  const entry = await db.one('SELECT clock_in AS clockIn, revision FROM time_entries WHERE id = ? AND staff_id = ? AND clock_out IS NULL', id, staff.id)
  if (!entry) fail(409, 'The clock status has changed. Enter your PIN again.')
  if (now <= entry.clockIn) fail(409, 'Wait a moment before clocking out.')
  const record = await signedPunch(env.APP_KEY, id, 'out', now, strokes)
  const changed = await db.run(`UPDATE time_entries SET clock_out = ?, original_out = coalesce(original_out, ?),
      revision = revision + 1, signatures = json_insert(signatures, '$[#]', json(?))
    WHERE id = ? AND staff_id = ? AND clock_out IS NULL AND revision = ?
      AND EXISTS (SELECT 1 FROM staff WHERE id = ? AND active = 1 AND code_hash = ?)`,
    now, now, JSON.stringify(record), id, staff.id, entry.revision, staff.id, staff.codeHash)
  if (!changed) fail(409, 'The clock status has changed. Enter your PIN again.')
  return json({ name, at: now, action: 'out', duration: now - entry.clockIn })
}

async function saveShift({ db, body }, id) {
  const staffId = text(body.staffId, 'Staff member', 100)
  const startAt = stamp(body.startAt, 'shift start')
  const endAt = stamp(body.endAt, 'shift end')
  if (endAt <= startAt) fail(400, 'The shift must end after it starts.')
  const role = text(body.role, 'Shift role', 60)
  const note = text(body.note, 'Shift notes', 500, false)
  const shiftId = id ?? crypto.randomUUID()
  if (!await db.one('SELECT id FROM staff WHERE id = ? AND active = 1', staffId)) fail(400, 'Choose an active staff member.')
  const changed = id
    ? await db.run(`UPDATE shifts SET staff_id = ?, start_at = ?, end_at = ?, role = ?, note = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND cancelled_at IS NULL AND EXISTS (SELECT 1 FROM staff WHERE id = ? AND active = 1)`,
      staffId, startAt, endAt, role, note, id, revisions(body.revision), staffId)
    : await db.run(`INSERT INTO shifts (id, staff_id, start_at, end_at, role, note)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM staff WHERE id = ? AND active = 1)`,
      shiftId, staffId, startAt, endAt, role, note, staffId)
  if (!changed) fail(409, 'This record changed. Refresh and try again.')
  return json({ id: shiftId }, id ? 200 : 201)
}

async function cancelShift({ db, now, body }, id) {
  const changed = await db.run('UPDATE shifts SET cancelled_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND cancelled_at IS NULL',
    now, id, revisions(body.revision))
  if (!changed) fail(409, 'This shift changed. Refresh and try again.')
  return json({ id })
}

async function publishShifts({ db, env, now, body, sendSms }) {
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 ||
      body.ids.some(id => typeof id !== 'string' || id.length > 100)) fail(400, 'Choose between 1 and 100 shifts.')
  if (body.sms && !smsEnabled(env)) fail(400, 'SMS delivery needs to be configured first.')
  const ids = JSON.stringify([...new Set(body.ids)])
  const published = await db.run(`INSERT INTO published_shifts (shift_id, staff_id, start_at, end_at, role, note, revision, published_at)
    SELECT s.id, s.staff_id, s.start_at, s.end_at, s.role, s.note, s.revision, ?
    FROM shifts s JOIN staff ON staff.id = s.staff_id
    WHERE s.id IN (SELECT value FROM json_each(?)) AND s.cancelled_at IS NULL AND staff.active = 1
    ON CONFLICT (shift_id) DO UPDATE SET staff_id = excluded.staff_id, start_at = excluded.start_at,
    end_at = excluded.end_at, role = excluded.role, note = excluded.note, revision = excluded.revision,
    published_at = excluded.published_at WHERE published_shifts.revision <> excluded.revision`, now, ids)
  if (!body.sms) return json({ published, messages: [] })
  const candidates = await db.all(`${shiftQuery} WHERE s.id IN (SELECT value FROM json_each(?))
    AND s.cancelled_at IS NULL AND staff.active = 1 AND p.revision = s.revision`, ids)
  const messages = []
  for (let i = 0; i < candidates.length; i += 6) {
    const batch = await Promise.all(candidates.slice(i, i + 6).map(async shift => ({
      id: shift.id, status: await submitShiftSms(db, env, shift, now, sendSms),
    })))
    messages.push(...batch)
  }
  return json({ published, messages })
}

async function saveEntry({ db, now, body }, id) {
  const clockIn = stamp(body.clockIn, 'clock-in time')
  const clockOut = body.clockOut == null ? null : stamp(body.clockOut, 'clock-out time')
  if (clockIn > now || (clockOut != null && clockOut > now)) fail(400, 'Attendance times cannot be in the future.')
  if (clockOut != null && clockOut <= clockIn) fail(400, 'Clock-out must be after clock-in.')
  const reason = text(body.reason, 'Reason for change', 300)
  const entryId = id ?? crypto.randomUUID()
  let changed
  if (id) {
    changed = await db.run(`UPDATE time_entries SET clock_in = ?, clock_out = ?, reason = ?,
      approved_at = NULL, corrections = corrections + 1, revision = revision + 1
      WHERE id = ? AND revision = ?`, clockIn, clockOut, reason, id, revisions(body.revision))
  } else {
    const staffId = text(body.staffId, 'Staff member', 100)
    if (!await db.one('SELECT id FROM staff WHERE id = ?', staffId)) fail(400, 'Choose a staff member.')
    await db.run('INSERT INTO time_entries (id, staff_id, clock_in, clock_out, reason) VALUES (?, ?, ?, ?, ?)',
      entryId, staffId, clockIn, clockOut, reason)
    changed = 1
  }
  if (!changed) fail(409, 'This entry changed. Refresh and try again.')
  return json({ id: entryId }, id ? 200 : 201)
}

async function approveEntry({ db, now, body }, id) {
  const changed = await db.run(`UPDATE time_entries SET approved_at = ?, revision = revision + 1
    WHERE id = ? AND clock_out IS NOT NULL AND approved_at IS NULL AND revision = ?`, now, id, revisions(body.revision))
  if (!changed) fail(409, 'This entry is open, already approved, or has changed. Refresh and try again.')
  return json({ id, approvedAt: now })
}

export async function handleApi(request, env, options = {}) {
  try {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()
    const path = url.pathname.replace(/\/$/, '')
    const db = database(env.DB)
    const now = options.now ?? Date.now()
    const context = {
      request, db, env, now, url, sendSms: options.sendSms,
      client: options.client ?? request.headers.get('CF-Connecting-IP') ?? 'shared-clock',
      body: ['POST', 'PATCH', 'DELETE'].includes(method) ? await payload(request, url) : {},
    }
    if (path === '/api/session' && method === 'GET') {
      return json({
        authenticated: await isOwner(context), platform: env.SITE_OWNER_ONLY === '1',
        demo: env.DEMO_MODE === '1', clockUrl: env.STAFF_CLOCK_URL,
      })
    }
    if (path === '/api/login' && method === 'POST') return await login(context)
    if (path === '/api/logout' && method === 'POST') return await logout(context)
    if (path.startsWith('/api/clock/')) {
      if (method !== 'POST') fail(405, 'Use the staff clock to make this request.')
      if (env.DEMO_MODE === '1') await seedDemo(db, env.APP_KEY, now)
      if (path === '/api/clock/lookup') return await clockLookup(context)
      if (path === '/api/clock/punch') return await clockPunch(context)
      fail(404, 'Clock action not found.')
    }
    if (!await isOwner(context)) fail(401, 'Sign in as the owner to continue.')
    if (env.DEMO_MODE === '1') await seedDemo(db, env.APP_KEY, now)
    if (path === '/api/workspace' && method === 'GET') return await workspace(context)
    if (path === '/api/staff' && method === 'POST') return await saveStaff(context)
    if (path === '/api/shifts' && method === 'POST') return await saveShift(context)
    if (path === '/api/shifts/publish' && method === 'POST') return await publishShifts(context)
    if (path === '/api/entries' && method === 'POST') return await saveEntry(context)
    const [, type, id, action] = path.match(/^\/api\/(staff|shifts|entries)\/([a-z0-9-]+)(?:\/([a-z]+))?$/i) ?? []
    if (type === 'staff' && method === 'GET' && (!action || action === 'niss')) return await staffDetails(context, id, action === 'niss')
    if (type === 'staff' && method === 'PATCH' && !action) return await saveStaff(context, id)
    if (type === 'shifts' && method === 'PATCH' && !action) return await saveShift(context, id)
    if (type === 'shifts' && method === 'DELETE' && !action) return await cancelShift(context, id)
    if (type === 'entries' && method === 'GET' && action === 'signatures') return await entrySignatures(context, id)
    if (type === 'entries' && method === 'PATCH' && !action) return await saveEntry(context, id)
    if (type === 'entries' && method === 'POST' && action === 'approve') return await approveEntry(context, id)
    fail(404, 'That action could not be found.')
  } catch (cause) {
    const error = loggableError(cause)
    if (error instanceof ApiError) return json({ error: error.message }, error.status)
    console.error('Shift API request failed.', error?.name ?? 'Error')
    return json({ error: 'The server could not complete the request. Try again.' }, 500)
  }
}
