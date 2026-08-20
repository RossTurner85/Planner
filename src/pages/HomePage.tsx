import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
} from 'recharts'
import type {
  Account,
  Dashboard,
  Goal,
  Motivation,
  NavOptions,
  PageId,
  Transaction,
} from '../types'
import {
  money,
  monthLabel,
  ordinalDay,
  shiftMonth,
  todayISO,
} from '../lib/format'
import { BillsMonthPanel } from '../components/BillsMonthPanel'

type Props = {
  profileId: number
  month: string
  onMonthChange: (month: string) => void
  onNavigate: (page: PageId, opts?: NavOptions) => void
  onRefresh: () => void
}

const PIE_COLORS = [
  '#2F6F5E',
  '#C45C26',
  '#3B6FA0',
  '#B08D2E',
  '#8B5E9A',
  '#5B756A',
  '#D47B5A',
]

type SectorProps = {
  cx?: number
  cy?: number
  innerRadius?: number
  outerRadius?: number
  startAngle?: number
  endAngle?: number
  fill?: string
}

function dateShift(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function isLiquidAccount(a: Account) {
  return a.type === 'checking' || a.type === 'savings'
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className="home-inline-chevron" aria-hidden>
      {open ? '▾' : '▸'}
    </span>
  )
}

function TxRow({
  tx,
  onClick,
}: {
  tx: Transaction
  onClick: () => void
}) {
  return (
    <button type="button" className="home-tx-row clickable" onClick={onClick}>
      <span className="home-tx-payee">{tx.payee_display || tx.payee}</span>
      <span className="muted home-tx-cat">{tx.category_name ?? '—'}</span>
      <span className={tx.amount < 0 ? 'amount-neg' : 'amount-pos'}>
        {money(tx.amount)}
      </span>
    </button>
  )
}

function ActiveSpendSector(props: SectorProps) {
  const {
    cx = 0,
    cy = 0,
    innerRadius = 0,
    outerRadius = 0,
    startAngle = 0,
    endAngle = 0,
    fill = '#2F6F5E',
  } = props
  return (
    <g style={{ cursor: 'pointer' }}>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 12}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="#f4f6f1"
        strokeWidth={2}
        style={{
          filter: `drop-shadow(0 0 12px ${fill}) drop-shadow(0 0 4px ${fill})`,
        }}
      />
    </g>
  )
}

export function HomePage({
  profileId,
  month,
  onMonthChange,
  onNavigate,
  onRefresh,
}: Props) {
  const [dash, setDash] = useState<Dashboard | null>(null)
  /** Only one balance panel opens at a time, so the hero never stacks. */
  const [openStat, setOpenStat] = useState<'cash' | 'cards' | null>(null)
  const [yesterdayOpen, setYesterdayOpen] = useState(false)
  const [todayOpen, setTodayOpen] = useState(false)
  const [yesterdayTx, setYesterdayTx] = useState<Transaction[]>([])
  const [todayTx, setTodayTx] = useState<Transaction[]>([])
  const [activePie, setActivePie] = useState<number | undefined>(undefined)

  const today = todayISO()
  const yesterday = dateShift(today, -1)

  const loadDashboard = () => {
    void window.finance.dashboard.get(profileId, month).then(setDash)
  }

  useEffect(() => {
    loadDashboard()
  }, [profileId, month])

  useEffect(() => {
    void window.finance.transactions
      .list(profileId, { from: yesterday, to: yesterday, limit: 100 })
      .then(setYesterdayTx)
    void window.finance.transactions
      .list(profileId, { from: today, to: today, limit: 100 })
      .then(setTodayTx)
  }, [profileId, today, yesterday])

  const refreshHome = () => {
    loadDashboard()
    onRefresh()
  }

  const liquidAccounts = useMemo(
    () => (dash?.accounts ?? []).filter(isLiquidAccount),
    [dash],
  )

  const cardAccounts = useMemo(
    () => (dash?.accounts ?? []).filter((a) => a.type === 'credit'),
    [dash],
  )

  // Cards are stored either sign depending on how they were set up, so the
  // total is shown as plain money owed.
  const cardTotal = useMemo(
    () => Math.abs(cardAccounts.reduce((sum, a) => sum + a.balance, 0)),
    [cardAccounts],
  )

  const pieData = useMemo(() => {
    if (!dash?.topSpend.length) return []
    return dash.topSpend.map((s) => ({ name: s.name, total: s.total }))
  }, [dash])

  const pieTotal = useMemo(
    () => pieData.reduce((s, c) => s + c.total, 0),
    [pieData],
  )

  const openSpending = () => onNavigate('insights', { tab: 'overview' })

  const askCoach = (question: string) =>
    onNavigate('insights', { tab: 'coach', coachQuestion: question })

  if (!dash) return <div className="empty">Loading home…</div>

  return (
    <div className="home-landing">
      {/* Cash on hand — centered */}
      <section className="home-block home-cash home-cash-centered">
        <div className="home-cash-pair">
          <button
            type="button"
            className={`home-cash-toggle clickable${
              openStat === 'cash' ? ' is-open' : ''
            }`}
            onClick={() =>
              setOpenStat((o) => (o === 'cash' ? null : 'cash'))
            }
            aria-expanded={openStat === 'cash'}
          >
            <div className="home-cash-center">
              <div className="home-kicker">Cash on hand</div>
              <div className="home-cash-value is-cash">{money(dash.cash)}</div>
              <div className="muted home-cash-meta">
                <Chevron open={openStat === 'cash'} />
                {liquidAccounts.length} account
                {liquidAccounts.length === 1 ? '' : 's'}
              </div>
            </div>
          </button>

          {cardAccounts.length > 0 ? (
            <>
              <div className="home-cash-divider" aria-hidden />
              <button
                type="button"
                className={`home-cash-toggle clickable${
                  openStat === 'cards' ? ' is-open' : ''
                }`}
                onClick={() =>
                  setOpenStat((o) => (o === 'cards' ? null : 'cards'))
                }
                aria-expanded={openStat === 'cards'}
              >
                <div className="home-cash-center">
                  <div className="home-kicker">Card balances</div>
                  <div className="home-cash-value is-cards">
                    {money(cardTotal)}
                  </div>
                  <div className="muted home-cash-meta">
                    <Chevron open={openStat === 'cards'} />
                    {cardAccounts.length} card
                    {cardAccounts.length === 1 ? '' : 's'}
                  </div>
                </div>
              </button>
            </>
          ) : null}
        </div>

        <div className="home-cash-month">
          <div className="month-nav">
            <button
              type="button"
              onClick={() => onMonthChange(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span>{monthLabel(month)}</span>
            <button
              type="button"
              onClick={() => onMonthChange(shiftMonth(month, 1))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        {openStat === 'cash' ? (
          <div className="home-inline-expand home-cash-expand">
            {liquidAccounts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No checking or savings accounts yet.
              </p>
            ) : (
              <ul className="home-account-list">
                {liquidAccounts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="home-account-row clickable"
                      onClick={() =>
                        onNavigate('setup', { accountId: a.id })
                      }
                    >
                      <span>
                        <strong>{a.name}</strong>
                        <span className="muted"> · {a.type}</span>
                      </span>
                      <span className="home-account-bal is-cash">
                        {money(a.balance)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {openStat === 'cards' ? (
          <div className="home-inline-expand home-cash-expand">
            <ul className="home-account-list">
              {cardAccounts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="home-account-row clickable"
                    onClick={() => onNavigate('setup', { accountId: a.id })}
                  >
                    <span>
                      <strong>{a.name}</strong>
                      <span className="muted">
                        {a.due_day
                          ? ` · due the ${ordinalDay(a.due_day)}`
                          : ' · owed'}
                      </span>
                    </span>
                    <span className="home-account-bal is-cards">
                      {money(Math.abs(a.balance))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="home-day-lists">
          <div className="home-day-block">
            <button
              type="button"
              className="home-day-toggle clickable"
              onClick={() => setYesterdayOpen((o) => !o)}
              aria-expanded={yesterdayOpen}
            >
              <Chevron open={yesterdayOpen} />
              <span>Yesterday’s transactions</span>
              <span className="muted home-day-count">{yesterdayTx.length}</span>
            </button>
            {yesterdayOpen ? (
              <div className="home-inline-expand tight">
                {yesterdayTx.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Nothing posted yesterday.
                  </p>
                ) : (
                  yesterdayTx.map((t) => (
                    <TxRow key={t.id} tx={t} onClick={() => onNavigate('transactions')} />
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="home-day-block">
            <button
              type="button"
              className="home-day-toggle clickable"
              onClick={() => setTodayOpen((o) => !o)}
              aria-expanded={todayOpen}
            >
              <Chevron open={todayOpen} />
              <span>Today’s transactions</span>
              <span className="muted home-day-count">{todayTx.length}</span>
            </button>
            {todayOpen ? (
              <div className="home-inline-expand tight">
                {todayTx.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Nothing posted today yet.
                  </p>
                ) : (
                  todayTx.map((t) => (
                    <TxRow key={t.id} tx={t} onClick={() => onNavigate('transactions')} />
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Bills + Goals | Spending */}
      <div className="home-mid-row">
        <div className="home-mid-col">
          <BillsMonthPanel
            bills={dash.bills}
            onOpen={() => onNavigate('bills')}
          />

          <GoalsSection
            profileId={profileId}
            motivation={dash.motivation}
            goals={dash.goals}
            onSaved={loadDashboard}
            onOpenGoals={() => onNavigate('goals')}
          />
        </div>

        <section className="home-block home-spend-section">
          <div className="home-spend-stack">
            <h2 className="home-section-title home-section-title-center">
              Where my money is going this month
            </h2>
            <div
              className="home-spend-hit clickable"
              role="button"
              tabIndex={0}
              onClick={openSpending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openSpending()
                }
              }}
              aria-label="Open spending"
            >
              {pieData.length === 0 ? (
                <div className="home-spend-empty muted">
                  No outgoing spend charted yet for this month.
                </div>
              ) : (
                <>
                  <div
                    className="home-spend-chart"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="total"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={88}
                          paddingAngle={3}
                          stroke="#f4f6f1"
                          strokeWidth={2}
                          activeIndex={activePie}
                          activeShape={ActiveSpendSector}
                          onMouseEnter={(_, i) => setActivePie(i)}
                          onMouseLeave={() => setActivePie(undefined)}
                          onClick={openSpending}
                          style={{ cursor: 'pointer', outline: 'none' }}
                        >
                          {pieData.map((_, i) => (
                            <Cell
                              key={i}
                              fill={PIE_COLORS[i % PIE_COLORS.length]}
                              style={{
                                cursor: 'pointer',
                                outline: 'none',
                                filter:
                                  activePie === i
                                    ? undefined
                                    : 'drop-shadow(0 0 0 transparent)',
                                transition: 'opacity 0.15s ease',
                                opacity:
                                  activePie === undefined || activePie === i
                                    ? 1
                                    : 0.55,
                              }}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="home-spend-total">
                    Total shown {money(pieTotal)}
                  </div>
                  <div className="home-spend-legend">
                    {pieData.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        className={`home-legend-row clickable ${
                          activePie === i ? 'is-active' : ''
                        }`}
                        onMouseEnter={() => setActivePie(i)}
                        onMouseLeave={() => setActivePie(undefined)}
                        onClick={(e) => {
                          e.stopPropagation()
                          openSpending()
                        }}
                      >
                        <span
                          className="dot"
                          style={{
                            background: PIE_COLORS[i % PIE_COLORS.length],
                          }}
                        />
                        <span>{s.name}</span>
                        <strong>{money(s.total)}</strong>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <CoachBar onAsk={askCoach} />
    </div>
  )
}

/** Short enough to sit on one line under the box. */
type GoalsSectionProps = {
  profileId: number
  motivation: Motivation | null
  goals: Goal[]
  onSaved: () => void
  onOpenGoals: () => void
}

/**
 * The reason behind the money, then the one goal that reason is currently
 * paying for. Goals arrive ranked, so "next up" is just the first one still
 * short of its target.
 */
function GoalsSection({
  profileId,
  motivation,
  goals,
  onSaved,
  onOpenGoals,
}: GoalsSectionProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const unfinished = goals.filter((g) => g.current_amount < g.target_amount)
  const next = unfinished[0] ?? null
  const allFunded = goals.length > 0 && unfinished.length === 0

  const startEdit = () => {
    setDraft(motivation?.raw ?? '')
    setNote(null)
    setEditing(true)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const raw = draft.trim()
    if (!raw || saving) return
    setSaving(true)
    setNote(null)
    const res = await window.finance.motivation.save({ profileId, raw })
    setSaving(false)
    if (!res.ok) {
      setNote(res.error)
      return
    }
    setNote(res.data.note ?? null)
    setEditing(false)
    setDraft('')
    onSaved()
  }

  return (
    <section className="home-block home-goals-section">
      <h2 className="home-section-title home-goals-title">Goals</h2>

      {motivation && !editing ? (
        <>
          <p className="home-motivation">{motivation.line}</p>
          <button
            type="button"
            className="home-motivation-edit"
            onClick={startEdit}
          >
            change
          </button>
        </>
      ) : (
        <form className="home-motivation-ask" onSubmit={save}>
          <label className="home-motivation-q" htmlFor="home-motivation-input">
            What's your biggest money motivation?
          </label>
          <div className="home-motivation-row">
            <input
              id="home-motivation-input"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Get out of debt, more time with the kids…"
              autoFocus={editing}
            />
            <button
              type="submit"
              className="btn btn-primary home-motivation-save"
              disabled={!draft.trim() || saving}
            >
              {saving ? 'Writing…' : 'Save'}
            </button>
          </div>
          {editing ? (
            <button
              type="button"
              className="home-motivation-cancel"
              onClick={() => {
                setEditing(false)
                setNote(null)
              }}
            >
              Keep what I had
            </button>
          ) : null}
        </form>
      )}

      {note ? <p className="home-motivation-note">{note}</p> : null}

      {next ? (
        <button
          type="button"
          className="home-next-goal clickable"
          onClick={onOpenGoals}
        >
          <span className="home-kicker">Next up</span>
          <span className="home-next-goal-name">{next.name}</span>
          <GoalTrack goal={next} />
          <span className="home-next-goal-meta">
            {money(next.current_amount)} of {money(next.target_amount)}
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="home-next-goal home-next-goal-empty clickable"
          onClick={onOpenGoals}
        >
          {allFunded
            ? 'Every goal is funded. Time to pick a new one.'
            : 'No goals yet — set the first one.'}
        </button>
      )}
    </section>
  )
}

function GoalTrack({ goal }: { goal: Goal }) {
  const pct = goal.target_amount
    ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
    : 0
  return (
    <span className="home-goal-track" aria-hidden="true">
      <span
        className="home-goal-fill"
        style={{ width: `${pct}%`, background: goal.color || '#2F6F5E' }}
      />
    </span>
  )
}

const COACH_IDEAS = [
  'Where did my money go?',
  'Any bills go up?',
  'What needs a category?',
]

/**
 * A front door to the coach, kept to one line so the page still belongs to the
 * balances and the bills. The question is handed to Insights → Coach, which
 * asks it on arrival.
 */
function CoachBar({ onAsk }: { onAsk: (question: string) => void }) {
  const [text, setText] = useState('')

  return (
    <section className="home-coach-bar">
      <div className="home-kicker home-coach-kicker">Ask the coach</div>
      <form
        className="home-coach-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onAsk(text)
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about your money…"
          aria-label="Ask the coach about your money"
        />
        <button
          type="submit"
          className="btn btn-primary home-coach-send"
          disabled={!text.trim()}
          aria-label="Ask"
        >
          Ask
        </button>
      </form>
      <div className="home-coach-ideas">
        {COACH_IDEAS.map((q) => (
          <button
            key={q}
            type="button"
            className="insight-chip"
            onClick={() => onAsk(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </section>
  )
}
