import { useCallback, useEffect, useState } from 'react'
import type { AppUpdateStatus } from '../../types'

export function AppUpdateSection() {
  const [info, setInfo] = useState<AppUpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setInfo(await window.finance.app.updateStatus())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function check() {
    setBusy(true)
    setNote(null)
    try {
      const next = await window.finance.app.updateStatus()
      setInfo(next)
      setNote(next.message)
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    setBusy(true)
    setNote(null)
    try {
      const res = await window.finance.app.updateApply()
      if (!res.ok && !res.cancelled) setNote(res.error)
    } finally {
      setBusy(false)
    }
  }

  async function pickFile() {
    setBusy(true)
    setNote(null)
    try {
      const res = await window.finance.app.updatePick()
      if (!res.ok && !res.cancelled) setNote(res.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="setup-section app-update">
      <div className="setup-head">
        <h2>App updates</h2>
        <span className="muted">v{info?.current ?? '…'}</span>
      </div>
      <p className="muted setup-hint">
        Check GitHub for a new version, or install a Setup file from this PC.
        Your accounts stay on this computer either way. A color change still
        needs a new version number — it is just not a full reinstall.
      </p>
      {info?.available ? (
        <p className="app-update-ready">
          Version {info.latest} is ready
          {info.source === 'github'
            ? ' on GitHub'
            : info.installerName
              ? ` (${info.installerName})`
              : ''}
          .
        </p>
      ) : null}
      {note ? <p className="muted setup-hint">{note}</p> : null}
      <div className="app-update-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void (info?.available ? apply() : check())}
        >
          {busy
            ? 'Working…'
            : info?.available
              ? `Install ${info.latest}`
              : 'Check for updates'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void pickFile()}
        >
          Install from a file…
        </button>
      </div>
    </section>
  )
}
