import { useMemo } from 'react'
import type { BillStatus } from '../types'
import { dayOrdinal, moneyBill } from '../lib/format'

type Props = {
  bills: BillStatus[]
  onOpen: () => void
}

const STATUS_ORDER: Record<BillStatus['status'], number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  paid: 3,
}

function isAutopay(b: BillStatus) {
  return Boolean(b.autopay)
}

/** Right-side status line for unpaid bill chips (homepage only) */
function billChipSchedule(b: BillStatus): string {
  const amt = moneyBill(b.amount)
  if (isAutopay(b)) {
    const when = b.autopayDate
      ? dayOrdinal(b.autopayDate)
      : `day ${b.autopay_day ?? b.due_day}`
    return `Autopay ${when} – ${amt}`
  }
  const when = b.dueDate ? dayOrdinal(b.dueDate) : `day ${b.due_day}`
  return `Due on ${when} – ${amt}`
}

function timelineKind(b: BillStatus): string {
  if (b.status === 'paid') return 'paid'
  if (isAutopay(b) && b.autopayDate) {
    if (b.status === 'overdue') return 'overdue'
    return 'autopay'
  }
  return b.status
}

/** Same palette as the spending donut, so the two halves of Home rhyme. */
const RING_COLORS = [
  '#2F6F5E',
  '#C45C26',
  '#3B6FA0',
  '#B08D2E',
  '#8B5E9A',
  '#5B756A',
  '#D47B5A',
]

/** Where every string meets, as if the bunch were being held. */
const GATHER = { x: 95, y: 144 }

/** Cluster laid out to overlap a little, the way a real bunch sits. */
const BALLOONS: Array<{ cx: number; cy: number; r: number }> = [
  { cx: 95, cy: 25, r: 19 },
  { cx: 60, cy: 35, r: 17 },
  { cx: 130, cy: 35, r: 17 },
  { cx: 76, cy: 63, r: 18 },
  { cx: 114, cy: 63, r: 18 },
  { cx: 40, cy: 67, r: 16 },
  { cx: 150, cy: 67, r: 16 },
]

/** Balloons are a touch taller than they are wide. */
const SQUASH = 1.18

/** The reward for clearing every bill, in the spending-donut colors. */
function AllPaidBalloons() {
  return (
    <svg
      className="bills-done-balloons"
      viewBox="0 0 190 150"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g className="bills-done-bunch">
        {/* Strings first so they tuck behind every balloon. */}
        {BALLOONS.map((b, i) => {
          const knotY = b.cy + b.r * SQUASH + 5
          const ctrlX = b.cx + (GATHER.x - b.cx) * 0.8
          const ctrlY = knotY + (GATHER.y - knotY) * 0.45
          return (
            <path
              key={`string-${i}`}
              className="bills-done-string"
              d={`M${b.cx} ${knotY} Q${ctrlX} ${ctrlY} ${GATHER.x} ${GATHER.y}`}
              fill="none"
              stroke={RING_COLORS[i % RING_COLORS.length]}
              strokeWidth={1.4}
              strokeLinecap="round"
              opacity={0.45}
              style={{ animationDelay: `${240 + i * 55}ms` }}
            />
          )
        })}

        {BALLOONS.map((b, i) => {
          const color = RING_COLORS[i % RING_COLORS.length]
          const ry = b.r * SQUASH
          const knotY = b.cy + ry
          return (
            <g
              key={`balloon-${i}`}
              className="bills-done-balloon"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <path
                d={`M${b.cx - 3.4} ${knotY} L${b.cx + 3.4} ${knotY} L${b.cx} ${knotY + 5.5} Z`}
                fill={color}
              />
              <ellipse cx={b.cx} cy={b.cy} rx={b.r} ry={ry} fill={color} />
              <ellipse
                cx={b.cx - b.r * 0.34}
                cy={b.cy - ry * 0.34}
                rx={b.r * 0.2}
                ry={ry * 0.26}
                fill="#ffffff"
                opacity={0.32}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}

function BillIcon() {
  return (
    <svg
      className="bills-launch-icon"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="8" y="6" width="32" height="36" rx="6" fill="currentColor" opacity="0.12" />
      <rect x="12" y="10" width="24" height="28" rx="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M17 18h14M17 24h14M17 30h9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="34" cy="34" r="8" fill="var(--accent)" />
      <path
        d="M31 34.5l2 2 4-5"
        stroke="#f5faf7"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function BillsMonthPanel({ bills, onOpen }: Props) {
  const awaiting = useMemo(
    () => bills.filter((b) => b.status !== 'paid'),
    [bills],
  )
  const paidCount = useMemo(
    () => bills.filter((b) => b.status === 'paid').length,
    [bills],
  )
  const allPaid = bills.length > 0 && awaiting.length === 0

  const sortedUnpaid = useMemo(
    () =>
      [...awaiting].sort((a, b) => {
        const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (so !== 0) return so
        const da = a.autopayDate || a.dueDate
        const db = b.autopayDate || b.dueDate
        return da.localeCompare(db)
      }),
    [awaiting],
  )

  return (
    <button
      type="button"
      className={`bills-launch home-bills-launch clickable${
        allPaid ? ' is-all-paid' : ''
      }`}
      onClick={onOpen}
    >
      <div className="home-bills-stack">
        <div className="home-bills-head">
          <div className="bills-launch-top">
            {allPaid ? null : <BillIcon />}
            <div className="bills-launch-copy">
              <h2 className="home-section-title">This month’s bills</h2>
              {bills.length === 0 ? (
                <p className="muted">Tap to set up recurring bills</p>
              ) : allPaid ? (
                <div className="bills-launch-stats">
                  <p className="bills-done-headline">
                    All {paidCount} paid
                  </p>
                  <p className="muted">Nothing left this month</p>
                </div>
              ) : (
                <div className="bills-launch-stats">
                  <p>
                    <strong
                      className={awaiting.length ? 'amount-neg' : 'amount-pos'}
                    >
                      {awaiting.length}
                    </strong>{' '}
                    awaiting payment
                  </p>
                  <p>
                    <strong className="amount-pos">{paidCount}</strong> already
                    paid
                  </p>
                </div>
              )}
            </div>
            {allPaid ? <AllPaidBalloons /> : null}
          </div>
        </div>

        {sortedUnpaid.length > 0 ? (
          <div className="bills-launch-strip">
            {sortedUnpaid.slice(0, 6).map((b) => (
              <div
                key={b.id}
                className={`bills-mini-chip status-${timelineKind(b)}`}
              >
                <span className="bills-mini-name">{b.name}</span>
                <span className="bills-mini-schedule">{billChipSchedule(b)}</span>
              </div>
            ))}
            {sortedUnpaid.length > 6 ? (
              <div className="bills-mini-more">+{sortedUnpaid.length - 6}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </button>
  )
}
