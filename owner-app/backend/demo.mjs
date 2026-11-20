import { dateKey, fromLocal, plusDays, weekKey } from '../shared/time.mjs'
import { CLOCK_CODE_LENGTH } from '../shared/clock.mjs'
import { digest, encrypt } from './security.mjs'

const demoStaff = [
  ['amira', 'Amira Vermeulen', 'Front of house', '258014'],
  ['louis', 'Louis De Smet', 'Kitchen', '310572'],
  ['noor', 'Noor Peeters', 'Bar', '427103'],
  ['emma', 'Emma Jacobs', 'Front of house', '518426'],
  ['youssef', 'Youssef El Idrissi', 'Kitchen', '608397'],
  ['lina', 'Lina Dubois', 'Bar', '704215'],
]
const unseeded = "NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded')"
const recordPinUpdate = ["INSERT INTO settings (key, value) VALUES ('demo_four_digit_codes', '1') ON CONFLICT DO NOTHING"]
const hour = 3_600_000

async function updateDemoPins(db, key) {
  if (await db.one("SELECT value FROM settings WHERE key = 'demo_four_digit_codes'")) return
  const changes = await Promise.all(demoStaff.map(async ([id, , , oldCode]) => {
    const [previous, next] = await Promise.all([digest(key, 'code', oldCode), digest(key, 'code', oldCode.slice(0, CLOCK_CODE_LENGTH))])
    return [`UPDATE staff SET code_hash = ?, code_digits = ? WHERE id = ? AND code_digits = 6 AND code_hash = ?
      AND NOT EXISTS (SELECT 1 FROM staff WHERE code_hash = ?)`, next, CLOCK_CODE_LENGTH, id, previous, next]
  }))
  await db.batch([...changes, recordPinUpdate])
}

export async function seedDemo(db, key, now) {
  if (await db.one("SELECT value FROM settings WHERE key = 'demo_seeded'")) return updateDemoPins(db, key)
  const today = dateKey(now)
  const week = weekKey(today)
  const at = (day, time) => fromLocal(day + 'T' + time)
  const statements = await Promise.all(demoStaff.map(async ([id, name, role, code], i) => [
    `INSERT INTO staff (id, name, role, phone, address_encrypted, code_hash, code_digits, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${unseeded}`,
    id, name, role, '+3200000000' + i,
    await encrypt(key, 'Demo address · Brussels', id + ':address'),
    await digest(key, 'code', code.slice(0, CLOCK_CODE_LENGTH)), CLOCK_CODE_LENGTH, now,
  ]))
  const historical = [
    ['amira', 0, '09:00', '17:00', true], ['louis', 0, '10:00', '18:00', true],
    ['noor', 1, '12:00', '19:00', true], ['emma', 1, '09:00', '16:30', false],
    ['youssef', 2, '08:00', '15:00', false], ['lina', 2, '11:00', '17:30', true],
  ]
  for (const [id, offset, from, to, approved] of historical) {
    const day = plusDays(week, offset)
    const start = at(day, from)
    const end = at(day, to)
    if (end >= now) continue
    statements.push([
      `INSERT INTO time_entries (id, staff_id, clock_in, clock_out, original_in, original_out, approved_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${unseeded}`,
      'history-' + id, id, start, end, start, end, approved ? end + 60_000 : null,
    ])
  }
  for (const [id, start] of [['louis', now - 2.1 * hour], ['noor', now - 0.9 * hour]]) {
    const clockIn = Math.floor(start)
    if (statements.some(statement => statement[1] === 'history-' + id && statement[4] > clockIn)) continue
    statements.push([
      `INSERT INTO time_entries (id, staff_id, clock_in, original_in)
       SELECT ?, ?, ?, ? WHERE ${unseeded}`, 'live-' + id, id, clockIn, clockIn,
    ])
  }
  const planned = [
    ['amira', 0, '09:00', '16:00', true], ['louis', 0, '10:00', '18:00', true],
    ['noor', 1, '12:00', '19:00', true], ['emma', 2, '09:00', '16:00', true],
    ['louis', 3, '10:00', '18:00', true], ['noor', 3, '12:00', '19:00', true],
    ['youssef', 4, '10:00', '17:00', false], ['lina', 4, '12:00', '18:00', false],
    ['amira', 5, '09:00', '16:00', false], ['emma', 6, '10:00', '16:00', false],
  ]
  for (const [i, row] of planned.entries()) {
    const [staffId, index, from, to, published] = row
    const id = 'plan-' + i
    const day = plusDays(week, index)
    const role = demoStaff.find(member => member[0] === staffId)[2]
    const start = at(day, from)
    const end = at(day, to)
    const note = staffId === 'amira' && index === 5 ? 'Please arrive at the main entrance.' : ''
    statements.push([
      `INSERT INTO shifts (id, staff_id, start_at, end_at, role, note)
       SELECT ?, ?, ?, ?, ?, ? WHERE ${unseeded}`, id, staffId, start, end, role, note,
    ])
    if (published || staffId === 'amira') statements.push([
      `INSERT INTO published_shifts (shift_id, staff_id, start_at, end_at, role, note, revision, published_at)
       SELECT ?, ?, ?, ?, ?, ?, 1, ? WHERE ${unseeded}`, id, staffId, start, end, role, note, now,
    ])
  }
  statements.push(["INSERT INTO settings (key, value) VALUES ('demo_seeded', '1') ON CONFLICT DO NOTHING"], recordPinUpdate)
  await db.batch(statements)
}
