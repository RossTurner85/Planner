import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Account, BillStatus, Category } from '../types'
import { money, monthLabel, shiftMonth } from '../lib/format'
import { billScheduleLabel, sortMonthBills } from '../lib/bills'

type Props = {
  profileId: number
  month: string
  onMonthChange: (month: string) => void
  onRefresh: () => void
}

type BillForm = {
  name: string
  amount: string
  dueDay: string
  nextDueDate: string
  payeeHint: string
  accountId: number | ''
  categoryId: number | ''
  autopay: boolean
  autopayDay: string
}

const emptyForm = (): BillForm => ({
  name: '',
  amount: '',
  dueDay: '',
  nextDueDate: '',
  payeeHint: '',
  accountId: '',
  categoryId: '',
  autopay: false,
  autopayDay: '',
})

function billToForm(b: BillStatus): BillForm {
  return {
    name: b.name,
    amount: String(b.amount),
    dueDay: b.due_day && b.due_day >= 1 ? String(b.due_day) : '',
    nextDueDate: b.next_due_date?.slice(0, 10) ?? '',
    payeeHint: b.payee_hint ?? '',
    accountId: b.account_id ?? '',
    categoryId: b.category_id ?? '',
    autopay: Boolean(b.autopay),
    autopayDay: String(
      b.autopay_day ?? (b.due_day && b.due_day >= 1 ? b.due_day : ''),
    ),
  }
}

function parseSchedule(form: BillForm): {
  dueDay: number | null
  nextDueDate: string | null
  error?: string
} {
  const dueDayRaw = form.dueDay.trim()
  const dueDay = dueDayRaw === '' ? null : Number(dueDayRaw)
  if (
    dueDay != null &&
    (Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31)
  ) {
    return {
      dueDay: null,
      nextDueDate: null,
      error: 'Due day must be blank or 1–31.',
    }
  }
  const nextRaw = form.nextDueDate.trim()
  const nextDueDate =
    nextRaw && /^\d{4}-\d{2}-\d{2}/.test(nextRaw) ? nextRaw.slice(0, 10) : null
  if (nextRaw && !nextDueDate) {
    return {
      dueDay: null,
      nextDueDate: null,
      error: 'Next due date must be a full calendar date or blank.',
    }
  }
  return { dueDay, nextDueDate }
}

function SettingsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M19.4 13.5a7.5 7.5 0 0 0 .05-1.5l2-1.15-2-3.46-2.2.7a7.6 7.6 0 0 0-1.3-.75L15.5 4h-4l-.45 2.34c-.46.2-.9.45-1.3.75l-2.2-.7-2 3.46 2 1.15a7.5 7.5 0 0 0 0 3l-2 1.15 2 3.46 2.2-.7c.4.3.84.55 1.3.75L11.5 20h4l.45-2.34c.46-.2.9-.45 1.3-.75l2.2.7 2-3.46-2-1.15Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function BillsPage({
  profileId,
  month,
  onMonthChange,
  onRefresh,
}: Props) {
  const [manageOpen, setManageOpen] = useState(false)
  const [monthBills, setMonthBills] = useState<BillStatus[]>([])
  const [catalog, setCatalog] = useState<BillStatus[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [docMsg, setDocMsg] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<BillForm>(emptyForm)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [status, list, a, c] = await Promise.all([
      window.finance.bills.status(profileId, month),
      window.finance.bills.list(profileId),
      window.finance.accounts.list(profileId),
      window.finance.categories.list(profileId),
    ])
    setMonthBills(status)
    setCatalog(
      (list as BillStatus[]).map((b) => ({
        ...b,
        dueDate: b.dueDate ?? '',
        status: b.status ?? 'upcoming',
      })),
    )
    setAccounts(a)
    setCategories(c)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, month])

  const awaiting = useMemo(
    () => monthBills.filter((b) => b.status !== 'paid'),
    [monthBills],
  )
  const paidCount = useMemo(
    () => monthBills.filter((b) => b.status === 'paid').length,
    [monthBills],
  )
  const sorted = useMemo(() => sortMonthBills(monthBills), [monthBills])

  const openBillDocument = async (b: BillStatus) => {
    setDocMsg(null)
    if (!b.document_path) {
      setDocMsg(
        `“${b.name}” has no uploaded PDF yet. Import the bill from Import.`,
      )
      return
    }
    const res = await window.finance.bills.openDocument(b.id)
    if (!res.ok) setDocMsg(res.error ?? 'Could not open bill PDF.')
  }

  const markPaid = async (b: BillStatus) => {
    setBusyId(b.id)
    try {
      await window.finance.bills.markPaid({
        profileId,
        billId: b.id,
        month,
      })
      await load()
      onRefresh()
    } finally {
      setBusyId(null)
    }
  }

  const unmarkPaid = async (b: BillStatus) => {
    setBusyId(b.id)
    try {
      await window.finance.bills.unmarkPaid({
        profileId,
        billId: b.id,
        month,
      })
      await load()
      onRefresh()
    } finally {
      setBusyId(null)
    }
  }

  const startEdit = (b: BillStatus) => {
    setEditingId(b.id)
    setForm(billToForm(b))
    setSaveMsg(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(emptyForm())
    setSaveMsg(null)
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (editingId == null) return
    const sched = parseSchedule(form)
    if (sched.error) {
      setSaveMsg(sched.error)
      return
    }
    const amount = Number(form.amount)
    if (!form.name.trim() || Number.isNaN(amount)) {
      setSaveMsg('Name and amount are required.')
      return
    }
    setBusy(true)
    setSaveMsg(null)
    try {
      await window.finance.bills.update(editingId, {
        name: form.name.trim(),
        amount,
        dueDay: sched.dueDay,
        nextDueDate: sched.nextDueDate,
        payeeHint: form.payeeHint.trim() || form.name.trim(),
        accountId: form.accountId || null,
        categoryId: form.categoryId || null,
        frequency: sched.nextDueDate ? 'custom' : 'monthly',
        autopay: form.autopay,
        autopayDay: form.autopay
          ? form.autopayDay
            ? Number(form.autopayDay)
            : sched.dueDay
          : null,
      })
      setSaveMsg('Saved.')
      await load()
      onRefresh()
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const removeBill = async (b: BillStatus) => {
    if (!confirm(`Remove “${b.name}”? This cannot be undone.`)) return
    await window.finance.bills.delete(b.id)
    if (editingId === b.id) cancelEdit()
    await load()
    onRefresh()
  }

  const closeManage = () => {
    setManageOpen(false)
    cancelEdit()
  }

  return (
    <div className="stack app-landing bills-month-page">
      {!manageOpen ? (
        <div className="page-month-bar">
          <div className="month-nav">
            <button
              type="button"
              onClick={() => onMonthChange(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span>{monthLabel(month)}</span>
            <button
              type="button"
              onClick={() => onMonthChange(shiftMonth(month, 1))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

      {manageOpen ? (
        <div className="stack" style={{ gap: 20 }}>
          <div className="bills-manage-header">
            <h2 className="home-section-title bills-manage-heading">
              Manage bills
            </h2>
            <button
              type="button"
              className="bills-cog-btn is-active"
              aria-label="Close bill settings"
              title="Back to this month"
              onClick={closeManage}
            >
              <SettingsIcon />
            </button>
          </div>
          {editingId != null ? (
            <div className="app-surface bills-manage-form">
              <div className="row space-between" style={{ marginBottom: 8 }}>
                <h3 className="home-section-title" style={{ fontSize: '1.15rem' }}>
                  Edit bill
                </h3>
                <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                  Cancel
                </button>
              </div>
              <form className="form-grid" onSubmit={saveEdit}>
                <div className="field">
                  <label>Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input
                    value={form.amount}
                    onChange={(e) =>
                      setForm({ ...form, amount: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="field">
                  <label>Due day of month (optional)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    placeholder="Blank if not every month"
                    value={form.dueDay}
                    onChange={(e) =>
                      setForm({ ...form, dueDay: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Next due date (optional)</label>
                  <input
                    type="date"
                    value={form.nextDueDate}
                    onChange={(e) =>
                      setForm({ ...form, nextDueDate: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Match text</label>
                  <input
                    value={form.payeeHint}
                    onChange={(e) =>
                      setForm({ ...form, payeeHint: e.target.value })
                    }
                    placeholder="How it appears on statements"
                  />
                </div>
                <div className="field">
                  <label>Account</label>
                  <select
                    value={form.accountId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        accountId: e.target.value
                          ? Number(e.target.value)
                          : '',
                      })
                    }
                  >
                    <option value="">None</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Category</label>
                  <select
                    value={form.categoryId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        categoryId: e.target.value
                          ? Number(e.target.value)
                          : '',
                      })
                    }
                  >
                    <option value="">None</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={form.autopay}
                      onChange={(e) =>
                        setForm({ ...form, autopay: e.target.checked })
                      }
                    />
                    Autopay
                  </label>
                </div>
                {form.autopay ? (
                  <div className="field">
                    <label>Autopay day</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={form.autopayDay}
                      onChange={(e) =>
                        setForm({ ...form, autopayDay: e.target.value })
                      }
                    />
                  </div>
                ) : null}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </form>
              {saveMsg ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  {saveMsg}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="app-surface">
            <p className="muted" style={{ marginTop: 0 }}>
              Edit details or remove a bill. Changes apply to every month.
            </p>
            {catalog.length === 0 ? (
              <div className="empty">No bills saved yet. Import a bill PDF first.</div>
            ) : (
              <ul className="bills-manage-list">
                {catalog.map((b) => (
                  <li key={b.id} className="bills-manage-row">
                    <div className="bills-manage-info">
                      <strong>{b.name}</strong>
                      <span className="muted">
                        {money(b.amount)}
                        {b.due_day != null && b.due_day >= 1
                          ? ` · day ${b.due_day}`
                          : ''}
                        {b.next_due_date
                          ? ` · next ${b.next_due_date.slice(0, 10)}`
                          : ''}
                        {b.autopay ? ' · autopay' : ''}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => startEdit(b)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger"
                        onClick={() => void removeBill(b)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="app-surface bills-month-panel">
          <div className="bills-month-stats">
            <div>
              <div className="home-kicker">Awaiting payment</div>
              <div
                className={`bills-stat-num ${
                  awaiting.length ? 'amount-neg' : ''
                }`}
              >
                {awaiting.length}
              </div>
            </div>
            <div>
              <div className="home-kicker">Already paid</div>
              <div className="bills-stat-num amount-pos">{paidCount}</div>
            </div>
            <button
              type="button"
              className="bills-cog-btn"
              aria-label="Bill settings"
              title="Edit or delete bills"
              onClick={() => setManageOpen(true)}
            >
              <SettingsIcon />
            </button>
          </div>

          {sorted.length === 0 ? (
            <div className="empty">
              No bills for {monthLabel(month)}. Import a bill PDF or add one
              from Import.
            </div>
          ) : (
            <ul className="bills-month-list">
              {sorted.map((b) => {
                const busyPaid = busyId === b.id
                const paid = b.status === 'paid'
                const canUndo =
                  paid && (b.paidManually || b.paidSource === 'manual')
                return (
                  <li
                    key={b.id}
                    className={`bills-month-row${paid ? ' is-paid' : ''}`}
                  >
                    <div className="bills-month-row-main">
                      <div className="bills-month-row-left">
                        <button
                          type="button"
                          className="bills-month-name"
                          onClick={() => void openBillDocument(b)}
                          title={
                            b.document_path
                              ? 'Open uploaded bill PDF'
                              : 'No PDF uploaded yet'
                          }
                        >
                          {b.name}
                        </button>
                        <div className="bills-month-meta muted">
                          {billScheduleLabel(b)}
                        </div>
                      </div>
                      <div className="bills-month-row-right">
                        <span className="bills-month-amount">
                          {money(b.amount)}
                        </span>
                        {!paid ? (
                          <button
                            type="button"
                            className="btn btn-primary bills-month-action"
                            disabled={busyPaid}
                            onClick={() => void markPaid(b)}
                          >
                            Mark paid
                          </button>
                        ) : canUndo ? (
                          <button
                            type="button"
                            className="btn btn-ghost bills-month-action"
                            disabled={busyPaid}
                            onClick={() => void unmarkPaid(b)}
                          >
                            Undo
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {docMsg ? (
            <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
              {docMsg}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
