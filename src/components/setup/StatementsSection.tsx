import { useEffect, useMemo, useState } from 'react'
import type { Account, ImportRow, StatementImport } from '../../types'
import { dayLabel, money } from '../../lib/format'

type Props = {
  profileId: number
  accounts: Account[]
  reloadAccounts: () => Promise<void>
  onNeedAccount: () => void
}

const BANK_TYPES = new Set(['checking', 'savings', 'cash'])
const IMPORTABLE_TYPES = new Set([...BANK_TYPES, 'credit'])

const PREVIEW_LIMIT = 40

function typeLabel(type: string) {
  return type === 'credit' ? 'credit card' : type
}

export function StatementsSection({
  profileId,
  accounts,
  reloadAccounts,
  onNeedAccount,
}: Props) {
  const [accountId, setAccountId] = useState<number | ''>('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [endingBalance, setEndingBalance] = useState('')
  const [startingBalance, setStartingBalance] = useState<number | null>(null)
  const [parseNotes, setParseNotes] = useState<string[]>([])
  const [result, setResult] = useState<string | null>(null)
  const [resultBad, setResultBad] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<StatementImport[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editFileName, setEditFileName] = useState('')
  const [editAccountId, setEditAccountId] = useState<number | ''>('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [undoTx, setUndoTx] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyMsg, setHistoryMsg] = useState<string | null>(null)

  const bankAccounts = useMemo(
    () => accounts.filter((a) => BANK_TYPES.has(a.type)),
    [accounts],
  )
  const creditAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'credit'),
    [accounts],
  )
  const importable = useMemo(
    () => accounts.filter((a) => IMPORTABLE_TYPES.has(a.type)),
    [accounts],
  )

  const loadHistory = async () => {
    setHistory(await window.finance.import.statementHistory(profileId))
  }

  useEffect(() => {
    void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  useEffect(() => {
    setAccountId((prev) => {
      if (prev && importable.some((a) => a.id === prev)) return prev
      return importable[0]?.id ?? ''
    })
  }, [importable])

  const selected = accounts.find((a) => a.id === accountId)
  const isCredit = selected?.type === 'credit'

  const totals = useMemo(() => {
    let moneyIn = 0
    let moneyOut = 0
    for (const r of rows) {
      if (r.amount > 0) moneyIn += r.amount
      else moneyOut += Math.abs(r.amount)
    }
    const net = moneyIn - moneyOut
    const closeRaw = endingBalance.trim() === '' ? null : Number(endingBalance)
    const close =
      closeRaw != null && !Number.isNaN(closeRaw) ? closeRaw : null
    const open =
      startingBalance != null
        ? startingBalance
        : close != null
          ? Number((close - net).toFixed(2))
          : null
    return { moneyIn, moneyOut, net, count: rows.length, open, close }
  }, [rows, endingBalance, startingBalance])

  const resetPick = () => {
    setResult(null)
    setResultBad(false)
    setParseNotes([])
    setStartingBalance(null)
  }

  const clearPick = () => {
    setRows([])
    setFileName(null)
    setEndingBalance('')
    setStartingBalance(null)
    setParseNotes([])
  }

  const pickCsv = async () => {
    resetPick()
    const picked = await window.finance.import.pickCsv()
    if (!picked) return
    setFileName(picked.fileName)
    setRows(picked.rows)
    const notes = [...(picked.notes ?? [])]
    if (isCredit && picked.endingBalance == null) {
      notes.push(
        'Credit card CSVs usually leave out a running balance. Paste the statement balance you owe below if you want the card total to match the issuer.',
      )
    }
    if (!picked.rows.length) {
      notes.push(
        'No transactions found in that CSV — check it has date, description, and amount columns.',
      )
    }
    setParseNotes(notes)
    setStartingBalance(picked.startingBalance ?? null)
    setEndingBalance(
      picked.endingBalance != null ? String(picked.endingBalance) : '',
    )
  }

  const pickPdf = async () => {
    resetPick()
    const files = await window.finance.import.pickBankPdfs()
    if (!files?.length) return

    const allRows: ImportRow[] = []
    const notes: string[] = []
    const names: string[] = []
    let lastEnding: number | null = null

    for (const f of files) {
      names.push(f.fileName)
      allRows.push(...f.rows)
      if (f.endingBalance != null) lastEnding = f.endingBalance
      for (const n of f.notes) notes.push(`${f.fileName}: ${n}`)
    }

    const seen = new Set<string>()
    const unique = allRows.filter((r) => {
      const key = `${r.date}|${r.amount.toFixed(2)}|${r.payee.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (isCredit) {
      notes.push(
        'This brings in card activity (purchases, payments, refunds). For the amount due or minimum payment, use Bill PDFs instead.',
      )
    }

    setFileName(names.join(', '))
    setRows(unique)
    setParseNotes(notes)
    if (lastEnding != null) setEndingBalance(String(lastEnding))
  }

  const commit = async () => {
    if (!accountId || rows.length === 0) return
    setBusy(true)
    try {
      const res = await window.finance.import.commit({
        profileId,
        accountId,
        rows,
        fileName: fileName ?? 'statement.csv',
        endingBalance:
          endingBalance.trim() === '' ? null : Number(endingBalance),
      })
      setResultBad(false)
      setResult(
        `Imported ${res.imported} new transaction${
          res.imported === 1 ? '' : 's'
        } into ${res.accountName ?? 'account'}, skipped ${res.skipped} duplicate${
          res.skipped === 1 ? '' : 's'
        }.` +
          (res.accountBalance != null
            ? ` Balance now ${money(res.accountBalance)}.`
            : ''),
      )
      clearPick()
      await Promise.all([reloadAccounts(), loadHistory()])
    } catch (e) {
      setResultBad(true)
      setResult(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (h: StatementImport) => {
    setDeleteId(null)
    setHistoryMsg(null)
    setEditingId(h.id)
    setEditFileName(h.file_name)
    setEditAccountId(h.account_id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditFileName('')
    setEditAccountId('')
  }

  const saveEdit = async () => {
    if (editingId == null || !editAccountId || !editFileName.trim()) return
    setHistoryBusy(true)
    setHistoryMsg(null)
    try {
      await window.finance.import.updateStatement({
        id: editingId,
        fileName: editFileName.trim(),
        accountId: editAccountId,
      })
      cancelEdit()
      await Promise.all([reloadAccounts(), loadHistory()])
      setHistoryMsg('Import updated.')
    } catch (e) {
      setHistoryMsg(e instanceof Error ? e.message : 'Could not update import')
    } finally {
      setHistoryBusy(false)
    }
  }

  const startDelete = (h: StatementImport) => {
    setEditingId(null)
    setHistoryMsg(null)
    setDeleteId(h.id)
    setUndoTx((h.linked_tx_count ?? 0) > 0)
  }

  const confirmDelete = async () => {
    if (deleteId == null) return
    const h = history.find((x) => x.id === deleteId)
    const canUndo = (h?.linked_tx_count ?? 0) > 0
    setHistoryBusy(true)
    setHistoryMsg(null)
    try {
      const res = await window.finance.import.deleteStatement({
        id: deleteId,
        undoTransactions: canUndo && undoTx,
      })
      setHistoryMsg(
        canUndo && undoTx
          ? `Removed “${res.fileName}” and ${res.removedTransactions} transaction${
              res.removedTransactions === 1 ? '' : 's'
            }.` +
              (res.accountBalance != null
                ? ` ${res.accountName} balance now ${money(res.accountBalance)}.`
                : '')
          : `Removed “${res.fileName}” from history. Transactions were left alone.`,
      )
      setDeleteId(null)
      await Promise.all([reloadAccounts(), loadHistory()])
    } catch (e) {
      setHistoryMsg(e instanceof Error ? e.message : 'Could not delete import')
    } finally {
      setHistoryBusy(false)
    }
  }

  return (
    <>
      <section className="setup-section">
        <div className="setup-head">
          <h2 className="home-section-title">Bring in a statement</h2>
          {rows.length > 0 ? (
            <button type="button" className="text-link" onClick={clearPick}>
              Discard file
            </button>
          ) : null}
        </div>

        {importable.length === 0 ? (
          <div className="empty">
            <p style={{ margin: '0 0 12px' }}>
              You need a checking, savings, or card account before importing.
            </p>
            <button type="button" className="btn" onClick={onNeedAccount}>
              Add an account
            </button>
          </div>
        ) : (
          <>
            <div className="form-grid">
              <div className="field">
                <label>Import into</label>
                <select
                  value={accountId}
                  onChange={(e) =>
                    setAccountId(e.target.value ? Number(e.target.value) : '')
                  }
                >
                  {bankAccounts.length > 0 ? (
                    <optgroup label="Bank">
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {money(a.balance)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {creditAccounts.length > 0 ? (
                    <optgroup label="Credit cards">
                      {creditAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {money(a.balance)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
              <div className="field">
                <label>
                  {isCredit ? 'Statement balance owed' : 'Balance after import'}
                </label>
                <input
                  value={endingBalance}
                  onChange={(e) => setEndingBalance(e.target.value)}
                  placeholder={isCredit ? 'Optional' : 'Auto-filled when found'}
                />
                <span className="setup-hint muted">
                  {isCredit
                    ? 'Card CSVs rarely include a balance — paste it to match your issuer.'
                    : 'Bank files often carry a running balance; we set the account to the latest one.'}
                </span>
              </div>
            </div>

            <div className="setup-actions-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void pickCsv()}
                disabled={!accountId}
              >
                Choose CSV…
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void pickPdf()}
                disabled={!accountId}
              >
                Choose PDF…
              </button>
              <span className="muted setup-hint">
                CSV is most accurate; PDF is best-effort.
              </span>
            </div>
          </>
        )}

        {parseNotes.length > 0 ? (
          <ul className="setup-note-list">
            {parseNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        {result ? (
          <p className={`setup-result ${resultBad ? 'amount-neg' : 'amount-pos'}`}>
            {result}
          </p>
        ) : null}
      </section>

      {rows.length > 0 ? (
        <section className="setup-section">
          <div className="setup-head">
            <h2 className="home-section-title">Ready to import</h2>
            <span className="muted setup-hint">
              {fileName}
              {selected ? ` → ${selected.name}` : ''}
            </span>
          </div>

          <div className="setup-stat-strip">
            <div>
              <div className="home-kicker">Rows</div>
              <div className="setup-stat-num">{totals.count}</div>
            </div>
            <div>
              <div className="home-kicker">
                {isCredit ? 'Payments' : 'Money in'}
              </div>
              <div className="setup-stat-num amount-pos">
                {money(totals.moneyIn)}
              </div>
            </div>
            <div>
              <div className="home-kicker">
                {isCredit ? 'Charges' : 'Money out'}
              </div>
              <div className="setup-stat-num amount-neg">
                {money(totals.moneyOut)}
              </div>
            </div>
            <div>
              <div className="home-kicker">Balance after</div>
              <div className="setup-stat-num">
                {totals.close != null
                  ? money(totals.close)
                  : selected
                    ? money(selected.balance + totals.net)
                    : '—'}
              </div>
            </div>
          </div>

          <ul className="setup-preview-list">
            {rows.slice(0, PREVIEW_LIMIT).map((r, i) => (
              <li key={`${r.date}-${r.payee}-${i}`}>
                <span className="setup-preview-main">
                  <span className="setup-row-name">{r.payee}</span>
                  <span className="muted setup-row-meta">
                    {dayLabel(r.date)}
                    {r.memo ? ` · ${r.memo}` : ''}
                  </span>
                </span>
                <span
                  className={`setup-row-num ${
                    r.amount < 0 ? 'amount-neg' : 'amount-pos'
                  }`}
                >
                  {money(r.amount)}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > PREVIEW_LIMIT ? (
            <p className="muted setup-hint">
              Showing the first {PREVIEW_LIMIT} of {rows.length}.
            </p>
          ) : null}

          <div className="setup-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !accountId}
              onClick={() => void commit()}
            >
              {busy ? 'Importing…' : `Import ${rows.length} transactions`}
            </button>
            <span className="muted setup-hint">
              Duplicates already in this account are skipped.
            </span>
          </div>
        </section>
      ) : null}

      <section className="setup-section">
        <div className="setup-head">
          <h2 className="home-section-title">Import history</h2>
          <span className="muted setup-hint">
            {history.length} file{history.length === 1 ? '' : 's'}
          </span>
        </div>

        {historyMsg ? (
          <p
            className={`setup-result ${
              historyMsg.startsWith('Could not') ? 'amount-neg' : 'amount-pos'
            }`}
          >
            {historyMsg}
          </p>
        ) : null}

        {history.length === 0 ? (
          <div className="empty">Nothing imported yet.</div>
        ) : (
          <ul className="setup-list">
            {history.map((h) => {
              const linked = h.linked_tx_count ?? 0
              const isEditing = editingId === h.id
              const isDeleting = deleteId === h.id
              return (
                <li key={h.id} className="setup-row-wrap">
                  <div className="setup-row is-static">
                    <span className="setup-row-main">
                      <span className="setup-row-name">{h.file_name}</span>
                      <span className="muted setup-row-meta">
                        {h.account_name} · {h.created_at?.slice(0, 10) ?? '—'} ·{' '}
                        {h.imported_count} in
                        {h.skipped_count > 0
                          ? `, ${h.skipped_count} skipped`
                          : ''}
                        {linked > 0 ? ` · ${linked} undoable` : ''}
                      </span>
                    </span>
                    <span className="setup-row-side">
                      <span className="setup-row-num">
                        <span className="amount-pos">{money(h.money_in)}</span>
                        <span className="muted"> / </span>
                        <span className="amount-neg">{money(h.money_out)}</span>
                      </span>
                      <span className="setup-row-actions">
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => startEdit(h)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-link is-danger"
                          onClick={() => startDelete(h)}
                        >
                          Delete
                        </button>
                      </span>
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="setup-inline">
                      <div className="form-grid">
                        <div className="field">
                          <label>Label</label>
                          <input
                            value={editFileName}
                            onChange={(e) => setEditFileName(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>Account</label>
                          <select
                            value={editAccountId}
                            onChange={(e) =>
                              setEditAccountId(
                                e.target.value ? Number(e.target.value) : '',
                              )
                            }
                          >
                            {importable.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({typeLabel(a.type)})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="setup-inline-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={historyBusy}
                          onClick={() => void saveEdit()}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {isDeleting ? (
                    <div className="setup-inline">
                      <p className="setup-confirm-copy">
                        {linked > 0
                          ? `Remove “${h.file_name}” from history?`
                          : `Remove “${h.file_name}” from history? Its transactions aren’t linked, so they’ll stay put.`}
                      </p>
                      {linked > 0 ? (
                        <label className="checkbox-label setup-confirm-check">
                          <input
                            type="checkbox"
                            checked={undoTx}
                            onChange={(e) => setUndoTx(e.target.checked)}
                          />
                          <span>
                            Also delete {linked} imported transaction
                            {linked === 1 ? '' : 's'}
                          </span>
                        </label>
                      ) : null}
                      <div className="setup-inline-actions">
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={historyBusy}
                          onClick={() => void confirmDelete()}
                        >
                          {historyBusy ? 'Removing…' : 'Confirm delete'}
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
