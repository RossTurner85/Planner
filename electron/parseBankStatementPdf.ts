/**
 * Heuristic parser for bank checking/savings statement PDFs (text layer only).
 * Bank layouts vary a lot; preview before import is required.
 */

export type BankStatementParseResult = {
  rows: Array<{
    date: string
    amount: number
    payee: string
    memo?: string
  }>
  endingBalance: number | null
  notes: string[]
  confidence: 'high' | 'medium' | 'low'
  textPreview: string
}

const SKIP_LINE =
  /^(page\s+\d|statement\s+(period|date|summary)|beginning\s+balance|ending\s+balance|previous\s+balance|new\s+balance|average\s+daily|total\s+(deposits|withdrawals|fees|interest|credits|debits)|account\s+(number|summary|activity)|member\s+fdic|please\s+|thank\s+you|questions\?|customer\s+service|routing\s+number|transaction\s+(date|description)|posting\s+date|balance\s*$|deposits\s+and\s+additions|withdrawals\s+and\s+other\s+deductions|checks?\s+paid|daily\s+balance|annual\s+percentage|interest\s+paid|service\s+charge|overdraft|continued\s+on|of\s+\d+\s*$)/i

const AMOUNT_RE =
  /(?:\$\s*)?(-?\(?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?|\(?\d+\.\d{2}\)?)-?(?:\s*(?:CR|DR))?/gi

function parseMoneyToken(raw: string): number | null {
  let s = raw.trim()
  if (!s) return null
  const cr = /\bCR\b/i.test(s)
  const dr = /\bDR\b/i.test(s)
  const parenNeg = /^\(.*\)$/.test(s.replace(/\s*(CR|DR)\s*$/i, '').trim())
  const trailingMinus = /-$/.test(s)
  s = s
    .replace(/\s*(CR|DR)\s*$/i, '')
    .replace(/[$,\s]/g, '')
    .replace(/[()]/g, '')
    .replace(/-$/, '')
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null
  let n = Number(s)
  if (Number.isNaN(n) || n === 0) return null
  if (parenNeg || trailingMinus || dr) n = -Math.abs(n)
  else if (cr) n = Math.abs(n)
  return n
}

function pad2(n: string) {
  return n.padStart(2, '0')
}

function toIsoDate(
  mm: string,
  dd: string,
  year: number,
): string | null {
  const m = Number(mm)
  const d = Number(dd)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${year}-${pad2(mm)}-${pad2(dd)}`
}

function yearFromDoc(text: string): number {
  const periods = [
    ...text.matchAll(
      /(?:statement\s+period|period\s+ending|through|ending|from)\s*[^\n]{0,40}?(?:1[0-2]|0?[1-9])[\/\-](?:[12][0-9]|0?[1-9]|3[01])[\/\-](\d{4})/gi,
    ),
  ]
  if (periods.length) {
    const ys = periods.map((m) => Number(m[1])).filter((y) => y > 2000 && y < 2100)
    if (ys.length) return Math.max(...ys)
  }
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]))
  if (years.length) {
    // Prefer the most common recent year rather than e.g. account year printed once
    const counts = new Map<number, number>()
    for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
  }
  return new Date().getFullYear()
}

function extractEndingBalance(text: string): number | null {
  const patterns = [
    /ending\s+balance[:\s]+\$?\s*([\d,]+\.\d{2})/i,
    /new\s+balance[:\s]+\$?\s*([\d,]+\.\d{2})/i,
    /closing\s+balance[:\s]+\$?\s*([\d,]+\.\d{2})/i,
    /current\s+balance[:\s]+\$?\s*([\d,]+\.\d{2})/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const n = parseMoneyToken(m[1])
      if (n != null) return Math.abs(n)
    }
  }
  return null
}

function looksLikeIncomePayee(payee: string): boolean {
  return /deposit|payroll|direct\s*dep|interest|refund|credit|ach\s*credit|mobile\s*deposit|venmo\s*cashout|zelle\s*from|transfer\s*from/i.test(
    payee,
  )
}

function looksLikeExpensePayee(payee: string): boolean {
  return /withdrawal|debit|purchase|pos\s|check\s|#\d+|fee|service\s*charge|payment\s+to|bill\s*pay|ach\s*debit|atm|transfer\s*to/i.test(
    payee,
  )
}

function assignSign(amount: number, payee: string): number {
  // Already signed from token
  if (amount < 0) return amount
  if (looksLikeExpensePayee(payee) && !looksLikeIncomePayee(payee)) {
    return -Math.abs(amount)
  }
  if (looksLikeIncomePayee(payee)) {
    return Math.abs(amount)
  }
  // Default: bank statements often list withdrawals as positive magnitudes in one column.
  // Prefer expense when ambiguous (user can catch wrong signs in preview).
  // If payee clearly empty/noise, keep as-is.
  return -Math.abs(amount)
}

function cleanPayee(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—·•]+|[\s\-–—·•]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function parseLine(
  line: string,
  defaultYear: number,
): { date: string; amount: number; payee: string } | null {
  const trimmed = line.replace(/\s+/g, ' ').trim()
  if (trimmed.length < 8) return null
  if (SKIP_LINE.test(trimmed)) return null

  // Leading date: MM/DD, MM/DD/YY, MM/DD/YYYY (also - separators)
  const dateMatch = trimmed.match(
    /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?:\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?)?\s+(.+)$/,
  )
  if (!dateMatch) return null

  const mm = dateMatch[1]
  const dd = dateMatch[2]
  let yRaw = dateMatch[3]
  // Some lines have post date + trans date: use first date
  const rest = dateMatch[7]
  let year = defaultYear
  if (yRaw) {
    year = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw)
  }
  const date = toIsoDate(mm, dd, year)
  if (!date) return null

  // Collect money tokens from the remainder
  const amounts: { token: string; index: number; value: number }[] = []
  const amountRe = new RegExp(AMOUNT_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = amountRe.exec(rest)) !== null) {
    const value = parseMoneyToken(m[0])
    if (value == null) continue
    // Skip tiny year-like false positives already filtered by \.\d{2}
    amounts.push({ token: m[0], index: m.index, value })
  }
  if (!amounts.length) return null

  // If two+ trailing amounts, last is often running balance; use first of last two as txn
  let txn: (typeof amounts)[0]
  let descEnd: number
  if (amounts.length >= 2) {
    const a = amounts[amounts.length - 2]
    const b = amounts[amounts.length - 1]
    // Both near end: amount + balance pattern
    const nearEnd = b.index >= rest.length - 24
    if (nearEnd && Math.abs(a.index - b.index) < 40) {
      txn = a
      descEnd = a.index
    } else {
      txn = amounts[amounts.length - 1]
      descEnd = txn.index
    }
  } else {
    txn = amounts[0]
    descEnd = txn.index
  }

  let payee = cleanPayee(rest.slice(0, descEnd))
  // Drop leftover amount fragments at end of payee
  payee = payee
    .replace(/(?:\$?\s*-?\d{1,3}(?:,\d{3})*\.\d{2}\s*)+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (payee.length < 2) return null
  if (/^[\d\s.,$/()-]+$/.test(payee)) return null

  // Skip pure balance lines that snuck through
  if (/^(beginning|ending|previous|new|closing)\b/i.test(payee)) return null

  let amount = txn.value
  // Token without sign → classify from description
  if (amount > 0 && !/[()]|-|CR|DR/i.test(txn.token)) {
    amount = assignSign(amount, payee)
  } else if (amount > 0 && looksLikeExpensePayee(payee) && !looksLikeIncomePayee(payee)) {
    // Positive number with no sign but debit wording
    amount = -Math.abs(amount)
  }

  return { date, amount, payee: payee.slice(0, 160) }
}

function dedupe(
  rows: Array<{ date: string; amount: number; payee: string; memo?: string }>,
) {
  const seen = new Set<string>()
  const out: typeof rows = []
  for (const r of rows) {
    const key = `${r.date}|${r.amount.toFixed(2)}|${r.payee.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export function parseBankStatementText(text: string): BankStatementParseResult {
  const notes: string[] = []
  const cleaned = (text || '').replace(/\r/g, '\n')
  if (!cleaned.trim()) {
    return {
      rows: [],
      endingBalance: null,
      notes: [
        'No text found in this PDF. Scanned image statements need OCR or a bank CSV export.',
      ],
      confidence: 'low',
      textPreview: '',
    }
  }

  const defaultYear = yearFromDoc(cleaned)
  const endingBalance = extractEndingBalance(cleaned)

  // Join soft-wrapped description lines: if a line has no leading date but previous did,
  // append to previous for re-parse... simpler approach: try single lines first, then
  // merge undated continuation lines into previous candidate buffer.
  const rawLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const merged: string[] = []
  for (const line of rawLines) {
    const startsDate = /^\d{1,2}[\/\-]\d{1,2}/.test(line)
    if (!startsDate && merged.length > 0 && !SKIP_LINE.test(line) && line.length < 120) {
      // Continuation of description (common when PDF wraps)
      const prev = merged[merged.length - 1]
      // Don't merge if current looks like footer noise
      if (!/^(www\.|http|call\s+\d)/i.test(line)) {
        merged[merged.length - 1] = `${prev} ${line}`
        continue
      }
    }
    merged.push(line)
  }

  const rows: Array<{
    date: string
    amount: number
    payee: string
    memo?: string
  }> = []

  for (const line of merged) {
    const parsed = parseLine(line, defaultYear)
    if (parsed) rows.push(parsed)
  }

  const unique = dedupe(rows).sort((a, b) => a.date.localeCompare(b.date))

  if (!unique.length) {
    notes.push(
      'Could not detect transaction lines. Best results: bank web download as “CSV” or a text-based PDF (not a photo scan). Try another export format from your bank.',
    )
  } else if (unique.length < 3) {
    notes.push(
      `Only found ${unique.length} transaction(s). Review carefully — this bank’s PDF layout may need a CSV for better accuracy.`,
    )
  } else {
    notes.push(
      `Parsed ${unique.length} transaction(s) from the PDF. Check payees and signs (in vs out) before importing.`,
    )
  }

  if (endingBalance != null) {
    notes.push(
      `Detected ending balance ${endingBalance.toFixed(2)} — optional field is prefilled.`,
    )
  }

  let confidence: 'high' | 'medium' | 'low' = 'low'
  if (unique.length >= 8) confidence = 'high'
  else if (unique.length >= 3) confidence = 'medium'

  return {
    rows: unique,
    endingBalance,
    notes,
    confidence,
    textPreview: cleaned.replace(/\s+/g, ' ').trim().slice(0, 400),
  }
}
