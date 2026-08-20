import { FormEvent, useEffect, useRef, useState } from 'react'
import type { CoachAsk } from '../../App'
import type {
  AiAskResult,
  AiCard,
  AiStatus,
  AiTurn,
  NavOptions,
  PageId,
} from '../../types'
import { monthLabel } from '../../lib/format'
import { SectionHead } from './shared'
import { AiCardView } from './AiCards'

type Props = {
  profileId: number
  month: string
  onNavigate?: (page: PageId, opts?: NavOptions) => void
  /** A question sent from elsewhere (the home page bar), asked on arrival. */
  autoAsk?: CoachAsk | null
}

const PROMPTS = [
  'Where is my money going this month?',
  'What did I spend at Costco this year?',
  'Did any of my regular bills go up?',
  'Compare this month to last month',
  'What still needs a category?',
]

type Msg = {
  id: number
  role: 'user' | 'assistant'
  text: string
  cards?: AiCard[]
  audit?: AiAskResult['audit']
  tokens?: { in: number; out: number }
  model?: string
  failed?: boolean
}

/** How much of the conversation is replayed for follow-up questions. */
const HISTORY_TURNS = 8

export function CoachTab({ profileId, month, onNavigate, autoAsk }: Props) {
  const [insights, setInsights] = useState<string[]>([])
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [thread, setThread] = useState<Msg[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const nextId = useRef(1)
  const tail = useRef<HTMLDivElement | null>(null)
  const handledAsk = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [notes, ai] = await Promise.all([
        window.finance.coach.insights(profileId, month),
        window.finance.ai.status(),
      ])
      if (cancelled) return
      setInsights(notes.insights)
      setStatus(ai)
    })()
    return () => {
      cancelled = true
    }
  }, [profileId, month])

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread, busy])

  const submit = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return

    const history: AiTurn[] = thread
      .filter((m) => !m.failed)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, text: m.text }))

    setThread((t) => [
      ...t,
      { id: nextId.current++, role: 'user', text },
    ])
    setQuestion('')
    setBusy(true)

    try {
      const res = await window.finance.ai.ask({
        profileId,
        month,
        question: text,
        history,
      })
      setThread((t) => [
        ...t,
        res.ok
          ? {
              id: nextId.current++,
              role: 'assistant',
              text: res.data.answer,
              cards: res.data.cards,
              audit: res.data.audit,
              tokens: { in: res.data.tokensIn, out: res.data.tokensOut },
              model: res.data.model,
            }
          : {
              id: nextId.current++,
              role: 'assistant',
              text: res.error,
              failed: true,
            },
      ])
    } finally {
      setBusy(false)
    }
  }

  const ask = (e: FormEvent) => {
    e.preventDefault()
    void submit(question)
  }

  // A question sent from the home page runs itself once the key is known to be
  // in place; without one, it waits in the box behind the setup panel.
  useEffect(() => {
    if (!autoAsk || !status) return
    if (handledAsk.current === autoAsk.nonce) return
    handledAsk.current = autoAsk.nonce
    if (status.configured) void submit(autoAsk.question)
    else setQuestion(autoAsk.question)
  }, [autoAsk, status])

  return (
    <>
      <section className="insight-section">
        <SectionHead title={`Notes on ${monthLabel(month)}`} />
        {insights.length === 0 ? (
          <div className="empty">Import a month and the coach will weigh in.</div>
        ) : (
          <ul className="insight-note-list">
            {insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="muted insight-note-line">
          These are figured from your own numbers on this machine — nothing
          leaves it.
        </p>
      </section>

      <section className="insight-section">
        <SectionHead
          title="Ask about your money"
          aside={
            status?.configured ? (
              <button
                type="button"
                className="btn btn-ghost btn-tiny"
                onClick={() => setShowSetup((s) => !s)}
              >
                {showSetup ? 'Done' : 'AI settings'}
              </button>
            ) : null
          }
        />

        {status && !status.configured ? (
          <AiSetup status={status} onSaved={setStatus} />
        ) : null}

        {status?.configured && showSetup ? (
          <AiSettings
            status={status}
            onChanged={(next) => {
              setStatus(next)
              if (!next.configured) setShowSetup(false)
            }}
          />
        ) : null}

        {status?.configured ? (
          <>
            {thread.length > 0 ? (
              <div className="ai-thread">
                {thread.map((m) => (
                  <AiMessage key={m.id} msg={m} onNavigate={onNavigate} />
                ))}
                {busy ? (
                  <div className="ai-msg ai-msg-assistant">
                    <div className="ai-thinking">
                      <span className="ai-dot" />
                      <span className="ai-dot" />
                      <span className="ai-dot" />
                      <span className="muted">Reading your transactions…</span>
                    </div>
                  </div>
                ) : null}
                <div ref={tail} />
              </div>
            ) : null}

            <form className="insight-ask" onSubmit={ask}>
              <textarea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="How much did I spend on groceries in the last six months?"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void submit(question)
                  }
                }}
              />
              <div className="insight-ask-row">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !question.trim()}
                >
                  {busy ? 'Thinking…' : 'Ask coach'}
                </button>
                <div className="insight-chips">
                  {PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="insight-chip"
                      onClick={() => setQuestion(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </>
        ) : null}
      </section>
    </>
  )
}

function AiMessage({
  msg,
  onNavigate,
}: {
  msg: Msg
  onNavigate?: (page: PageId, opts?: NavOptions) => void
}) {
  if (msg.role === 'user') {
    return (
      <div className="ai-msg ai-msg-user">
        <p>{msg.text}</p>
      </div>
    )
  }

  return (
    <div className="ai-msg ai-msg-assistant">
      {msg.failed ? (
        <p className="ai-error">{msg.text}</p>
      ) : (
        msg.text.split('\n').map((line, i) =>
          line.trim() ? <p key={i}>{line}</p> : null,
        )
      )}

      {msg.cards?.map((card, i) => (
        <AiCardView key={i} card={card} onNavigate={onNavigate} />
      ))}

      {msg.audit ? <SentDetails msg={msg} /> : null}
    </div>
  )
}

/**
 * The honesty panel: every byte that went to OpenAI for this answer, shown
 * verbatim, so using the cloud never has to be taken on faith.
 */
function SentDetails({ msg }: { msg: Msg }) {
  const audit = msg.audit
  if (!audit) return null
  const total =
    (msg.tokens?.in ?? 0) + (msg.tokens?.out ?? 0)

  return (
    <details className="ai-sent">
      <summary>
        What was sent to OpenAI
        <span className="muted">
          {audit.calls.length} lookup{audit.calls.length === 1 ? '' : 's'}
          {total ? ` · ${total.toLocaleString()} tokens` : ''}
          {msg.model ? ` · ${msg.model}` : ''}
        </span>
      </summary>

      <div className="ai-sent-body">
        <h4>Your question</h4>
        <pre>{audit.question}</pre>

        <h4>Standing instructions</h4>
        <pre>{audit.instructions}</pre>

        {audit.calls.length === 0 ? (
          <p className="muted">No data was looked up for this answer.</p>
        ) : (
          audit.calls.map((call, i) => (
            <div key={i}>
              <h4>
                {call.tool}
                <span className="muted"> · {call.bytes.toLocaleString()} bytes</span>
              </h4>
              <pre>{JSON.stringify(call.args, null, 2)}</pre>
              <pre>{call.sent}</pre>
            </div>
          ))
        )}
      </div>
    </details>
  )
}

function AiSetup({
  status,
  onSaved,
}: {
  status: AiStatus
  onSaved: (next: AiStatus) => void
}) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState(status.model)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    setBusy(true)
    setError(null)
    const res = await window.finance.ai.saveKey({ key, model })
    setBusy(false)
    if (res.ok) {
      setKey('')
      onSaved({ ...res.data, models: status.models })
    } else {
      setError(res.error)
    }
  }

  return (
    <form className="ai-setup" onSubmit={save}>
      <p>
        The coach can answer questions about your actual transactions — search
        them, add them up, and chart them — using OpenAI. Paste an API key to
        turn it on.
      </p>
      <ul className="ai-setup-facts">
        <li>
          Your key is encrypted on this machine with Windows' own encryption and
          never leaves it.
        </li>
        <li>
          Only your question and the specific figures needed to answer it are
          sent. Every answer shows exactly what went out.
        </li>
        <li>Nothing is sent until you ask something.</li>
      </ul>

      {!status.encryptionAvailable ? (
        <p className="ai-error">
          This machine can't encrypt saved keys right now, so the key would sit
          on disk as plain text. Worth sorting out before saving one.
        </p>
      ) : null}

      <label className="field">
        <span>OpenAI API key</span>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <ModelPicker status={status} model={model} onChange={setModel} />

      {error ? <p className="ai-error">{error}</p> : null}

      <div className="ai-setup-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Save key'}
        </button>
        <span className="muted">
          Get one at platform.openai.com/api-keys
        </span>
      </div>
    </form>
  )
}

function AiSettings({
  status,
  onChanged,
}: {
  status: AiStatus
  onChanged: (next: AiStatus) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setModel = async (model: string) => {
    setBusy(true)
    setError(null)
    const res = await window.finance.ai.setModel(model)
    setBusy(false)
    if (res.ok) onChanged({ ...res.data, models: status.models })
    else setError(res.error)
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    const res = await window.finance.ai.clearKey()
    setBusy(false)
    if (res.ok) onChanged({ ...res.data, models: status.models })
    else setError(res.error)
  }

  return (
    <div className="ai-setup">
      <ModelPicker
        status={status}
        model={status.model}
        onChange={(m) => void setModel(m)}
        disabled={busy}
      />
      {error ? <p className="ai-error">{error}</p> : null}
      <div className="ai-setup-actions">
        <span className="muted">Key on file ending {status.keyHint}</span>
        <button
          type="button"
          className="btn btn-ghost btn-danger"
          onClick={() => void remove()}
          disabled={busy}
        >
          Remove key
        </button>
      </div>
    </div>
  )
}

function ModelPicker({
  status,
  model,
  onChange,
  disabled,
}: {
  status: AiStatus
  model: string
  onChange: (model: string) => void
  disabled?: boolean
}) {
  const active = status.models.find((m) => m.id === model)
  return (
    <label className="field">
      <span>Model</span>
      <select
        value={model}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {status.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.id}
          </option>
        ))}
      </select>
      {active ? <small className="muted">{active.blurb}</small> : null}
    </label>
  )
}
