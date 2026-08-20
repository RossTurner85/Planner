import type { BillStatus } from '../types'
import { dayOrdinal } from './format'

const STATUS_ORDER: Record<BillStatus['status'], number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  paid: 3,
}

export function isAutopay(b: BillStatus) {
  return Boolean(b.autopay)
}

export function billScheduleLabel(b: BillStatus): string {
  if (b.status === 'paid') return 'paid'
  if (isAutopay(b)) {
    const d = b.autopayDate || b.dueDate
    return d ? `Autopay on ${dayOrdinal(d)}` : 'Autopay'
  }
  return b.dueDate ? `Due Date ${dayOrdinal(b.dueDate)}` : 'Due date TBD'
}

/** Needs attention first, then by date, then name. */
export function sortMonthBills(list: BillStatus[]) {
  return [...list].sort((a, b) => {
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (so !== 0) return so
    const da = a.autopayDate || a.dueDate || ''
    const db = b.autopayDate || b.dueDate || ''
    return da.localeCompare(db) || a.name.localeCompare(b.name)
  })
}

export function billTotals(list: BillStatus[]) {
  let total = 0
  let paid = 0
  let paidCount = 0
  for (const b of list) {
    total += b.amount
    if (b.status === 'paid') {
      paid += b.amount
      paidCount += 1
    }
  }
  return {
    total,
    paid,
    unpaid: total - paid,
    paidCount,
    unpaidCount: list.length - paidCount,
  }
}
