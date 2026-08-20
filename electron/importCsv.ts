import Papa from 'papaparse'

export type ImportRow = {
  date: string
  amount: number
  payee: string
  memo?: string
}

export type CsvParseResult = {
  rows: ImportRow[]
  endingBalance: number | null
  startingBalance: number | null
  notes: string[]
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\s]+/g, ' ')
}

function parseDate(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (mdy) {
    const mm = mdy[1].padStart(2, '0')
    const dd = mdy[2].padStart(2, '0')
    return `${mdy[3]}-${mm}-${dd}`
  }
  const mdy2 = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (mdy2) {
    const mm = mdy2[1].padStart(2, '0')
    const dd = mdy2[2].padStart(2, '0')
    return `${mdy2[3]}-${mm}-${dd}`
  }
  const d = new Date(v)
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return null
}

function parseAmount(raw: string): number | null {
  if (raw == null || String(raw).trim() === '') return null
  let s = String(raw).trim()
  const parenNeg = /^\(.*\)$/.test(s)
  s = s.replace(/[$,\s]/g, '').replace(/[()]/g, '')
  if (!s) return null
  let n = Number(s)
  if (Number.isNaN(n)) return null
  if (parenNeg) n = -Math.abs(n)
  return n
}

function cleanPayee(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function isDirectionOnly(s: string): boolean {
  return /^(debit|credit|withdrawal|deposit)$/i.test(s.trim())
}

/**
 * Some issuers (Barclays, etc.) put a title/account/balance block above the
 * real CSV header. Detect the header row and peel off the preamble.
 */
function extractCsvBody(text: string): {
  body: string
  preambleBalance: number | null
  preambleNotes: string[]
} {
  const preambleNotes: string[] = []
  let preambleBalance: number | null = null
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  for (const line of lines) {
    const bal = line.match(
      /(?:account\s+)?balance(?:\s+as\s+of\s+[^:]*)?:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    )
    if (bal) {
      const n = parseAmount(bal[1])
      if (n != null) preambleBalance = Math.abs(n)
    }
  }

  const headerIdx = lines.findIndex((line) => {
    if (!line.includes(',')) return false
    // Cheap parse of a header candidate (handles quoted commas poorly but ok for headers)
    const cols = line
      .split(',')
      .map((c) => normalizeHeader(c.replace(/^["']|["']$/g, '')))
    if (cols.length < 3) return false
    const hasDate = cols.some((c) => c.includes('date'))
    const hasAmount = cols.some(
      (c) => c === 'amount' || c.includes('amount') || c === 'amt',
    )
    const hasDesc = cols.some((c) =>
      /desc|payee|merchant|name|details|memo/.test(c),
    )
    return hasDate && hasAmount && hasDesc
  })

  if (headerIdx <= 0) {
    return { body: text, preambleBalance, preambleNotes }
  }

  preambleNotes.push(
    `Skipped ${headerIdx} preamble line(s) before the transaction table.`,
  )
  if (preambleBalance != null) {
    preambleNotes.push(
      `Detected account balance ${preambleBalance.toFixed(2)} in file header — will set the account on import.`,
    )
  }

  return {
    body: lines.slice(headerIdx).join('\n'),
    preambleBalance,
    preambleNotes,
  }
}

type ParsedLine = {
  date: string
  amount: number
  payee: string
  memo?: string
  /** Running balance AFTER this transaction (when the bank provides it). */
  balanceAfter: number | null
  fileIndex: number
}

/**
 * Chase (and many banks) export newest-first with a running Balance after each line.
 * Infer opening/closing from those balances + any tip rows that lack balance.
 */
function inferBalances(lines: ParsedLine[]): {
  startingBalance: number | null
  endingBalance: number | null
} {
  if (!lines.length) return { startingBalance: null, endingBalance: null }

  const newestFirst =
    lines[0].date > lines[lines.length - 1].date ||
    (lines[0].date === lines[lines.length - 1].date &&
      lines.some((l) => l.balanceAfter != null))

  const chrono = [...lines].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    // Same day: in newest-first files, higher index = earlier in the day
    return newestFirst ? b.fileIndex - a.fileIndex : a.fileIndex - b.fileIndex
  })

  const net = lines.reduce((s, r) => s + r.amount, 0)

  let endingBalance: number | null = null
  for (let i = chrono.length - 1; i >= 0; i--) {
    if (chrono[i].balanceAfter != null) {
      endingBalance = chrono[i].balanceAfter as number
      for (let j = i + 1; j < chrono.length; j++) {
        endingBalance += chrono[j].amount
      }
      break
    }
  }

  let startingBalance: number | null = null
  for (let i = 0; i < chrono.length; i++) {
    if (chrono[i].balanceAfter != null) {
      startingBalance = (chrono[i].balanceAfter as number) - chrono[i].amount
      for (let j = 0; j < i; j++) {
        startingBalance -= chrono[j].amount
      }
      break
    }
  }

  // Cross-check / fill gaps
  if (endingBalance != null && startingBalance == null) {
    startingBalance = Number((endingBalance - net).toFixed(2))
  } else if (startingBalance != null && endingBalance == null) {
    endingBalance = Number((startingBalance + net).toFixed(2))
  }

  // Prefer consistent pair from ending when both present but inconsistent
  if (
    endingBalance != null &&
    startingBalance != null &&
    Math.abs(startingBalance + net - endingBalance) > 0.05
  ) {
    startingBalance = Number((endingBalance - net).toFixed(2))
  }

  if (endingBalance != null) endingBalance = Number(endingBalance.toFixed(2))
  if (startingBalance != null)
    startingBalance = Number(startingBalance.toFixed(2))

  return { startingBalance, endingBalance }
}

export function parseStatementCsv(text: string): CsvParseResult {
  const notes: string[] = []
  const { body, preambleBalance, preambleNotes } = extractCsvBody(
    text.replace(/^\uFEFF/, ''),
  )
  notes.push(...preambleNotes)

  const parsed = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  })

  if (!parsed.data?.length) {
    return {
      rows: [],
      endingBalance: preambleBalance,
      startingBalance: null,
      notes: notes.concat(['No rows found in CSV.']),
    }
  }

  const sample = parsed.meta.fields ?? Object.keys(parsed.data[0] ?? {})
  const field = (candidates: string[]) =>
    sample.find((f) => candidates.includes(normalizeHeader(f)))

  const dateField =
    field([
      'posting date',
      'posted date',
      'post date',
      'transaction date',
      'trans date',
      'date',
    ]) ?? sample.find((f) => normalizeHeader(f).includes('date'))

  // Prefer real description over Chase "Details" (DEBIT/CREDIT)
  let descField =
    field([
      'description',
      'payee',
      'name',
      'merchant',
      'transaction description',
      'memo',
    ]) ?? sample.find((f) => /desc|payee|name|merchant/i.test(normalizeHeader(f)))

  const detailsField = field(['details'])
  if (
    descField &&
    normalizeHeader(descField) === 'details' &&
    field(['description'])
  ) {
    descField = field(['description'])!
  }
  if (!descField && detailsField) {
    // Last resort — will usually be DEBIT/CREDIT only
    descField = detailsField
  }

  const amountField = field(['amount', 'transaction amount', 'amt'])
  const debitField = field(['debit', 'withdrawal', 'outflow', 'spend'])
  const creditField = field(['credit', 'deposit', 'inflow'])
  // Running balance — not memo
  const balanceField = field([
    'balance',
    'running balance',
    'running bal',
    'running bal.',
    'available balance',
  ])
  const memoField = field([
    'memo',
    'notes',
    'note',
    'check or slip #',
    'check number',
  ])
  const typeField = field(['type', 'transaction type', 'credit debit'])
  const categoryField = field(['category', 'transaction category'])
  const purchasedByField = field(['purchased by', 'cardholder', 'card member'])

  // Chase "Details" column, or Barclays "Category" when values are DEBIT/CREDIT only
  let directionField: string | null = null
  if (detailsField) {
    const sampleVal = (parsed.data[0]?.[detailsField] ?? '').trim()
    if (isDirectionOnly(sampleVal) || /debit|credit/i.test(sampleVal)) {
      directionField = detailsField
    }
  }
  if (!directionField && categoryField) {
    const samples = parsed.data
      .slice(0, 12)
      .map((r) => (r[categoryField] ?? '').trim())
      .filter(Boolean)
    if (
      samples.length > 0 &&
      samples.every((s) => isDirectionOnly(s) || /^(sale|payment|return)$/i.test(s))
    ) {
      directionField = categoryField
    }
  }

  const lines: ParsedLine[] = []

  parsed.data.forEach((row, fileIndex) => {
    if (!dateField || !descField) return
    const date = parseDate(row[dateField] ?? '')
    let payee = cleanPayee(row[descField] ?? '')

    // If description blank or direction-only, try other columns
    if (!payee || isDirectionOnly(payee)) {
      const alt = field(['description', 'payee', 'name', 'merchant'])
      if (alt && alt !== descField) {
        payee = cleanPayee(row[alt] ?? '')
      }
    }
    if (!date || !payee || isDirectionOnly(payee)) return

    let amount: number | null = null
    if (amountField) {
      amount = parseAmount(row[amountField] ?? '')
    } else if (debitField || creditField) {
      const debit = debitField ? parseAmount(row[debitField] ?? '') : null
      const credit = creditField ? parseAmount(row[creditField] ?? '') : null
      if (debit && debit !== 0) amount = -Math.abs(debit)
      else if (credit && credit !== 0) amount = Math.abs(credit)
    }

    if (amount == null || amount === 0) return

    // Direction/type only flips absolute amounts when bank didn't already sign them.
    // Chase credit: Sale=-49.12 (signed), Payment=487.68 (unsigned — must stay positive).
    const directionRaw = directionField
      ? (row[directionField] ?? '').toLowerCase()
      : ''
    const typeRaw = typeField ? (row[typeField] ?? '').toLowerCase() : ''
    const signedAlready =
      (row[amountField ?? ''] ?? '').trim().startsWith('-') ||
      /^\(.*\)$/.test((row[amountField ?? ''] ?? '').trim())

    if (!signedAlready) {
      const dir = `${directionRaw} ${typeRaw}`
      // Card refunds/payments/credits first (don't treat "Payment" as an expense)
      if (
        /\b(payment|return|refund|credit|deposit|payroll|interest|cashout|adjustment)\b/i.test(
          dir,
        ) &&
        !/\bsale\b/i.test(dir)
      ) {
        amount = Math.abs(amount)
      } else if (
        /\b(sale|purchase|debit|withdrawal|fee|charge|atm)\b/i.test(dir)
      ) {
        amount = -Math.abs(amount)
      }
    }

    const balanceAfter = balanceField
      ? parseAmount(row[balanceField] ?? '')
      : null

    const memoParts: string[] = []
    if (typeField && typeField !== descField) {
      const t = (row[typeField] ?? '').trim()
      if (t) memoParts.push(t)
    }
    // Real categories only — skip Barclays DEBIT/CREDIT "Category" values
    if (
      categoryField &&
      categoryField !== descField &&
      categoryField !== directionField
    ) {
      const c = (row[categoryField] ?? '').trim()
      if (c && !isDirectionOnly(c)) memoParts.push(c)
    }
    if (purchasedByField) {
      const by = (row[purchasedByField] ?? '').trim()
      if (by) memoParts.push(by)
    }
    if (memoField && memoField !== descField) {
      const m = (row[memoField] ?? '').trim()
      if (m) memoParts.push(m)
    }

    lines.push({
      date,
      amount,
      payee: payee.slice(0, 200),
      memo: memoParts.length ? memoParts.join(' · ') : undefined,
      balanceAfter:
        balanceAfter != null && !Number.isNaN(balanceAfter)
          ? balanceAfter
          : null,
      fileIndex,
    })
  })

  const inferred = inferBalances(lines)
  // Prefer a stated "account balance as of" from the file header over running balance
  const endingBalance =
    preambleBalance != null ? preambleBalance : inferred.endingBalance
  const startingBalance =
    preambleBalance != null && lines.length
      ? Number(
          (
            preambleBalance - lines.reduce((s, r) => s + r.amount, 0)
          ).toFixed(2),
        )
      : inferred.startingBalance

  const rows: ImportRow[] = lines.map(({ date, amount, payee, memo }) => ({
    date,
    amount,
    payee,
    memo,
  }))

  if (!rows.length) {
    notes.push(
      'No transactions found. Need date, description, and amount columns' +
        (dateField && descField && amountField
          ? ' (headers found but rows did not parse — check amounts/dates).'
          : '.'),
    )
  } else {
    notes.push(`Parsed ${rows.length} transactions.`)
    if (startingBalance != null) {
      notes.push(
        `Opening balance (before first line): ${startingBalance.toFixed(2)}.`,
      )
    }
    if (endingBalance != null) {
      notes.push(
        `Closing balance from statement: ${endingBalance.toFixed(2)} — will set the account balance on import.`,
      )
    } else {
      notes.push(
        'No balance found in file. Enter the statement balance (amount owed) manually if you want the card total to match.',
      )
    }
  }

  return { rows, endingBalance, startingBalance, notes }
}
