import { useEffect, useId, useRef } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react'
import { localCandidates, localValue, weekLabel } from '../shared/time.mjs'

export function Brand({ home = false }) {
  const content = <><img src="/brand.svg" alt="" /><span>French Tacos Antwerp</span></>
  return home ? <a className="brand" href="#overview">{content}</a> : <div className="brand">{content}</div>
}

export function Avatar({ name, size = '' }) {
  const words = name.trim().split(/\s+/)
  const initials = (words[0][0] + (words.length > 1 ? words.at(-1)[0] : '')).toUpperCase()
  const color = Array.from(name).reduce((sum, character) => sum + character.codePointAt(0), 0) % 6
  return <span className={`avatar avatar-${color} ${size}`} aria-hidden="true">{initials}</span>
}

export function Button({ variant = 'secondary', icon: Icon, children, className = '', type = 'button', ...props }) {
  return <button type={type} className={`button button-${variant} ${className}`} {...props}>{Icon && <Icon size={16} />}{children}</button>
}

export function IconButton({ icon: Icon, label, className = '', ...props }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}><Icon size={17} /></button>
}

export function OpenClock({ url }) {
  return <a className="button button-secondary open-clock" href={url} target="_blank" rel="noreferrer" aria-label="Open staff clock">
    <Clock3 size={16} /><span>Staff clock</span>
  </a>
}

export function Badge({ tone = 'plain', children }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" aria-hidden="true" />{children}</span>
}

export function statusOfShift(shift) {
  if (!shift.publishedRevision) return ['Draft', 'plain']
  if (shift.publishedRevision !== shift.revision) return ['Edited', 'amber']
  return ['Shared', 'green']
}

export function statusOfEntry(entry) {
  if (!entry.clockOut) return ['On clock', 'live']
  if (entry.approvedAt) return ['Approved', 'green']
  return ['Needs review', 'amber']
}

export function WeekTools({ week, onWeek, onThisWeek, stepWeek }) {
  return <div className="week-tools">
    <div className="week-switcher">
      <IconButton icon={ChevronLeft} label="Previous week" onClick={() => stepWeek(-7)} />
      <label className="week-date">
        <CalendarDays size={16} aria-hidden="true" />
        <span>{weekLabel(week)}</span>
        <input type="date" aria-label="Jump to week" value={week} min="2000-01-01" max="2099-12-31" onChange={e => e.target.value && onWeek(e.target.value)}/>
      </label>
      <IconButton icon={ChevronRight} label="Next week" onClick={() => stepWeek(7)} />
    </div>
    <Button onClick={onThisWeek}>This week</Button>
  </div>
}

export function EmptyState({ icon: Icon = CalendarDays, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={23} /></span><strong>{title}</strong>
    {description && <p>{description}</p>}{action}
  </div>
}

export function Modal({ title, description, children, onClose }) {
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className="modal" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.currentTarget === event.target) {
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
      }
    }}>
    <header className="modal-header">
      <div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div>
      <IconButton icon={X} label="Close dialog" onClick={onClose} />
    </header>
    {children}
  </dialog>
}

export function Field({ label, help, children, className = '' }) {
  const id = useId()
  return <div className={`field ${className}`}>
    <label htmlFor={id}>{label}</label>
    {children(id, help ? id + '-help' : undefined)}
    {help && <p id={id + '-help'} className="field-help">{help}</p>}
  </div>
}

export function Select({ children, ...props }) {
  return <div className="select-wrap"><select {...props}>{children}</select><ChevronDown size={15} aria-hidden="true" /></div>
}

export function startLocal(timestamp) {
  const value = localValue(timestamp)
  const candidates = localCandidates(value)
  return { value, occurrence: candidates.length === 2 && timestamp >= candidates[1] ? 1 : 0 }
}

export function TimeField({ label, state, setState, required }) {
  const ambiguous = localCandidates(state.value).length === 2
  return <div className="time-field">
    <Field label={label}>{id => <input id={id} type="datetime-local" min="2000-01-01T00:00" max="2099-12-31T23:59" required={required} value={state.value}
      onChange={e => setState({ value: e.target.value, occurrence: 0 })}/>}</Field>
    {ambiguous && <Select aria-label={label + ' daylight-saving occurrence'} value={state.occurrence}
      onChange={e => setState({ ...state, occurrence: Number(e.target.value) })}>
      <option value={0}>First occurrence (summer time)</option><option value={1}>Second occurrence (winter time)</option>
    </Select>}
  </div>
}

