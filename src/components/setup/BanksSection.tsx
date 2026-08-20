import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Account,
  PlaidConnectPoll,
  PlaidEnv,
  PlaidItem,
  PlaidMappingChoice,
  PlaidStatus,
  PlaidSyncResult,
} from '../../types'
import { money } from '../../lib/format'

type Props = {
  profileId: number
  accounts: Account[]
  reloadAccounts: () => Promise<void>
}

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investment' },
]

const POLL_MS = 2500
/** Hosted Link tokens are short-lived; stop waiting well before that. */
const POLL_LIMIT = Math.round((10 * 60 * 1000) / POLL_MS)

type LinkedPoll = Extract<PlaidConnectPoll, { state: 'linked' }>

/** 'create' makes a new account, 'skip' leaves the bank account out. */
type Choice = 'create' | 'skip' | string

type Waiting =
  | null
  | { mode: 'connect' }
  | { mode: 'repair'; itemRowId: number }

type MappingDraft = {
  itemRowId: number
  institutionName: string
  rows: LinkedPoll['accounts']
  choice: Record<number, Choice>
  name: Record<number, string>
  type: Record<number, string>
}

function statusLabel(item: PlaidItem): { text: string; tone: string } {
  if (item.status === 'login_required') {
    return { text: 'Needs sign-in', tone: 'due' }
  }
  if (item.status === 'error') return { text: 'Last sync failed', tone: 'due' }
  if (!item.last_synced_at) return { text: 'Not synced yet', tone: '' }
  return { text: 'Connected', tone: 'paid' }
}

function whenLabel(stamp: string | null): string {
  if (!stamp) return 'never'
  // SQLite hands back UTC without a zone marker.
  const date = new Date(`${stamp.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return stamp
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function syncSummary(res: PlaidSyncResult): string {
  if (res.error) return `${res.institutionName}: ${res.error}`
  if (res.historyPending) {
    return `${res.institutionName} is still assembling its history. Nothing arrived yet — hit “Sync now” again in a minute.`
  }
  const bits = [`${res.inserted} new`]
  if (res.updated) bits.push(`${res.updated} updated`)
  if (res.deleted) bits.push(`${res.deleted} removed`)
  const range =
    res.earliest && res.latest ? ` (${res.earliest} → ${res.latest})` : ''
  return `${res.institutionName}: ${bits.join(', ')}${range}.`
}

export function BanksSection({ profileId, accounts, reloadAccounts }: Props) {
  const [status, setStatus] = useState<PlaidStatus | null>(null)
  const [items, setItems] = useState<PlaidItem[]>([])
  const [keysOpen, setKeysOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [env, setEnv] = useState<PlaidEnv>('sandbox')
  const [busy, setBusy] = useState(false)
  /** A Plaid window is open in the browser: adding a bank, or repairing one. */
  const [waiting, setWaiting] = useState<Waiting>(null)
  const [mapping, setMapping] = useState<MappingDraft | null>(null)
  const [results, setResults] = useState<PlaidSyncResult[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmForget, setConfirmForget] = useState<number | null>(null)
  const linkToken = useRef<string | null>(null)

  const reload = useCallback(async () => {
    const [st, list] = await Promise.all([
      window.finance.plaid.status(),
      window.finance.plaid.items(profileId),
    ])
    setStatus(st)
    setItems(list)
    setEnv(st.env)
    setKeysOpen(!st.configured)
  }, [profileId])

  useEffect(() => {
    void reload()
  }, [reload])

  const saveKeys = async () => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    const res = await window.finance.plaid.saveKeys({ clientId, secret, env })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    setStatus(res.data)
    setSecret('')
    setClientId('')
    setKeysOpen(false)
    setMsg(
      `Keys saved and verified against ${
        res.data.env === 'sandbox' ? 'Sandbox' : 'Production'
      }.`,
    )
  }

  const removeKeys = async () => {
    const res = await window.finance.plaid.clearKeys()
    if (res.ok) {
      setStatus(res.data)
      setKeysOpen(true)
      setMsg('Keys removed from this computer.')
    }
  }

  const connect = async () => {
    setErr(null)
    setMsg(null)
    setResults([])
    setBusy(true)
    const started = await window.finance.plaid.connectStart(profileId)
    setBusy(false)
    if (!started.ok) {
      setErr(started.error)
      return
    }
    linkToken.current = started.data.linkToken
    setWaiting({ mode: 'connect' })
  }

  // Hosted Link finishes in the browser, so we ask Plaid whether it's done.
  useEffect(() => {
    if (waiting?.mode !== 'connect' || !linkToken.current) return
    let tries = 0
    let stop = false
    let inFlight = false

    const tick = async () => {
      if (stop || inFlight) return
      tries += 1
      const token = linkToken.current
      if (!token) return
      inFlight = true
      const res = await window.finance.plaid
        .connectPoll(profileId, token)
        .finally(() => {
          inFlight = false
        })
      if (stop) return
      if (!res.ok) {
        setErr(res.error)
        setWaiting(null)
        return
      }
      if (res.data.state === 'linked') {
        const linked = res.data
        setWaiting(null)
        setMapping({
          itemRowId: linked.itemRowId,
          institutionName: linked.institutionName,
          rows: linked.accounts,
          choice: Object.fromEntries(
            linked.accounts.map((a) => [
              a.id,
              a.suggestedAccountId != null
                ? String(a.suggestedAccountId)
                : 'create',
            ]),
          ),
          name: Object.fromEntries(linked.accounts.map((a) => [a.id, a.label])),
          type: Object.fromEntries(
            linked.accounts.map((a) => [a.id, a.suggestedType]),
          ),
        })
        await reload()
        return
      }
      if (tries >= POLL_LIMIT) {
        setWaiting(null)
        setErr('That link session expired. Start the connection again.')
      }
    }

    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [waiting, profileId, reload])

  const saveMapping = async () => {
    if (!mapping) return
    setBusy(true)
    setErr(null)
    const choices: PlaidMappingChoice[] = mapping.rows.map((row) => {
      const pick = mapping.choice[row.id]
      if (pick === 'create') {
        return {
          plaidAccountRowId: row.id,
          accountId: null,
          create: true,
          name: mapping.name[row.id]?.trim() || row.label,
          type: mapping.type[row.id] ?? row.suggestedType,
        }
      }
      return {
        plaidAccountRowId: row.id,
        accountId: pick === 'skip' ? null : Number(pick),
        create: false,
        name: '',
        type: '',
      }
    })

    const saved = await window.finance.plaid.finishMapping({
      profileId,
      itemRowId: mapping.itemRowId,
      choices,
    })
    if (!saved.ok) {
      setBusy(false)
      setErr(saved.error)
      return
    }

    const itemRowId = mapping.itemRowId
    setMapping(null)
    await reloadAccounts()
    setMsg(
      'Accounts linked. Pulling history — banks take a minute to hand over ' +
        'two years, so this can sit here a while.',
    )
    const synced = await window.finance.plaid.sync(itemRowId, true)
    setBusy(false)
    if (!synced.ok) {
      setErr(synced.error)
    } else {
      setResults([synced.data])
      setMsg(null)
    }
    await Promise.all([reload(), reloadAccounts()])
  }

  const runSync = async (itemRowId?: number) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    setResults([])
    const res =
      itemRowId != null
        ? await window.finance.plaid.sync(itemRowId)
        : await window.finance.plaid.syncAll(profileId)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
    } else {
      setResults(Array.isArray(res.data) ? res.data : [res.data])
    }
    await Promise.all([reload(), reloadAccounts()])
  }

  const reconnect = async (itemRowId: number) => {
    setBusy(true)
    setErr(null)
    const res = await window.finance.plaid.reconnect(itemRowId)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    // Update mode hands back no public token, so there is nothing to poll for.
    linkToken.current = null
    setWaiting({ mode: 'repair', itemRowId })
  }

  const forget = async (itemRowId: number, deleteTransactions: boolean) => {
    setBusy(true)
    const res = await window.finance.plaid.disconnect(
      itemRowId,
      deleteTransactions,
    )
    setBusy(false)
    setConfirmForget(null)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    setMsg(
      deleteTransactions
        ? 'Bank disconnected and its synced transactions deleted.'
        : 'Bank disconnected. Its transactions stayed as history.',
    )
    await Promise.all([reload(), reloadAccounts()])
  }

  const accountName = (id: number | null) =>
    accounts.find((a) => a.id === id)?.name ?? null

  return (
    <>
      <section className="setup-section">
        <div className="setup-head">
          <h2 className="home-section-title">Plaid keys</h2>
          {status?.configured && !keysOpen ? (
            <button
              type="button"
              className="text-link"
              onClick={() => setKeysOpen(true)}
            >
              Change keys
            </button>
          ) : null}
        </div>

        {status && !status.encryptionAvailable ? (
          <p className="setup-result amount-neg">
            This computer can't encrypt saved secrets, so keys won't be stored.
          </p>
        ) : null}

        {status?.configured && !keysOpen ? (
          <div className="setup-row is-static">
            <div className="setup-row-main">
              <span className="setup-row-name">
                {status.env === 'sandbox' ? 'Sandbox' : 'Production'} keys saved
              </span>
              <span className="muted setup-row-meta">
                Client ID {status.clientIdHint} · encrypted on this computer
              </span>
            </div>
            <div className="setup-row-actions">
              <button
                type="button"
                className="text-link"
                onClick={() => void removeKeys()}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="setup-inline">
            <div className="segmented is-small">
              <button
                type="button"
                className={env === 'sandbox' ? 'active' : ''}
                onClick={() => setEnv('sandbox')}
              >
                Sandbox
              </button>
              <button
                type="button"
                className={env === 'production' ? 'active' : ''}
                onClick={() => setEnv('production')}
              >
                Production
              </button>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Client ID</label>
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="From the Plaid dashboard"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label>
                  {env === 'sandbox' ? 'Sandbox secret' : 'Production secret'}
                </label>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Keys → Secrets"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="setup-actions-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveKeys()}
                disabled={busy || !clientId.trim() || !secret.trim()}
              >
                {busy ? 'Checking…' : 'Save keys'}
              </button>
              {status?.configured ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setKeysOpen(false)}
                >
                  Cancel
                </button>
              ) : null}
              <span className="muted setup-hint">
                Keys are checked with Plaid, then encrypted on this computer.
                They never leave it except to call Plaid.
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="setup-section">
        <div className="setup-head">
          <h2 className="home-section-title">Connected banks</h2>
          {items.length > 0 ? (
            <button
              type="button"
              className="text-link"
              onClick={() => void runSync()}
              disabled={busy || waiting != null}
            >
              Sync all
            </button>
          ) : null}
        </div>

        {waiting ? (
          <div className="setup-inline">
            <strong>Finish in your browser</strong>
            <span className="muted setup-hint">
              {waiting.mode === 'connect'
                ? 'A Plaid window opened outside the app. Pick your bank and sign in — this page notices when you’re done.'
                : 'A Plaid window opened outside the app. Sign in again to repair the connection, then come back here.'}
              {status?.env === 'sandbox'
                ? ' Sandbox logins are user_good / pass_good.'
                : ''}
            </span>
            <div className="setup-inline-actions">
              {waiting.mode === 'repair' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const id = waiting.itemRowId
                    setWaiting(null)
                    void runSync(id)
                  }}
                  disabled={busy}
                >
                  I'm done — sync now
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setWaiting(null)
                  linkToken.current = null
                }}
              >
                {waiting.mode === 'connect' ? 'Stop waiting' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : null}

        {mapping ? (
          <div className="setup-inline">
            <strong>Match {mapping.institutionName} accounts</strong>
            <span className="muted setup-hint">
              Point each bank account at one you already have, or let the app
              add it. Anything set to “Don't import” is left alone.
            </span>
            <ul className="setup-list">
              {mapping.rows.map((row) => {
                const pick = mapping.choice[row.id]
                return (
                  <li key={row.id} className="setup-row-wrap">
                    <div className="bank-map-row">
                      <div className="setup-row-main">
                        <span className="setup-row-name">{row.label}</span>
                        <span className="muted setup-row-meta">
                          {row.balance != null
                            ? money(row.balance)
                            : 'no balance reported'}
                        </span>
                      </div>
                      <select
                        value={pick}
                        onChange={(e) =>
                          setMapping({
                            ...mapping,
                            choice: {
                              ...mapping.choice,
                              [row.id]: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="create">Add as a new account</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={String(a.id)}>
                            {a.name}
                          </option>
                        ))}
                        <option value="skip">Don't import</option>
                      </select>
                    </div>
                    {pick === 'create' ? (
                      <div className="bank-map-row bank-map-new">
                        <input
                          value={mapping.name[row.id] ?? ''}
                          onChange={(e) =>
                            setMapping({
                              ...mapping,
                              name: {
                                ...mapping.name,
                                [row.id]: e.target.value,
                              },
                            })
                          }
                          placeholder="Account name"
                        />
                        <select
                          value={mapping.type[row.id] ?? 'checking'}
                          onChange={(e) =>
                            setMapping({
                              ...mapping,
                              type: {
                                ...mapping.type,
                                [row.id]: e.target.value,
                              },
                            })
                          }
                        >
                          {ACCOUNT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            <div className="setup-inline-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveMapping()}
                disabled={busy}
              >
                {busy ? 'Working…' : 'Save and pull 24 months'}
              </button>
              <button
                type="button"
                className="text-link"
                onClick={() => setMapping(null)}
                disabled={busy}
              >
                Later
              </button>
            </div>
          </div>
        ) : null}

        {items.length === 0 && !waiting && !mapping ? (
          <div className="empty">
            <p style={{ margin: '0 0 12px' }}>
              {status?.configured
                ? 'No banks connected yet. Connecting one pulls up to 24 months of history, then keeps itself current.'
                : 'Add your Plaid keys above, then you can connect a bank.'}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void connect()}
              disabled={!status?.configured || busy}
            >
              Connect a bank
            </button>
          </div>
        ) : null}

        {items.length > 0 ? (
          <ul className="setup-list">
            {items.map((item) => {
              const badge = statusLabel(item)
              return (
                <li key={item.id} className="setup-row-wrap">
                  <div className="setup-row is-static">
                    <div className="setup-row-main">
                      <span className="setup-row-name">
                        {item.institution_name ?? 'Bank'}
                      </span>
                      <span className="muted setup-row-meta">
                        {item.env === 'sandbox' ? 'Sandbox · ' : ''}
                        Last synced {whenLabel(item.last_synced_at)}
                      </span>
                    </div>
                    <div className="setup-row-side">
                      <span className={`badge ${badge.tone}`}>{badge.text}</span>
                      <div className="setup-row-actions">
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => void runSync(item.id)}
                          disabled={busy || waiting != null}
                        >
                          Sync now
                        </button>
                        {item.status === 'login_required' ? (
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => void reconnect(item.id)}
                            disabled={busy || waiting != null}
                          >
                            Fix sign-in
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setConfirmForget(item.id)}
                          disabled={busy}
                        >
                          Forget
                        </button>
                      </div>
                    </div>
                  </div>

                  <ul className="bank-accounts">
                    {item.accounts.map((acct) => (
                      <li key={acct.id}>
                        <span>
                          {acct.name}
                          {acct.mask ? ` ••${acct.mask}` : ''}
                        </span>
                        <span className="muted">
                          {acct.linked && acct.account_id != null
                            ? `→ ${accountName(acct.account_id) ?? 'account'}`
                            : 'not imported'}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {item.last_error && item.status !== 'ok' ? (
                    <p className="muted setup-row-meta">{item.last_error}</p>
                  ) : null}

                  {confirmForget === item.id ? (
                    <div className="setup-inline">
                      <strong>Forget {item.institution_name ?? 'this bank'}?</strong>
                      <span className="muted setup-hint">
                        The connection is revoked at Plaid either way. Choose
                        whether the transactions it synced stay behind.
                      </span>
                      <div className="setup-inline-actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void forget(item.id, false)}
                          disabled={busy}
                        >
                          Keep transactions
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void forget(item.id, true)}
                          disabled={busy}
                        >
                          Delete them too
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setConfirmForget(null)}
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
        ) : null}

        {items.length > 0 && !waiting && !mapping ? (
          <div className="setup-actions-row">
            <button
              type="button"
              className="btn"
              onClick={() => void connect()}
              disabled={busy}
            >
              Connect another bank
            </button>
          </div>
        ) : null}

        {msg ? <p className="setup-msg muted">{msg}</p> : null}
        {err ? <p className="setup-result amount-neg">{err}</p> : null}

        {results.length > 0 ? (
          <ul className="setup-note-list">
            {results.map((res) => (
              <li key={res.itemRowId}>
                {syncSummary(res)}
                {res.skipped > 0
                  ? ` ${res.skipped} skipped from accounts you didn't import.`
                  : ''}
                {res.overlap.map((o) => (
                  <div key={o.account_id}>
                    {o.account_name}: {o.count} hand-entered or imported
                    transaction{o.count === 1 ? '' : 's'} sit in this same date
                    range — worth reviewing on the Transactions page so nothing
                    is counted twice.
                  </div>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  )
}
