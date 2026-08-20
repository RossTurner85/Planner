import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUpdateStatus, InsightTab, NavOptions, PageId, Profile } from './types'
import { currentMonth, monthLabel, shiftMonth } from './lib/format'
import { HomePage } from './pages/HomePage'
import { TransactionsPage } from './pages/TransactionsPage'
import { BudgetsPage } from './pages/BudgetsPage'
import { BillsPage } from './pages/BillsPage'
import { GoalsPage } from './pages/GoalsPage'
import { InsightsPage } from './pages/InsightsPage'
import { SetupPage } from './pages/SetupPage'

const NAV: Array<{ id: PageId; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'bills', label: 'Bills' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'goals', label: 'Goals' },
  { id: 'insights', label: 'Insights' },
  { id: 'setup', label: 'Accounts & Statements' },
]

/**
 * A pre-filtered arrival on the Transactions page. The nonce is what makes a
 * second identical jump still count as a new one.
 */
export type TxJump = {
  search: string
  from: string
  to: string
  nonce: number
}

/** A question handed to the Coach from somewhere else, to run on arrival. */
export type CoachAsk = {
  question: string
  nonce: number
}

/** Pages that own their own month control (or don't care about months). */
const NO_MONTH_NAV = new Set<PageId>(['home', 'transactions', 'bills', 'setup'])

/** Pages whose header is a centered title with no subtitle. */
const CENTERED_TITLE = new Set<PageId>(['transactions', 'bills', 'setup'])

const TITLES: Record<PageId, { title: string; sub: string }> = {
  home: {
    title: '',
    sub: 'Where money went, what’s due, and what still needs attention.',
  },
  transactions: {
    title: 'Transactions',
    sub: 'Track every dollar without drowning in it — categorize only what matters.',
  },
  bills: {
    title: "This month’s bills",
    sub: '',
  },
  budgets: {
    title: 'Budgets',
    sub: 'A few flexible caps — enough control, not a second job.',
  },
  goals: {
    title: 'Goals',
    sub: 'Save toward something concrete without spreadsheet guilt.',
  },
  insights: {
    title: 'Insights',
    sub: 'What happened, what’s shifting, and reports you can actually read.',
  },
  setup: {
    title: 'Accounts & Statements',
    sub: '',
  },
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileId, setProfileId] = useState<number | null>(null)
  const [page, setPage] = useState<PageId>('home')
  const [month, setMonth] = useState(currentMonth())
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [focusAccountId, setFocusAccountId] = useState<number | null>(null)
  const [insightTab, setInsightTab] = useState<InsightTab>('overview')
  const [txJump, setTxJump] = useState<TxJump | null>(null)
  const [coachAsk, setCoachAsk] = useState<CoachAsk | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [updateReady, setUpdateReady] = useState<AppUpdateStatus | null>(null)

  useEffect(() => {
    void window.finance.app.version().then(setAppVersion)
  }, [])

  useEffect(
    () =>
      window.finance.app.onUpdateAvailable((status) => {
        setUpdateReady(status)
      }),
    [],
  )

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await window.finance.profiles.list()
      setProfiles(list)
      setProfileId((prev) => prev ?? list[0]?.id ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles')
    }
  }, [])

  useEffect(() => {
    void refreshProfiles()
  }, [refreshProfiles])

  const profile = useMemo(
    () => profiles.find((p) => p.id === profileId) ?? null,
    [profiles, profileId],
  )

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  // The banks refresh themselves in the background; say so briefly and reload
  // the figures, rather than leaving stale numbers on screen.
  useEffect(
    () =>
      window.finance.plaid.onAutoSynced((summary) => {
        const bits: string[] = []
        if (summary.inserted) bits.push(`${summary.inserted} new`)
        if (summary.updated) bits.push(`${summary.updated} updated`)
        if (summary.deleted) bits.push(`${summary.deleted} removed`)
        setSyncNote(`${bits.join(' · ')} from ${summary.banks.join(', ')}`)
        refresh()
      }),
    [refresh],
  )

  useEffect(() => {
    if (!syncNote) return
    const id = window.setTimeout(() => setSyncNote(null), 9000)
    return () => window.clearTimeout(id)
  }, [syncNote])

  // Sidebar / bottom bar without id: clear account focus
  const navigate = useCallback(
    (next: PageId, opts?: NavOptions) => {
      if (next === 'setup') {
        setFocusAccountId(opts?.accountId ?? null)
      } else {
        setFocusAccountId(null)
      }
      if (next === 'insights' && opts?.tab) {
        setInsightTab(opts.tab)
      }
      setCoachAsk(
        next === 'insights' && opts?.coachQuestion
          ? { question: opts.coachQuestion, nonce: Date.now() }
          : null,
      )
      // A jump from the coach ("see these transactions") arrives pre-filtered.
      setTxJump(
        next === 'transactions' && (opts?.search || opts?.from || opts?.to)
          ? {
              search: opts.search ?? '',
              from: opts.from ?? '',
              to: opts.to ?? '',
              nonce: Date.now(),
            }
          : null,
      )
      setPage((prev) => {
        if (prev === next) {
          return prev
        }
        window.history.pushState({ page: next }, '', `#${next}`)
        return next
      })
    },
    [],
  )

  useEffect(() => {
    window.history.replaceState({ page: 'home' }, '', '#home')
    const onPop = (e: PopStateEvent) => {
      setFocusAccountId(null)
      const statePage = (e.state as { page?: PageId } | null)?.page
      if (statePage && statePage in TITLES) {
        setPage(statePage)
        return
      }
      const hash = window.location.hash.replace(/^#/, '') as PageId
      if (hash && hash in TITLES) {
        setPage(hash)
        return
      }
      setPage('home')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (error) {
    return (
      <div className="empty">
        <h1>Couldn’t open the app</h1>
        <p>{error}</p>
      </div>
    )
  }

  if (!profile) {
    return <div className="empty">Loading Bizzy&apos;s Finance…</div>
  }

  const meta = TITLES[page] ?? TITLES.home

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-kicker">Local · Private</div>
          <h1 className="brand-name">Bizzy&apos;s Finance</h1>
        </div>

        <div className="profile-switcher">
          {(['adult', 'dependent'] as const).map((role) => {
            const group = profiles.filter((p) =>
              role === 'dependent' ? p.role === 'dependent' : p.role !== 'dependent',
            )
            if (!group.length) return null
            return (
              <div key={role}>
                <div className="profile-label">
                  {role === 'adult' ? 'Household' : 'Kids'}
                </div>
                <div className="profile-list">
                  {group.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`profile-btn ${p.id === profile.id ? 'active' : ''}`}
                      onClick={() => setProfileId(p.id)}
                    >
                      <span className="dot" style={{ background: p.color }} />
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          Data stays on this PC.
          <br />
          Each profile has its own money. Person tags on a purchase only mean who it was spent on.
          {appVersion ? (
            <>
              <br />
              <span className="sidebar-version">v{appVersion}</span>
            </>
          ) : null}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div
            className={`topbar-inner${
              page === 'home'
                ? ' is-home'
                : CENTERED_TITLE.has(page)
                  ? ' is-page-center'
                  : ''
            }`}
          >
            <div className="topbar-copy">
              {page === 'home' ? (
                <>
                  <h1
                    style={{
                      borderBottom: `3px solid ${profile.color}`,
                      display: 'inline-block',
                      paddingBottom: 2,
                    }}
                  >
                    {profile.name}
                  </h1>
                  <p>{meta.sub}</p>
                </>
              ) : CENTERED_TITLE.has(page) ? (
                <h1
                  style={{
                    borderBottom: `3px solid ${profile.color}`,
                    display: 'inline-block',
                    paddingBottom: 2,
                  }}
                >
                  {meta.title}
                </h1>
              ) : (
                <>
                  <h1
                    style={{
                      borderBottom: `3px solid ${profile.color}`,
                      display: 'inline-block',
                      paddingBottom: 2,
                    }}
                  >
                    {meta.title}
                  </h1>
                  <p>
                    {profile.name} · {meta.sub}
                  </p>
                </>
              )}
            </div>
            {!NO_MONTH_NAV.has(page) ? (
              <div className="topbar-month-slot">
                <div className="month-nav">
                  <button
                    type="button"
                    onClick={() => setMonth((m) => shiftMonth(m, -1))}
                    aria-label="Previous month"
                  >
                    ‹
                  </button>
                  <span>{monthLabel(month)}</span>
                  <button
                    type="button"
                    onClick={() => setMonth((m) => shiftMonth(m, 1))}
                    aria-label="Next month"
                  >
                    ›
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </header>

        <div className="content" key={`${profile.id}-${month}-${tick}`}>
          {page === 'home' && (
            <HomePage
              profileId={profile.id}
              month={month}
              onMonthChange={setMonth}
              onNavigate={navigate}
              onRefresh={refresh}
            />
          )}
          {page === 'transactions' && (
            <TransactionsPage
              profileId={profile.id}
              month={month}
              onMonthChange={setMonth}
              onRefresh={refresh}
              jump={txJump}
            />
          )}
          {page === 'budgets' && (
            <BudgetsPage
              profileId={profile.id}
              month={month}
              onNavigate={navigate}
            />
          )}
          {page === 'bills' && (
            <BillsPage
              profileId={profile.id}
              month={month}
              onMonthChange={setMonth}
              onRefresh={refresh}
            />
          )}
          {page === 'goals' && (
            <GoalsPage profileId={profile.id} onRefresh={refresh} />
          )}
          {page === 'insights' && (
            <InsightsPage
              profileId={profile.id}
              profiles={profiles}
              month={month}
              tab={insightTab}
              onTabChange={setInsightTab}
              onNavigate={navigate}
              coachAsk={coachAsk}
            />
          )}
          {page === 'setup' && (
            <SetupPage
              profileId={profile.id}
              profiles={profiles}
              focusAccountId={focusAccountId}
            />
          )}
        </div>

        <nav className="bottom-bar" aria-label="Primary">
          <button
            type="button"
            className={page === 'home' ? 'active' : ''}
            onClick={() => navigate('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={
              page === 'insights' && insightTab !== 'coach' ? 'active' : ''
            }
            onClick={() => navigate('insights', { tab: 'overview' })}
          >
            Insights
          </button>
          <button
            type="button"
            className={
              page === 'insights' && insightTab === 'coach' ? 'active' : ''
            }
            onClick={() => navigate('insights', { tab: 'coach' })}
          >
            AI Coach
          </button>
        </nav>
      </main>

      {syncNote ? (
        <div className="sync-toast" role="status">
          <span className="sync-toast-dot" />
          <span>{syncNote}</span>
        </div>
      ) : null}

      {updateReady?.available ? (
        <div className="sync-toast update-toast" role="status">
          <span className="sync-toast-dot" />
          <span>Version {updateReady.latest} is ready</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void window.finance.app.updateApply()
            }}
          >
            Install
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setUpdateReady(null)}
          >
            Later
          </button>
        </div>
      ) : null}
    </div>
  )
}
