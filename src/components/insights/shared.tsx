import { money } from '../../lib/format'

export const SERIES_COLORS = {
  spend: '#C45C26',
  income: '#2F6F5E',
  net: '#3B6FA0',
}

export const CATEGORY_COLORS = [
  '#2F6F5E',
  '#C45C26',
  '#3B6FA0',
  '#B08D2E',
  '#8B5E9A',
  '#5B756A',
  '#D47B5A',
  '#6F8FA8',
]

export const GRID_STROKE = 'rgba(27,36,32,0.08)'

export const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: '1px solid rgba(27,36,32,0.1)',
  background: '#fbfcf8',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  boxShadow: '0 10px 30px rgba(27,36,32,0.1)',
}

export const AXIS_STYLE = {
  fontSize: '0.75rem',
  fill: '#4d5a52',
}

export function axisMoney(v: number) {
  const abs = Math.abs(v)
  if (abs >= 1000) return `$${Math.round(v / 1000)}k`
  return `$${Math.round(v)}`
}

export function formatPct(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}

/** Spending up is bad; income and net up are good. */
export function deltaClass(
  n: number | null | undefined,
  kind: 'spend' | 'gain',
) {
  if (n == null || n === 0) return 'muted'
  const good = kind === 'spend' ? n < 0 : n > 0
  return good ? 'amount-pos' : 'amount-neg'
}

/** "Aug 26" — compact enough for chart axes. */
export function shortMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', {
    month: 'short',
    year: '2-digit',
  })
}

export function safeShare(part: number, whole: number) {
  if (!whole) return 0
  return Math.min(100, Math.max(0, (part / whole) * 100))
}

/** Ranked row with a proportional bar — used by every "top N" list. */
export function ShareRow({
  label,
  value,
  share,
  color,
  meta,
}: {
  label: string
  value: number
  share: number
  color?: string
  meta?: string
}) {
  return (
    <li className="insight-share-row">
      <div className="insight-share-top">
        <span className="insight-share-label">
          {color ? (
            <i className="dot" style={{ background: color }} aria-hidden />
          ) : null}
          {label}
        </span>
        <span className="insight-share-value">{money(value)}</span>
      </div>
      <div className="insight-share-track">
        <span
          style={{
            width: `${share}%`,
            background: color ?? SERIES_COLORS.spend,
          }}
        />
      </div>
      {meta ? <div className="muted insight-share-meta">{meta}</div> : null}
    </li>
  )
}

export function StatCell({
  label,
  value,
  tone,
  meta,
}: {
  label: string
  value: string
  tone?: string
  meta?: React.ReactNode
}) {
  return (
    <div className="insight-stat">
      <div className="home-kicker">{label}</div>
      <div className={`insight-stat-num ${tone ?? ''}`}>{value}</div>
      {meta ? <div className="insight-stat-meta">{meta}</div> : null}
    </div>
  )
}

export function SectionHead({
  title,
  aside,
}: {
  title: string
  aside?: React.ReactNode
}) {
  return (
    <div className="insight-head">
      <h2 className="home-section-title">{title}</h2>
      {aside ? <div className="insight-head-aside">{aside}</div> : null}
    </div>
  )
}
