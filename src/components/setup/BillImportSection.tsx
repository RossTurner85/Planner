import { useEffect, useState } from 'react'
import type {
  Account,
  BillPdfDraft,
  Category,
  ParsedBillPdf,
} from '../../types'
import { money } from '../../lib/format'

type Props = {
  profileId: number
  accounts: Account[]
}

const CONFIDENCE_FLAG: Record<ParsedBillPdf['confidence'], string> = {
  high: 'status-paid',
  medium: 'status-due',
  low: 'status-overdue',
}

async function toDraft(
  profileId: number,
  parsed: ParsedBillPdf,
  accounts: Account[],
): Promise<BillPdfDraft> {
  let categoryId: number | '' = ''
  if (parsed.suggestedCategory) {
    const id = await window.finance.categories.findByName(
      profileId,
      parsed.suggestedCategory,
    )
    if (id) categoryId = id
  }
  return {
    ...parsed,
    amountInput: parsed.amount != null ? String(parsed.amount) : '',
    dueDayInput: parsed.dueDay != null ? String(parsed.dueDay) : '',
    nextDueDateInput:
      parsed.dueDate && parsed.dueDate.length >= 10
        ? parsed.dueDate.slice(0, 10)
        : '',
    categoryId,
    accountId: accounts[0]?.id ?? '',
    autopay: Boolean(parsed.autopay),
    autopayDayInput:
      parsed.autopayDay != null
        ? String(parsed.autopayDay)
        : parsed.dueDay != null
          ? String(parsed.dueDay)
          : '',
    principalInput:
      parsed.mortgage?.principal != null
        ? String(parsed.mortgage.principal)
        : '',
    interestInput:
      parsed.mortgage?.interest != null ? String(parsed.mortgage.interest) : '',
    escrowInput:
      parsed.mortgage?.escrow != null ? String(parsed.mortgage.escrow) : '',
    statementBalanceInput:
      parsed.creditCard?.statementBalance != null
        ? String(parsed.creditCard.statementBalance)
        : parsed.isCreditCard && parsed.amount != null
          ? String(parsed.amount)
          : '',
    minimumPaymentInput:
      parsed.creditCard?.minimumPayment != null
        ? String(parsed.creditCard.minimumPayment)
        : '',
    saveResult: null,
  }
}

export function BillImportSection({ profileId, accounts }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<BillPdfDraft[]>([])
  const [saved, setSaved] = useState<string[]>([])

  useEffect(() => {
    void window.finance.categories.list(profileId).then(setCategories)
  }, [profileId])

  const pickPdfs = async () => {
    setSaved([])
    setBusy(true)
    try {
      const parsed = await window.finance.import.pickBillPdfs()
      if (!parsed?.length) return
      setDrafts(
        await Promise.all(parsed.map((p) => toDraft(profileId, p, accounts))),
      )
    } finally {
      setBusy(false)
    }
  }

  const updateDraft = (index: number, patch: Partial<BillPdfDraft>) => {
    setDrafts((list) =>
      list.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    )
  }

  type CommitResult =
    | { ok: true; message: string }
    | { ok: false; error: string }

  const commitDraft = async (d: BillPdfDraft): Promise<CommitResult> => {
    const amount = Number(d.amountInput)
    const dueDayRaw = d.dueDayInput.trim()
    const dueDay = dueDayRaw === '' ? null : Number(dueDayRaw)
    const nextDueRaw = d.nextDueDateInput.trim()
    const nextDueDate =
      nextDueRaw && /^\d{4}-\d{2}-\d{2}/.test(nextDueRaw)
        ? nextDueRaw.slice(0, 10)
        : null

    if (!d.name.trim() || Number.isNaN(amount) || amount <= 0) {
      return { ok: false, error: 'Name and a valid amount are required.' }
    }
    if (dueDay != null && (Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31)) {
      return { ok: false, error: 'Due day must be blank or 1–31.' }
    }
    if (nextDueRaw && !nextDueDate) {
      return {
        ok: false,
        error: 'Next due date must be a full calendar date or blank.',
      }
    }
    const autopayDay = d.autopay ? Number(d.autopayDayInput) : null
    if (
      d.autopay &&
      (autopayDay == null ||
        Number.isNaN(autopayDay) ||
        autopayDay < 1 ||
        autopayDay > 31)
    ) {
      return {
        ok: false,
        error: 'Autopay day must be 1–31 when autopay is on.',
      }
    }

    try {
      const res = await window.finance.import.commitBillPdf({
        profileId,
        name: d.name.trim(),
        amount,
        dueDay,
        nextDueDate,
        payeeHint: d.payeeHint.trim() || d.name.trim(),
        categoryId: d.categoryId || null,
        accountId: d.accountId || null,
        sourceFilePath: d.filePath,
        originalFileName: d.fileName,
        extracted: d,
        autopay: d.autopay,
        autopayDay: d.autopay ? autopayDay : null,
        isMortgage: d.isMortgage,
        principal: d.principalInput ? Number(d.principalInput) : null,
        interest: d.interestInput ? Number(d.interestInput) : null,
        escrow: d.escrowInput ? Number(d.escrowInput) : null,
        minimumPayment: d.minimumPaymentInput
          ? Number(d.minimumPaymentInput)
          : null,
        statementBalance: d.statementBalanceInput
          ? Number(d.statementBalanceInput)
          : d.isCreditCard
            ? amount
            : null,
      })

      let msg =
        res.action === 'created' ? 'Bill created.' : 'Existing bill updated.'
      if (nextDueDate) {
        msg += ` Shows up only in ${nextDueDate.slice(0, 7)}.`
      } else if (dueDay == null) {
        msg +=
          ' No due schedule yet, so it won’t appear on monthly bill lists until you set a due day.'
      }
      if (d.autopay) msg += ` Autopay on day ${autopayDay}.`
      if (res.matchedTransaction) {
        msg += ` Matched ${res.matchedTransaction.payee} (${money(
          res.matchedTransaction.amount,
        )}) on ${res.matchedTransaction.date}.`
      } else {
        msg += ' No matching payment found yet — it’ll show as unpaid in Bills.'
      }
      return { ok: true, message: msg }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Save failed',
      }
    }
  }

  const saveDraft = async (index: number) => {
    const d = drafts[index]
    if (!d) return
    setBusy(true)
    try {
      const res = await commitDraft(d)
      if (res.ok) {
        setSaved((s) => [...s, `${d.name.trim()}: ${res.message}`])
        setDrafts((list) => list.filter((_, i) => i !== index))
      } else {
        updateDraft(index, { saveResult: res.error })
      }
    } finally {
      setBusy(false)
    }
  }

  /** Saved drafts leave the list; anything that fails stays with its error. */
  const saveAll = async () => {
    const queue = drafts
    const messages: string[] = []
    const failed: BillPdfDraft[] = []
    setBusy(true)
    try {
      for (const d of queue) {
        const res = await commitDraft(d)
        if (res.ok) messages.push(`${d.name.trim()}: ${res.message}`)
        else failed.push({ ...d, saveResult: res.error })
      }
      setSaved((s) => [...s, ...messages])
      setDrafts(failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="setup-section">
        <div className="setup-head">
          <h2 className="home-section-title">Read a bill PDF</h2>
          {drafts.length > 1 ? (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => void saveAll()}
            >
              Save all {drafts.length}
            </button>
          ) : null}
        </div>

        <div className="setup-actions-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void pickPdfs()}
          >
            {busy ? 'Reading…' : 'Choose bill PDFs…'}
          </button>
          <span className="muted setup-hint">
            Scanned image-only PDFs may need the amount typed in by hand.
          </span>
        </div>

        {saved.length > 0 ? (
          <ul className="setup-note-list is-good">
            {saved.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {drafts.map((d, index) => (
        <section className="setup-draft" key={`${d.filePath}-${index}`}>
          <div className="setup-draft-head">
            <div className="setup-draft-title">
              <span className="setup-row-name">{d.fileName}</span>
              <span className={`bill-flag ${CONFIDENCE_FLAG[d.confidence]}`}>
                {d.confidence} confidence
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void saveDraft(index)}
            >
              Save bill
            </button>
          </div>

          {d.notes.length > 0 ? (
            <ul className="setup-note-list">
              {d.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}

          <div className="form-grid">
            <div className="field">
              <label>Bill name</label>
              <input
                value={d.name}
                onChange={(e) => updateDraft(index, { name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Amount due</label>
              <input
                value={d.amountInput}
                onChange={(e) =>
                  updateDraft(index, { amountInput: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Due day of month</label>
              <input
                type="number"
                min={1}
                max={31}
                placeholder="Blank if not monthly"
                value={d.dueDayInput}
                onChange={(e) =>
                  updateDraft(index, { dueDayInput: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Next due date</label>
              <input
                type="date"
                value={d.nextDueDateInput}
                onChange={(e) =>
                  updateDraft(index, { nextDueDateInput: e.target.value })
                }
              />
              <span className="setup-hint muted">
                Quarterly bills: set the exact date and it shows in that month
                only.
              </span>
            </div>
            <div className="field">
              <label>Match text on statements</label>
              <input
                value={d.payeeHint}
                onChange={(e) =>
                  updateDraft(index, { payeeHint: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={d.categoryId}
                onChange={(e) =>
                  updateDraft(index, {
                    categoryId: e.target.value ? Number(e.target.value) : '',
                  })
                }
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Paid from</label>
              <select
                value={d.accountId}
                onChange={(e) =>
                  updateDraft(index, {
                    accountId: e.target.value ? Number(e.target.value) : '',
                  })
                }
              >
                <option value="">Any account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field checkbox-field">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={d.autopay}
                  onChange={(e) => {
                    const on = e.target.checked
                    updateDraft(index, {
                      autopay: on,
                      autopayDayInput: on
                        ? d.autopayDayInput || d.dueDayInput || '1'
                        : d.autopayDayInput,
                    })
                  }}
                />
                <span>On autopay</span>
              </label>
            </div>
            {d.autopay ? (
              <div className="field">
                <label>Autopay day</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={d.autopayDayInput}
                  onChange={(e) =>
                    updateDraft(index, { autopayDayInput: e.target.value })
                  }
                />
              </div>
            ) : null}
          </div>

          {d.isMortgage ||
          d.principalInput ||
          d.interestInput ||
          d.escrowInput ? (
            <div className="setup-subblock">
              <div className="home-kicker">Mortgage breakdown</div>
              <p className="muted setup-hint">
                Principal + interest + escrow should equal{' '}
                {money(Number(d.amountInput) || 0)}.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label>Principal</label>
                  <input
                    value={d.principalInput}
                    onChange={(e) =>
                      updateDraft(index, { principalInput: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Interest</label>
                  <input
                    value={d.interestInput}
                    onChange={(e) =>
                      updateDraft(index, { interestInput: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Escrow</label>
                  <input
                    value={d.escrowInput}
                    onChange={(e) =>
                      updateDraft(index, { escrowInput: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Sum</label>
                  <input
                    readOnly
                    value={money(
                      (Number(d.principalInput) || 0) +
                        (Number(d.interestInput) || 0) +
                        (Number(d.escrowInput) || 0),
                    )}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {d.isCreditCard ||
          d.statementBalanceInput ||
          d.minimumPaymentInput ? (
            <div className="setup-subblock">
              <div className="home-kicker">Credit card balances</div>
              <p className="muted setup-hint">
                Amount due defaults to the full statement balance.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label>Statement balance</label>
                  <input
                    value={d.statementBalanceInput}
                    onChange={(e) => {
                      const v = e.target.value
                      updateDraft(index, {
                        statementBalanceInput: v,
                        amountInput: v || d.amountInput,
                      })
                    }}
                  />
                </div>
                <div className="field">
                  <label>Minimum payment</label>
                  <input
                    value={d.minimumPaymentInput}
                    onChange={(e) =>
                      updateDraft(index, {
                        minimumPaymentInput: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Use as amount due</label>
                  <div className="setup-actions-row tight">
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        updateDraft(index, {
                          amountInput: d.statementBalanceInput || d.amountInput,
                        })
                      }
                    >
                      Full balance
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        updateDraft(index, {
                          amountInput: d.minimumPaymentInput || d.amountInput,
                        })
                      }
                    >
                      Minimum
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {d.textPreview ? (
            <p className="muted setup-preview-text">
              Read from PDF: {d.textPreview.slice(0, 200)}
              {d.textPreview.length > 200 ? '…' : ''}
            </p>
          ) : null}

          {d.saveResult ? (
            <p className="setup-result amount-neg">{d.saveResult}</p>
          ) : null}
        </section>
      ))}
    </>
  )
}
