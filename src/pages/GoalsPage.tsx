import { FormEvent, useEffect, useState } from 'react'
import type { Goal } from '../types'
import { money } from '../lib/format'

type Props = {
  profileId: number
  onRefresh: () => void
}

export function GoalsPage({ profileId, onRefresh }: Props) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [form, setForm] = useState({
    name: '',
    targetAmount: '',
    currentAmount: '0',
    targetDate: '',
  })

  const load = async () => {
    setGoals(await window.finance.goals.list(profileId))
  }

  useEffect(() => {
    void load()
  }, [profileId])

  const move = async (id: number, direction: 'up' | 'down') => {
    setGoals(await window.finance.goals.move(id, direction))
    onRefresh()
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await window.finance.goals.create({
      profileId,
      name: form.name,
      targetAmount: Number(form.targetAmount),
      currentAmount: Number(form.currentAmount || 0),
      targetDate: form.targetDate || null,
    })
    setForm({ name: '', targetAmount: '', currentAmount: '0', targetDate: '' })
    await load()
    onRefresh()
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="panel">
        <h2>New goal</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <div className="field">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Emergency fund"
              required
            />
          </div>
          <div className="field">
            <label>Target</label>
            <input
              value={form.targetAmount}
              onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Already saved</label>
            <input
              value={form.currentAmount}
              onChange={(e) => setForm({ ...form, currentAmount: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Target date</label>
            <input
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Add goal
          </button>
        </form>
      </div>

      {goals.length > 1 ? (
        <p className="muted goals-rank-hint">
          Ranked in your order — the home page shows whichever unfinished goal
          sits at #1.
        </p>
      ) : null}

      <div className="grid grid-2">
        {goals.length === 0 ? (
          <div className="panel empty">No goals yet.</div>
        ) : (
          goals.map((g, i) => {
            const pct = g.target_amount
              ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100))
              : 0
            return (
              <div className="panel" key={g.id}>
                <div className="row space-between">
                  <div className="goals-rank-head">
                    <span className="goals-rank">#{i + 1}</span>
                    <h3 style={{ margin: 0 }}>{g.name}</h3>
                  </div>
                  <div className="goals-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-tiny"
                      title="Move up"
                      aria-label={`Move ${g.name} up`}
                      disabled={i === 0}
                      onClick={() => void move(g.id, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-tiny"
                      title="Move down"
                      aria-label={`Move ${g.name} down`}
                      disabled={i === goals.length - 1}
                      onClick={() => void move(g.id, 'down')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger"
                      onClick={async () => {
                        await window.finance.goals.delete(g.id)
                        await load()
                        onRefresh()
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="stat-value" style={{ margin: '12px 0 4px' }}>
                  {money(g.current_amount)}
                </div>
                <div className="muted" style={{ marginBottom: 12 }}>
                  of {money(g.target_amount)}
                  {g.target_date ? ` · by ${g.target_date}` : ''}
                </div>
                <div className="progress">
                  <span style={{ width: `${pct}%`, background: g.color }} />
                </div>
                <div className="row" style={{ marginTop: 14 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Update saved amount</label>
                    <input
                      defaultValue={g.current_amount}
                      onBlur={async (e) => {
                        const val = Number(e.target.value)
                        if (Number.isNaN(val)) return
                        await window.finance.goals.update(g.id, {
                          name: g.name,
                          targetAmount: g.target_amount,
                          currentAmount: val,
                          targetDate: g.target_date,
                          color: g.color,
                        })
                        await load()
                        onRefresh()
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
