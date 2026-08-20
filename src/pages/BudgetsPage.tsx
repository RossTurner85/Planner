import { FormEvent, useEffect, useMemo, useState } from 'react'
import type {
  BillStatus,
  Category,
  Dashboard,
  NavOptions,
  PageId,
} from '../types'
import { money, monthLabel, shiftMonth, todayISO } from '../lib/format'
import { billScheduleLabel, billTotals, sortMonthBills } from '../lib/bills'

type BudgetRow = {
  category_id: number
  category_name: string
  amount: number
  spent: number
  emoji?: string
  group_name?: string
}

type Suggestion = {
  categoryId: number
  name: string
  spent: number
  suggested: number
}

/** One proposed cap in the "build my budget" flow. */
type DraftCap = {
  categoryId: number
  name: string
  /** Average monthly spend across the 3 prior months. */
  avg: number
  /** Existing cap for this month, if any. */
  existing: number | null
  amount: string
  include: boolean
}

type Props = {
  profileId: number
  month: string
  onNavigate: (page: PageId, opts?: NavOptions) => void
}

function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

function monthEnd(month: string) {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
}

function shortMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' })
}

/** Months averaged when proposing caps. */
const LOOKBACK = 3

/** 0 = month hasn't started, 1 = month is over. */
function monthProgress(month: string) {
  const today = todayISO()
  const nowMonth = today.slice(0, 7)
  if (month < nowMonth) return 1
  if (month > nowMonth) return 0
  return Math.min(1, Number(today.slice(8, 10)) / daysInMonth(month))
}

/** Days left to spend, counting today. */
function daysRemaining(month: string) {
  const today = todayISO()
  const nowMonth = today.slice(0, 7)
  if (month < nowMonth) return 0
  if (month > nowMonth) return daysInMonth(month)
  return daysInMonth(month) - Number(today.slice(8, 10)) + 1
}

type PaceState = { key: 'ok' | 'hot' | 'over' | 'cool' | 'idle'; label: string }

function paceState(spent: number, cap: number, pace: number): PaceState {
  if (cap <= 0) return { key: 'idle', label: '' }
  if (spent > cap) return { key: 'over', label: 'over cap' }
  if (pace >= 1) return { key: 'ok', label: 'stayed under' }
  if (spent === 0) return { key: 'idle', label: 'nothing yet' }
  const expected = cap * pace
  if (spent > expected * 1.15) return { key: 'hot', label: 'running hot' }
  if (spent < expected * 0.6) return { key: 'cool', label: 'well under' }
  return { key: 'ok', label: 'on track' }
}

function roundCap(n: number) {
  if (n <= 0) return 0
  const step = n < 200 ? 10 : 25
  return Math.ceil(n / step) * step
}

export function BudgetsPage({ profileId, month, onNavigate }: Props) {
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [monthSpend, setMonthSpend] = useState<Array<{ name: string; total: number }>>([])
  /** Average monthly spend per category name over the prior `LOOKBACK` months. */
  const [avgByName, setAvgByName] = useState<Record<string, number>>({})
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [amount, setAmount] = useState('')
  const [buildOpen, setBuildOpen] = useState(false)
  const [draft, setDraft] = useState<DraftCap[]>([])
  const [applying, setApplying] = useState(false)

  const priorMonths = useMemo(
    () =>
      Array.from({ length: LOOKBACK }, (_, i) =>
        shiftMonth(month, -(LOOKBACK - i)),
      ),
    [month],
  )

  const load = async () => {
    const [d, c, spend] = await Promise.all([
      window.finance.dashboard.get(profileId, month),
      window.finance.categories.list(profileId),
      window.finance.reports.spendingByCategory(
        profileId,
        `${month}-01`,
        monthEnd(month),
      ),
    ])
    const prior = await Promise.all(
      priorMonths.map((m) =>
        window.finance.reports.spendingByCategory(
          profileId,
          `${m}-01`,
          monthEnd(m),
        ),
      ),
    )
    const totals: Record<string, number> = {}
    for (const rows of prior) {
      for (const r of rows) totals[r.name] = (totals[r.name] ?? 0) + r.total
    }
    for (const name of Object.keys(totals)) totals[name] /= LOOKBACK

    setDash(d)
    setCategories(
      c.filter((x) => x.kind === 'expense' && x.name !== 'Uncategorized'),
    )
    setMonthSpend(spend)
    setAvgByName(totals)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, month])

  const bills: BillStatus[] = dash?.bills ?? []
  const sortedBills = useMemo(() => sortMonthBills(bills), [bills])
  const totals = useMemo(() => billTotals(bills), [bills])

  const caps = (dash?.budget.categories ?? []) as BudgetRow[]
  const capsPlanned = dash?.budget.planned ?? 0
  const capsSpent = dash?.budget.spent ?? 0
  const capsLeft = capsPlanned - capsSpent

  const income = dash?.income ?? 0
  const hasIncome = income > 0
  const committed = totals.total + capsPlanned
  const unallocated = income - committed
  const splitBase = Math.max(income, committed, 1)

  const pace = monthProgress(month)
  const daysLeft = daysRemaining(month)

  /** Categories already covered by a fixed bill — those aren't flexible. */
  const billCategoryIds = useMemo(() => {
    const s = new Set<number>()
    for (const b of bills) if (b.category_id != null) s.add(b.category_id)
    return s
  }, [bills])

  /** Expense categories that are fair game for a flexible cap. */
  const flexCategories = useMemo(
    () => categories.filter((c) => !billCategoryIds.has(c.id)),
    [categories, billCategoryIds],
  )

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!dash) return []
    const capped = new Set(caps.map((b) => b.category_name))
    const idByName = new Map(flexCategories.map((c) => [c.name, c.id]))
    return monthSpend
      .filter((r) => !capped.has(r.name) && idByName.has(r.name))
      .sort((a, b) => b.total - a.total)
      .slice(0, 4)
      .map((r) => ({
        categoryId: idByName.get(r.name) as number,
        name: r.name,
        spent: r.total,
        suggested: roundCap(Math.max(r.total, avgByName[r.name] ?? 0)),
      }))
  }, [dash, caps, flexCategories, monthSpend, avgByName])

  const editingExisting = caps.some((b) => b.category_id === categoryId)

  const startEdit = (b: BudgetRow) => {
    setCategoryId(b.category_id)
    setAmount(String(b.amount))
  }

  const applySuggestion = (s: Suggestion) => {
    setCategoryId(s.categoryId)
    setAmount(String(s.suggested))
  }

  const openBuild = () => {
    const capByCategory = new Map(caps.map((b) => [b.category_id, b.amount]))
    const spentByName = new Map(monthSpend.map((r) => [r.name, r.total]))
    const proposed = flexCategories
      .map((c) => {
        const avg = avgByName[c.name] ?? 0
        const existing = capByCategory.get(c.id) ?? null
        // Never propose a cap you've already blown through this month.
        const cap = roundCap(Math.max(avg, spentByName.get(c.name) ?? 0))
        return {
          categoryId: c.id,
          name: c.name,
          avg,
          existing,
          amount: String(cap),
          include: existing == null,
        }
      })
      .filter((r) => Number(r.amount) > 0)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 6)
    setDraft(proposed)
    setBuildOpen(true)
  }

  const closeBuild = () => {
    setBuildOpen(false)
    setDraft([])
  }

  const patchDraft = (categoryId: number, patch: Partial<DraftCap>) => {
    setDraft((rows) =>
      rows.map((r) => (r.categoryId === categoryId ? { ...r, ...patch } : r)),
    )
  }

  const includedDraft = draft.filter(
    (r) => r.include && Number(r.amount) > 0,
  )

  const applyBuild = async () => {
    if (includedDraft.length === 0) return
    setApplying(true)
    try {
      for (const row of includedDraft) {
        await window.finance.budgets.upsert({
          profileId,
          categoryId: row.categoryId,
          month,
          amount: Number(row.amount),
        })
      }
      await load()
      closeBuild()
    } finally {
      setApplying(false)
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!categoryId || !amount) return
    await window.finance.budgets.upsert({
      profileId,
      categoryId,
      month,
      amount: Number(amount),
    })
    setAmount('')
    setCategoryId('')
    await load()
  }

  if (!dash) return <div className="empty">Loading budgets…</div>

  const paidPct = totals.total > 0 ? (totals.paid / totals.total) * 100 : 0

  return (
    <div className="budgets-page">
      <section className="budget-plan">
        <div className="budget-plan-top">
          <div className="budget-plan-cell">
            <div className="home-kicker">Money in</div>
            <div className="budget-plan-num">{money(income)}</div>
            <div className="muted budget-plan-sub">{monthLabel(month)}</div>
          </div>
          <div className="budget-plan-cell">
            <div className="home-kicker">Committed</div>
            <div className="budget-plan-num">{money(committed)}</div>
            <div className="muted budget-plan-sub">bills + caps</div>
          </div>
          <div className="budget-plan-cell">
            <div className="home-kicker">Unallocated</div>
            <div
              className={`budget-plan-num ${
                !hasIncome ? '' : unallocated >= 0 ? 'amount-pos' : 'amount-neg'
              }`}
            >
              {hasIncome ? money(unallocated) : '—'}
            </div>
            <div className="muted budget-plan-sub">
              {hasIncome
                ? unallocated >= 0
                  ? 'not spoken for'
                  : 'plan exceeds income'
                : 'no income logged yet'}
            </div>
          </div>
        </div>

        <div className="budget-split" aria-hidden>
          <span
            className="budget-seg is-bills"
            style={{ width: `${(totals.total / splitBase) * 100}%` }}
          />
          <span
            className="budget-seg is-caps"
            style={{ width: `${(capsPlanned / splitBase) * 100}%` }}
          />
          <span
            className="budget-seg is-free"
            style={{ width: `${(Math.max(0, unallocated) / splitBase) * 100}%` }}
          />
        </div>
        <div className="budget-split-legend">
          <span>
            <i className="dot budget-dot is-bills" />
            Fixed bills {money(totals.total)}
          </span>
          <span>
            <i className="dot budget-dot is-caps" />
            Flexible caps {money(capsPlanned)}
          </span>
          <span>
            <i className="dot budget-dot is-free" />
            Free {money(Math.max(0, unallocated))}
          </span>
        </div>
      </section>

      <section className="budget-section">
        <div className="budget-section-head">
          <h2 className="home-section-title">Fixed bills</h2>
          <button
            type="button"
            className="text-link"
            onClick={() => onNavigate('bills')}
          >
            Manage in Bills
          </button>
        </div>

        {bills.length === 0 ? (
          <div className="empty">
            No bills land in {monthLabel(month)} yet — import a bill PDF to see
            them counted here.
          </div>
        ) : (
          <>
            <div className="budget-bill-stats">
              <div>
                <div className="home-kicker">Due this month</div>
                <div className="budget-stat-num">{money(totals.total)}</div>
              </div>
              <div>
                <div className="home-kicker">Paid</div>
                <div className="budget-stat-num amount-pos">
                  {money(totals.paid)}
                </div>
              </div>
              <div>
                <div className="home-kicker">Still owed</div>
                <div
                  className={`budget-stat-num ${
                    totals.unpaid > 0 ? 'amount-neg' : ''
                  }`}
                >
                  {money(totals.unpaid)}
                </div>
              </div>
            </div>

            <div className="progress budget-bill-progress">
              <span style={{ width: `${paidPct}%` }} />
            </div>
            <div className="muted budget-bill-progress-note">
              {totals.paidCount} of {bills.length} paid ·{' '}
              {totals.unpaidCount === 0
                ? 'all clear this month'
                : `${totals.unpaidCount} still to go`}
            </div>

            <ul className="budget-bill-list">
              {sortedBills.map((b) => (
                <li
                  key={b.id}
                  className={`budget-bill-row${
                    b.status === 'paid' ? ' is-paid' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="budget-bill-name"
                    onClick={() => onNavigate('bills')}
                    title="Open in Bills"
                  >
                    {b.name}
                  </button>
                  <span className="muted budget-bill-meta">
                    {billScheduleLabel(b)}
                  </span>
                  <span className={`bill-flag status-${b.status}`}>
                    {b.status}
                  </span>
                  <span className="budget-bill-amount">{money(b.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="budget-section">
        <div className="budget-section-head">
          <h2 className="home-section-title">Flexible spending</h2>
          {capsPlanned > 0 && daysLeft > 0 ? (
            <span className="muted budget-daily">
              ≈ {money(Math.max(0, capsLeft) / daysLeft)}/day for {daysLeft} more
              day{daysLeft === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        {caps.length === 0 ? (
          <div className="budget-cap-empty">
            <p className="muted" style={{ margin: 0 }}>
              No caps yet. Let your own history pick the starting numbers.
            </p>
            <button type="button" className="btn btn-primary" onClick={openBuild}>
              Build my budget
            </button>
          </div>
        ) : (
          <ul className="budget-cap-list">
            {caps.map((b) => {
              const over = b.spent > b.amount
              const pct = b.amount
                ? Math.min(100, (b.spent / b.amount) * 100)
                : 0
              const state = paceState(b.spent, b.amount, pace)
              const perDay = daysLeft > 0 ? (b.amount - b.spent) / daysLeft : 0
              return (
                <li key={b.category_id} className="budget-cap-row">
                  <button
                    type="button"
                    className="budget-cap-hit"
                    onClick={() => startEdit(b)}
                    title="Edit this cap"
                  >
                    <div className="budget-cap-top">
                      <strong className="budget-cap-name">
                        {b.emoji ? `${b.emoji} ` : ''}
                        {b.category_name}
                      </strong>
                      {state.label ? (
                        <span className={`budget-pace-flag is-${state.key}`}>
                          {state.label}
                        </span>
                      ) : null}
                      <span className="budget-cap-amount">
                        {money(b.spent)}
                        <span className="muted"> / {money(b.amount)}</span>
                      </span>
                    </div>
                    <div
                      className={`progress budget-cap-bar ${over ? 'over' : ''}`}
                    >
                      <span style={{ width: `${over ? 100 : pct}%` }} />
                      {pace > 0 && pace < 1 ? (
                        <i
                          className="budget-pace-mark"
                          style={{ left: `${pace * 100}%` }}
                        />
                      ) : null}
                    </div>
                    <div className="muted budget-cap-foot">
                      {over
                        ? `${money(b.spent - b.amount)} over`
                        : `${money(b.amount - b.spent)} left`}
                      {!over && daysLeft > 0
                        ? ` · ${money(Math.max(0, perDay))}/day`
                        : ''}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="budget-section">
        <div className="budget-section-head">
          <h2 className="home-section-title">
            {editingExisting ? 'Update a cap' : 'Set a cap'}
          </h2>
          {categoryId ? (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setCategoryId('')
                setAmount('')
              }}
            >
              Clear
            </button>
          ) : !buildOpen ? (
            <button type="button" className="text-link" onClick={openBuild}>
              Build from my history
            </button>
          ) : null}
        </div>
        <p className="muted budget-section-copy">
          Cap only the categories that move — groceries, dining, shopping. Fixed
          bills are already counted above, so this list stays short enough to
          stick with.
        </p>

        {buildOpen ? (
          <div className="budget-build">
            <div className="budget-build-head">
              <div>
                <div className="home-kicker">Proposed caps</div>
                <p className="muted budget-section-copy">
                  Built from what you actually spent {shortMonth(priorMonths[0])}–
                  {shortMonth(priorMonths[priorMonths.length - 1])}. Uncheck
                  anything you don’t want, and change any number.
                </p>
              </div>
              <button type="button" className="text-link" onClick={closeBuild}>
                Cancel
              </button>
            </div>

            {draft.length === 0 ? (
              <div className="empty">
                Not enough spending history yet — import a few months of
                statements and try again.
              </div>
            ) : (
              <>
                <ul className="budget-build-list">
                  {draft.map((row) => (
                    <li
                      key={row.categoryId}
                      className={`budget-build-row${
                        row.include ? '' : ' is-off'
                      }`}
                    >
                      <label className="budget-build-check">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={(e) =>
                            patchDraft(row.categoryId, {
                              include: e.target.checked,
                            })
                          }
                        />
                        <span className="budget-build-name">{row.name}</span>
                      </label>
                      <span className="muted budget-build-meta">
                        {money(row.avg)}/mo typical
                        {row.existing != null
                          ? ` · capped at ${money(row.existing)} now`
                          : ''}
                      </span>
                      <input
                        className="budget-build-input"
                        value={row.amount}
                        inputMode="decimal"
                        aria-label={`Cap for ${row.name}`}
                        onChange={(e) =>
                          patchDraft(row.categoryId, { amount: e.target.value })
                        }
                      />
                    </li>
                  ))}
                </ul>
                <div className="budget-build-foot">
                  <span className="muted">
                    {includedDraft.length} selected ·{' '}
                    {money(
                      includedDraft.reduce((s, r) => s + Number(r.amount), 0),
                    )}{' '}
                    of caps
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={applying || includedDraft.length === 0}
                    onClick={() => void applyBuild()}
                  >
                    {applying
                      ? 'Saving…'
                      : `Apply ${includedDraft.length} cap${
                          includedDraft.length === 1 ? '' : 's'
                        }`}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {!buildOpen && suggestions.length > 0 ? (
          <div className="budget-suggest">
            <div className="home-kicker">Spending with no cap yet</div>
            <div className="budget-suggest-chips">
              {suggestions.map((s) => (
                <button
                  key={s.categoryId}
                  type="button"
                  className="budget-suggest-chip"
                  onClick={() => applySuggestion(s)}
                >
                  <span className="budget-suggest-name">{s.name}</span>
                  <span className="muted budget-suggest-meta">
                    {money(s.spent)} so far · try {money(s.suggested)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <form className="form-grid budget-form" onSubmit={onSubmit}>
          <div className="field">
            <label>Category</label>
            <select
              value={categoryId}
              onChange={(e) =>
                setCategoryId(e.target.value ? Number(e.target.value) : '')
              }
              required
            >
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji ? `${c.emoji} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Monthly cap</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="400"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">
            {editingExisting ? 'Update cap' : 'Set cap'}
          </button>
        </form>
      </section>
    </div>
  )
}
