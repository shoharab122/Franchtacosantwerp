import { useState } from 'react'
import {
  Activity, CalendarDays, Check, ClipboardCheck, Clock3, Hourglass, ListChecks,
  Pencil, Plus, Search, Send, UsersRound,
} from 'lucide-react'
import { CLOCK_CODE_LENGTH } from '../shared/clock.mjs'
import { dateFormat, dayDate, durationInRange, durationText, fromLocal, plusDays, shortDate, timeText, weekLabel } from '../shared/time.mjs'
import { Avatar, Badge, Button, EmptyState, IconButton, Select, statusOfEntry, statusOfShift, WeekTools } from './ui.jsx'

export function getTotals(data) {
  const approved = data.entries.filter(entry => entry.approvedAt)
  const pending = data.entries.filter(entry => entry.clockOut && !entry.approvedAt)
  const active = data.entries.filter(entry => !entry.clockOut)
  const scheduledTime = data.shifts.reduce((total, shift) => total + Math.max(0, Math.min(shift.endAt, data.end) - Math.max(shift.startAt, data.start)), 0)
  const hours = entries => entries.reduce((total, entry) => total + durationInRange(entry, data.start, data.end), 0)
  return { approved, pending, active, scheduledTime, approvedTime: hours(approved), pendingTime: hours(pending) }
}

function Metric({ icon: Icon, tone, label, value, detail }) {
  return <div className="metric">
    <div className="metric-label"><span className={`metric-icon metric-${tone}`}><Icon size={17} /></span>{label}</div>
    <strong>{value}</strong><span className="metric-detail">{detail}</span>
  </div>
}

export function Overview({ data, open, setPage }) {
  const { active, approvedTime, pendingTime, pending, scheduledTime } = getTotals(data)
  const today = data.todayShifts
  const currentDate = dateFormat(data.now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return <>
    <div className="page-title"><div><h1>Overview</h1><p>{currentDate}</p></div>
      <Button variant="primary" icon={Plus} onClick={() => open('shift')}>New shift</Button></div>
    <section className="overview-hero" aria-label="Team clock status">
      <div className="hero-content">
        <div className="hero-status"><span className="live-beacon" /> Live attendance</div>
        <h2>{active.length} {active.length === 1 ? 'person' : 'people'} on the clock</h2>
        <div className="hero-team">
          {active.length > 0 ? <>
            <div className="avatar-stack">{active.slice(0, 3).map(entry => <Avatar name={entry.name} key={entry.id} size="avatar-small" />)}</div>
            <span>{active.slice(0, 3).map(entry => entry.name.split(' ')[0]).join(', ')}{active.length > 3 ? ` +${active.length - 3} more` : ''}</span>
          </> : <span>Clock-ins will appear here as your team arrives.</span>}
        </div>
        <Button variant="hero" onClick={() => setPage('attendance')}>View attendance</Button>
      </div>
      <div className="hero-clock" aria-label={`Brussels time ${timeText(data.now)}`}>
        <div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit orbit-c" />
        <div className="hero-clock-core"><Clock3 size={23} strokeWidth={1.7} /><strong>{timeText(data.now)}</strong><span>Brussels time</span></div>
        <i className="orbit-point point-one" /><i className="orbit-point point-two" /><i className="orbit-point point-three" />
      </div>
    </section>
    <div className="section-line"><h2>This week</h2><span><CalendarDays size={15} />{shortDate(data.start)}–{shortDate(data.end - 1)}</span></div>
    <div className="metrics">
      <Metric icon={CalendarDays} tone="mint" label="Scheduled hours" value={durationText(scheduledTime)} detail={`${data.shifts.length} planned ${data.shifts.length === 1 ? 'shift' : 'shifts'}`} />
      <Metric icon={Clock3} tone="blue" label="Recorded hours" value={durationText(approvedTime + pendingTime)} detail="Completed clock entries" />
      <Metric icon={ClipboardCheck} tone="green" label="Approved hours" value={durationText(approvedTime)} detail="Confirmed by the owner" />
      <Metric icon={Hourglass} tone="amber" label="Awaiting review" value={durationText(pendingTime)} detail={`${pending.length} ${pending.length === 1 ? 'entry' : 'entries'} to approve`} />
    </div>
    <div className="overview-panels">
      <section className="panel">
        <div className="panel-heading"><div><h2>Today’s schedule</h2><p>{today.length} {today.length === 1 ? 'shift' : 'shifts'} planned</p></div>
          <Button variant="ghost" onClick={() => setPage('schedule')}>View schedule</Button></div>
        {today.length ? <div className="list-rows">{today.slice(0, 5).map(shift => {
          const [status, tone] = statusOfShift(shift)
          return <button className="list-row schedule-row" key={shift.id} onClick={() => open('shift', { shift })}>
            <Avatar name={shift.name}/><div className="row-person"><strong>{shift.name}</strong><span>{shift.role}</span></div>
            <span className="row-time">{timeText(shift.startAt)}–{timeText(shift.endAt)}</span>
            <Badge tone={tone}>{status}</Badge>
          </button>
        })}</div> : <EmptyState title="No shifts today" description="Add a shift to plan someone’s workday." />}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Needs approval</h2><p>Completed clock entries</p></div>
          <Button variant="ghost" onClick={() => setPage('attendance')}>Review hours</Button></div>
        {pending.length ? <div className="list-rows">{pending.slice(0, 4).map(entry =>
          <button className="list-row approval-row" key={entry.id} onClick={() => open('entry', { entry })}>
            <Avatar name={entry.name} /><div className="row-person"><strong>{entry.name}</strong><span>{shortDate(entry.clockIn)}</span></div>
            <span className="row-time">{durationText(entry.clockOut - entry.clockIn)}</span>
          </button>
        )}</div> : <EmptyState icon={ListChecks} title="All caught up" description="Completed entries appear here when they need approval." />}
      </section>
    </div>
  </>
}

function calendarDay(day, today) {
  const date = dayDate(day)
  return <div key={day} className={`calendar-date ${day === today ? 'calendar-today' : ''}`}>
    <span>{dateFormat(date, { weekday: 'short' })}</span><strong>{dateFormat(date, { day: 'numeric' })}</strong>
    {day === today && <small>Today</small>}
  </div>
}

export function Schedule({ data, open, weekProps }) {
  const days = Array.from({ length: 7 }, (_, i) => plusDays(data.week, i))
  const activeIds = new Set(data.staff.filter(member => member.active).map(member => member.id))
  const pending = data.shifts.filter(shift => activeIds.has(shift.staffId) && shift.publishedRevision !== shift.revision)
  const workingIds = new Set(data.shifts.map(shift => shift.staffId))
  const staff = data.staff.filter(member => member.active || workingIds.has(member.id))
  const byPerson = new Map()
  for (const shift of data.shifts) {
    if (!byPerson.has(shift.staffId)) byPerson.set(shift.staffId, [])
    byPerson.get(shift.staffId).push(shift)
  }
  const bounds = days.map(day => [fromLocal(day + 'T00:00'), fromLocal(plusDays(day, 1) + 'T00:00')])
  return <>
    <div className="page-title"><div><h1>Schedule</h1><p>Plan shifts and share them with your team.</p></div>
      <div className="page-actions"><Button icon={Send} disabled={!pending.length} onClick={() => open('publish', { shifts: pending })}>Send shifts{pending.length > 0 ? ` (${pending.length})` : ''}</Button>
        <Button variant="primary" icon={Plus} onClick={() => open('shift')}>New shift</Button></div></div>
    <div className="page-toolbar"><WeekTools {...weekProps} /><div className="calendar-legend"><Badge tone="green">Shared</Badge><Badge>Draft</Badge><Badge tone="amber">Edited</Badge></div></div>
    {!staff.length ? <section className="panel"><EmptyState icon={UsersRound} title="Add your first staff member"
      description="Once they’re in your team, you can assign them shifts." action={<Button icon={Plus} variant="primary" onClick={() => open('staff')}>Add staff</Button>} /></section>
      : <section className="panel calendar-scroll" aria-label="Weekly shift planner"><div className="calendar">
        <div className="calendar-grid calendar-head"><div className="calendar-team">Staff <span>{staff.length}</span></div>
          {days.map(day => calendarDay(day, data.today))}</div>
        {staff.map(member => <div className="calendar-grid calendar-row" key={member.id}>
          <div className="calendar-person"><Avatar name={member.name} size="avatar-small" /><div><strong>{member.name}</strong><span>{member.role}</span></div></div>
          {days.map((day, index) => {
            const [start, end] = bounds[index]
            const shifts = (byPerson.get(member.id) ?? []).filter(shift => shift.startAt < end && shift.endAt > start)
            return <div className={`calendar-cell ${day === data.today ? 'calendar-today' : ''}`} key={day}>
              {shifts.map(shift => {
                const [status, tone] = statusOfShift(shift)
                const startText = shift.startAt < start ? '00:00' : timeText(shift.startAt)
                const endText = shift.endAt >= end ? '24:00' : timeText(shift.endAt)
                return <button className={`shift-card shift-${tone}`} key={shift.id} onClick={() => open('shift', { shift })}
                  aria-label={`${member.name}, ${startText} to ${endText}, ${status}. Edit shift`}>
                  <strong>{startText}–{endText}</strong><span>{shift.role}</span><small>{status}</small>
                </button>
              })}
              {member.active === 1 && <button className={`cell-add ${shifts.length ? 'cell-add-compact' : ''}`}
                aria-label={`Add shift for ${member.name} on ${day}`} onClick={() => open('shift', { day, staffId: member.id })}><Plus size={16}/></button>}
            </div>
          })}
        </div>)}
      </div></section>}
  </>
}

const attendanceFilters = [
  ['all', 'All entries'], ['active', 'On clock'], ['pending', 'Needs review'], ['approved', 'Approved'],
]

const hourPeriods = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']]
const reportMonths = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1).padStart(2, '0')
  return [value, dateFormat(dayDate(`2000-${value}-01`), { month: 'long' })]
})
const reportYears = Array.from({ length: 100 }, (_, index) => String(2099 - index))

function HoursByStaff({ data, period, hoursKey, date, setDate, selectPeriod, loadError }) {
  const [year, month] = date.split('-')
  const label = period === 'week' ? weekLabel(hoursKey)
    : period === 'month' ? dateFormat(dayDate(hoursKey), { month: 'long', year: 'numeric' }) : year
  const loaded = data.hours?.period === period && data.hours.key === hoursKey
  const totals = new Map(loaded ? data.hours.totals.map(total => [total.staffId, total]) : [])
  const members = data.staff.filter(member => member.active || totals.has(member.id))
  return <section className="panel total-panel" aria-labelledby="staff-hours-title">
    <div className="panel-heading"><div><h2 id="staff-hours-title">Hours by staff</h2><p>Completed entries in Brussels time</p></div></div>
    <div className="filter-tabs hours-tabs" role="group" aria-label="Hours period">
      {hourPeriods.map(([value, name]) => <button key={value} type="button" className={period === value ? 'filter-active' : ''}
        aria-pressed={period === value} onClick={() => selectPeriod(value)}>{name}</button>)}
    </div>
    <div className="hours-controls">
      {period === 'week' ? <strong>{label}</strong> : <div className="hours-pickers">
        {period === 'month' && <label className="field"><span>Month</span><Select aria-label="Hours month" value={month}
          onChange={event => setDate(`${year}-${event.target.value}-01`)}>
          {reportMonths.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </Select></label>}
        <label className="field"><span>Year</span><Select aria-label="Hours year" value={year}
          onChange={event => setDate(`${event.target.value}-${month}-01`)}>
          {reportYears.map(value => <option key={value}>{value}</option>)}
        </Select></label>
      </div>}
    </div>
    {!loaded ? <p className="hours-message" role="status">{loadError ? 'Could not load staff hours.' : 'Loading hours…'}</p> :
      members.length ? <div className="list-rows hours-list" aria-label={`Hours by staff for ${label}`}>
        {members.map(member => {
          const total = totals.get(member.id) ?? { recorded: 0, approved: 0 }
          return <div key={member.id} className="hours-row"><div><Avatar size="avatar-small" name={member.name}/><strong>{member.name}</strong></div>
            <span><strong>{durationText(total.recorded)}<span className="visually-hidden"> recorded</span></strong><small>{durationText(total.approved)} approved</small></span></div>
        })}
      </div> : <EmptyState icon={UsersRound} title="No staff hours for this period" />}
  </section>
}

export function Attendance({ data, open, weekProps, approve, approving, hoursProps }) {
  const [filter, setFilter] = useState('all')
  const { active, pending, approved, approvedTime, pendingTime } = getTotals(data)
  const lookup = { all: data.entries, active, pending, approved }
  return <>
    <div className="page-title"><div><h1>Attendance</h1><p>Review clock entries and confirm worked hours.</p></div>
      <Button variant="primary" icon={Plus} onClick={() => open('entry')}>Add time entry</Button></div>
    <div className="page-toolbar attendance-toolbar"><span>Clock entries week</span><WeekTools {...weekProps} /></div>
    <div className="metrics metrics-three attendance-metrics">
      <Metric icon={Activity} tone="mint" label="On the clock" value={active.length} detail="Live across all weeks" />
      <Metric icon={Clock3} tone="blue" label="Recorded in selected week" value={durationText(approvedTime + pendingTime)} detail={`${durationText(pendingTime)} awaiting review`} />
      <Metric icon={ClipboardCheck} tone="green" label="Approved in selected week" value={durationText(approvedTime)} detail={`${approved.length} approved ${approved.length === 1 ? 'entry' : 'entries'}`} />
    </div>
    <div className="attendance-panels">
      <HoursByStaff data={data} {...hoursProps}/>
      <section className="panel attendance-table">
        <div className="panel-heading"><div><h2>Clock entries</h2><p>Times shown in Brussels local time</p></div></div>
        <div className="filter-tabs" aria-label="Filter clock entries">
          {attendanceFilters.map(([id, label]) => <button key={id} className={filter === id ? 'filter-active' : ''} aria-pressed={filter === id}
            onClick={() => setFilter(id)}>{label}<span>{lookup[id].length}</span></button>)}
        </div>
        {lookup[filter].length ? <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Staff member</th><th>Clock in</th><th>Clock out</th><th>Worked</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{lookup[filter].map(entry => {
            const [status, tone] = statusOfEntry(entry)
            return <tr key={entry.id}>
              <td><div className="table-person"><Avatar name={entry.name} size="avatar-small"/><div><strong>{entry.name}</strong><small>{entry.role}</small></div></div></td>
              <td><strong>{timeText(entry.clockIn)}</strong><small>{shortDate(entry.clockIn)}</small></td>
              <td>{entry.clockOut ? <><strong>{timeText(entry.clockOut)}</strong><small>{shortDate(entry.clockOut)}</small></> : '—'}</td>
              <td><strong>{entry.clockOut ? durationText(entry.clockOut - entry.clockIn) : '—'}</strong></td>
              <td><Badge tone={tone}>{status}</Badge></td>
              <td><div className="table-actions">
                {tone === 'amber' && <IconButton className="approve-button" icon={Check} label={`Approve ${entry.name}’s hours`}
                  disabled={approving === entry.id} onClick={() => approve(entry)} />}
                <IconButton icon={Pencil} label={`Edit ${entry.name}’s entry`} onClick={() => open('entry', { entry })} />
              </div></td>
            </tr>
          })}</tbody>
        </table></div> : <EmptyState icon={Clock3} title="No clock entries to show" description="Entries appear here when your team uses the staff clock." />}
      </section>
    </div>
  </>
}

export function Staff({ data, open }) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase()
  const matches = data.staff.filter(member => (member.name + ' ' + member.role).toLocaleLowerCase().includes(query))
  const active = data.staff.filter(member => member.active).length
  return <>
    <div className="page-title"><div><h1>Staff</h1><p>Manage staff details and their individual clock PINs.</p></div>
      <Button variant="primary" icon={Plus} onClick={() => open('staff')}>Add staff</Button></div>
    <section className="panel staff-panel">
      <div className="panel-heading"><div><h2>Team directory</h2><p>{active} active {active === 1 ? 'staff member' : 'staff members'}</p></div>
        <label className="staff-search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)}
          aria-label="Search staff by name or role" placeholder="Search staff…" type="search" /></label></div>
      {matches.length ? <div className="table-scroll"><table className="data-table staff-table">
        <thead><tr><th>Name</th><th>Role</th><th>Social security number</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>{matches.map(member => <tr key={member.id}>
          <td><div className="table-person"><Avatar name={member.name}/><strong>{member.name}</strong></div></td><td>{member.role}</td>
          <td>{member.nissLastFour ? <span className="mask">••••••• {member.nissLastFour}</span> : <span className="muted">—</span>}</td>
          <td><Badge tone={member.active ? 'green' : 'plain'}>{member.active ? 'Active' : 'Inactive'}</Badge>
            {member.active && member.codeDigits !== CLOCK_CODE_LENGTH && <small>Needs a 4-digit PIN</small>}</td>
          <td><Button icon={Pencil} onClick={() => open('staff', { staff: member })}>Edit</Button></td>
        </tr>)}</tbody></table></div>
        : <EmptyState icon={UsersRound} title={query ? 'No matching staff' : 'Your team starts here'}
          description={query ? 'Try a different name or role.' : 'Add a staff member to assign a clock PIN and start planning shifts.'}
          action={!query && <Button icon={Plus} variant="primary" onClick={() => open('staff')}>Add staff</Button>} />}
    </section>
  </>
}
