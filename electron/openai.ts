/**
 * Minimal OpenAI Responses API client. Only the handful of fields this app
 * needs are typed, which keeps the dependency list short and makes it obvious
 * what leaves the machine.
 */

const BASE = 'https://api.openai.com/v1'

export type AiModelInfo = {
  id: string
  label: string
  blurb: string
}

/**
 * The three general-purpose GPT-5.6 tiers. Terra is the default: this app asks
 * short questions over small tool results, so flagship reasoning is rarely
 * worth the extra cost.
 */
export const AI_MODELS: AiModelInfo[] = [
  {
    id: 'gpt-5.6-terra',
    label: 'Balanced',
    blurb: 'Good answers at a moderate price. Best default.',
  },
  {
    id: 'gpt-5.6-luna',
    label: 'Economy',
    blurb: 'Cheapest and fastest. Fine for simple lookups.',
  },
  {
    id: 'gpt-5.6-sol',
    label: 'Best',
    blurb: 'Strongest reasoning for tricky questions. Costs the most.',
  },
]

export const DEFAULT_MODEL = 'gpt-5.6-terra'

export function isKnownModel(id: string): boolean {
  return AI_MODELS.some((m) => m.id === id)
}

export class OpenAiError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'OpenAiError'
    this.status = status
    this.code = code
  }
}

/** A function the model is allowed to call. */
export type AiTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: boolean
}

/**
 * Items flow both ways: whatever the model returns is handed straight back on
 * the next turn (reasoning items included, which GPT-5 models require), with
 * our function results appended.
 */
export type AiItem = Record<string, unknown>

export type AiFunctionCall = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type AiResponse = {
  id: string
  output: AiItem[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

async function call<T>(
  key: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new OpenAiError(
      'Could not reach OpenAI. Check your internet connection.',
      0,
      'NETWORK',
    )
  }

  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new OpenAiError(
      `OpenAI returned an unreadable response (${res.status})`,
      res.status,
      'PARSE_ERROR',
    )
  }

  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } }).error
    throw new OpenAiError(
      friendlyError(res.status, err?.message),
      res.status,
      err?.code ?? 'UNKNOWN',
    )
  }

  return json as T
}

function friendlyError(status: number, message: string | undefined): string {
  if (status === 401) return 'That OpenAI key was rejected. Check it and re-save.'
  if (status === 429) {
    return (
      message ??
      'OpenAI is rate limiting or your credit balance is spent. Check your usage limit.'
    )
  }
  if (status === 402 || (message ?? '').includes('quota')) {
    return 'Your OpenAI credit balance is used up. Add credit to keep asking.'
  }
  return message ?? `OpenAI error ${status}`
}

/** Cheap auth check: listing models needs a valid key and costs nothing. */
export async function verifyKey(key: string): Promise<void> {
  await call<unknown>(key, '/models', { method: 'GET' })
}

export function createResponse(
  key: string,
  body: {
    model: string
    instructions: string
    input: AiItem[]
    tools: AiTool[]
    max_output_tokens?: number
  },
): Promise<AiResponse> {
  return call<AiResponse>(key, '/responses', { method: 'POST', body })
}

/** Pulls the function calls the model wants run out of a response. */
export function functionCalls(res: AiResponse): AiFunctionCall[] {
  return res.output.filter(
    (item): item is AiItem & AiFunctionCall => item.type === 'function_call',
  )
}

/** Concatenates the assistant's visible text from a response. */
export function outputText(res: AiResponse): string {
  const parts: string[] = []
  for (const item of res.output) {
    if (item.type !== 'message') continue
    const content = item.content as
      | Array<{ type?: string; text?: string }>
      | undefined
    for (const chunk of content ?? []) {
      if (chunk.type === 'output_text' && chunk.text) parts.push(chunk.text)
    }
  }
  return parts.join('\n').trim()
}
