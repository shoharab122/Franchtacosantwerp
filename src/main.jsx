import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CalendarDays, CheckCircle2, Clock3, LayoutGrid, LogOut, Menu, ShieldCheck, UsersRound, X,
} from 'lucide-react'
import { api } from '../shared/client.mjs'
import { dateKey, periodStart, plusDays, weekKey } from '../shared/time.mjs'
import { Brand, Button, Field, IconButton, OpenClock } from './ui.jsx'
import { Attendance, Overview, Schedule, Staff } from './views.jsx'
import { EntryDialog, PublishDialog, ShiftDialog, StaffDialog } from './dialogs.jsx'
import '../shared/base.css'
import './owner.css'

const navigation = [
  ['overview', 'Overview', LayoutGrid], ['schedule', 'Schedule', CalendarDays],
  ['attendance', 'Attendance', Clock3], ['staff', 'Staff', UsersRound],
]
const fromHash = () => navigation.find(item => '#' + item[0] === window.location.hash)?.[0] ?? 'overview'

function Login({ session, onLogin }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event, demo = false) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/login', { method: 'POST', body: { password: demo ? 'minhaj-shift-demo' : password } })
      onLogin()
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }
  return <main className="login-layout">
    <div className="login-background"><Brand /><h1>Shift planning and attendance</h1></div>
    <div className="login-content">
      <div className="login-card"><div className="empty-icon"><ShieldCheck size={25} /></div>
        <h2>Owner sign-in</h2>
        {session.platform ? <a className="button button-primary" href="/signin-with-chatgpt?returnTo=%2F" target="_top">Sign in with ChatGPT</a> :
          <form className="form-stack" onSubmit={submit}>
            <Field label="Owner password">{id => <input id={id} type="password" value={password} autoComplete="current-password" onChange={event => setPassword(event.target.value)} required />}</Field>
            {error && <p className="error-message" role="alert">{error}</p>}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            {session.demo && <Button disabled={busy} onClick={event => void submit(event, true)}>Open demo workspace</Button>}
          </form>}
        <OpenClock url={session.clockUrl} />
      </div>
    </div>
  </main>
}

function Shell({ session, signOut }) {
  const [page, setPageState] = useState(fromHash)
  const [week, setWeek] = useState(() => weekKey())
  const [hoursPeriod, setHoursPeriod] = useState('week')
  const [hoursDate, setHoursDate] = useState(() => dateKey())
  const [menu, setMenu] = useState(false)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [approving, setApproving] = useState(null)
  const fetchGeneration = useRef(0)
  const activeWeek = page === 'overview' ? weekKey() : week
  const hoursKey = hoursPeriod === 'week' ? activeWeek : periodStart(hoursPeriod, hoursDate)
  const query = new URLSearchParams({ week: activeWeek })
  if (page === 'attendance') {
    query.set('hours', hoursPeriod)
    if (hoursPeriod !== 'week') query.set('date', hoursKey)
  }
  const workspacePath = '/workspace?' + query

  useEffect(() => {
    const listener = () => { setPageState(fromHash()); setMenu(false) }
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [])

  const notify = useCallback((message, type = 'success') => setToast({ message, type }), [])
  const refresh = useCallback(async () => {
    const generation = ++fetchGeneration.current
    try {
      const update = await api(workspacePath)
      if (generation === fetchGeneration.current) { setData(update); setLoadError('') }
    } catch (error) {
      if (generation !== fetchGeneration.current) return
      if (error.status === 401 && !session.platform) signOut()
      else setLoadError(error.message)
    }
  }, [workspacePath, session.platform, signOut])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 20_000)
    const onVisible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      fetchGeneration.current++
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(null), 6_000)
    return () => clearTimeout(timeout)
  }, [toast])

  const open = (type, options = {}) => setModal({ type, ...options })
  const close = () => setModal(null)
  const done = message => { close(); void refresh(); notify(message) }
  const setPage = value => { window.location.hash = value; setPageState(value); setMenu(false) }

  const approve = async (entry, rethrow = false) => {
    setApproving(entry.id)
    try {
      await api('/entries/' + entry.id + '/approve', { method: 'POST', body: { revision: entry.revision } })
      notify(`${entry.name}’s hours approved.`)
      void refresh()
    } catch (error) {
      if (rethrow) throw error
      notify(error.message, 'error')
      void refresh()
    } finally { setApproving(null) }
  }
  const logout = async () => {
    try {
      await api('/logout', { method: 'POST', body: {} })
      signOut()
    } catch (error) { notify(error.message, 'error') }
  }
  const weekProps = {
    week, onWeek: day => setWeek(weekKey(day)),
    stepWeek: days => setWeek(previous => plusDays(previous, days)), onThisWeek: () => setWeek(weekKey()),
  }
  const selectPeriod = period => {
    if (hoursPeriod === 'week' && period !== 'week') {
      setHoursDate(week === weekKey(data.today) ? data.today : week)
    }
    setHoursPeriod(period)
  }
  const label = navigation.find(item => item[0] === page)[1]
  return <div className="workspace">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    {menu && <button type="button" className="menu-overlay" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand home /><IconButton className="mobile-only" icon={X} label="Close navigation" onClick={() => setMenu(false)}/></div>
      <div className="workspace-label">Workspace</div>
      <nav aria-label="Workspace pages">
        {navigation.map(([id, name, Icon]) => <a key={id} href={'#' + id} aria-current={page === id ? 'page' : undefined} className={page === id ? 'nav-active' : ''} onClick={() => setMenu(false)}>
          <Icon size={19} strokeWidth={1.75}/><span>{name}</span>
        </a>)}
      </nav>
      <div className="sidebar-footer">
        <div className="owner-avatar" aria-hidden="true">FT</div><div><strong>French Tacos Antwerp</strong><small>Owner workspace</small></div>
        {session.platform ? <a className="icon-button logout-button" href="/signout-with-chatgpt?returnTo=%2F" target="_top" title="Sign out" aria-label="Sign out"><LogOut size={17}/></a> :
          <IconButton className="logout-button" label="Sign out" icon={LogOut} onClick={logout} />}
      </div>
    </aside>
    <div className="workspace-body">
      <header className="topbar">
        <div className="breadcrumbs"><IconButton className="mobile-only" icon={Menu} label="Open navigation" onClick={() => setMenu(true)} />
          <span>Workspace</span><i aria-hidden="true">/</i><strong>{label}</strong></div>
        <div className="topbar-actions">
          {session.demo && <span className="demo-pill"><span />Demo workspace</span>}
          <OpenClock url={session.clockUrl} />
        </div>
      </header>
      <main className="workspace-main" id="main-content" tabIndex={-1}>
        {loadError && <div className="load-error error-message" role="alert"><span>{loadError}</span><Button onClick={refresh}>Retry</Button></div>}
        {data && (data.week === activeWeek || page === 'staff') ? <>
          {page === 'overview' && <Overview data={data} open={open} setPage={setPage}/>}
          {page === 'schedule' && <Schedule data={data} open={open} weekProps={weekProps}/>}
          {page === 'attendance' && <Attendance data={data} open={open} weekProps={weekProps} approving={approving} approve={approve}
            hoursProps={{ period: hoursPeriod, hoursKey, date: hoursDate, selectPeriod, setDate: setHoursDate, loadError }}/>}
          {page === 'staff' && <Staff data={data} open={open}/>}
        </> : <div className="page-title"><div><h1>{label}</h1>{!loadError && <p role="status">Loading workspace…</p>}</div></div>}
      </main>
    </div>
    {data && modal?.type === 'staff' && <StaffDialog person={modal.staff} close={close} done={done} demo={session.demo} />}
    {data && modal?.type === 'shift' && <ShiftDialog data={data} {...modal} open={open} close={close} done={done} />}
    {data && modal?.type === 'entry' && <EntryDialog data={data} entry={modal.entry}
      signatureRevision={data.entries.find(entry => entry.id === modal.entry?.id)?.revision ?? modal.entry?.revision}
      close={close} done={done} approve={entry => approve(entry, true)} />}
    {data && modal?.type === 'publish' && <PublishDialog shifts={modal.shifts} close={close} done={done} smsEnabled={data.smsEnabled} />}
    {toast && <div role={toast.type === 'error' ? 'alert' : 'status'} className={`toast toast-${toast.type}`}>
      {toast.type === 'success' && <CheckCircle2 size={20}/>}<span>{toast.message}</span><IconButton label="Dismiss message" icon={X} onClick={() => setToast(null)}/>
    </div>}
  </div>
}

function App() {
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const readSession = useCallback(async () => {
    setError('')
    try { setSession(await api('/session')) } catch (cause) { setError(cause.message) }
  }, [])
  const login = useCallback(() => setSession(previous => ({ ...previous, authenticated: true })), [])
  const signOut = useCallback(() => setSession(previous => ({ ...previous, authenticated: false })), [])
  useEffect(() => { void readSession() }, [readSession])
  if (!session) return <main className="launch"><Brand />{error ? <><p className="error-message" role="alert">{error}</p><Button onClick={readSession}>Retry</Button></> : <p role="status">Opening your workspace…</p>}</main>
  if (!session.authenticated) return <Login session={session} onLogin={login}/>
  return <Shell session={session} signOut={signOut}/>
}

createRoot(document.getElementById('root')).render(<App/>)
