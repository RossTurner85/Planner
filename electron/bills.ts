export type BillRow = {
  id: number
  name: string
  amount: number
  /** Day of each month (1–31). 0 / null = no monthly schedule. */
  due_day: number | null
  /**
   * Optional one-shot due calendar date (YYYY-MM-DD).
   * When set, the bill only appears in that calendar month’s view
   * (e.g. quarterly trash due Sept 1 → only September).
   */
  next_due_date?: string | null
  payee_hint?: string | null
  account_id?: number | null
  category_id?: number | null
  frequency?: string
  active?: number
  autopay?: number | boolean
  autopay_day?: number | null
}

export type TxRow = {
  id: number
  date: string
  amount: number
  payee: string
  memo?: string | null
  account_id: number
  category_id?: number | null
}

export type BillStatus = BillRow & {
  status: 'paid' | 'due' | 'overdue' | 'upcoming'
  matchedTxId?: number
  matchedAmount?: number
  /** Date of the matched payment transaction, if paid */
  matchedDate?: string | null
  dueDate: string
  /** Calendar date when autopay is scheduled (if enabled) */
  autopayDate?: string | null
  /** How this bill was marked paid for the month */
  paidSource?: 'transaction' | 'manual' | null
  paidManually?: boolean
}

function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

/** Resolve due / autopay dates for this view month, or null if bill stays hidden. */
export function scheduleForMonth(
  bill: BillRow,
  month: string,
): { dueDate: string; autopayDate: string | null } | null {
  const [yStr, mStr] = month.split('-')
  const year = Number(yStr)
  const monthNum = Number(mStr)
  const dim = daysInMonth(year, monthNum - 1)

  const nextDue =
    bill.next_due_date && /^\d{4}-\d{2}-\d{2}/.test(bill.next_due_date)
      ? bill.next_due_date.slice(0, 10)
      : null

  if (nextDue) {
    if (nextDue.slice(0, 7) !== month) return null
    const isAutopay = Boolean(bill.autopay)
    let autopayDate: string | null = null
    if (isAutopay) {
      const apRaw = bill.autopay_day
      if (apRaw != null && Number(apRaw) >= 1) {
        const apDay = Math.min(Number(apRaw), dim)
        autopayDate = `${month}-${String(apDay).padStart(2, '0')}`
      } else {
        autopayDate = nextDue
      }
    }
    return { dueDate: nextDue, autopayDate }
  }

  const dueDay = Number(bill.due_day)
  if (!dueDay || dueDay < 1) {
    // No monthly day and no specific next_due_date → omit from period views
    return null
  }

  const clamped = Math.min(dueDay, dim)
  const dueDate = `${month}-${String(clamped).padStart(2, '0')}`
  const isAutopay = Boolean(bill.autopay)
  const apDayRaw = bill.autopay_day ?? dueDay
  const apDay = Math.min(Number(apDayRaw) || clamped, dim)
  const autopayDate = isAutopay
    ? `${month}-${String(apDay).padStart(2, '0')}`
    : null

  return { dueDate, autopayDate }
}

export function matchBillsForPeriod(
  bills: BillRow[],
  transactions: TxRow[],
  month: string,
): BillStatus[] {
  const [yStr, mStr] = month.split('-')
  const year = Number(yStr)
  const monthNum = Number(mStr)
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const usedTx = new Set<number>()

  const results: BillStatus[] = []

  for (const bill of bills) {
    const schedule = scheduleForMonth(bill, month)
    if (!schedule) continue

    const { dueDate, autopayDate } = schedule
    const hint = (bill.payee_hint || bill.name).toLowerCase()
    const expected = Math.abs(bill.amount)
    const windowStart = `${month}-01`

    let best: TxRow | undefined
    let bestScore = 0

    for (const tx of transactions) {
      if (usedTx.has(tx.id)) continue
      if (tx.amount >= 0) continue
      if (tx.date < windowStart || tx.date > `${month}-31`) continue

      const payee = `${tx.payee} ${tx.memo ?? ''}`.toLowerCase()
      const nameMatch =
        payee.includes(hint) ||
        hint.split(/\s+/).some((w) => w.length > 2 && payee.includes(w))
      if (!nameMatch) continue

      const amountDiff = Math.abs(Math.abs(tx.amount) - expected)
      const amountScore =
        amountDiff <= 1
          ? 3
          : amountDiff <= expected * 0.15
            ? 2
            : amountDiff <= expected * 0.35
              ? 1
              : 0
      if (amountScore === 0 && expected > 0) continue

      const score = amountScore + (nameMatch ? 2 : 0)
      if (score > bestScore) {
        bestScore = score
        best = tx
      }
    }

    if (best) {
      usedTx.add(best.id)
      results.push({
        ...bill,
        status: 'paid' as const,
        matchedTxId: best.id,
        matchedAmount: Math.abs(best.amount),
        matchedDate: best.date,
        dueDate,
        autopayDate,
        paidSource: 'transaction',
        paidManually: false,
      })
      continue
    }

    const watchDate = autopayDate ?? dueDate

    let status: BillStatus['status'] = 'upcoming'
    if (watchDate < todayStr) status = 'overdue'
    else if (watchDate <= todayStr) status = 'due'
    else status = 'upcoming'

    const [cy, cm] = [today.getFullYear(), today.getMonth() + 1]
    if (year < cy || (year === cy && monthNum < cm)) {
      status = 'overdue'
    }

    results.push({
      ...bill,
      status,
      dueDate,
      autopayDate,
      paidSource: null,
      paidManually: false,
    })
  }

  return results
}

/** Overlay manual paid marks from bill_payments for the given month. */
export function applyManualBillPayments(
  statuses: BillStatus[],
  manuals: Array<{ bill_id: number; paid_on: string }>,
): BillStatus[] {
  const byBill = new Map(manuals.map((m) => [m.bill_id, m.paid_on]))
  return statuses.map((b) => {
    if (b.status === 'paid' && b.paidSource === 'transaction') return b
    const paidOn = byBill.get(b.id)
    if (!paidOn) return b
    return {
      ...b,
      status: 'paid' as const,
      matchedDate: paidOn,
      matchedAmount: b.matchedAmount ?? Math.abs(b.amount),
      paidSource: 'manual' as const,
      paidManually: true,
    }
  })
}
