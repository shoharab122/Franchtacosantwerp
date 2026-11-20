import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { handleApi } from './api.mjs'
import { openSqlite } from './sqlite.mjs'
import { digest, encrypt, passwordHash } from './security.mjs'
import { dateKey, fromLocal, weekRange } from '../shared/time.mjs'

const hours = 3_600_000
const secret = '16'.repeat(32)
const password = 'local-test-password-42'
const base = fromLocal('2026-11-19T14:00')

async function fixture(t, settings = {}, options = {}) {
  const DB = settings.DB ?? openSqlite(':memory:')
  t.after(() => DB.close())
  const env = { DB, APP_KEY: secret, OWNER_PASSWORD_HASH: await passwordHash(password), ...settings }
  let now = base
  let cookie = ''
  let clientCount = 0
  const call = async (path, { method = 'GET', body, owner = true, headers = {} } = {}) => {
    const request = new Request('https://shift.test/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(owner && cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    const response = await handleApi(request, env, { now, client: 'clock-' + clientCount, ...options })
    return { status: response.status, data: await response.json(), cookie: response.headers.get('Set-Cookie') }
  }
  const ok = async (path, options) => {
    const result = await call(path, options)
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result))
    return result.data
  }
  const auth = async () => {
    const login = await call('/login', { method: 'POST', body: { password } })
    assert.equal(login.status, 200)
    assert.match(login.cookie, /HttpOnly; SameSite=Strict.*; Secure/)
    cookie = login.cookie.split(';')[0]
  }
  return { DB, call, ok, auth, setNow: value => { now = value }, nextClient: () => ++clientCount }
}

const staff = { name: 'Aline Exemple', role: 'Service', phone: '0470 11 22 33', address: 'Synthetic address', niss: '00.00.00-000.00', code: '0712' }
const inSignature = [[[5, 90], [26, 35], [43, 91]]]
const outSignature = [[[6, 78], [25, 21], [49, 83]], [[10, 70], [43, 68]]]

test('owner records stay private and sensitive fields are protected', async t => {
  const { DB, call, ok, auth } = await fixture(t)
  assert.equal((await call('/workspace')).status, 401)
  assert.equal((await call('/staff', { method: 'POST', body: staff })).status, 401)
  assert.equal((await call('/login', { method: 'POST', body: { password: 'invalid' } })).status, 401)
  await auth()
  for (const code of ['123', '071234', '12ab', 7214]) {
    assert.equal((await call('/staff', { method: 'POST', body: { ...staff, code } })).status, 400)
  }
  const { id } = await ok('/staff', { method: 'POST', body: staff })
  const stored = await DB.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first()
  assert.notEqual(stored.code_hash, staff.code)
  assert.equal(stored.code_digits, 4)
  assert.notEqual(stored.address_encrypted, staff.address)
  assert.notEqual(stored.niss_encrypted, '00000000000')
  assert.equal((await call('/staff/' + id + '/niss', { owner: false })).status, 401)
  assert.equal((await ok('/staff/' + id)).phone, '+32470112233')
  assert.equal((await ok('/staff/' + id + '/niss')).niss, '00000000000')
  assert.equal((await call('/staff', { method: 'POST', body: staff })).status, 409)
  assert.equal((await call('/staff', {
    method: 'POST', body: staff, headers: { Origin: 'https://other.test' },
  })).status, 403)
  const clock = await ok('/clock/lookup', { method: 'POST', body: { code: staff.code }, owner: false })
  assert.deepEqual(Object.keys(clock).sort(), ['active', 'name', 'shifts'])
  assert.equal(clock.name, 'Aline')
  await ok('/staff/' + id, { method: 'PATCH', body: { ...staff, code: '9043', niss: '' } })
  assert.equal((await call('/clock/lookup', { method: 'POST', body: { code: staff.code } })).status, 401)
  assert.equal((await ok('/staff/' + id + '/niss')).niss, null)
  await ok('/logout', { method: 'POST', body: {} })
  assert.equal((await call('/workspace')).status, 401)
})

test('kiosk punches, owner correction, and approval stay consistent', async t => {
  const { auth, ok, call, setNow, DB } = await fixture(t)
  await auth()
  const { id: staffId } = await ok('/staff', { method: 'POST', body: staff })
  const punch = body => call('/clock/punch', { method: 'POST', owner: false, body: { code: staff.code, signature: inSignature, ...body } })
  for (const signature of [undefined, [], [[[5, 5]]], [[[-1, 1], [10, 10]]], [Array(1501).fill([1, 1])]]) {
    assert.equal((await punch({ action: 'in', signature })).status, 400)
  }
  const result = await Promise.all([punch({ action: 'in' }), punch({ action: 'in' })])
  assert.deepEqual(result.map(item => item.status).sort(), [201, 409])
  const open = (await ok('/workspace')).entries[0]
  const signaturePath = '/entries/' + open.id + '/signatures'
  assert.equal(Object.hasOwn(open, 'signatures'), false)
  assert.equal((await call(signaturePath, { owner: false })).status, 401)
  assert.deepEqual((await ok(signaturePath)).signatures, [{ action: 'in', at: base, strokes: inSignature }])
  const deactivate = await call('/staff/' + staffId, { method: 'PATCH', body: { ...staff, active: false } })
  assert.equal(deactivate.status, 409)
  const approvalPath = '/entries/' + open.id + '/approve'
  assert.equal((await call(approvalPath, { method: 'POST', body: { revision: open.revision } })).status, 409)
  setNow(base + 5 * hours)
  assert.equal((await punch({ action: 'out', entryId: 'stale-id' })).status, 409)
  assert.equal((await punch({ action: 'out', entryId: open.id, signature: [] })).status, 400)
  const clockOuts = await Promise.all(Array.from({ length: 2 }, () => punch({ action: 'out', entryId: open.id, signature: outSignature })))
  assert.deepEqual(clockOuts.map(item => item.status).sort(), [200, 409])
  assert.equal(clockOuts.find(item => item.status === 200).data.duration, 5 * hours)
  const expectedSignatures = [{ action: 'in', at: base, strokes: inSignature }, { action: 'out', at: base + 5 * hours, strokes: outSignature }]
  assert.deepEqual((await ok(signaturePath)).signatures, expectedSignatures)
  const storedSignatures = await DB.prepare('SELECT signatures FROM time_entries WHERE id = ?').bind(open.id).first()
  assert.doesNotMatch(storedSignatures.signatures, /strokes|\[5,90\]|\[6,78\]/)
  const closed = (await ok('/workspace')).entries[0]
  assert.equal(closed.originalOut, base + 5 * hours)
  await ok(approvalPath, { method: 'POST', body: { revision: closed.revision } })
  const approved = (await ok('/workspace')).entries[0]
  assert.ok(approved.approvedAt)
  await ok('/entries/' + approved.id, {
    method: 'PATCH', body: { revision: approved.revision, clockIn: base + hours, clockOut: approved.clockOut, reason: 'Employer verified the start time.' },
  })
  const corrected = (await ok('/workspace')).entries[0]
  assert.equal(corrected.approvedAt, null)
  assert.equal(corrected.originalIn, base)
  assert.deepEqual((await ok(signaturePath)).signatures, expectedSignatures)
  const audit = await DB.prepare('SELECT * FROM time_corrections WHERE entry_id = ?').bind(open.id).first()
  assert.equal(audit.previous_approval, approved.approvedAt)
  assert.equal((await call('/entries', { method: 'POST', body: { staffId, clockIn: base + 2 * hours, clockOut: base + 3 * hours, reason: 'Overlap' } })).status, 409)
  await ok(approvalPath, { method: 'POST', body: { revision: corrected.revision } })
})

test('an existing database keeps attendance and lets staff finish an open entry after a PIN reset', async t => {
  const folder = mkdtempSync(join(import.meta.dirname, '.migration-test-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const path = join(folder, 'before.sqlite')
  const address = await encrypt(secret, staff.address, 'legacy:address')
  const legacyCode = '071234'
  const codeHash = await digest(secret, 'code', legacyCode)
  const old = new DatabaseSync(path)
  old.exec(readFileSync(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8'))
  old.exec('PRAGMA user_version = 1')
  old.prepare('INSERT INTO staff (id, name, role, phone, address_encrypted, code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('legacy', staff.name, staff.role, staff.phone, address, codeHash, base - 6 * hours)
  old.prepare('INSERT INTO time_entries (id, staff_id, clock_in, original_in) VALUES (?, ?, ?, ?)')
    .run('legacy-open', 'legacy', base - 2 * hours, base - 2 * hours)
  old.close()

  const DB = openSqlite(path)
  const { auth, call, ok } = await fixture(t, { DB })
  await auth()
  assert.equal((await ok('/staff/legacy')).codeDigits, 6)
  assert.equal((await ok('/staff/legacy')).address, staff.address)
  assert.deepEqual((await ok('/entries/legacy-open/signatures')).signatures, [])
  assert.equal((await ok('/workspace')).entries[0].clockIn, base - 2 * hours)
  assert.equal((await call('/clock/lookup', { method: 'POST', body: { code: legacyCode }, owner: false })).status, 401)
  await ok('/staff/legacy', { method: 'PATCH', body: { ...staff, code: '', niss: undefined } })
  assert.equal((await ok('/staff/legacy')).codeDigits, 6)
  await ok('/staff/legacy', { method: 'PATCH', body: { ...staff, niss: undefined } })
  assert.equal((await ok('/staff/legacy')).codeDigits, 4)
  const active = (await ok('/clock/lookup', { method: 'POST', body: { code: staff.code }, owner: false })).active
  assert.equal(active.id, 'legacy-open')
  const closed = await ok('/clock/punch', { method: 'POST', owner: false, body: {
    code: staff.code, action: 'out', entryId: active.id, signature: outSignature,
  } })
  assert.equal(closed.duration, 2 * hours)
  assert.deepEqual((await ok('/entries/legacy-open/signatures')).signatures, [{ action: 'out', at: base, strokes: outSignature }])
})

test('staff hours split completed entries across calendar periods and reflect approval and corrections', async t => {
  const { auth, call, ok } = await fixture(t)
  await auth()
  const { id: staffId } = await ok('/staff', { method: 'POST', body: staff })
  const { id: other } = await ok('/staff', { method: 'POST', body: { ...staff, name: 'Other Staff', code: '0124' } })
  const manual = (clockIn, clockOut, member = staffId) => ok('/entries', { method: 'POST', body: {
    staffId: member, clockIn: fromLocal(clockIn), clockOut: clockOut ? fromLocal(clockOut) : null, reason: 'Sample hours',
  } })
  const approved = await manual('2025-12-31T23:00', '2026-01-01T02:00')
  await ok(`/entries/${approved.id}/approve`, { method: 'POST', body: { revision: 1 } })
  await manual('2026-01-04T23:00', '2026-01-05T03:00')
  await manual('2026-03-29T01:30', '2026-03-29T04:30')
  await manual('2026-11-19T10:00', null)
  await manual('2026-01-04T08:00', '2026-01-04T13:00', other)
  await ok('/staff/' + other, { method: 'PATCH', body: { ...staff, name: 'Other Staff', code: '', active: false } })
  const totals = async query => {
    const result = await ok('/workspace?' + query)
    return result.hours.totals.find(row => row.staffId === staffId)
  }
  assert.equal((await call('/workspace?hours=year', { owner: false })).status, 401)
  assert.equal((await call('/workspace?hours=invalid')).status, 400)
  assert.equal((await call('/workspace?hours=month&date=2026-02-30')).status, 400)
  assert.deepEqual(await totals('week=2026-01-01&hours=week'), { staffId, recorded: 4 * hours, approved: 3 * hours })
  assert.deepEqual(await totals('week=2026-01-05&hours=week'), { staffId, recorded: 3 * hours, approved: 0 })
  assert.deepEqual(await totals('hours=month&date=2026-01-18'), { staffId, recorded: 6 * hours, approved: 2 * hours })
  assert.deepEqual(await totals('hours=month&date=2026-03-02'), { staffId, recorded: 2 * hours, approved: 0 })
  assert.deepEqual(await totals('hours=year&date=2025-06-16'), { staffId, recorded: hours, approved: hours })
  assert.deepEqual(await totals('hours=year&date=2026-08-21'), { staffId, recorded: 8 * hours, approved: 2 * hours })
  const january = await ok('/workspace?hours=month&date=2026-01-18')
  assert.equal(january.hours.key, '2026-01-01')
  assert.ok(january.staff.some(member => member.id === other && !member.active))
  assert.deepEqual(january.hours.totals.find(row => row.staffId === other), { staffId: other, recorded: 5 * hours, approved: 0 })
  assert.deepEqual((await ok('/workspace?hours=month&date=2026-11-01')).hours.totals, [])
  await ok(`/entries/${approved.id}`, { method: 'PATCH', body: {
    revision: 2, clockIn: fromLocal('2025-12-31T23:00'), clockOut: fromLocal('2026-01-01T01:00'), reason: 'Corrected end time',
  } })
  assert.deepEqual(await totals('hours=year&date=2026-08-21'), { staffId, recorded: 7 * hours, approved: 0 })
})

test('only shared shift versions are visible in the staff clock', async t => {
  const { auth, ok, call } = await fixture(t)
  await auth()
  const { id: staffId } = await ok('/staff', { method: 'POST', body: staff })
  const clock = () => ok('/clock/lookup', { method: 'POST', body: { code: staff.code }, owner: false })
  const shift = { staffId, startAt: base + hours, endAt: base + 8 * hours, role: 'Service', note: 'Use reception door.' }
  const { id } = await ok('/shifts', { method: 'POST', body: shift })
  const publish = () => ok('/shifts/publish', { method: 'POST', body: { ids: [id] } })
  assert.equal((await clock()).shifts.length, 0)
  assert.equal((await call('/shifts', { method: 'POST', body: shift })).status, 409)
  assert.equal((await publish()).published, 1)
  assert.equal((await clock()).shifts[0].endAt, shift.endAt)
  assert.equal((await publish()).published, 0)
  await ok('/shifts/' + id, { method: 'PATCH', body: { ...shift, endAt: base + 9 * hours, revision: 1 } })
  assert.equal((await clock()).shifts[0].endAt, shift.endAt)
  assert.equal((await publish()).published, 1)
  assert.equal((await clock()).shifts[0].endAt, base + 9 * hours)
  await ok('/shifts/' + id, { method: 'DELETE', body: { revision: 2 } })
  assert.equal((await clock()).shifts.length, 0)
})

test('SMS submissions use the messaging provider and are reserved once per shift revision', async t => {
  let calls = 0
  const sendSms = async (url, options) => {
    calls++
    assert.match(url, /api\.twilio\.com.*Messages\.json/)
    assert.equal(options.body.get('To'), '+32470112233')
    assert.equal(options.body.get('MessagingServiceSid'), 'test-service')
    return Response.json({ sid: 'test-message', status: 'queued' }, { status: 201 })
  }
  const { auth, ok } = await fixture(t, {
    TWILIO_ACCOUNT_SID: 'test-account', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_MESSAGING_SERVICE_SID: 'test-service',
  }, { sendSms })
  await auth()
  const { id: staffId } = await ok('/staff', { method: 'POST', body: staff })
  const { id } = await ok('/shifts', { method: 'POST', body: {
    staffId, startAt: base + hours, endAt: base + 2 * hours, role: 'Service',
  } })
  const send = () => ok('/shifts/publish', { method: 'POST', body: { ids: [id], sms: true } })
  const [first] = await Promise.all([send(), send()])
  assert.ok(['queued', 'submitting'].includes(first.messages[0].status))
  assert.equal((await send()).messages[0].status, 'queued')
  assert.equal(calls, 1)
})

test('invalid clock codes are rate-limited and Brussels daylight-saving times are explicit', async t => {
  const { auth, ok, call, nextClient } = await fixture(t)
  await auth()
  await ok('/staff', { method: 'POST', body: staff })
  for (let i = 0; i < 8; i++) assert.equal((await call('/clock/lookup', { method: 'POST', body: { code: '0001' } })).status, 401)
  assert.equal((await call('/clock/lookup', { method: 'POST', body: { code: staff.code } })).status, 429)
  nextClient()
  assert.equal((await ok('/clock/lookup', { method: 'POST', body: { code: staff.code } })).name, 'Aline')
  assert.throws(() => fromLocal('2026-03-29T02:30'), /when the clocks change/)
  assert.equal(fromLocal('2026-10-25T02:30', 1) - fromLocal('2026-10-25T02:30', 0), hours)
  const [start, end] = weekRange('2026-03-23')
  assert.equal(dateKey(start), '2026-03-23')
  assert.equal(end - start, (7 * 24 - 1) * hours)
})

test('private hosted workspace binds the owner and seeds only sample data', async t => {
  const { call, ok } = await fixture(t, { SITE_OWNER_ONLY: '1', DEMO_MODE: '1' })
  const owner = { 'oai-authenticated-user-id': 'test-owner' }
  const visitor = { 'oai-authenticated-user-id': 'test-visitor' }
  assert.equal((await call('/workspace')).status, 401)
  assert.equal((await ok('/session', { headers: owner })).authenticated, true)
  assert.equal((await call('/workspace', { headers: visitor })).status, 401)
  const data = await ok('/workspace', { headers: owner })
  assert.ok(data.staff.length > 0)
  assert.ok(data.entries.length > 0)
  assert.ok(data.shifts.length > 0)
  assert.equal((await ok('/clock/lookup', { method: 'POST', body: { code: '2580' } })).name, 'Amira')
  assert.equal((await call('/staff', { method: 'POST', body: staff, headers: owner })).status, 400)
})
