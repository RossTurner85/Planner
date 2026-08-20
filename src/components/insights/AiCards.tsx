import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AiCard, NavOptions, PageId } from '../../types'
import { money } from '../../lib/format'
import {
  AXIS_STYLE,
  CATEGORY_COLORS,
  GRID_STROKE,
  SERIES_COLORS,
  TOOLTIP_STYLE,
  axisMoney,
} from './shared'

type Props = {
  card: AiCard
  onNavigate?: (page: PageId, opts?: NavOptions) => void
}

const PAGES: PageId[] = [
  'home',
  'transactions',
  'budgets',
  'bills',
  'goals',
  'insights',
  'setup',
]

/** Whatever the coach chose to draw instead of describing in words. */
export function AiCardView({ card, onNavigate }: Props) {
  if (card.kind === 'chart') return <ChartCard card={card} />
  if (card.kind === 'table') return <TableCard card={card} />
  return <LinkCard card={card} onNavigate={onNavigate} />
}

function ChartCard({ card }: { card: Extract<AiCard, { kind: 'chart' }> }) {
  const data = card.points.map((p) => ({ label: p.label, value: p.value }))

  return (
    <figure className="ai-card">
      <figcaption className="ai-card-title">{card.title}</figcaption>
      <ResponsiveContainer width="100%" height={card.chart === 'donut' ? 240 : 210}>
        {card.chart === 'donut' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={58}
              outerRadius={92}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => money(v)}
              contentStyle={TOOLTIP_STYLE}
            />
          </PieChart>
        ) : card.chart === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={axisMoney}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip formatter={(v: number) => money(v)} contentStyle={TOOLTIP_STYLE} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={SERIES_COLORS.net}
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={axisMoney}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip formatter={(v: number) => money(v)} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="value" fill={SERIES_COLORS.spend} radius={[6, 6, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
      {card.chart === 'donut' ? (
        <ul className="ai-card-legend">
          {data.map((p, i) => (
            <li key={p.label}>
              <i
                className="dot"
                style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                aria-hidden
              />
              {p.label}
              <span className="ai-legend-value">{money(p.value)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {card.note ? <p className="muted ai-card-note">{card.note}</p> : null}
    </figure>
  )
}

function TableCard({ card }: { card: Extract<AiCard, { kind: 'table' }> }) {
  return (
    <figure className="ai-card">
      <figcaption className="ai-card-title">{card.title}</figcaption>
      <div className="ai-table-wrap">
        <table className="ai-table">
          <thead>
            <tr>
              {card.columns.map((c, i) => (
                <th key={i} className={c.numeric ? 'is-num' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} className={card.columns[i]?.numeric ? 'is-num' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.note ? <p className="muted ai-card-note">{card.note}</p> : null}
    </figure>
  )
}

function LinkCard({
  card,
  onNavigate,
}: {
  card: Extract<AiCard, { kind: 'link' }>
  onNavigate?: (page: PageId, opts?: NavOptions) => void
}) {
  const page = PAGES.includes(card.page as PageId) ? (card.page as PageId) : null
  if (!page || !onNavigate) return null

  return (
    <button
      type="button"
      className="btn ai-jump"
      onClick={() =>
        onNavigate(page, {
          search: card.search ?? undefined,
          from: card.from ?? undefined,
          to: card.to ?? undefined,
        })
      }
    >
      {card.label}
      <span aria-hidden>→</span>
    </button>
  )
}
