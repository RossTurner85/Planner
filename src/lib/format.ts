export function money(n: number, digits = 2) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/** Pretty day from ISO date, e.g. "Aug 1" or "Friday, Aug 1" */
export function dayLabel(iso: string, style: 'short' | 'long' = 'short') {
  if (!iso || iso.length < 10) return iso
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (style === 'long') {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Bare day of the month with its suffix, e.g. "22nd" */
export function ordinalDay(day: number) {
  const j = day % 10
  const k = day % 100
  let suffix = 'th'
  if (j === 1 && k !== 11) suffix = 'st'
  else if (j === 2 && k !== 12) suffix = 'nd'
  else if (j === 3 && k !== 13) suffix = 'rd'
  return `${day}${suffix}`
}

/** e.g. Aug 17th */
export function dayOrdinal(iso: string) {
  if (!iso || iso.length < 10) return iso
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const mon = date.toLocaleDateString('en-US', { month: 'short' })
  const j = d % 10
  const k = d % 100
  let suffix = 'th'
  if (j === 1 && k !== 11) suffix = 'st'
  else if (j === 2 && k !== 12) suffix = 'nd'
  else if (j === 3 && k !== 13) suffix = 'rd'
  return `${mon} ${d}${suffix}`
}

/** Currency; whole dollars omit cents for cleaner bill chips */
export function moneyBill(n: number) {
  const abs = Math.abs(n)
  if (Math.abs(abs - Math.round(abs)) < 0.005) {
    return money(abs, 0)
  }
  return money(abs, 2)
}

export function cls(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
