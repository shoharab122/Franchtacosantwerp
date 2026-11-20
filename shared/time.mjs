export const ZONE = 'Europe/Brussels'
export const locale = 'en-GB'
const minute = 60_000
const day = 86_400_000
const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function parts(date) {
  return Object.fromEntries(partsFormat.formatToParts(date).map(piece => [piece.type, piece.value]))
}

export function dateKey(date = Date.now()) {
  const p = parts(date)
  return `${p.year}-${p.month}-${p.day}`
}

export function localValue(date) {
  if (date == null) return ''
  const p = parts(date)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function localCandidates(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return []
  const naive = Date.parse(value + ':00Z')
  if (!Number.isFinite(naive)) return []
  const offsets = new Set([naive - day, naive, naive + day].map(sample => {
    const p = parts(sample)
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - sample
  }))
  return [...offsets].map(offset => naive - offset)
    .filter(candidate => localValue(candidate) === value).sort((a, b) => a - b)
}

export function fromLocal(value, occurrence = 0) {
  const possibilities = localCandidates(value)
  if (!possibilities.length) throw new Error('Enter a valid Brussels date and time. Times skipped when the clocks change cannot be used.')
  return possibilities[occurrence] ?? possibilities[0]
}

export function plusDays(key, count) {
  return new Date(Date.parse(key + 'T12:00:00Z') + count * day).toISOString().slice(0, 10)
}

export function plusMonths(key, count) {
  const date = new Date(key.slice(0, 7) + '-01T12:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + count)
  return date.toISOString().slice(0, 10)
}

export function weekKey(key = dateKey()) {
  const weekday = new Date(key + 'T12:00:00Z').getUTCDay()
  return plusDays(key, -((weekday + 6) % 7))
}

export function weekRange(key) {
  return [fromLocal(key + 'T00:00'), fromLocal(plusDays(key, 7) + 'T00:00')]
}

export function periodStart(period, key) {
  if (period === 'year') return key.slice(0, 4) + '-01-01'
  if (period === 'month') return key.slice(0, 7) + '-01'
  return weekKey(key)
}

export function durationText(milliseconds, { empty = '0h', pad = false } = {}) {
  const total = Math.max(0, Math.round(milliseconds / minute))
  if (!total && !pad) return empty
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (!pad && !hours) return `${minutes}m`
  if (!pad && !minutes) return `${hours}h`
  return `${hours}h ${pad ? String(minutes).padStart(2, '0') : minutes}m`
}

export function dateFormat(date, options) {
  return new Intl.DateTimeFormat(locale, { timeZone: ZONE, ...options }).format(date)
}

export const shortDate = date => dateFormat(date, { day: 'numeric', month: 'short' })
export const fullDate = date => dateFormat(date, { weekday: 'long', day: 'numeric', month: 'long' })
export const timeText = date => date == null ? '—' : dateFormat(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const dayDate = key => fromLocal(key + 'T12:00')

export function weekLabel(key) {
  const start = dayDate(key)
  const end = dayDate(plusDays(key, 6))
  const year = dateFormat(end, { year: 'numeric' })
  const sameMonth = dateFormat(start, { year: 'numeric', month: 'numeric' }) === dateFormat(end, { year: 'numeric', month: 'numeric' })
  return `${sameMonth ? dateFormat(start, { day: 'numeric' }) : shortDate(start)}–${shortDate(end)} ${year}`
}

export function durationInRange(entry, start, end) {
  if (entry.clockOut == null) return 0
  return Math.max(0, Math.min(entry.clockOut, end) - Math.max(entry.clockIn, start))
}
