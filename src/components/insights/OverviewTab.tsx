import { useEffect, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { TrendsData } from '../../types'
import { money, monthLabel } from '../../lib/format'
import {
  CATEGORY_COLORS,
  SectionHead,
  ShareRow,
  StatCell,
  TOOLTIP_STYLE,
  deltaClass,
  formatPct,
  safeShare,
} from './shared'

type Props = {
  profileIds: number[]
  month: string
}

type CatRow = { name: string; total: number }

export function OverviewTab({ profileIds, month }: Props) {
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [byCat, setByCat] = useState<CatRow[]>([])
  const [txCount, setTxCount] = useState(0)
  const [notes, setNotes] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [t, c, series] = await Promise.all([
        window.finance.reports.trends(profileIds, 'mom', month),
        window.finance.reports.spendingByCategory(
          profileIds,
          `${month}-01`,
          `${month}-31`,
        ),
        window.finance.reports.monthlySeries(profileIds, month, month),
      ])
      if (cancelled) return
      setTrends(t)
      setByCat(c)
      setTxCount(series[0]?.txCount ?? 0)
    })()
    void window.finance.coach.insights(profileIds[0], month).then((r) => {
      if (!cancelled) setNotes(r.insights.slice(0, 3))
    })
    return () => {
      cancelled = true
    }
  }, [profileIds, month])

  const catTotal = useMemo(
    () => byCat.reduce((s, c) => s + c.total, 0),
    [byCat],
  )

  if (!trends) return <div className="empty">Loading overview…</div>

  const s = trends.summary
  const biggest = Math.max(s.currentIncome, s.currentSpent, 1)
  const savingsRate =
    s.currentIncome > 0 ? (s.currentNet / s.currentIncome) * 100 : null
  const topCats = byCat.slice(0, 5)

  return (
    <>
      {notes.length > 0 ? (
        <section className="insight-section">
          <SectionHead title="What stands out" />
          <ul className="insight-note-list">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="insight-section">
        <SectionHead
          title="Income vs spending"
          aside={<span className="muted">{monthLabel(month)}</span>}
        />
        <div className="insight-versus">
          <div className="insight-versus-row">
            <span className="insight-versus-label">Money in</span>
            <div className="insight-versus-track">
              <span
                className="is-income"
                style={{ width: `${safeShare(s.currentIncome, biggest)}%` }}
              />
            </div>
            <span className="insight-versus-num amount-pos">
              {money(s.currentIncome)}
            </span>
          </div>
          <div className="insight-versus-row">
            <span className="insight-versus-label">Money out</span>
            <div className="insight-versus-track">
              <span
                className="is-spend"
                style={{ width: `${safeShare(s.currentSpent, biggest)}%` }}
              />
            </div>
            <span className="insight-versus-num amount-neg">
              {money(s.currentSpent)}
            </span>
          </div>
        </div>

        <div className="insight-stat-grid">
          <StatCell
            label="Income"
            value={money(s.currentIncome)}
            meta={
              <span className={deltaClass(s.incomeChangePct, 'gain')}>
                {formatPct(s.incomeChangePct)} vs last month
              </span>
            }
          />
          <StatCell
            label="Spending"
            value={money(s.currentSpent)}
            meta={
              <span className={deltaClass(s.spentChangePct, 'spend')}>
                {formatPct(s.spentChangePct)} vs last month
              </span>
            }
          />
          <StatCell
            label="Transactions"
            value={String(txCount)}
            meta={<span className="muted">counted this month</span>}
          />
        </div>
      </section>

      <section className="insight-section">
        <SectionHead title="Net cash flow" />
        <div className="insight-net">
          <div
            className={`insight-net-num ${
              s.currentNet >= 0 ? 'amount-pos' : 'amount-neg'
            }`}
          >
            {money(s.currentNet)}
          </div>
          <p className="muted insight-net-copy">
            {s.currentNet >= 0
              ? `You kept ${money(s.currentNet)} of what came in`
              : `You spent ${money(Math.abs(s.currentNet))} more than came in`}
            {savingsRate != null
              ? ` — that's ${savingsRate.toFixed(0)}% of your income.`
              : '.'}
          </p>
        </div>
        <div className="insight-stat-grid">
          <StatCell
            label="Last month"
            value={money(s.previousNet)}
            tone={s.previousNet >= 0 ? 'amount-pos' : 'amount-neg'}
          />
          <StatCell
            label="Change"
            value={formatPct(s.netChangePct)}
            tone={deltaClass(s.netChangePct, 'gain')}
          />
          <StatCell
            label="Savings rate"
            value={savingsRate != null ? `${savingsRate.toFixed(0)}%` : '—'}
          />
        </div>
      </section>

      <section className="insight-section">
        <SectionHead
          title="Spending by category"
          aside={<span className="muted">{money(catTotal)} total</span>}
        />
        {byCat.length === 0 ? (
          <div className="empty">
            Nothing categorized for {monthLabel(month)} yet.
          </div>
        ) : (
          <div className="insight-donut-wrap">
            <div className="insight-donut">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={byCat}
                    dataKey="total"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={90}
                    paddingAngle={3}
                    stroke="#f4f6f1"
                    strokeWidth={2}
                  >
                    {byCat.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => money(v)}
                    contentStyle={TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="insight-legend">
              {byCat.slice(0, 8).map((c, i) => (
                <li key={c.name}>
                  <span
                    className="dot"
                    style={{
                      background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                    }}
                  />
                  <span className="insight-legend-name">{c.name}</span>
                  <span className="insight-legend-num">{money(c.total)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="insight-section">
        <SectionHead title="Top spending categories" />
        {topCats.length === 0 ? (
          <div className="empty">No spending to rank yet.</div>
        ) : (
          <ul className="insight-share-list">
            {topCats.map((c, i) => (
              <ShareRow
                key={c.name}
                label={c.name}
                value={c.total}
                share={safeShare(c.total, topCats[0].total)}
                color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                meta={`${safeShare(c.total, catTotal).toFixed(0)}% of this month's spending`}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="insight-section">
        <SectionHead
          title="Month-over-month changes"
          aside={
            <span className="muted">
              {trends.currentLabel} vs {trends.previousLabel}
            </span>
          }
        />
        {trends.risers.length === 0 && trends.fallers.length === 0 ? (
          <div className="empty">
            Two months of categorized history unlocks this comparison.
          </div>
        ) : (
          <div className="insight-change-cols">
            <div>
              <div className="home-kicker">Went up</div>
              {trends.risers.length === 0 ? (
                <p className="muted insight-empty-line">Nothing rose.</p>
              ) : (
                <ul className="insight-change-list">
                  {trends.risers.map((c) => (
                    <li key={c.name}>
                      <span className="insight-change-name">{c.name}</span>
                      <span className="muted insight-change-from">
                        {money(c.previous)} → {money(c.current)}
                      </span>
                      <span className="amount-neg insight-change-delta">
                        +{money(c.changeAbs)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="home-kicker">Went down</div>
              {trends.fallers.length === 0 ? (
                <p className="muted insight-empty-line">Nothing fell.</p>
              ) : (
                <ul className="insight-change-list">
                  {trends.fallers.map((c) => (
                    <li key={c.name}>
                      <span className="insight-change-name">{c.name}</span>
                      <span className="muted insight-change-from">
                        {money(c.previous)} → {money(c.current)}
                      </span>
                      <span className="amount-pos insight-change-delta">
                        {money(c.changeAbs)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
