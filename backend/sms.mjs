import { shortDate, timeText, dateKey } from '../shared/time.mjs'

export const smsEnabled = env => env.DEMO_MODE !== '1' && Boolean(
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID,
)

export async function submitShiftSms(db, env, shift, now, send = fetch) {
  const { id, revision, phone, startAt, endAt, role } = shift
  const reserved = await db.run(`
    INSERT INTO shift_messages (shift_id, revision, status, attempted_at)
    VALUES (?, ?, 'submitting', ?)
    ON CONFLICT (shift_id, revision) DO UPDATE SET status = 'submitting', attempted_at = excluded.attempted_at
    WHERE shift_messages.status = 'failed'
  `, id, revision, now)
  if (!reserved) {
    const existing = await db.one('SELECT status FROM shift_messages WHERE shift_id = ? AND revision = ?', id, revision)
    return existing.status
  }

  let status = 'uncertain'
  let providerId = null
  const end = dateKey(startAt) === dateKey(endAt) ? timeText(endAt) : `${shortDate(endAt)} ${timeText(endAt)}`
  try {
    const response = await send(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: phone,
        MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
        Body: `French Tacos Antwerp: ${shortDate(startAt)} ${timeText(startAt)}–${end} (Brussels), ${role}. Check your staff clock for the schedule.`,
      }),
      signal: AbortSignal.timeout(7_000),
    })
    if (response.ok) {
      const payload = await response.json()
      providerId = payload.sid ?? null
      status = ['failed', 'undelivered'].includes(payload.status) ? 'failed' : (providerId ? 'queued' : 'uncertain')
    } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      status = 'failed'
    }
  } catch {
    // A timeout can occur after a provider accepts a message. Keep that submission reserved.
  }
  await db.run('UPDATE shift_messages SET status = ?, provider_id = ? WHERE shift_id = ? AND revision = ?',
    status, providerId, id, revision)
  return status
}
