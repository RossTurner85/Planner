import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Account, Profile } from '../../types'
import { money } from '../../lib/format'

type Props = {
  profileId: number
  profiles: Profile[]
  accounts: Account[]
  reload: () => Promise<void>
  focusAccountId?: number | null
}

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investment' },
]

const GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'Bank', types: ['checking', 'savings', 'cash'] },
  { label: 'Credit cards', types: ['credit'] },
]

function typeLabel(type: string) {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type
}

type EditForm = {
  name: string
  type: string
  institution: string
  balance: string
  dueDay: string
}

const emptyAdd = (): EditForm => ({
  name: '',
  type: 'checking',
  institution: '',
  balance: '0',
  dueDay: '',
})

/** Blank clears the day; anything outside 1–31 is rejected by the caller. */
function parseDueDay(raw: string): number | null | 'invalid' {
  const clean = raw.trim()
  if (!clean) return null
  const day = Number(clean)
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'invalid'
  return day
}

export function AccountsSection({
  profileId,
  profiles,
  accounts,
  reload,
  focusAccountId = null,
}: Props) {
  const [openId, setOpenId] = useState<number | null>(focusAccountId)
  const [edit, setEdit] = useState<EditForm>(emptyAdd)
  const [addOpen, setAddOpen] = useState(false)
  const [add, setAdd] = useState<EditForm>(emptyAdd)
  const [addOwner, setAddOwner] = useState(profileId)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (focusAccountId != null) setOpenId(focusAccountId)
  }, [focusAccountId])

  // Keep the open editor in sync with whichever account is expanded.
  useEffect(() => {
    const a = accounts.find((x) => x.id === openId)
    if (!a) return
    setEdit({
      name: a.name,
      type: a.type,
      institution: a.institution ?? '',
      balance: String(a.balance),
      dueDay: a.due_day != null ? String(a.due_day) : '',
    })
  }, [openId, accounts])

  useEffect(() => {
    setAddOwner(profileId)
  }, [profileId])

  const grouped = useMemo(() => {
    const claimed = new Set(GROUPS.flatMap((g) => g.types))
    const owners: Array<{ label: string; color: string; items: Account[] }> = []
    const seen = new Set<number>()
    for (const a of accounts) {
      if (seen.has(a.profile_id)) continue
      seen.add(a.profile_id)
      const mine = accounts.filter((x) => x.profile_id === a.profile_id)
      owners.push({
        label: a.owner_name ?? 'Unknown',
        color: a.owner_color ?? '#2F6F5E',
        items: mine,
      })
    }
    return owners.map((owner) => {
      const sections = GROUPS.map((g) => ({
        label: g.label,
        items: owner.items.filter((a) => g.types.includes(a.type)),
      }))
      const rest = owner.items.filter((a) => !claimed.has(a.type))
      if (rest.length) sections.push({ label: 'Other', items: rest })
      return {
        owner: owner.label,
        color: owner.color,
        sections: sections.filter((s) => s.items.length > 0),
      }
    })
  }, [accounts])

  const toggle = (id: number) => {
    setMsg(null)
    setOpenId((cur) => (cur === id ? null : id))
  }

  const saveEdit = async (id: number) => {
    const balance = Number(edit.balance)
    if (!edit.name.trim() || Number.isNaN(balance)) {
      setMsg('Name is required and balance must be a number.')
      return
    }
    const dueDay = parseDueDay(edit.dueDay)
    if (dueDay === 'invalid') {
      setMsg('Due day needs to be a day of the month between 1 and 31.')
      return
    }
    setBusy(true)
    try {
      await window.finance.accounts.update(id, {
        name: edit.name.trim(),
        type: edit.type,
        institution: edit.institution.trim() || undefined,
        balance,
        dueDay,
      })
      await reload()
      setMsg('Saved.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save account')
    } finally {
      setBusy(false)
    }
  }

  const removeAccount = async (a: Account) => {
    if (
      !confirm(
        `Remove “${a.name}”? Transactions stay in the database but lose this account.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await window.finance.accounts.delete(a.id)
      setOpenId(null)
      await reload()
      setMsg(`Removed ${a.name}.`)
    } finally {
      setBusy(false)
    }
  }

  const onAdd = async (e: FormEvent) => {
    e.preventDefault()
    const balance = Number(add.balance || 0)
    if (!add.name.trim() || Number.isNaN(balance)) return
    const dueDay = parseDueDay(add.dueDay)
    if (dueDay === 'invalid') {
      setMsg('Due day needs to be a day of the month between 1 and 31.')
      return
    }
    setBusy(true)
    try {
      const created = (await window.finance.accounts.create({
        profileId: addOwner,
        name: add.name.trim(),
        type: add.type,
        institution: add.institution.trim() || undefined,
        balance,
        dueDay,
      })) as Account
      setAdd(emptyAdd())
      setAddOpen(false)
      await reload()
      if (created?.id != null) setOpenId(created.id)
      setMsg(`Added ${created?.name ?? 'account'}.`)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not add account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="setup-section">
      <div className="setup-head">
        <h2 className="home-section-title">Household accounts</h2>
        <button
          type="button"
          className="text-link"
          onClick={() => setAddOpen((o) => !o)}
        >
          {addOpen ? 'Never mind' : 'Add an account'}
        </button>
      </div>

      {addOpen ? (
        <form className="setup-inline" onSubmit={onAdd}>
          <div className="home-kicker">New account</div>
          <div className="form-grid">
            <div className="field">
              <label>Whose</label>
              <select
                value={addOwner}
                onChange={(e) => setAddOwner(Number(e.target.value))}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role === 'dependent' ? ' (kid)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Name</label>
              <input
                value={add.name}
                onChange={(e) => setAdd({ ...add, name: e.target.value })}
                placeholder="Everyday Checking"
                required
              />
            </div>
            <div className="field">
              <label>Type</label>
              <select
                value={add.type}
                onChange={(e) => setAdd({ ...add, type: e.target.value })}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Institution</label>
              <input
                value={add.institution}
                onChange={(e) =>
                  setAdd({ ...add, institution: e.target.value })
                }
                placeholder="Chase"
              />
            </div>
            <div className="field">
              <label>Starting balance</label>
              <input
                value={add.balance}
                onChange={(e) => setAdd({ ...add, balance: e.target.value })}
              />
            </div>
            {add.type === 'credit' ? (
              <div className="field">
                <label>Payment due day</label>
                <input
                  value={add.dueDay}
                  onChange={(e) => setAdd({ ...add, dueDay: e.target.value })}
                  placeholder="e.g. 22"
                  inputMode="numeric"
                />
                <span className="setup-hint muted">
                  Day of the month the payment is due. Shows on Home.
                </span>
              </div>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Add account
            </button>
          </div>
        </form>
      ) : null}

      {accounts.length === 0 ? (
        <div className="empty">
          No accounts yet — add your checking account first, then import a
          statement.
        </div>
      ) : (
        grouped.map((owner) => (
          <div className="setup-owner" key={owner.owner}>
            <div className="setup-owner-head">
              <span className="dot" style={{ background: owner.color }} />
              <span>{owner.owner}</span>
            </div>
            {owner.sections.map((group) => (
          <div className="setup-group" key={`${owner.owner}-${group.label}`}>
            <div className="home-kicker setup-group-label">{group.label}</div>
            <ul className="setup-list">
              {group.items.map((a) => {
                const open = openId === a.id
                return (
                  <li
                    key={a.id}
                    className={`setup-row-wrap${open ? ' is-open' : ''}`}
                  >
                    <button
                      type="button"
                      className="setup-row clickable"
                      onClick={() => toggle(a.id)}
                      aria-expanded={open}
                    >
                      <span className="setup-row-main">
                        <span className="setup-row-name">{a.name}</span>
                        <span className="muted setup-row-meta">
                          {typeLabel(a.type)}
                          {a.institution ? ` · ${a.institution}` : ''}
                        </span>
                      </span>
                      <span className="setup-row-num">
                        {/* Cards read as money owed, matching Home. */}
                        {money(
                          a.type === 'credit' ? Math.abs(a.balance) : a.balance,
                        )}
                      </span>
                    </button>

                    {open ? (
                      <div className="setup-inline">
                        <div className="form-grid">
                          <div className="field">
                            <label>Name</label>
                            <input
                              value={edit.name}
                              onChange={(e) =>
                                setEdit({ ...edit, name: e.target.value })
                              }
                            />
                          </div>
                          <div className="field">
                            <label>Type</label>
                            <select
                              value={edit.type}
                              onChange={(e) =>
                                setEdit({ ...edit, type: e.target.value })
                              }
                            >
                              {ACCOUNT_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label>Institution</label>
                            <input
                              value={edit.institution}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  institution: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="field">
                            <label>Balance</label>
                            <input
                              value={edit.balance}
                              onChange={(e) =>
                                setEdit({ ...edit, balance: e.target.value })
                              }
                            />
                          </div>
                          {edit.type === 'credit' ? (
                            <div className="field">
                              <label>Payment due day</label>
                              <input
                                value={edit.dueDay}
                                onChange={(e) =>
                                  setEdit({ ...edit, dueDay: e.target.value })
                                }
                                placeholder="e.g. 22"
                                inputMode="numeric"
                              />
                              <span className="setup-hint muted">
                                Day of the month the payment is due. Leave blank
                                to hide it.
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="setup-inline-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy}
                            onClick={() => void saveEdit(a.id)}
                          >
                            {busy ? 'Saving…' : 'Save changes'}
                          </button>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => setOpenId(null)}
                          >
                            Close
                          </button>
                          <button
                            type="button"
                            className="text-link is-danger"
                            disabled={busy}
                            onClick={() => void removeAccount(a)}
                          >
                            Delete account
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
            ))}
          </div>
        ))
      )}

      {msg ? <p className="muted setup-msg">{msg}</p> : null}
    </section>
  )
}
