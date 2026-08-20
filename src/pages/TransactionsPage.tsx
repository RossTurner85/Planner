import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { TxJump } from '../App'
import type { Account, Category, Person, Transaction } from '../types'
import {
  money,
  monthLabel,
  shiftMonth,
  todayISO,
} from '../lib/format'
import { PersonPicker } from '../components/transactions/PersonPicker'

type Props = {
  profileId: number
  month: string
  onMonthChange: (month: string) => void
  onRefresh: () => void
  /** Set when the coach sends you here with a search or range already chosen. */
  jump?: TxJump | null
}

type SortField = 'date' | 'amount' | 'merchant' | 'category'
type SortDir = 'first' | 'second'

/** Sentinel in the category dropdown for "make a new one". */
const NEW_CATEGORY = '__new_category'

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'amount', label: 'Amount' },
  { field: 'merchant', label: 'Merchant' },
  { field: 'category', label: 'Category' },
]

/** Default / alternate labels for each field's first and second click. */
const SORT_DIR_LABEL: Record<SortField, { first: string; second: string }> = {
  date: { first: 'newest → oldest', second: 'oldest → newest' },
  amount: { first: 'lowest → highest', second: 'highest → lowest' },
  merchant: { first: 'A → Z', second: 'Z → A' },
  category: { first: 'A → Z', second: 'Z → A' },
}

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
  }
}

function txDateLabel(iso: string) {
  if (!iso || iso.length < 10) return iso
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
}

function merchantKeyOf(t: Transaction) {
  return t.merchant_key || t.payee_display || t.payee
}

function purchaseOrdinal(n: number) {
  const j = n % 10
  const k = n % 100
  let suffix = 'th'
  if (j === 1 && k !== 11) suffix = 'st'
  else if (j === 2 && k !== 12) suffix = 'nd'
  else if (j === 3 && k !== 13) suffix = 'rd'
  return `${n}${suffix} purchase`
}

type MerchantGroup = {
  key: string
  display: string
  /** Oldest → newest (1st purchase first) */
  purchases: Transaction[]
  latest: Transaction
  total: number
  sharedCategoryId: number | null | 'mixed'
  sharedPersonId: number | null | 'mixed'
}

function groupByMerchant(txs: Transaction[]): MerchantGroup[] {
  const map = new Map<string, Transaction[]>()
  for (const t of txs) {
    const key = merchantKeyOf(t)
    const list = map.get(key) ?? []
    list.push(t)
    map.set(key, list)
  }

  const groups: MerchantGroup[] = []
  for (const [key, list] of map) {
    const purchases = [...list].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.id - b.id
    })
    const latest = purchases[purchases.length - 1]
    let total = 0
    const catIds = new Set<number | null>()
    const personIds = new Set<number | null>()
    for (const t of purchases) {
      total += t.amount
      catIds.add(t.category_id)
      personIds.add(t.person_id ?? null)
    }
    let sharedCategoryId: number | null | 'mixed' = null
    if (catIds.size === 1) sharedCategoryId = [...catIds][0]
    else if (catIds.size > 1) sharedCategoryId = 'mixed'

    let sharedPersonId: number | null | 'mixed' = null
    if (personIds.size === 1) sharedPersonId = [...personIds][0]
    else if (personIds.size > 1) sharedPersonId = 'mixed'

    groups.push({
      key,
      display: latest.payee_display || latest.payee,
      purchases,
      latest,
      total,
      sharedCategoryId,
      sharedPersonId,
    })
  }
  return groups
}

function sortGroups(
  groups: MerchantGroup[],
  field: SortField,
  dir: SortDir,
  catName: (id: number | null | 'mixed') => string,
): MerchantGroup[] {
  const sorted = [...groups]
  /** first click = “natural” primary; second inverts. */
  const flip = dir === 'second' ? -1 : 1

  sorted.sort((a, b) => {
    let cmp = 0
    switch (field) {
      case 'date':
        // first: newest first (desc)
        cmp =
          b.latest.date.localeCompare(a.latest.date) ||
          b.latest.id - a.latest.id
        break
      case 'amount':
        // first: lowest → highest (asc on signed total)
        cmp =
          a.total - b.total || b.latest.date.localeCompare(a.latest.date)
        break
      case 'merchant':
        // first: A → Z
        cmp =
          a.display.localeCompare(b.display, undefined, {
            sensitivity: 'base',
          }) || b.latest.date.localeCompare(a.latest.date)
        break
      case 'category':
        // first: A → Z
        cmp =
          catName(a.sharedCategoryId).localeCompare(
            catName(b.sharedCategoryId),
            undefined,
            { sensitivity: 'base' },
          ) || b.latest.date.localeCompare(a.latest.date)
        break
      default:
        cmp = 0
    }
    return cmp * flip
  })
  return sorted
}

export function TransactionsPage({
  profileId,
  month,
  onMonthChange,
  onRefresh,
  jump,
}: Props) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [search, setSearch] = useState('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('first')
  const [showSort, setShowSort] = useState(false)
  const [showRange, setShowRange] = useState(false)
  const [rangeMode, setRangeMode] = useState(false)
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  /** Older months opened under the primary month (not including `month`). */
  const [olderMonths, setOlderMonths] = useState<string[]>([])
  const [monthTxs, setMonthTxs] = useState<Record<string, Transaction[]>>({})
  const [rangeTxs, setRangeTxs] = useState<Transaction[]>([])
  /** Expanded merchant group key */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingCatKey, setEditingCatKey] = useState<string | null>(null)
  /** Merchant group currently typing a brand-new category name. */
  const [newCatKey, setNewCatKey] = useState<string | null>(null)
  const [newCatName, setNewCatName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    accountId: 0,
    date: todayISO(),
    amount: '',
    payee: '',
    memo: '',
    categoryId: '' as number | '',
  })

  const sortMenuRef = useRef<HTMLDivElement>(null)
  const rangeMenuRef = useRef<HTMLDivElement>(null)

  // Arriving from the coach: adopt the filter it picked out.
  useEffect(() => {
    if (!jump) return
    setSearch(jump.search)
    if (jump.from && jump.to) {
      setRangeMode(true)
      setRangeFrom(jump.from)
      setRangeTo(jump.to)
      setDraftFrom(jump.from)
      setDraftTo(jump.to)
    }
  }, [jump])

  const catNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

  const categoryLabel = (id: number | null | 'mixed') => {
    if (id === 'mixed') return 'Mixed'
    if (id == null) return 'Uncategorized'
    return catNameById.get(id) ?? 'Uncategorized'
  }

  const loadMeta = async () => {
    const [a, c, p] = await Promise.all([
      window.finance.accounts.list(profileId),
      window.finance.categories.list(profileId),
      window.finance.people.list(profileId),
    ])
    setAccounts(a)
    setCategories(c)
    setPeople(p)
    if (!form.accountId && a[0]) {
      setForm((f) => ({ ...f, accountId: a[0].id }))
    }
  }

  const loadMonth = async (ym: string) => {
    const bounds = monthBounds(ym)
    const t = await window.finance.transactions.list(profileId, {
      from: bounds.from,
      to: bounds.to,
      search: search || undefined,
      accountId: accountId || undefined,
      limit: 2000,
    })
    setMonthTxs((prev) => ({ ...prev, [ym]: t }))
  }

  const loadRange = async (from: string, to: string) => {
    const t = await window.finance.transactions.list(profileId, {
      from,
      to,
      search: search || undefined,
      accountId: accountId || undefined,
      limit: 5000,
    })
    setRangeTxs(t)
  }

  // Reset older months when global month or profile changes
  useEffect(() => {
    setOlderMonths([])
    setSelectedKey(null)
    setEditingCatKey(null)
    setNewCatKey(null)
  }, [profileId, month])

  useEffect(() => {
    void loadMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  // Suggest categories for still-uncategorized txs from merchant names
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result =
        await window.finance.transactions.recategorizeUncategorized(profileId)
      if (cancelled || !result?.updated) return
      if (rangeMode && rangeFrom && rangeTo) await loadRange(rangeFrom, rangeTo)
      else {
        await loadMonth(month)
        for (const ym of olderMonths) await loadMonth(ym)
      }
      onRefresh()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  useEffect(() => {
    if (rangeMode && rangeFrom && rangeTo) {
      void loadRange(rangeFrom, rangeTo)
      return
    }
    void loadMonth(month)
    for (const ym of olderMonths) {
      void loadMonth(ym)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, month, search, accountId, rangeMode, rangeFrom, rangeTo, olderMonths])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (showSort && sortMenuRef.current && !sortMenuRef.current.contains(t)) {
        setShowSort(false)
      }
      if (showRange && rangeMenuRef.current && !rangeMenuRef.current.contains(t)) {
        setShowRange(false)
      }
      if (
        (editingCatKey != null || newCatKey != null) &&
        t instanceof Element &&
        !t.closest('.tx-cat-editing')
      ) {
        setEditingCatKey(null)
        setNewCatKey(null)
        setNewCatName('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [showSort, showRange, editingCatKey, newCatKey])

  /**
   * Transfer categories are offered separately: money moving between your own
   * accounts is real, but it's deliberately left out of every total.
   */
  const countedCats = useMemo(
    () => categories.filter((c) => c.kind !== 'transfer'),
    [categories],
  )

  const transferCats = useMemo(
    () => categories.filter((c) => c.kind === 'transfer'),
    [categories],
  )

  const transferCatIds = useMemo(
    () => new Set(transferCats.map((c) => c.id)),
    [transferCats],
  )

  const applyRange = () => {
    if (!draftFrom || !draftTo) return
    if (draftFrom > draftTo) return
    setRangeFrom(draftFrom)
    setRangeTo(draftTo)
    setRangeMode(true)
    setShowRange(false)
    setOlderMonths([])
    setSelectedKey(null)
  }

  const clearRange = () => {
    setRangeMode(false)
    setRangeFrom('')
    setRangeTo('')
    setDraftFrom('')
    setDraftTo('')
    setShowRange(false)
    setSelectedKey(null)
  }

  const nextOlderToOffer = useMemo(() => {
    const oldest =
      olderMonths.length > 0
        ? olderMonths[olderMonths.length - 1]
        : month
    return shiftMonth(oldest, -1)
  }, [month, olderMonths])

  const openOlderMonth = () => {
    setOlderMonths((prev) =>
      prev.includes(nextOlderToOffer) ? prev : [...prev, nextOlderToOffer],
    )
  }

  const collapseOlderMonth = (ym: string) => {
    setOlderMonths((prev) => prev.filter((m) => m !== ym))
  }

  const reloadVisible = async () => {
    if (rangeMode && rangeFrom && rangeTo) await loadRange(rangeFrom, rangeTo)
    else {
      await loadMonth(month)
      for (const ym of olderMonths) await loadMonth(ym)
    }
  }

  const setCategory = async (group: MerchantGroup, categoryId: number | null) => {
    const ids = group.purchases.map((t) => t.id)
    const ruleMatch =
      categoryId != null
        ? group.display.trim().length >= 2
          ? group.display.trim()
          : group.key
        : null

    await window.finance.transactions.categorizeMany({
      ids,
      categoryId,
      profileId,
      saveRuleMatch: ruleMatch,
    })
    setEditingCatKey(null)
    // Reload list in place only — onRefresh() remounts content (tick key) and jumps scroll.
    await reloadVisible()
  }

  /** Create a category on the fly, then file this merchant under it. */
  const createCategoryFor = async (group: MerchantGroup) => {
    const name = newCatName.trim()
    if (!name) return
    const existingId = categories.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    )?.id
    const id =
      existingId ??
      (
        await window.finance.categories.create({
          profileId,
          name,
          groupName: 'Custom',
          kind: 'expense',
          emoji: '🏷️',
        })
      ).id
    setCategories(await window.finance.categories.list(profileId))
    setNewCatKey(null)
    setNewCatName('')
    await setCategory(group, id)
  }

  const setPerson = async (ids: number[], personId: number | null) => {
    await window.finance.transactions.assignPerson({ ids, personId })
    await reloadVisible()
  }

  const addPerson = async (name: string) => {
    const person = await window.finance.people.create(profileId, name)
    setPeople(await window.finance.people.list(profileId))
    return person
  }

  const removeTx = async (txId: number) => {
    await window.finance.transactions.delete(txId)
    await reloadVisible()
    onRefresh()
  }

  const toggleGroup = (key: string) => {
    setSelectedKey((cur) => (cur === key ? null : key))
    setEditingCatKey(null)
  }

  const pickSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'first' ? 'second' : 'first'))
    } else {
      setSortField(field)
      setSortDir('first')
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.accountId || !form.payee || Number.isNaN(amount)) return
    await window.finance.transactions.create({
      profileId,
      accountId: form.accountId,
      date: form.date,
      amount,
      payee: form.payee,
      memo: form.memo || undefined,
      categoryId: form.categoryId || null,
    })
    setForm((f) => ({ ...f, amount: '', payee: '', memo: '' }))
    setShowForm(false)
    if (rangeMode && rangeFrom && rangeTo) await loadRange(rangeFrom, rangeTo)
    else await loadMonth(month)
    onRefresh()
  }

  const renderTxList = (txs: Transaction[]) => {
    const groups = sortGroups(
      groupByMerchant(txs),
      sortField,
      sortDir,
      categoryLabel,
    )
    if (groups.length === 0) {
      return (
        <div className="empty tx-empty">
          Nothing here yet. Import a statement or add one.
        </div>
      )
    }
    return (
      <ul className="tx-card-list">
        {groups.map((g) => {
          const open = selectedKey === g.key
          const editing = editingCatKey === g.key
          const naming = newCatKey === g.key
          const cat = categoryLabel(g.sharedCategoryId)
          const unc = cat === 'Uncategorized' || cat === 'Mixed'
          const ordinalLabel = purchaseOrdinal(g.purchases.length)
          // Card payments read as huge income if shown in green, so they get a
          // neutral amount instead.
          const excluded =
            typeof g.sharedCategoryId === 'number' &&
            transferCatIds.has(g.sharedCategoryId)

          return (
            <li key={g.key} className={`tx-card ${open ? 'is-open' : ''}`}>
              <div className="tx-card-main">
                <div className="tx-card-top">
                  <button
                    type="button"
                    className="tx-card-merchant"
                    onClick={() => toggleGroup(g.key)}
                  >
                    {g.display}
                  </button>

                  <div
                    className={`tx-card-cat-slot ${
                      editing || naming ? 'tx-cat-editing' : ''
                    }`}
                  >
                    {naming ? (
                      <div
                        className="tx-cat-new"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          autoFocus
                          value={newCatName}
                          placeholder="Category name"
                          onChange={(e) => setNewCatName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void createCategoryFor(g)
                            if (e.key === 'Escape') {
                              setNewCatKey(null)
                              setNewCatName('')
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-tiny"
                          disabled={!newCatName.trim()}
                          onClick={() => void createCategoryFor(g)}
                        >
                          Add
                        </button>
                      </div>
                    ) : editing ? (
                      <select
                        className="tx-cat-select"
                        autoFocus
                        value={
                          g.sharedCategoryId === 'mixed' ||
                          g.sharedCategoryId == null
                            ? ''
                            : String(g.sharedCategoryId)
                        }
                        onChange={(e) => {
                          if (e.target.value === NEW_CATEGORY) {
                            setNewCatName('')
                            setNewCatKey(g.key)
                            setEditingCatKey(null)
                            return
                          }
                          void setCategory(
                            g,
                            e.target.value ? Number(e.target.value) : null,
                          )
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">
                          {g.sharedCategoryId === 'mixed'
                            ? 'Mixed…'
                            : 'Uncategorized'}
                        </option>
                        {countedCats.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                        {transferCats.length > 0 ? (
                          <optgroup label="Not counted in totals">
                            {transferCats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        <option value={NEW_CATEGORY}>+ New category…</option>
                      </select>
                    ) : (
                      <button
                        type="button"
                        className={`tx-card-category ${unc ? 'is-uncat' : ''}`}
                        title="Change category for this merchant"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingCatKey(g.key)
                          setSelectedKey(null)
                        }}
                      >
                        {cat}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`tx-card-amount ${
                      excluded
                        ? 'amount-excluded'
                        : g.total < 0
                          ? 'amount-neg'
                          : 'amount-pos'
                    }`}
                    title={
                      excluded
                        ? 'Not counted in spending or income totals'
                        : undefined
                    }
                    onClick={() => toggleGroup(g.key)}
                  >
                    {money(g.total)}
                  </button>
                </div>

                <div className="tx-card-date-row">
                  <button
                    type="button"
                    className="tx-card-date-hit"
                    onClick={() => toggleGroup(g.key)}
                  >
                    <span className="tx-card-date">
                      {txDateLabel(g.latest.date)}
                    </span>
                    <span className="tx-card-purchases">{ordinalLabel}</span>
                  </button>
                  <PersonPicker
                    people={people}
                    value={g.sharedPersonId}
                    onPick={(personId) =>
                      setPerson(
                        g.purchases.map((t) => t.id),
                        personId,
                      )
                    }
                    onCreate={addPerson}
                  />
                </div>
              </div>

              {open ? (
                <div className="tx-card-detail">
                  <ul className="tx-purchase-list">
                    {g.purchases.map((t, i) => {
                      const merchant = t.payee_display || t.payee
                      return (
                        <li key={t.id} className="tx-purchase-item">
                          <div className="tx-purchase-head">
                            <span className="tx-purchase-ordinal">
                              {purchaseOrdinal(i + 1)}
                            </span>
                            <span className="tx-purchase-date">
                              {txDateLabel(t.date)}
                            </span>
                            <span
                              className={`tx-purchase-amount ${
                                t.amount < 0 ? 'amount-neg' : 'amount-pos'
                              }`}
                            >
                              {money(t.amount)}
                            </span>
                          </div>
                          <div className="tx-purchase-meta">
                            <div className="tx-purchase-meta-row">
                              <span className="tx-purchase-label">Account</span>
                              <span>{t.account_name ?? '—'}</span>
                            </div>
                            <div className="tx-purchase-meta-row">
                              <span className="tx-purchase-label">For</span>
                              <PersonPicker
                                compact
                                people={people}
                                value={t.person_id ?? null}
                                onPick={(personId) =>
                                  setPerson([t.id], personId)
                                }
                                onCreate={addPerson}
                              />
                            </div>
                            {t.memo ? (
                              <div className="tx-purchase-meta-row">
                                <span className="tx-purchase-label">Memo</span>
                                <span>{t.memo}</span>
                              </div>
                            ) : null}
                            {t.payee !== merchant ? (
                              <div className="tx-purchase-meta-row">
                                <span className="tx-purchase-label">
                                  Original payee
                                </span>
                                <span>{t.payee}</span>
                              </div>
                            ) : null}
                          </div>
                          <div className="tx-purchase-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-danger"
                              onClick={() => void removeTx(t.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  const primaryTxCount = rangeMode
    ? rangeTxs.length
    : (monthTxs[month]?.length ?? 0)

  return (
    <div className="stack app-landing tx-page">
      <div className="tx-month-lead">
        <div className="page-month-bar">
          {!rangeMode ? (
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
          ) : (
            <div className="tx-range-lead muted">
              {rangeFrom} – {rangeTo}
            </div>
          )}
        </div>
        <p className="tx-count-under muted">
          {primaryTxCount} transaction{primaryTxCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="tx-toolbar app-surface">
        <div className="tx-toolbar-row">
          <div className="tx-search">
            <span className="tx-search-icon" aria-hidden>
              ⌕
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by merchant name"
              aria-label="Search by merchant name"
            />
          </div>

          <div className="tx-toolbar-actions">
            <div className="tx-menu" ref={sortMenuRef}>
              <button
                type="button"
                className={`btn btn-ghost tx-tool-btn ${showSort ? 'is-active' : ''}`}
                onClick={() => {
                  setShowSort((s) => !s)
                  setShowRange(false)
                }}
              >
                Sort
              </button>
              {showSort ? (
                <div className="tx-menu-panel" role="menu">
                  {SORT_FIELDS.map((o) => {
                    const active = sortField === o.field
                    const hint = active
                      ? SORT_DIR_LABEL[o.field][sortDir]
                      : SORT_DIR_LABEL[o.field].first
                    return (
                      <button
                        key={o.field}
                        type="button"
                        role="menuitem"
                        className={`tx-menu-item ${active ? 'is-active' : ''}`}
                        onClick={() => pickSort(o.field)}
                      >
                        <span className="tx-sort-field">{o.label}</span>
                        <span className="tx-sort-dir muted">{hint}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>

            <div className="tx-menu" ref={rangeMenuRef}>
              <button
                type="button"
                className={`btn btn-ghost tx-tool-btn ${
                  rangeMode || showRange ? 'is-active' : ''
                }`}
                onClick={() => {
                  setShowRange((s) => !s)
                  setShowSort(false)
                  if (!draftFrom && !draftTo) {
                    const b = monthBounds(month)
                    setDraftFrom(rangeFrom || b.from)
                    setDraftTo(rangeTo || b.to)
                  }
                }}
              >
                Custom date range
              </button>
              {showRange ? (
                <div className="tx-menu-panel tx-range-panel">
                  <div className="tx-range-fields">
                    <div className="field">
                      <label>From</label>
                      <input
                        type="date"
                        value={draftFrom}
                        onChange={(e) => setDraftFrom(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>To</label>
                      <input
                        type="date"
                        value={draftTo}
                        onChange={(e) => setDraftTo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="tx-range-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={applyRange}
                      disabled={!draftFrom || !draftTo || draftFrom > draftTo}
                    >
                      Apply
                    </button>
                    {rangeMode ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={clearRange}
                      >
                        Back to months
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <select
              className="tx-account-filter"
              value={accountId}
              onChange={(e) =>
                setAccountId(e.target.value ? Number(e.target.value) : '')
              }
              aria-label="Filter by account"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowForm((s) => !s)}
            >
              {showForm ? 'Close' : 'Add'}
            </button>
          </div>
        </div>

        {showForm && (
          <form className="form-grid" onSubmit={onSubmit} style={{ marginTop: 12 }}>
            <div className="field">
              <label>Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Account</label>
              <select
                value={form.accountId}
                onChange={(e) =>
                  setForm({ ...form, accountId: Number(e.target.value) })
                }
                required
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Payee</label>
              <input
                value={form.payee}
                onChange={(e) => setForm({ ...form, payee: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Amount (+ income / − spend)</label>
              <input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="-42.50"
                required
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={form.categoryId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    categoryId: e.target.value ? Number(e.target.value) : '',
                  })
                }
              >
                <option value="">Auto / Uncategorized</option>
                {countedCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji ? `${c.emoji} ` : ''}
                    {c.name}
                  </option>
                ))}
                {transferCats.length > 0 ? (
                  <optgroup label="Not counted in totals">
                    {transferCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji ? `${c.emoji} ` : ''}
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <div className="field">
              <label>Memo</label>
              <input
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </form>
        )}
      </div>

      {rangeMode ? (
        <section className="tx-month-section app-surface">
          {renderTxList(rangeTxs)}
        </section>
      ) : (
        <>
          <section className="tx-month-section app-surface">
            {renderTxList(monthTxs[month] ?? [])}
          </section>

          {olderMonths.map((ym) => (
            <section key={ym} className="tx-month-section app-surface">
              <div className="tx-month-heading-row">
                <h2 className="home-section-title tx-month-heading">
                  {monthLabel(ym)}
                  <span className="muted tx-month-count">
                    {(monthTxs[ym]?.length ?? 0)} transaction
                    {(monthTxs[ym]?.length ?? 0) === 1 ? '' : 's'}
                  </span>
                </h2>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => collapseOlderMonth(ym)}
                >
                  Hide
                </button>
              </div>
              {renderTxList(monthTxs[ym] ?? [])}
            </section>
          ))}

          <div className="tx-older-expand">
            <button
              type="button"
              className="tx-older-btn"
              onClick={openOlderMonth}
            >
              <span className="tx-older-chevron" aria-hidden>
                ▾
              </span>
              Show previous month · {monthLabel(nextOlderToOffer)}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
