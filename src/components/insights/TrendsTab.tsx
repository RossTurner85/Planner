import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MonthPoint, RecurringChange, TrendsData } from '../../types'
import { money, shiftMonth } from '../../lib/format'
import {
  AXIS_STYLE,
  GRID_STROKE,
  SERIES_COLORS,
  SectionHead,
  TOOLTIP_STYLE,
  axisMoney,
  deltaClass,
  formatPct,
  safeShare,
  shortMonth,
} from './shared'

type Props = {
  profileIds: number[]
  month: string
}

type Span = 3 | 6 | 12

const SPANS: Array<{ id: Span; label: string }> = [
  { id: 3, label: '3 months' },
  { id: 6, label: '6 months' },
  { id: 12, label: '12 months' },
]

export function TrendsTab({ profileIds, month }: Props) {
  const [win, setWin] = useState<Span>(6)
  const [series, setSeries] = useState<MonthPoint[]>([])
  const [compare, setCompare] = useState<Record<Span, TrendsData> | null>(null)
  const [recurring, setRecurring] = useState<RecurringChange[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const from = shiftMonth(month, -11)
      const [s, t3, t6, t12, rec] = await Promise.all([
        window.finance.reports.monthlySeries(profileIds, from, month),
        window.finance.reports.trends(profileIds, '3m', month),
        window.finance.reports.trends(profileIds, '6m', month),
        window.finance.reports.trends(profileIds, '1y', month),
        window.finance.reports.recurring(profileIds, month, 6),
      ])
      if (cancelled) return
      setSeries(s)
      setCompare({ 3: t3, 6: t6, 12: t12 })
      setRecurring(rec)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [profileIds, month])

  const shown = useMemo(() => series.slice(-win), [series, win])
  const hasData = shown.some((m) => m.spent > 0 || m.income > 0)

  const cumulative = useMemo(() => {
    let run = 0
    return shown.map((m) => {
      run += m.net
      return { ...m, running: run }
    })
  }, [shown])

  if (loading) return <div className="empty">Loading trends…</div>

  const active = compare?.[win]
  const categoryChanges = active?.categoryChanges ?? []
  const worstCat = categoryChanges[0]
    ? Math.max(
        ...categoryChanges.map((c) => Math.max(c.current, c.previous)),
        1,
      )
    : 1
  const movers = recurring.filter((r) => Math.abs(r.changeAbs) >= 1).slice(0, 8)

  return (
    <>
      <div className="insight-window">
        <div className="segmented is-small">
          {SPANS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={win === w.id ? 'active' : ''}
              onClick={() => setWin(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <p className="muted insight-window-copy">
          Ending {shown.at(-1)?.label ?? '—'} · anchored to the month in the top
          bar
        </p>
      </div>

      {!hasData ? (
        <div className="empty">
          Import a few months of statements and trends will fill in here.
        </div>
      ) : (
        <>
          <section className="insight-section">
            <SectionHead
              title="Spending over time"
              aside={
                <span className="muted">
                  avg {money(avg(shown.map((m) => m.spent)))} / month
                </span>
              }
            />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={shown} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
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
                  dataKey="spent"
                  name="Spent"
                  fill={SERIES_COLORS.spend}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={44}
                />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="insight-section">
            <SectionHead
              title="Income over time"
              aside={
                <span className="muted">
                  avg {money(avg(shown.map((m) => m.income)))} / month
                </span>
              }
            />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={shown} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
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
                  dataKey="income"
                  name="Income"
                  fill={SERIES_COLORS.income}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={44}
                />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="insight-section">
            <SectionHead
              title="Money kept, month by month"
              aside={<span className="muted">running total of income − spending</span>}
            />
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={cumulative} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="insightNetFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES_COLORS.net} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={SERIES_COLORS.net} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
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
                <Area
                  type="monotone"
                  dataKey="running"
                  name="Kept so far"
                  stroke={SERIES_COLORS.net}
                  strokeWidth={2}
                  fill="url(#insightNetFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </section>
        </>
      )}

      <section className="insight-section">
        <SectionHead
          title="Category trends"
          aside={
            active ? (
              <span className="muted">
                {active.currentLabel} vs {active.previousLabel}
              </span>
            ) : null
          }
        />
        {categoryChanges.length === 0 ? (
          <div className="empty">Categorize spending to compare categories.</div>
        ) : (
          <ul className="insight-trend-list">
            {categoryChanges.map((c) => (
              <li key={c.name}>
                <div className="insight-trend-top">
                  <span className="insight-trend-name">{c.name}</span>
                  <span
                    className={
                      c.changeAbs > 0
                        ? 'amount-neg'
                        : c.changeAbs < 0
                          ? 'amount-pos'
                          : 'muted'
                    }
                  >
                    {c.changeAbs > 0 ? '+' : ''}
                    {money(c.changeAbs)} · {formatPct(c.changePct)}
                  </span>
                </div>
                <div className="insight-trend-bars">
                  <span className="insight-trend-bar">
                    <i
                      style={{
                        width: `${safeShare(c.previous, worstCat)}%`,
                        background: 'rgba(27,36,32,0.22)',
                      }}
                    />
                  </span>
                  <span className="insight-trend-bar">
                    <i
                      style={{
                        width: `${safeShare(c.current, worstCat)}%`,
                        background: SERIES_COLORS.spend,
                      }}
                    />
                  </span>
                </div>
                <div className="muted insight-trend-meta">
                  {money(c.previous)} before · {money(c.current)} now
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="insight-section">
        <SectionHead
          title="Recurring expense changes"
          aside={<span className="muted">seen in 3+ of the last 6 months</span>}
        />
        {movers.length === 0 ? (
          <div className="empty">
            No repeat merchants have shifted enough to flag yet.
          </div>
        ) : (
          <ul className="insight-row-list">
            {movers.map((r) => (
              <li key={r.name}>
                <div>
                  <span className="insight-row-name">{r.name}</span>
                  <div className="muted insight-row-meta">
                    usually {money(r.priorAvg)} · charged in {r.monthsSeen} of
                    the last 6 months
                  </div>
                </div>
                <div className="insight-row-right">
                  <span className="insight-row-num">{money(r.latest)}</span>
                  <span className="muted">{shortMonth(r.latestMonth)}</span>
                  <span className={deltaClass(r.changeAbs, 'spend')}>
                    {r.changeAbs > 0 ? '+' : ''}
                    {money(r.changeAbs)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="insight-section">
        <SectionHead title="3 / 6 / 12-month comparisons" />
        {!compare ? (
          <div className="empty">Loading comparisons…</div>
        ) : (
          <ul className="insight-compare-list">
            {SPANS.map((w) => {
              const c = compare[w.id].summary
              return (
                <li key={w.id}>
                  <div className="insight-compare-head">
                    <span className="insight-row-name">Last {w.label}</span>
                    <span className="muted">
                      vs {compare[w.id].previousLabel}
                    </span>
                  </div>
                  <div className="insight-compare-grid">
                    <div>
                      <div className="home-kicker">Spent</div>
                      <div className="insight-compare-num">
                        {money(c.currentSpent)}
                      </div>
                      <div className={deltaClass(c.spentChangePct, 'spend')}>
                        {formatPct(c.spentChangePct)}
                      </div>
                    </div>
                    <div>
                      <div className="home-kicker">Income</div>
                      <div className="insight-compare-num">
                        {money(c.currentIncome)}
                      </div>
                      <div className={deltaClass(c.incomeChangePct, 'gain')}>
                        {formatPct(c.incomeChangePct)}
                      </div>
                    </div>
                    <div>
                      <div className="home-kicker">Kept</div>
                      <div
                        className={`insight-compare-num ${
                          c.currentNet >= 0 ? 'amount-pos' : 'amount-neg'
                        }`}
                      >
                        {money(c.currentNet)}
                      </div>
                      <div className={deltaClass(c.netChangePct, 'gain')}>
                        {formatPct(c.netChangePct)}
                      </div>
                    </div>
                    <div>
                      <div className="home-kicker">Avg / month</div>
                      <div className="insight-compare-num">
                        {money(c.avgSpent)}
                      </div>
                      <div className="muted">spending</div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

function avg(nums: number[]) {
  if (nums.length === 0) return 0
  return nums.reduce((s, n) => s + n, 0) / nums.length
}
