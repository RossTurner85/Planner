import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  CategoryMonthRow,
  Dashboard,
  IncomeReport,
  MonthPoint,
  Transaction,
} from '../../types'
import { dayLabel, money, monthLabel, shiftMonth } from '../../lib/format'
import { billTotals } from '../../lib/bills'
import {
  AXIS_STYLE,
  CATEGORY_COLORS,
  GRID_STROKE,
  SERIES_COLORS,
  SectionHead,
  ShareRow,
  StatCell,
  TOOLTIP_STYLE,
  axisMoney,
  safeShare,
  shortMonth,
} from './shared'

type Props = {
  profileId: number
  profileIds: number[]
  month: string
}

type ReportId = 'monthly' | 'annual' | 'category' | 'income' | 'cashflow'

const REPORTS: Array<{ id: ReportId; label: string; blurb: string }> = [
  {
    id: 'monthly',
    label: 'Monthly',
    blurb: 'One month, top to bottom — what came in, what went out, what it left.',
  },
  {
    id: 'annual',
    label: 'Annual',
    blurb: 'A full calendar year at a glance, month by month.',
  },
  {
    id: 'category',
    label: 'Category',
    blurb: 'Pick a category and see twelve months of history behind it.',
  },
  {
    id: 'income',
    label: 'Income',
    blurb: 'Where your money comes from and how steady it is.',
  },
  {
    id: 'cashflow',
    label: 'Cash flow',
    blurb: 'In, out, and what stacked up over the last twelve months.',
  },
]

export function ReportsTab({ profileId, profileIds, month }: Props) {
  const [report, setReport] = useState<ReportId>('monthly')
  const current = REPORTS.find((r) => r.id === report) ?? REPORTS[0]

  return (
    <>
      <div className="insight-report-pick">
        <div className="segmented is-small">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={report === r.id ? 'active' : ''}
              onClick={() => setReport(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="muted insight-window-copy">{current.blurb}</p>
      </div>

      {report === 'monthly' ? (
        <MonthlyReport profileId={profileId} profileIds={profileIds} month={month} />
      ) : null}
      {report === 'annual' ? (
        <AnnualReport profileId={profileId} profileIds={profileIds} month={month} />
      ) : null}
      {report === 'category' ? (
        <CategoryReport profileId={profileId} profileIds={profileIds} month={month} />
      ) : null}
      {report === 'income' ? (
        <IncomeReportView profileId={profileId} profileIds={profileIds} month={month} />
      ) : null}
      {report === 'cashflow' ? (
        <CashFlowReport profileId={profileId} profileIds={profileIds} month={month} />
      ) : null}
    </>
  )
}

function MonthlyReport({ profileId, profileIds, month }: Props) {
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [byCat, setByCat] = useState<Array<{ name: string; total: number }>>([])
  const [big, setBig] = useState<Transaction[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [d, c, tx] = await Promise.all([
        window.finance.dashboard.get(profileId, month),
        window.finance.reports.spendingByCategory(
          profileIds,
          `${month}-01`,
          `${month}-31`,
        ),
        window.finance.transactions.list(profileId, {
          from: `${month}-01`,
          to: `${month}-31`,
          limit: 800,
        }),
      ])
      if (cancelled) return
      setDash(d)
      setByCat(c)
      setBig(
        tx
          .filter((t) => t.amount < 0 && !t.is_transfer)
          .sort((a, b) => a.amount - b.amount)
          .slice(0, 6),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [profileId, profileIds, month])

  if (!dash) return <div className="empty">Building report…</div>

  const net = dash.income - dash.spent
  const total = byCat.reduce((s, c) => s + c.total, 0)
  const bills = billTotals(dash.bills)
  const rate = dash.income > 0 ? (net / dash.income) * 100 : null

  return (
    <>
      <ReportTitle
        title={`${monthLabel(month)} report`}
        meta={`${dash.txCount} transactions · ${dash.accountCount} accounts`}
      />

      <section className="insight-section">
        <div className="insight-stat-grid">
          <StatCell label="Money in" value={money(dash.income)} tone="amount-pos" />
          <StatCell label="Money out" value={money(dash.spent)} tone="amount-neg" />
          <StatCell
            label="Kept"
            value={money(net)}
            tone={net >= 0 ? 'amount-pos' : 'amount-neg'}
            meta={
              rate != null ? (
                <span className="muted">{rate.toFixed(0)}% of income</span>
              ) : null
            }
          />
          <StatCell
            label="Uncategorized"
            value={String(dash.uncategorized)}
            meta={<span className="muted">still to sort</span>}
          />
        </div>
      </section>

      <section className="insight-section">
        <SectionHead
          title="Where it went"
          aside={<span className="muted">{money(total)}</span>}
        />
        {byCat.length === 0 ? (
          <div className="empty">Nothing categorized this month.</div>
        ) : (
          <ul className="insight-share-list">
            {byCat.map((c, i) => (
              <ShareRow
                key={c.name}
                label={c.name}
                value={c.total}
                share={safeShare(c.total, byCat[0].total)}
                color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                meta={`${safeShare(c.total, total).toFixed(0)}% of spending`}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="insight-section">
        <SectionHead title="Bills" />
        {dash.bills.length === 0 ? (
          <div className="empty">No bills tracked for this month.</div>
        ) : (
          <div className="insight-stat-grid">
            <StatCell label="Billed" value={money(bills.total)} />
            <StatCell
              label="Paid"
              value={money(bills.paid)}
              tone="amount-pos"
              meta={<span className="muted">{bills.paidCount} bills</span>}
            />
            <StatCell
              label="Still owed"
              value={money(bills.unpaid)}
              tone={bills.unpaid > 0 ? 'amount-neg' : undefined}
              meta={<span className="muted">{bills.unpaidCount} bills</span>}
            />
          </div>
        )}
      </section>

      {dash.budget.categories.length > 0 ? (
        <section className="insight-section">
          <SectionHead
            title="Budget performance"
            aside={
              <span className="muted">
                {money(dash.budget.spent)} of {money(dash.budget.planned)}
              </span>
            }
          />
          <ul className="insight-row-list">
            {dash.budget.categories.map((c) => {
              const over = c.spent > c.amount
              return (
                <li key={c.category_id}>
                  <div>
                    <span className="insight-row-name">
                      {c.emoji ? `${c.emoji} ` : ''}
                      {c.category_name}
                    </span>
                    <div className="muted insight-row-meta">
                      cap {money(c.amount)}
                    </div>
                  </div>
                  <div className="insight-row-right">
                    <span className="insight-row-num">{money(c.spent)}</span>
                    <span className={over ? 'amount-neg' : 'amount-pos'}>
                      {over
                        ? `${money(c.spent - c.amount)} over`
                        : `${money(c.amount - c.spent)} left`}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <section className="insight-section">
        <SectionHead title="Biggest single charges" />
        {big.length === 0 ? (
          <div className="empty">No spending recorded this month.</div>
        ) : (
          <ul className="insight-row-list">
            {big.map((t) => (
              <li key={t.id}>
                <div>
                  <span className="insight-row-name">
                    {t.payee_display || t.payee}
                  </span>
                  <div className="muted insight-row-meta">
                    {dayLabel(t.date)} · {t.category_name ?? 'Uncategorized'}
                  </div>
                </div>
                <span className="insight-row-num amount-neg">
                  {money(Math.abs(t.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function AnnualReport({ profileIds, month }: Props) {
  const [year, setYear] = useState(() => Number(month.slice(0, 4)))
  const [series, setSeries] = useState<MonthPoint[]>([])
  const [cats, setCats] = useState<CategoryMonthRow[]>([])

  useEffect(() => {
    setYear(Number(month.slice(0, 4)))
  }, [month])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [s, c] = await Promise.all([
        window.finance.reports.monthlySeries(
          profileIds,
          `${year}-01`,
          `${year}-12`,
        ),
        window.finance.reports.categoryMonthly(
          profileIds,
          `${year}-01`,
          `${year}-12`,
        ),
      ])
      if (cancelled) return
      setSeries(s)
      setCats(c)
    })()
    return () => {
      cancelled = true
    }
  }, [profileIds, year])

  const totals = useMemo(() => {
    const income = series.reduce((s, m) => s + m.income, 0)
    const spent = series.reduce((s, m) => s + m.spent, 0)
    const active = series.filter((m) => m.txCount > 0)
    return {
      income,
      spent,
      net: income - spent,
      months: active.length,
      avgSpent: active.length ? spent / active.length : 0,
      best: [...active].sort((a, b) => b.net - a.net)[0],
      worst: [...active].sort((a, b) => a.net - b.net)[0],
    }
  }, [series])

  const topCats = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of cats) {
      map.set(row.name, (map.get(row.name) ?? 0) + row.total)
    }
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
  }, [cats])

  return (
    <>
      <ReportTitle
        title={`${year} in review`}
        meta={`${totals.months} months with activity`}
        aside={
          <div className="insight-year-nav">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setYear((y) => y - 1)}
            >
              ←
            </button>
            <span>{year}</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setYear((y) => y + 1)}
            >
              →
            </button>
          </div>
        }
      />

      <section className="insight-section">
        <div className="insight-stat-grid">
          <StatCell label="Income" value={money(totals.income)} tone="amount-pos" />
          <StatCell label="Spending" value={money(totals.spent)} tone="amount-neg" />
          <StatCell
            label="Kept"
            value={money(totals.net)}
            tone={totals.net >= 0 ? 'amount-pos' : 'amount-neg'}
          />
          <StatCell label="Avg spend / month" value={money(totals.avgSpent)} />
        </div>
        {totals.best && totals.worst ? (
          <p className="muted insight-note-line">
            Best month was {monthLabel(totals.best.month)} at{' '}
            {money(totals.best.net)} kept; the tightest was{' '}
            {monthLabel(totals.worst.month)} at {money(totals.worst.net)}.
          </p>
        ) : null}
      </section>

      <section className="insight-section">
        <SectionHead
          title="Month by month"
          aside={
            <span className="insight-key">
              <span>
                <i className="dot" style={{ background: SERIES_COLORS.income }} />
                Income
              </span>
              <span>
                <i className="dot" style={{ background: SERIES_COLORS.spend }} />
                Spent
              </span>
            </span>
          }
        />
        {totals.months === 0 ? (
          <div className="empty">No transactions recorded in {year}.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={axisMoney}
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(v: number) => money(v)}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="income" name="Income" fill={SERIES_COLORS.income} radius={[5, 5, 0, 0]} />
                <Bar dataKey="spent" name="Spent" fill={SERIES_COLORS.spend} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <ul className="insight-row-list">
              {series
                .filter((m) => m.txCount > 0)
                .map((m) => (
                  <li key={m.month}>
                    <div>
                      <span className="insight-row-name">
                        {monthLabel(m.month)}
                      </span>
                      <div className="muted insight-row-meta">
                        in {money(m.income)} · out {money(m.spent)}
                      </div>
                    </div>
                    <span
                      className={`insight-row-num ${
                        m.net >= 0 ? 'amount-pos' : 'amount-neg'
                      }`}
                    >
                      {money(m.net)}
                    </span>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section className="insight-section">
        <SectionHead title={`Biggest categories of ${year}`} />
        {topCats.length === 0 ? (
          <div className="empty">Categorize spending to fill this in.</div>
        ) : (
          <ul className="insight-share-list">
            {topCats.map((c, i) => (
              <ShareRow
                key={c.name}
                label={c.name}
                value={c.total}
                share={safeShare(c.total, topCats[0].total)}
                color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                meta={`${money(c.total / Math.max(1, totals.months))} per active month`}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function CategoryReport({ profileIds, month }: Props) {
  const [rows, setRows] = useState<CategoryMonthRow[]>([])
  const [pick, setPick] = useState<string>('')
  const from = shiftMonth(month, -11)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await window.finance.reports.categoryMonthly(
        profileIds,
        from,
        month,
      )
      if (cancelled) return
      setRows(r)
    })()
    return () => {
      cancelled = true
    }
  }, [profileIds, month, from])

  const names = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.name, (map.get(r.name) ?? 0) + r.total)
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, total]) => ({ name, total }))
  }, [rows])

  const active = names.some((n) => n.name === pick)
    ? pick
    : (names[0]?.name ?? '')

  const series = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      if (r.name !== active) continue
      map.set(r.month, (map.get(r.month) ?? 0) + r.total)
    }
    const out: Array<{ month: string; label: string; total: number }> = []
    let cursor = from
    for (let i = 0; i < 12; i++) {
      out.push({
        month: cursor,
        label: shortMonth(cursor),
        total: map.get(cursor) ?? 0,
      })
      cursor = shiftMonth(cursor, 1)
    }
    return out
  }, [rows, active, from])

  const stats = useMemo(() => {
    const hits = series.filter((m) => m.total > 0)
    const total = series.reduce((s, m) => s + m.total, 0)
    const grand = rows.reduce((s, r) => s + r.total, 0)
    return {
      total,
      months: hits.length,
      avg: hits.length ? total / hits.length : 0,
      high: [...hits].sort((a, b) => b.total - a.total)[0],
      share: safeShare(total, grand),
    }
  }, [series, rows])

  if (names.length === 0) {
    return <div className="empty">No categorized spending in the last year.</div>
  }

  return (
    <>
      <ReportTitle
        title="Category report"
        meta={`${monthLabel(from)} – ${monthLabel(month)}`}
        aside={
          <label className="insight-picker">
            <span className="home-kicker">Category</span>
            <select value={active} onChange={(e) => setPick(e.target.value)}>
              {names.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <section className="insight-section">
        <div className="insight-stat-grid">
          <StatCell label="Total spent" value={money(stats.total)} />
          <StatCell
            label="Average"
            value={money(stats.avg)}
            meta={<span className="muted">per active month</span>}
          />
          <StatCell
            label="Highest month"
            value={stats.high ? money(stats.high.total) : '—'}
            meta={
              stats.high ? (
                <span className="muted">{monthLabel(stats.high.month)}</span>
              ) : null
            }
          />
          <StatCell
            label="Share of spending"
            value={`${stats.share.toFixed(0)}%`}
            meta={<span className="muted">of all categories</span>}
          />
        </div>
      </section>

      <section className="insight-section">
        <SectionHead title={`${active} over 12 months`} />
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={axisMoney}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              formatter={(v: number) => money(v)}
              contentStyle={TOOLTIP_STYLE}
            />
            <Bar
              dataKey="total"
              name={active}
              fill={SERIES_COLORS.spend}
              radius={[6, 6, 0, 0]}
              maxBarSize={38}
            />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="insight-section">
        <SectionHead title="Every category, last 12 months" />
        <ul className="insight-share-list">
          {names.slice(0, 12).map((n, i) => (
            <ShareRow
              key={n.name}
              label={n.name}
              value={n.total}
              share={safeShare(n.total, names[0].total)}
              color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
              meta={`${money(n.total / 12)} per month averaged`}
            />
          ))}
        </ul>
      </section>
    </>
  )
}

function IncomeReportView({ profileIds, month }: Props) {
  const [data, setData] = useState<IncomeReport | null>(null)
  const from = shiftMonth(month, -11)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await window.finance.reports.incomeReport(profileIds, from, month)
      if (cancelled) return
      setData(r)
    })()
    return () => {
      cancelled = true
    }
  }, [profileIds, month, from])

  if (!data) return <div className="empty">Building report…</div>

  const active = data.byMonth.filter((m) => m.total > 0)
  const avgMonth = active.length ? data.total / active.length : 0
  const best = [...active].sort((a, b) => b.total - a.total)[0]
  const low = [...active].sort((a, b) => a.total - b.total)[0]
  const steady =
    best && low && best.total > 0
      ? 100 - safeShare(best.total - low.total, best.total)
      : null

  if (data.total === 0) {
    return (
      <div className="empty">
        No income recorded between {monthLabel(from)} and {monthLabel(month)}.
      </div>
    )
  }

  return (
    <>
      <ReportTitle
        title="Income report"
        meta={`${monthLabel(from)} – ${monthLabel(month)}`}
      />

      <section className="insight-section">
        <div className="insight-stat-grid">
          <StatCell label="Total income" value={money(data.total)} tone="amount-pos" />
          <StatCell
            label="Average"
            value={money(avgMonth)}
            meta={<span className="muted">per month with income</span>}
          />
          <StatCell
            label="Best month"
            value={best ? money(best.total) : '—'}
            meta={best ? <span className="muted">{best.label}</span> : null}
          />
          <StatCell
            label="Steadiness"
            value={steady != null ? `${steady.toFixed(0)}%` : '—'}
            meta={<span className="muted">high vs low month</span>}
          />
        </div>
      </section>

      <section className="insight-section">
        <SectionHead title="Income over the year" />
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={data.byMonth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={axisMoney}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              formatter={(v: number) => money(v)}
              contentStyle={TOOLTIP_STYLE}
            />
            <Line
              type="monotone"
              dataKey="total"
              name="Income"
              stroke={SERIES_COLORS.income}
              strokeWidth={2.5}
              dot={{ r: 3, fill: SERIES_COLORS.income }}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="insight-section">
        <SectionHead title="Where it comes from" />
        <ul className="insight-share-list">
          {data.sources.slice(0, 10).map((src, i) => (
            <ShareRow
              key={src.name}
              label={src.name}
              value={src.total}
              share={safeShare(src.total, data.sources[0].total)}
              color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
              meta={`${src.count} deposits across ${src.months} month${
                src.months === 1 ? '' : 's'
              } · ${safeShare(src.total, data.total).toFixed(0)}% of income`}
            />
          ))}
        </ul>
      </section>
    </>
  )
}

function CashFlowReport({ profileIds, month }: Props) {
  const [series, setSeries] = useState<MonthPoint[]>([])
  const from = shiftMonth(month, -11)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = await window.finance.reports.monthlySeries(
        profileIds,
        from,
        month,
      )
      if (cancelled) return
      setSeries(s)
    })()
    return () => {
      cancelled = true
    }
  }, [profileIds, month, from])

  const rows = useMemo(() => {
    let run = 0
    return series.map((m) => {
      run += m.net
      return { ...m, running: run }
    })
  }, [series])

  const totals = useMemo(() => {
    const income = series.reduce((s, m) => s + m.income, 0)
    const spent = series.reduce((s, m) => s + m.spent, 0)
    const positive = series.filter((m) => m.txCount > 0 && m.net >= 0).length
    const active = series.filter((m) => m.txCount > 0).length
    return { income, spent, net: income - spent, positive, active }
  }, [series])

  if (totals.active === 0) {
    return <div className="empty">No cash-flow history to report yet.</div>
  }

  return (
    <>
      <ReportTitle
        title="Cash-flow report"
        meta={`${monthLabel(from)} – ${monthLabel(month)}`}
      />

      <section className="insight-section">
        <div className="insight-stat-grid">
          <StatCell label="In" value={money(totals.income)} tone="amount-pos" />
          <StatCell label="Out" value={money(totals.spent)} tone="amount-neg" />
          <StatCell
            label="Net"
            value={money(totals.net)}
            tone={totals.net >= 0 ? 'amount-pos' : 'amount-neg'}
          />
          <StatCell
            label="Positive months"
            value={`${totals.positive} of ${totals.active}`}
            meta={
              <span className="muted">
                {safeShare(totals.positive, totals.active).toFixed(0)}% of the
                time
              </span>
            }
          />
        </div>
      </section>

      <section className="insight-section">
        <SectionHead title="Running total" />
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={axisMoney}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              formatter={(v: number) => money(v)}
              contentStyle={TOOLTIP_STYLE}
            />
            <Line
              type="monotone"
              dataKey="running"
              name="Cumulative net"
              stroke={SERIES_COLORS.net}
              strokeWidth={2.5}
              dot={{ r: 3, fill: SERIES_COLORS.net }}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="insight-section">
        <SectionHead title="Month detail" />
        <ul className="insight-flow-list">
          {rows
            .filter((m) => m.txCount > 0)
            .reverse()
            .map((m) => (
              <li key={m.month}>
                <span className="insight-flow-month">{monthLabel(m.month)}</span>
                <span className="amount-pos">{money(m.income)}</span>
                <span className="amount-neg">{money(m.spent)}</span>
                <span className={m.net >= 0 ? 'amount-pos' : 'amount-neg'}>
                  {money(m.net)}
                </span>
                <span className="muted">{money(m.running)} running</span>
              </li>
            ))}
        </ul>
      </section>
    </>
  )
}

function ReportTitle({
  title,
  meta,
  aside,
}: {
  title: string
  meta?: string
  aside?: React.ReactNode
}) {
  return (
    <div className="insight-report-title">
      <div>
        <h2 className="insight-report-h">{title}</h2>
        {meta ? <p className="muted insight-report-meta">{meta}</p> : null}
      </div>
      {aside ?? null}
    </div>
  )
}
