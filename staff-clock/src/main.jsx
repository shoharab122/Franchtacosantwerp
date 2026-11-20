import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CalendarDays, Check, ChevronLeft, Clock3, Delete, LogIn, LogOut, ShieldCheck } from 'lucide-react'
import { api } from '../shared/client.mjs'
import {
  CLOCK_CODE_LENGTH, CLOCK_CODE_PATTERN, hasSignature, isClockCode,
  SIGNATURE_WIDTH, SIGNATURE_HEIGHT, SIGNATURE_MAX_POINTS, signaturePath,
} from '../shared/clock.mjs'
import { dateKey, fullDate, shortDate, timeText, durationText } from '../shared/time.mjs'
import '../shared/base.css'
import './clock.css'

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'delete']

function ClockFace({ now }) {
  return <section className="clock-face" aria-label="Current local time">
    <div className="brand"><img src="/brand.svg" alt="" />French Tacos Antwerp</div>
    <div className="clock-rings" aria-hidden="true"><i /><i /><i /><i /><b /><b /><b /></div>
    <div className="clock-wall">
      <p className="clock-zone"><span />Brussels local time</p>
      <time className="wall-time" dateTime={new Date(now).toISOString()}>{timeText(now)}</time>
      <p className="wall-date">{fullDate(now)}</p>
    </div>
  </section>
}

function CodeEntry({ code, setCode, submit, busy, error }) {
  const input = useRef(null)
  useEffect(() => { input.current?.focus({ preventScroll: true }) }, [])
  const press = key => {
    setCode(previous => key === 'clear' ? '' : (key === 'delete' ? previous.slice(0, -1) : (previous + key).slice(0, CLOCK_CODE_LENGTH)))
  }
  return <form className="clock-card code-card" onSubmit={submit}>
    <header><span className="clock-card-icon"><Clock3 size={23} /></span>
      <h1>Clock in or out</h1><p>Enter your 4-digit staff PIN to continue.</p></header>
    <div className="code-group">
      <label className="visually-hidden" htmlFor="staff-code">Staff PIN</label>
      <input id="staff-code" ref={input} className="code-input" inputMode="none" aria-describedby={error ? 'clock-error' : undefined}
        type="password" pattern={CLOCK_CODE_PATTERN} maxLength={CLOCK_CODE_LENGTH} autoComplete="off" value={code} disabled={busy}
        onChange={event => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, CLOCK_CODE_LENGTH))} />
      <div className="code-slots" style={{ '--code-length': CLOCK_CODE_LENGTH }} aria-hidden="true">{Array.from({ length: CLOCK_CODE_LENGTH }, (_, index) => <span key={index} className={index < code.length ? 'code-filled' : ''} />)}</div>
    </div>
    {error && <p className="error-message" id="clock-error" role="alert">{error}</p>}
    <div className="keypad" aria-label="Staff code keypad">
      {keys.map(key => <button key={key} type="button" className={`key ${key.length > 1 ? 'key-utility' : ''}`} onClick={() => press(key)}
        aria-label={key === 'delete' ? 'Backspace' : key === 'clear' ? 'Clear code' : key} disabled={busy}>
        {key === 'delete' ? <Delete size={21} /> : key === 'clear' ? 'Clear' : key}
      </button>)}
    </div>
    <button className="clock-primary" type="submit" disabled={!isClockCode(code) || busy}>{busy ? 'Checking PIN…' : 'Continue'}</button>
  </form>
}

function SignaturePad({ strokes, setStrokes, busy }) {
  const pointer = useRef(null)
  const count = useRef(0)

  const addPoints = (event, start = false) => {
    const sample = event.nativeEvent
    const samples = start ? [sample] : (sample.getCoalescedEvents?.() || [])
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect()
    const points = (samples.length ? samples : [sample]).slice(0, SIGNATURE_MAX_POINTS - count.current).map(point => [
      Math.round(Math.max(0, Math.min(SIGNATURE_WIDTH, (point.clientX - left) * SIGNATURE_WIDTH / width))),
      Math.round(Math.max(0, Math.min(SIGNATURE_HEIGHT, (point.clientY - top) * SIGNATURE_HEIGHT / height))),
    ])
    if (!points.length) return
    count.current += points.length
    setStrokes(previous => start ? [...previous, points] : [...previous.slice(0, -1), [...previous.at(-1), ...points]])
  }

  const startStroke = event => {
    if (busy || event.button !== 0 || pointer.current !== null || count.current >= SIGNATURE_MAX_POINTS) return
    event.preventDefault()
    pointer.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    addPoints(event, true)
  }
  const moveStroke = event => {
    if (!busy && pointer.current === event.pointerId) addPoints(event)
  }
  const endStroke = event => {
    if (pointer.current === event.pointerId) pointer.current = null
  }
  const finishStroke = event => {
    moveStroke(event)
    endStroke(event)
  }
  const clear = () => {
    pointer.current = null
    count.current = 0
    setStrokes([])
  }

  return <div className="signature-field">
    <div className="signature-header"><h2 id="signature-label">Signature</h2>
      <button type="button" aria-label="Clear signature" onClick={clear} disabled={busy || !strokes.length}>Clear</button></div>
    <p>Sign with your finger, a pen, or the mouse.</p>
    <svg className="signature-pad" viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`} preserveAspectRatio="none"
      role="img" aria-labelledby="signature-label" onPointerDown={startStroke} onPointerMove={moveStroke}
      onPointerUp={finishStroke} onPointerCancel={endStroke} onLostPointerCapture={endStroke}>
      <line x1="10" y1="90" x2="350" y2="90" className="signature-guide"/>
      <path className="signature-ink" d={signaturePath(strokes)}/>
    </svg>
  </div>
}

function ClockReview({ staff, now, reset, submit, busy, error, strokes, setStrokes }) {
  const isActive = Boolean(staff.active)
  const Icon = isActive ? LogOut : LogIn
  return <section className="clock-card review-card">
    <div className="clock-card-icon"><Clock3 size={23} /></div>
    <h1>Hello, {staff.name}</h1>
    <p>{isActive ? `You clocked in at ${timeText(staff.active.clockIn)}${dateKey(staff.active.clockIn) !== dateKey(now) ? ' on ' + shortDate(staff.active.clockIn) : ''}.` : 'You’re currently clocked out.'}</p>
    <SignaturePad strokes={strokes} setStrokes={setStrokes} busy={busy}/>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="clock-primary" type="button" onClick={submit} disabled={busy || !hasSignature(strokes)}><Icon size={19}/>{busy ? 'Saving…' : (isActive ? 'Sign and clock out' : 'Sign and clock in')}</button>
    <div className="staff-shifts">
      <h2><CalendarDays size={19}/>Your shared shifts</h2>
      {staff.shifts.length ? <ul>{staff.shifts.map(shift => <li key={shift.id}>
        <strong>{fullDate(shift.startAt)}</strong><span>{timeText(shift.startAt)}–{dateKey(shift.startAt) === dateKey(shift.endAt) ? '' : shortDate(shift.endAt) + ' '}{timeText(shift.endAt)} · {shift.role}</span>
        {shift.note && <small>{shift.note}</small>}
      </li>)}</ul> : <p>No upcoming shifts have been shared.</p>}
    </div>
    <button type="button" className="clock-back" onClick={reset} disabled={busy}><ChevronLeft size={18}/>Finish and clear screen</button>
  </section>
}

function ClockSuccess({ result, reset }) {
  const isOut = result.action === 'out'
  return <section className="clock-card success-card">
    <span className="clock-card-icon clock-success"><Check size={32}/></span>
    <h1>Clocked {isOut ? 'out' : 'in'}</h1>
    <p>{result.name}, your time was recorded at {timeText(result.at)}.</p>
    {isOut && <p className="worked">Time worked <strong>{durationText(result.duration)}</strong></p>}
    <button className="clock-primary" type="button" onClick={reset}>Done</button>
  </section>
}

function App() {
  const [now, setNow] = useState(Date.now)
  const [code, setCode] = useState('')
  const [staff, setStaff] = useState(null)
  const [signature, setSignature] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const current = useRef(null)
  const reset = useCallback(() => {
    current.current?.abort()
    current.current = null
    setBusy(false)
    setCode('')
    setStaff(null)
    setSignature([])
    setResult(null)
    setError('')
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    const leave = () => { if (document.hidden) reset() }
    document.addEventListener('visibilitychange', leave)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', leave) }
  }, [reset])

  useEffect(() => {
    if ((!staff && !result && !code) || busy) return undefined
    const timeout = setTimeout(reset, result ? 7_000 : 35_000)
    return () => clearTimeout(timeout)
  }, [staff, result, code, signature, busy, reset])

  const send = async action => {
    if (current.current || !isClockCode(code) || (action === 'punch' && !hasSignature(signature))) return
    const controller = new AbortController()
    current.current = controller
    setError('')
    setBusy(true)
    const timeout = setTimeout(() => controller.abort('timeout'), 15_000)
    try {
      if (action === 'lookup') {
        const details = await api('/clock/lookup', { method: 'POST', body: { code }, signal: controller.signal })
        if (current.current === controller) setStaff(details)
      } else {
        const details = await api('/clock/punch', {
          method: 'POST', body: { code, action: staff.active ? 'out' : 'in', entryId: staff.active?.id, signature }, signal: controller.signal,
        })
        if (current.current === controller) { setResult(details); setCode(''); setStaff(null); setSignature([]) }
      }
    } catch (cause) {
      if (current.current !== controller) return
      if (controller.signal.aborted || [401, 409, 429].includes(cause.status)) { setCode(''); setStaff(null); setSignature([]) }
      setError(controller.signal.aborted ? 'The connection timed out. Enter your PIN to check your current clock status.' : cause.message)
    } finally {
      clearTimeout(timeout)
      if (current.current === controller) { current.current = null; setBusy(false) }
    }
  }

  return <main className="staff-clock">
    <ClockFace now={now}/>
    <section className="clock-content">
      <div className="clock-top"><span className="station-dot"/>Staff clock</div>
      <div className="clock-stage">
        {result ? <ClockSuccess result={result} reset={reset}/> : staff ?
          <ClockReview staff={staff} now={now} reset={reset} busy={busy} error={error}
            strokes={signature} setStrokes={setSignature} submit={() => void send('punch')}/> :
          <CodeEntry code={code} setCode={setter => { if (error) setError(''); setCode(setter) }} busy={busy} error={error}
            submit={event => { event.preventDefault(); void send('lookup') }}/>}
      </div>
      <footer className="clock-footer"><ShieldCheck size={16} />Your PIN is personal. Ask your employer if you need help.</footer>
    </section>
  </main>
}

createRoot(document.getElementById('root')).render(<App/>)
