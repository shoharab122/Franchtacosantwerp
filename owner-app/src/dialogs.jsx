import { useEffect, useState } from 'react'
import { CalendarDays, Check, LockKeyhole, Send, ShieldCheck, UserPlus } from 'lucide-react'
import { api } from '../shared/client.mjs'
import { CLOCK_CODE_LENGTH, CLOCK_CODE_PATTERN, SIGNATURE_WIDTH, SIGNATURE_HEIGHT, signaturePath } from '../shared/clock.mjs'
import { dateFormat, durationText, fromLocal, localValue, shortDate, timeText } from '../shared/time.mjs'
import { Avatar, Badge, Button, EmptyState, Field, Modal, Select, startLocal, statusOfShift, TimeField } from './ui.jsx'

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async action => {
    if (busy) return
    setError('')
    setBusy(true)
    try { await action() } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }
  return { busy, error, run }
}

function ErrorBox({ message }) {
  return message ? <p className="error-message" role="alert">{message}</p> : null
}

export function StaffDialog({ person, close, done, demo }) {
  const [staff, setStaff] = useState(person ? null : { name: '', role: '', phone: '', address: '', active: 1 })
  const [loadError, setLoadError] = useState('')
  const [code, setCode] = useState('')
  const [national, setNational] = useState('')
  const [clearNational, setClearNational] = useState(false)
  const [revealedNumber, setRevealedNumber] = useState('')
  const { busy, error, run } = useAction()
  const cancel = () => { if (!busy) close() }
  useEffect(() => {
    if (!person) return undefined
    const controller = new AbortController()
    api('/staff/' + person.id, { signal: controller.signal }).then(setStaff)
      .catch(err => { if (err.name !== 'AbortError') setLoadError(err.message) })
    return () => controller.abort()
  }, [person])

  const change = (property, value) => setStaff(previous => ({ ...previous, [property]: value }))
  const needsPin = person && staff?.codeDigits !== CLOCK_CODE_LENGTH
  const submit = event => {
    event.preventDefault()
    void run(async () => {
      const body = { name: staff.name, role: staff.role, phone: staff.phone, address: staff.address, active: Boolean(staff.active), code }
      if (national || clearNational) body.niss = clearNational ? '' : national
      await api(person ? '/staff/' + person.id : '/staff', { method: person ? 'PATCH' : 'POST', body })
      done(person ? 'Staff details updated.' : 'Staff member added.')
    })
  }
  const reveal = () => {
    if (revealedNumber) setRevealedNumber('')
    else void run(async () => setRevealedNumber((await api('/staff/' + person.id + '/niss')).niss ?? ''))
  }
  return <Modal title={person ? 'Edit staff member' : 'Add staff member'} onClose={cancel}>
    {!staff ? <div className="modal-body"><ErrorBox message={loadError} />{!loadError && <p className="muted" role="status">Loading staff details…</p>}</div> :
    <form onSubmit={submit}>
      <div className="modal-body form-stack">
        <div className="form-columns">
          <Field label="Full name">{id => <input id={id} value={staff.name} autoComplete="off" maxLength={100} required onChange={e => change('name', e.target.value)} />}</Field>
          <Field label="Role (optional)">{id => <input id={id} value={staff.role} maxLength={60} placeholder="e.g. Kitchen" onChange={e => change('role', e.target.value)} />}</Field>
        </div>
        <Field label="Phone number">{id => <input id={id} type="tel" value={staff.phone} autoComplete="off" maxLength={40} required placeholder="+32" onChange={e => change('phone', e.target.value)} />}</Field>
        <Field label="Address">{id => <textarea id={id} rows={2} value={staff.address} autoComplete="off" maxLength={350} required onChange={e => change('address', e.target.value)} />}</Field>
        <Field label="Belgian social security number (NISS/INSZ)"
          help={demo ? 'Available in a configured workspace.' : 'Optional. Stored encrypted and visible only to the owner.'}>
          {(id, describedBy) => <div className="field-inline">
            <input id={id} aria-describedby={describedBy} value={national} autoComplete="off" inputMode="numeric" maxLength={17}
              placeholder={staff.nissLastFour ? '••••••• ' + staff.nissLastFour : '11 digits'} disabled={demo || clearNational} onChange={e => setNational(e.target.value)} />
            {staff.nissLastFour && !clearNational && <Button onClick={reveal} disabled={busy}>{revealedNumber ? 'Hide' : 'Reveal'}</Button>}
          </div>}
        </Field>
        {revealedNumber && !clearNational && <p className="notice"><ShieldCheck size={17} /><span className="national-value">{revealedNumber}</span></p>}
        {staff.nissLastFour && <label className="check-line"><input type="checkbox" checked={clearNational} onChange={e => setClearNational(e.target.checked)} />Remove the saved number</label>}
        <Field label={person ? 'New 4-digit clock PIN' : '4-digit clock PIN'}
          help={needsPin ? 'Set a new PIN to enable clock access for this staff member.' : person ? 'Leave blank to keep the current PIN.' : 'Share this PIN privately with this staff member.'}>
          {(id, describedBy) => <input id={id} aria-describedby={describedBy} inputMode="numeric" autoComplete="off"
            maxLength={CLOCK_CODE_LENGTH} minLength={CLOCK_CODE_LENGTH} pattern={CLOCK_CODE_PATTERN} required={!person}
            type="password" value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))} />}
        </Field>
        {person && <label className="check-line"><input type="checkbox" checked={Boolean(staff.active)} onChange={e => change('active', e.target.checked ? 1 : 0)} />Allow clock access</label>}
        <ErrorBox message={error} />
      </div>
      <footer className="modal-footer"><Button onClick={cancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" icon={person ? Check : UserPlus} disabled={busy}>{busy ? 'Saving…' : (person ? 'Save staff' : 'Add staff')}</Button></footer>
    </form>}
  </Modal>
}

export function ShiftDialog({ data, shift, day, staffId, close, done, open }) {
  const initialDate = day ?? (data.today >= data.week ? data.today : data.week)
  const currentDay = initialDate < data.week || initialDate >= localValue(data.end).slice(0, 10) ? data.week : initialDate
  const [owner, setOwner] = useState(shift?.staffId ?? staffId ?? '')
  const [start, setStart] = useState(() => shift ? startLocal(shift.startAt) : { value: currentDay + 'T09:00', occurrence: 0 })
  const [end, setEnd] = useState(() => shift ? startLocal(shift.endAt) : { value: currentDay + 'T17:00', occurrence: 0 })
  const [role, setRole] = useState(shift?.role ?? data.staff.find(member => member.id === staffId)?.role ?? '')
  const [note, setNote] = useState(shift?.note ?? '')
  const [cancelShift, setCancelShift] = useState(false)
  const { busy, error, run } = useAction()
  const active = data.staff.filter(member => member.active)
  const cancel = () => { if (!busy) close() }
  const changed = !shift || shift.staffId !== owner || shift.role !== role || shift.note !== note ||
    start.value !== localValue(shift.startAt) || end.value !== localValue(shift.endAt) ||
    start.occurrence !== startLocal(shift.startAt).occurrence || end.occurrence !== startLocal(shift.endAt).occurrence
  const choose = value => {
    setOwner(value)
    if (!shift || !role) setRole(active.find(member => member.id === value)?.role ?? '')
  }
  const submit = event => {
    event.preventDefault()
    void run(async () => {
      const body = {
        staffId: owner, startAt: fromLocal(start.value, start.occurrence), endAt: fromLocal(end.value, end.occurrence),
        role, note, revision: shift?.revision,
      }
      await api(shift ? '/shifts/' + shift.id : '/shifts', { method: shift ? 'PATCH' : 'POST', body })
      done(shift ? 'Shift changes saved.' : 'Shift added as a draft.')
    })
  }
  const remove = () => void run(async () => {
    await api('/shifts/' + shift.id, { method: 'DELETE', body: { revision: shift.revision } })
    done(shift.publishedRevision ? 'Shift cancelled.' : 'Draft shift removed.')
  })
  const status = shift ? statusOfShift(shift) : null
  const smsStatus = {
    queued: 'SMS queued by the provider.',
    failed: 'SMS failed. You can try sending it again.',
    uncertain: 'SMS submission could not be confirmed.',
    submitting: 'SMS submission is pending.',
  }[shift?.smsStatus]
  return <Modal title={shift ? 'Edit shift' : 'New shift'} description="Shift times use Brussels local time." onClose={cancel}>
    {!active.length && !shift ? <EmptyState icon={UserPlus} title="Add a staff member first" action={
      <Button variant="primary" onClick={() => open('staff')}>Add staff</Button>
    } /> : <form onSubmit={submit}>
      <div className="modal-body form-stack">
        {status && <div className="shift-dialog-status"><Badge tone={status[1]}>{status[0]}</Badge>
          {shift.publishedRevision && <span>Share changes when staff need the updated shift.</span>}</div>}
        {smsStatus && <p className="field-help">{smsStatus}</p>}
        <Field label="Staff member">{id => <Select id={id} value={owner} onChange={e => choose(e.target.value)} required>
          <option value="">Choose a staff member</option>{active.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </Select>}</Field>
        <div className="form-columns">
          <TimeField label="Starts" state={start} setState={setStart} required />
          <TimeField label="Ends" state={end} setState={setEnd} required />
        </div>
        <Field label="Shift role">{id => <input id={id} value={role} maxLength={60} placeholder="e.g. Front of house" required onChange={e => setRole(e.target.value)} />}</Field>
        <Field label="Notes (optional)" help="Staff can see these notes after you share the shift.">
          {(id, info) => <textarea id={id} aria-describedby={info} value={note} rows={2} maxLength={500} onChange={e => setNote(e.target.value)} />}
        </Field>
        {cancelShift && <div className="confirm-box"><p>{shift.publishedRevision ? 'This shift will be removed from the staff schedule.' : 'This draft will be removed.'}</p>
          <Button variant="danger" disabled={busy} onClick={remove}>{shift.publishedRevision ? 'Confirm cancellation' : 'Confirm removal'}</Button></div>}
        <ErrorBox message={error} />
      </div>
      <footer className="modal-footer modal-footer-split">
        {shift && !cancelShift && <Button variant="text-danger" onClick={() => setCancelShift(true)}>{shift.publishedRevision ? 'Cancel shift' : 'Remove draft'}</Button>}
        {shift && cancelShift && <Button onClick={() => setCancelShift(false)}>Keep shift</Button>}
        <div className="modal-actions">
          {shift && !changed && (shift.publishedRevision !== shift.revision || (data.smsEnabled && !['queued', 'uncertain', 'submitting'].includes(shift.smsStatus))) &&
            <Button icon={Send} onClick={() => open('publish', { shifts: [shift] })}>Send shift</Button>}
          <Button type="submit" variant="primary" icon={Check} disabled={busy || !changed}>{busy ? 'Saving…' : (shift ? 'Save changes' : 'Add to schedule')}</Button>
        </div>
      </footer>
    </form>}
  </Modal>
}

function EntrySignatures({ id }) {
  const [signatures, setSignatures] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api(`/entries/${id}/signatures`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSignatures(result.signatures) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [id])

  return <section className="entry-signatures" aria-label="Punch signatures">
    <h3>Punch signatures</h3>
    {error ? <ErrorBox message={error}/> : !signatures ? <p role="status">Loading signatures…</p> : signatures.length ?
      <div className="entry-signature-grid">{signatures.map(({ action, at, strokes }) => {
        const label = action === 'in' ? 'Clock-in signature' : 'Clock-out signature'
        return <figure key={`${action}-${at}`}>
          <svg viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`} role="img" aria-label={label}>
            <path d={signaturePath(strokes)}/>
          </svg>
          <figcaption><strong>{label}</strong><small>{shortDate(at)} {timeText(at)}</small></figcaption>
        </figure>
      })}</div> : <p>No signatures recorded for this entry.</p>}
  </section>
}

export function EntryDialog({ data, entry, signatureRevision, close, done, approve }) {
  const [staffId, setStaffId] = useState(entry?.staffId ?? '')
  const [clockIn, setIn] = useState(() => startLocal(entry?.clockIn ?? data.now - 3_600_000))
  const [clockOut, setOut] = useState(() => startLocal(entry ? entry.clockOut : data.now))
  const [reason, setReason] = useState('')
  const { busy, error, run } = useAction()
  const cancel = () => { if (!busy) close() }
  const resolveTime = (current, original) => {
    const initial = startLocal(original)
    return initial.value === current.value && initial.occurrence === current.occurrence ? original : fromLocal(current.value, current.occurrence)
  }
  const submit = event => {
    event.preventDefault()
    void run(async () => {
      const body = {
        staffId, clockIn: resolveTime(clockIn, entry?.clockIn), clockOut: clockOut.value ? resolveTime(clockOut, entry?.clockOut) : null,
        reason, revision: entry?.revision,
      }
      await api(entry ? '/entries/' + entry.id : '/entries', { method: entry ? 'PATCH' : 'POST', body })
      done(entry ? 'Clock entry corrected.' : 'Clock entry added.')
    })
  }
  const unchanged = entry && [clockIn, clockOut].every((value, index) => {
    const initial = startLocal(index === 0 ? entry.clockIn : entry.clockOut)
    return initial.value === value.value && initial.occurrence === value.occurrence
  })
  const edit = Boolean(entry)
  return <Modal title={edit ? 'Review clock entry' : 'Add time entry'} description={entry ? entry.name : 'Record time for a missed clock-in or clock-out.'} onClose={cancel}>
    <form onSubmit={submit}>
      <div className="modal-body form-stack">
        {entry ? <div className="notice entry-notice">
          <CalendarDays size={19} /><span><strong>{entry.clockOut ? durationText(entry.clockOut - entry.clockIn) + ' recorded' : 'On the clock'}</strong>
            <small>{entry.originalIn ? `Original punches ${timeText(entry.originalIn)}–${timeText(entry.originalOut)}` : 'Manually entered'}
            {entry.reason ? ` · ${entry.reason}` : ''}</small></span>
          {entry.approvedAt && <Badge tone="green">Approved</Badge>}
        </div> : <Field label="Staff member">{id => <Select id={id} value={staffId} required onChange={e => setStaffId(e.target.value)}>
          <option value="">Choose a staff member</option>{data.staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </Select>}</Field>}
        {entry && <EntrySignatures key={`${entry.id}-${signatureRevision}`} id={entry.id}/>}
        <div className="form-columns">
          <TimeField label="Clock in" state={clockIn} setState={setIn} required />
          <TimeField label="Clock out" state={clockOut} setState={setOut} />
        </div>
        <Field label={edit ? 'Reason for correction' : 'Reason for manual entry'}
          help={entry?.approvedAt ? 'Changing this time sends it back for approval.' : 'Use Brussels local time. Leave clock-out blank for an open entry.'}>
          {(id, info) => <textarea id={id} aria-describedby={info} value={reason} rows={2} required maxLength={300} onChange={e => setReason(e.target.value)} />}
        </Field>
        <ErrorBox message={error} />
      </div>
      <footer className="modal-footer">
        <Button onClick={cancel} disabled={busy}>Close</Button>
        {edit && entry.clockOut && !entry.approvedAt && unchanged &&
          <Button variant="primary" icon={Check} onClick={() => void run(async () => { await approve(entry); close() })} disabled={busy}>{busy ? 'Approving…' : 'Approve hours'}</Button>}
        <Button type="submit" variant={edit && unchanged && entry.clockOut && !entry.approvedAt ? 'secondary' : 'primary'}
          disabled={busy || (edit && unchanged)}>{busy ? 'Saving…' : (edit ? 'Save correction' : 'Add time entry')}</Button>
      </footer>
    </form>
  </Modal>
}

export function PublishDialog({ shifts, smsEnabled, close, done }) {
  const [ids, setIds] = useState(() => new Set(shifts.map(shift => shift.id)))
  const [sms, setSms] = useState(false)
  const { busy, error, run } = useAction()
  const cancel = () => { if (!busy) close() }
  const toggle = id => setIds(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const submit = event => {
    event.preventDefault()
    void run(async () => {
      const chosen = [...ids]
      let published = 0
      const messages = []
      for (let i = 0; i < chosen.length; i += 100) {
        const result = await api('/shifts/publish', { method: 'POST', body: { ids: chosen.slice(i, i + 100), sms } })
        published += result.published
        messages.push(...result.messages)
      }
      const queued = messages.filter(message => message.status === 'queued').length
      let outcome = published ? `${published} ${published === 1 ? 'shift' : 'shifts'} shared with staff.` : 'The selected shifts were already shared.'
      if (sms) {
        outcome += ` ${queued} SMS ${queued === 1 ? 'message' : 'messages'} queued.`
        if (messages.length > queued) outcome += ` ${messages.length - queued} could not be confirmed.`
      }
      done(outcome)
    })
  }
  return <Modal title={shifts.length === 1 ? 'Send shift' : 'Send shifts'}
    description="Staff will see shared shifts when they enter their code in the staff clock." onClose={cancel}>
    <form onSubmit={submit}>
      <div className="modal-body form-stack">
        <div className="publish-list">{shifts.map(shift =>
          <label className="publish-row" key={shift.id}>
            <input type="checkbox" checked={ids.has(shift.id)} onChange={() => toggle(shift.id)} />
            <Avatar name={shift.name} size="avatar-small" />
            <span><strong>{shift.name}</strong><small>{dateFormat(shift.startAt, { weekday: 'short', day: 'numeric', month: 'short' })} · {timeText(shift.startAt)}–{timeText(shift.endAt)}</small></span>
            <span className="publish-role">{shift.role}</span>
          </label>)}</div>
        {smsEnabled ? <label className="check-line"><input type="checkbox" checked={sms} onChange={e => setSms(e.target.checked)} />Also send an SMS to each assigned staff member</label> :
          <p className="notice"><LockKeyhole size={17} />Your staff clock is ready for sharing. SMS requires a configured messaging service.</p>}
        <ErrorBox message={error} />
      </div>
      <footer className="modal-footer"><Button onClick={cancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" icon={Send} disabled={!ids.size || busy}>{busy ? 'Sending…' : `Send ${ids.size} ${ids.size === 1 ? 'shift' : 'shifts'}`}</Button></footer>
    </form>
  </Modal>
}
