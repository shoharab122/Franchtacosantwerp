import { dateKey, weekKey } from '../shared/time.mjs'
import { hasSignature, isClockCode, SIGNATURE_WIDTH, SIGNATURE_HEIGHT, SIGNATURE_MAX_POINTS } from '../shared/clock.mjs'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function fail(status, message) {
  throw new ApiError(status, message)
}

export function text(value, label, max, required = true) {
  const clean = typeof value === 'string' ? value.trim() : ''
  if ((required && !clean) || clean.length > max) fail(400, `${label} must contain ${required ? '1–' : 'up to '}${max} characters.`)
  return clean
}

export function phone(value) {
  const original = text(value, 'Phone number', 40)
  let clean = original.replace(/[\s.()/-]/g, '')
  if (clean.startsWith('00')) clean = '+' + clean.slice(2)
  else if (clean.startsWith('0')) clean = '+32' + clean.slice(1)
  if (!/^\+[1-9]\d{7,14}$/.test(clean)) fail(400, 'Enter a Belgian phone number or use an international number beginning with +.')
  return clean
}

export function niss(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') fail(400, 'The social security number must contain 11 digits.')
  const clean = value.replace(/[ .-]/g, '')
  if (!/^\d{11}$/.test(clean)) fail(400, 'The social security number must contain 11 digits.')
  return clean
}

export function pin(value) {
  if (!isClockCode(value)) fail(400, 'The clock PIN must contain four digits.')
  return value
}

export function signature(value) {
  const invalid = () => fail(400, 'Draw your signature before clocking in or out.')
  if (!Array.isArray(value) || !value.length) invalid()
  let points = 0
  for (const stroke of value) {
    if (!Array.isArray(stroke) || !stroke.length) invalid()
    points += stroke.length
    if (points > SIGNATURE_MAX_POINTS || !stroke.every(point => Array.isArray(point) && point.length === 2 &&
      Number.isInteger(point[0]) && point[0] >= 0 && point[0] <= SIGNATURE_WIDTH &&
      Number.isInteger(point[1]) && point[1] >= 0 && point[1] <= SIGNATURE_HEIGHT)) invalid()
  }
  if (!hasSignature(value)) invalid()
  return value
}

export function stamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 946684800000 || value >= 4133980800000) fail(400, `Enter a valid ${label}.`)
  return value
}

export function revisions(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail(400, 'A record revision is required.')
  return value
}

export function validWeek(value, now) {
  if (!value) return weekKey(dateKey(now))
  return weekKey(validDate(value, 'week'))
}

export function validDate(value, label = 'date') {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) fail(400, `Choose a valid ${label}.`)
  const date = Date.parse(value + 'T12:00:00Z')
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value) fail(400, `Choose a valid ${label}.`)
  return value
}
