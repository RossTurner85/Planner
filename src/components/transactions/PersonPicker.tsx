import { useEffect, useRef, useState } from 'react'
import type { Person } from '../../types'

type Props = {
  people: Person[]
  /** 'mixed' when a merchant group has purchases for different people. */
  value: number | null | 'mixed'
  onPick: (personId: number | null) => void | Promise<void>
  onCreate: (name: string) => Promise<Person | null>
  /** Smaller chip for the nested purchase rows. */
  compact?: boolean
}

const NEW = '__new'

export function PersonPicker({
  people,
  value,
  onPick,
  onCreate,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const close = () => {
    setOpen(false)
    setNaming(false)
    setDraft('')
  }

  const label =
    value === 'mixed'
      ? 'Several people'
      : value == null
        ? 'Spent on'
        : (people.find((p) => p.id === value)?.name ?? 'Spent on')

  const save = async () => {
    const name = draft.trim()
    if (!name) return
    setBusy(true)
    try {
      const person = await onCreate(name)
      if (person) await onPick(person.id)
      close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`tx-person ${compact ? 'is-compact' : ''}`}
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
    >
      {!open ? (
        <button
          type="button"
          className={`tx-person-chip ${value == null ? 'is-empty' : ''}`}
          title="Who was this spent on?"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden>◍</span>
          {label}
        </button>
      ) : naming ? (
        <div className="tx-person-new">
          <input
            autoFocus
            value={draft}
            placeholder="Name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') close()
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-tiny"
            disabled={busy || !draft.trim()}
            onClick={() => void save()}
          >
            Add
          </button>
          <button type="button" className="btn btn-ghost btn-tiny" onClick={close}>
            Cancel
          </button>
        </div>
      ) : (
        <select
          className="tx-person-select"
          autoFocus
          value={value === 'mixed' || value == null ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value
            if (v === NEW) {
              setNaming(true)
              return
            }
            void onPick(v ? Number(v) : null)
            close()
          }}
        >
          <option value="">Not tracking who</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={NEW}>+ New person…</option>
        </select>
      )}
    </div>
  )
}
