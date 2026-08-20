/**
 * Extract structured bill fields from PDF text (utility, credit, phone, mortgage, etc.).
 * Heuristics first; no network required.
 */

export type MortgageBreakdown = {
  principal: number | null
  interest: number | null
  escrow: number | null
  regularPayment: number | null
  pastDue: number | null
  fees: number | null
}

export type CreditCardBreakdown = {
  /** Full payoff amount (statement / new balance) */
  statementBalance: number | null
  /** Minimum payment due */
  minimumPayment: number | null
}

export type ParsedBillPdf = {
  fileName: string
  filePath: string
  textPreview: string
  name: string
  amount: number | null
  dueDate: string | null
  dueDay: number | null
  statementDate: string | null
  payeeHint: string
  suggestedCategory: string | null
  confidence: 'high' | 'medium' | 'low'
  notes: string[]
  autopay: boolean
  autopayDay: number | null
  autopayDate: string | null
  /** Present for mortgage statements when we can parse the breakdown */
  isMortgage: boolean
  mortgage: MortgageBreakdown | null
  /** Credit card statements — amount defaults to full statement balance */
  isCreditCard: boolean
  creditCard: CreditCardBreakdown | null
}

function moneyTokens(text: string): Array<{ value: number; index: number; raw: string }> {
  const re = /\$?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g
  const out: Array<{ value: number; index: number; raw: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[0]
    const n = Number(m[1].replace(/,/g, ''))
    if (!Number.isNaN(n) && n > 0 && n < 1_000_000) {
      out.push({ value: n, index: m.index, raw })
    }
  }
  return out
}

function parseMoney(raw: string): number | null {
  const n = Number(String(raw).replace(/[$,\s]/g, ''))
  if (Number.isNaN(n) || n < 0) return null
  return n
}

function parseDateNear(text: string, index: number, window = 80): string | null {
  const slice = text.slice(Math.max(0, index - 20), index + window)
  return firstDate(slice)
}

function firstDate(text: string): string | null {
  const mdy = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/)
  if (mdy) {
    let y = Number(mdy[3])
    if (y < 100) y += 2000
    const mm = mdy[1].padStart(2, '0')
    const dd = mdy[2].padStart(2, '0')
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${y}-${mm}-${dd}`
    }
  }
  const named = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  )
  if (named) {
    const months: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    }
    const key = named[1].slice(0, 3).toLowerCase()
    const mm = months[key]
    const dd = named[2].padStart(2, '0')
    if (mm) return `${named[3]}-${mm}-${dd}`
  }
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

/** First positive money amount after a label match (skips $0.00 by default). */
function findLabeledAmount(
  text: string,
  labels: RegExp[],
  opts?: { allowZero?: boolean; maxWindow?: number },
): number | null {
  const allowZero = opts?.allowZero ?? false
  const maxWindow = opts?.maxWindow ?? 160
  for (const label of labels) {
    const re = new RegExp(label.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const window = text.slice(m.index, m.index + maxWindow)
      const monies = moneyTokens(window)
      for (const mon of monies) {
        if (!allowZero && mon.value === 0) continue
        // Skip huge loan balances / outstanding principal when looking for monthly due
        if (mon.value > 50_000) continue
        return mon.value
      }
    }
  }
  return null
}

function findLabeledDate(text: string, labels: RegExp[]): string | null {
  for (const label of labels) {
    const re = new RegExp(label.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const d = parseDateNear(text, m.index + m[0].length)
      if (d) return d
    }
  }
  return null
}

function looksLikeMortgage(text: string, fileName: string): boolean {
  const hay = `${fileName}\n${text}`
  return /mortgage|escrow|outstanding principal|loan due date|regular monthly payment|new american funding|loan number|principal.*interest.*escrow/i.test(
    hay,
  )
}

function looksLikeCreditCard(text: string, fileName: string): boolean {
  const hay = `${fileName}\n${text.slice(0, 3500)}`
  return /credit\s*card|statement\s*balance|minimum\s*payment\s*due|account\s*ending|card\s*member|world\s*elite\s*mastercard|visa\s+signature|rewards?\s+.*mastercard|barclays|barclaycard/i.test(
    hay,
  )
}

/**
 * Prefer full statement balance for people who pay in full; still capture minimum.
 */
function extractCreditCardBreakdown(text: string): CreditCardBreakdown {
  const statementBalance =
    matchFirstAmount(text, [
      /Statement\s+Balance\s+as\s+of\s+[^\n$]{0,40}\$?\s*([\d,]+\.\d{2})/i,
      /Statement\s+Balance\s*[:=]\s*\$?\s*([\d,]+\.\d{2})/i,
      /Statement\s+Balance[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/i,
      /New\s+Balance\s*[:=]?\s*\$?\s*([\d,]+\.\d{2})/i,
      /Total\s+New\s+Balance\s*[:=]?\s*\$?\s*([\d,]+\.\d{2})/i,
      /Balance\s+as\s+of\s+[^\n$]{0,30}\$?\s*([\d,]+\.\d{2})/i,
    ]) ?? null

  const minimumPayment =
    matchFirstAmount(text, [
      /Minimum\s+Payment\s+Due\s*[:=]?\s*\$?\s*([\d,]+\.\d{2})/i,
      /Minimum\s+Payment\s*[:=]?\s*\$?\s*([\d,]+\.\d{2})/i,
    ]) ?? null

  return { statementBalance, minimumPayment }
}

/**
 * Parse New American Funding–style and common mortgage breakdowns from jumbled PDF text.
 */
function extractMortgageBreakdown(text: string): MortgageBreakdown {
  // Prefer the "Explanation of Amount Due" block when present (avoids outstanding principal / rates)
  const expl = sliceSection(
    text,
    /Explanation of Amount Due/i,
    /Transaction Activity|Past Payments Breakdown|PAYMENT COUPON|IMPORTANT INFORMATION/i,
  )
  const zone = expl || text

  // Principal$657.70 — require $ sign so we don't grab "Outstanding Principal\n2.750%"
  let principal =
    matchFirstAmount(zone, [
      /Principal\s*\$\s*([\d,]+\.\d{2})/i,
      /(?:^|\n)\s*Principal\s*\$\s*([\d,]+\.\d{2})/im,
    ]) ?? null

  // Fallback without $ but not after Outstanding / Rate
  if (principal == null) {
    const m = zone.match(/(?<!Outstanding\s)(?<!Rate\s)Principal[^\d$%]{0,12}\$?\s*([\d,]+\.\d{2})/i)
    if (m) {
      const n = parseMoney(m[1])
      if (n != null && n >= 50) principal = n
    }
  }

  const interest =
    matchFirstAmount(zone, [
      /\$?\s*([\d,]+\.\d{2})\s*Interest\b/i,
      /\bInterest\s*\$\s*([\d,]+\.\d{2})/i,
    ]) ?? null

  let escrow: number | null = null
  const escrowLabel = zone.match(
    /\$?\s*([\d,]+\.\d{2})\s*\n?\s*Escrow\s*\(?Taxes?\s+and\s+Insurance\)?/i,
  )
  if (escrowLabel) escrow = parseMoney(escrowLabel[1])
  if (escrow == null) {
    escrow = matchFirstAmount(zone, [
      /Escrow\s*\(?Taxes?\s+and\s+Insurance\)?\s*\$\s*([\d,]+\.\d{2})/i,
    ])
  }
  // Escrow Balance and large balances are not monthly escrow
  if (escrow != null && escrow > 5000) escrow = null

  const regularPayment =
    matchFirstAmount(text, [
      /Regular\s+Monthly\s+Payment\s*\$?\s*([\d,]+\.\d{2})/i,
      /Regular\s+Monthly\s+Payment[^\d$]{0,30}\$?\s*([\d,]+\.\d{2})/i,
    ]) ?? null

  const pastDue =
    matchFirstAmount(
      zone,
      [/Past\s+Due\s+Payment(?:\(s\))?\s*\$?\s*([\d,]+\.\d{2})/i],
      true,
    ) ?? 0

  const fees =
    matchFirstAmount(
      zone,
      [
        /Total\s+Fees\s+and\s+Charges\s*\$?\s*([\d,]+\.\d{2})/i,
        /Fees\s+and\s+Charges\s*\$?\s*([\d,]+\.\d{2})/i,
      ],
      true,
    ) ?? 0

  return {
    principal,
    interest,
    escrow,
    regularPayment,
    pastDue,
    fees,
  }
}

function matchFirstAmount(
  text: string,
  patterns: RegExp[],
  allowZero = false,
): number | null {
  for (const p of patterns) {
    const m = text.match(p)
    if (!m) continue
    const n = parseMoney(m[1])
    if (n == null) continue
    if (!allowZero && n === 0) continue
    if (n > 50_000) continue
    return n
  }
  return null
}

function sliceSection(
  text: string,
  start: RegExp,
  end: RegExp,
): string | null {
  const s = text.search(start)
  if (s < 0) return null
  const rest = text.slice(s)
  const e = rest.search(end)
  return e > 0 ? rest.slice(0, e) : rest.slice(0, 1200)
}

function resolveMortgageTotal(
  text: string,
  m: MortgageBreakdown,
): { amount: number | null; note?: string } {
  // Best labels: "Next Payment… Total Amount Due: date $amount"
  const labeledTotals: number[] = []
  const re =
    /Total\s+Amount\s+Due:?\s*(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*)?\$?\s*([\d,]+\.\d{2})/gi
  let hit: RegExpExecArray | null
  while ((hit = re.exec(text)) !== null) {
    const n = parseMoney(hit[1])
    if (n != null && n > 0 && n < 50_000) labeledTotals.push(n)
  }

  // Coupon style: Total Amount Due $1,750.36 on its own
  const coupon = [
    ...text.matchAll(
      /Total\s+Amount\s+Due\s*\$\s*([\d,]+\.\d{2})/gi,
    ),
  ]
    .map((x) => parseMoney(x[1]))
    .filter((n): n is number => n != null && n > 0 && n < 50_000)

  for (const n of coupon) labeledTotals.push(n)

  // Prefer mode of labeled totals (appears multiple times at $1750.36)
  if (labeledTotals.length) {
    const freq = new Map<number, number>()
    for (const n of labeledTotals) {
      const key = Math.round(n * 100) / 100
      freq.set(key, (freq.get(key) ?? 0) + 1)
    }
    let best = labeledTotals[0]
    let bestC = 0
    for (const [n, c] of freq) {
      if (c > bestC || (c === bestC && n > best)) {
        best = n
        bestC = c
      }
    }
    // Reject $0-ish and reject lone principal-sized if we have larger consensus
    if (best > 0) return { amount: best }
  }

  if (m.regularPayment && m.regularPayment > 0) {
    return {
      amount: m.regularPayment,
      note: 'Used Regular Monthly Payment as amount due.',
    }
  }

  if (
    m.principal != null &&
    m.interest != null &&
    m.escrow != null
  ) {
    const sum =
      Math.round((m.principal + m.interest + m.escrow) * 100) / 100
    return {
      amount: sum,
      note: 'Amount due computed as principal + interest + escrow.',
    }
  }

  return { amount: null }
}

const CATEGORY_HINTS: Array<{ cat: string; patterns: RegExp }> = [
  {
    cat: 'Other',
    patterns:
      /credit\s*card|statement\s*balance|minimum\s*payment\s*due|account\s*ending|barclays|barclaycard|world\s*elite\s*mastercard|card ending/i,
  },
  {
    cat: 'Rent / Mortgage',
    patterns:
      /mortgage|new american funding|loan number|outstanding principal|escrow \(taxes|regular monthly payment|loan due date/i,
  },
  {
    cat: 'Utilities',
    patterns:
      /jurupa community services|\bjcsd\b|water\s+(?:bill|charges|utility)|sewer\s+charges|electric|p\.?\s*g\.?\s*&?\s*e|power|energy|gas company|\bwater\b|\bsewer\b|community services district/i,
  },
  {
    cat: 'Utilities',
    patterns:
      /\binternet\b|\bcomcast\b|\bxfinity\b|\bverizon\b|\bat&t\b|\bt-?mobile\b|\bspectrum\b|\bwireless\b|\bfiber\b|\bstarlink\b|cable\s+bill/i,
  },
  { cat: 'Insurance', patterns: /\binsurance\b|\bgeico\b|\bprogressive\b|\bstate farm\b|\ballstate\b|\bpremium\b/i },
  { cat: 'Rent / Mortgage', patterns: /\brent\b|\blandlord\b|property management|\bhoa\b/i },
  { cat: 'Subscriptions', patterns: /netflix|spotify|hulu|disney|subscription|membership/i },
  { cat: 'Health', patterns: /medical|dental|health|clinic|hospital|pharmacy|cvs|walgreens/i },
]

/** Strong issuer identity — checked in scoring order (local utilities before card brands). */
const KNOWN_VENDORS: Array<{
  name: string
  hint: string
  pattern: RegExp
  /** Card brands often appear only as accepted payment methods */
  cardBrand?: boolean
}> = [
  {
    name: 'Barclays',
    hint: 'BARCLAYS',
    pattern: /\bbarclays\b|\bbarclaycard\b/i,
  },
  {
    name: 'Jurupa Community Services',
    hint: 'JCSD',
    pattern: /jurupa community services(?:\s+district)?|\bjcsd\b/i,
  },
  {
    name: 'New American Funding',
    hint: 'NEW AMERICAN FUNDING',
    pattern: /new american funding/i,
  },
  { name: 'PG&E', hint: 'PGE', pattern: /p\.?\s*g\.?\s*&?\s*e|pacific gas/i },
  { name: 'Comcast', hint: 'COMCAST', pattern: /comcast|xfinity/i },
  { name: 'Verizon', hint: 'VERIZON', pattern: /verizon/i },
  { name: 'AT&T', hint: 'ATT', pattern: /at&t|a\.t\.&t/i },
  { name: 'T-Mobile', hint: 'T-MOBILE', pattern: /t-?mobile/i },
  { name: 'Spectrum', hint: 'SPECTRUM', pattern: /spectrum/i },
  { name: 'Geico', hint: 'GEICO', pattern: /geico/i },
  { name: 'Progressive', hint: 'PROGRESSIVE', pattern: /progressive/i },
  { name: 'State Farm', hint: 'STATE FARM', pattern: /state farm/i },
  { name: 'Netflix', hint: 'NETFLIX', pattern: /netflix/i },
  { name: 'Spotify', hint: 'SPOTIFY', pattern: /spotify/i },
  { name: 'Amazon', hint: 'AMAZON', pattern: /\bamazon\b/i },
  {
    name: 'Chase',
    hint: 'CHASE',
    pattern: /\bchase\b/i,
    cardBrand: true,
  },
  {
    name: 'Capital One',
    hint: 'CAPITAL ONE',
    pattern: /capital one/i,
    cardBrand: true,
  },
  {
    name: 'Bank of America',
    hint: 'BANK OF AMERICA',
    pattern: /bank of america/i,
    cardBrand: true,
  },
  {
    name: 'Wells Fargo',
    hint: 'WELLS FARGO',
    pattern: /wells fargo/i,
    cardBrand: true,
  },
  {
    name: 'American Express',
    hint: 'AMEX',
    pattern: /american express|\bamex\b/i,
    cardBrand: true,
  },
  {
    name: 'Discover',
    hint: 'DISCOVER',
    pattern: /\bdiscover\b/i,
    cardBrand: true,
  },
  // Mastercard/Visa only as issuers when filename/statement indicates CC — not network logos on utility bills
  {
    name: 'Mastercard',
    hint: 'MASTERCARD',
    pattern: /world\s*elite\s*mastercard|rewards?\s+.*mastercard|mastercard\s+statement/i,
    cardBrand: true,
  },
]

function isAcceptedPaymentMethodsContext(text: string, matchIndex: number): boolean {
  const window = text.slice(Math.max(0, matchIndex - 120), matchIndex + 100)
  return /accepted\s+payment|payment\s+types|cash[\s,]+check|money\s+order|visa[\s,]+mastercard|mastercard[\s,]+american|pay\s+by\s+(?:mail|phone|credit)/i.test(
    window,
  )
}

function looksLikeCardStatement(text: string, fileName: string): boolean {
  const hay = `${fileName}\n${text.slice(0, 2500)}`
  return /credit\s*card|card\s+member|membership\s+rewards|account\s+ending|minimum\s+payment|new\s+balance|previous\s+balance.*payments?\s+\/\s*credits/i.test(
    hay,
  )
}

function guessFromFileName(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{4,}|\b20\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
}

function guessPayee(text: string, fileName: string): { name: string; hint: string } {
  // Filename / path cues (very strong for water/electric folders)
  if (/barclay|credit\s*card|ccstatement/i.test(fileName)) {
    if (/\bbarclays\b|\bbarclaycard\b/i.test(text) || /barclay/i.test(fileName)) {
      return { name: 'Barclays', hint: 'BARCLAYS' }
    }
  }
  if (/water|jcsd|jurupa/i.test(fileName)) {
    if (/jurupa|jcsd/i.test(text) || /jurupa|jcsd|water/i.test(fileName)) {
      if (/jurupa community services|\bjcsd\b/i.test(text)) {
        return { name: 'Jurupa Community Services', hint: 'JCSD' }
      }
      return { name: 'Water', hint: 'WATER' }
    }
  }
  if (/electric|pge|edison/i.test(fileName)) {
    return { name: 'Electric', hint: 'ELECTRIC' }
  }
  if (/mortgage|naf/i.test(fileName)) {
    return { name: /naf|american funding/i.test(text) ? 'New American Funding' : 'Mortgage', hint: 'MORTGAGE' }
  }

  // Utility / district agency lines near top of bill
  const district = text.match(
    /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,5}\s+(?:Community\s+)?Services?\s+District)/,
  )
  if (district) {
    const name = district[1].replace(/\s+/g, ' ').trim()
    const hint = /jurupa/i.test(name) ? 'JCSD' : name.toUpperCase().slice(0, 24)
    return { name, hint }
  }

  type Cand = { name: string; hint: string; score: number }
  const cands: Cand[] = []

  for (const v of KNOWN_VENDORS) {
    const re = new RegExp(v.pattern.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      // Skip card brands that only appear under "Accepted payment types"
      if (v.cardBrand && isAcceptedPaymentMethodsContext(text, m.index)) {
        continue
      }
      if (v.cardBrand && !looksLikeCardStatement(text, fileName) && !v.pattern.test(fileName)) {
        // Bare brand mention without card-statement layout — weak / ignore
        continue
      }

      // Prefer earlier matches (issuer letterhead) over footer noise
      let score = 100 - Math.min(90, Math.floor(m.index / 80))
      if (v.pattern.test(fileName)) score += 40
      if (!v.cardBrand) score += 20
      if (m.index < 800) score += 15
      cands.push({ name: v.name, hint: v.hint, score })
    }
  }

  if (cands.length) {
    cands.sort((a, b) => b.score - a.score)
    return { name: cands[0].name, hint: cands[0].hint }
  }

  if (/mortgage/i.test(fileName) || /mortgage statement/i.test(text)) {
    return { name: 'Mortgage', hint: 'MORTGAGE' }
  }

  if (/total\s+(?:current\s+)?water|sewer\s+charges|historical\s+water/i.test(text)) {
    return { name: 'Water', hint: 'WATER' }
  }

  const fileGuess = guessFromFileName(fileName)
  if (fileGuess.length >= 3) {
    return {
      name: fileGuess
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' '),
      hint: fileGuess.toUpperCase().slice(0, 24),
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60)
    .filter((l) => !/page\s+\d|www\.|\.com|account|statement|invoice|office hours/i.test(l))

  const top = lines[0] || 'Bill'
  return {
    name: top.slice(0, 48),
    hint: top.replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().slice(0, 24),
  }
}

function suggestCategory(text: string, fileName: string): string | null {
  const hay = `${fileName}\n${text}`
  for (const h of CATEGORY_HINTS) {
    if (h.patterns.test(hay)) return h.cat
  }
  return null
}

export function parseBillText(text: string, fileName: string, filePath: string): ParsedBillPdf {
  const notes: string[] = []
  const cleaned = text.replace(/\u0000/g, ' ')
  // keep newlines for section parsers, collapse spaces on lines for generic parse
  const flat = cleaned.replace(/[ \t]+/g, ' ')

  const isMortgage = looksLikeMortgage(flat, fileName)
  const isCreditCard = !isMortgage && looksLikeCreditCard(flat, fileName)
  let mortgage: MortgageBreakdown | null = null
  let creditCard: CreditCardBreakdown | null = null
  let amountFinal: number | null = null

  if (isMortgage) {
    mortgage = extractMortgageBreakdown(cleaned)
    // If we have principal+interest but missing escrow, derive from regular payment
    if (
      mortgage.principal != null &&
      mortgage.interest != null &&
      mortgage.escrow == null &&
      mortgage.regularPayment != null
    ) {
      const rest =
        Math.round(
          (mortgage.regularPayment - mortgage.principal - mortgage.interest) * 100,
        ) / 100
      if (rest > 0 && rest < 5000) mortgage.escrow = rest
    }

    // Fill regular payment from components if needed
    if (
      mortgage.regularPayment == null &&
      mortgage.principal != null &&
      mortgage.interest != null &&
      mortgage.escrow != null
    ) {
      mortgage.regularPayment =
        Math.round(
          (mortgage.principal + mortgage.interest + mortgage.escrow) * 100,
        ) / 100
    }

    const resolved = resolveMortgageTotal(cleaned, mortgage)
    amountFinal = resolved.amount
    if (resolved.note) notes.push(resolved.note)
    if (amountFinal != null) {
      notes.push(
        `Mortgage breakdown: principal ${mortgage.principal ?? '—'}, interest ${mortgage.interest ?? '—'}, escrow ${mortgage.escrow ?? '—'}.`,
      )
    } else {
      notes.push('Mortgage statement detected but total due was unclear — check amount.')
    }
  }

  if (isCreditCard) {
    creditCard = extractCreditCardBreakdown(cleaned)
    // Prefer full statement balance so “pay in full” is the default amount
    if (creditCard.statementBalance != null) {
      amountFinal = creditCard.statementBalance
      notes.push(
        `Credit card: statement balance ${creditCard.statementBalance.toFixed(2)} (pay in full).${
          creditCard.minimumPayment != null
            ? ` Minimum payment ${creditCard.minimumPayment.toFixed(2)}.`
            : ''
        }`,
      )
    } else if (creditCard.minimumPayment != null) {
      amountFinal = creditCard.minimumPayment
      notes.push(
        'Only minimum payment found — enter statement balance manually if you pay in full.',
      )
    }
  }

  if (amountFinal == null) {
    // Prefer full totals; for non-CC bills avoid minimum payment first
    const labels = isCreditCard
      ? [
          /statement\s*balance/,
          /new\s*balance/,
          /total\s*new\s*balance/,
          /total\s*payment\s*due/,
          /total\s*amount\s*due/,
        ]
      : [
          /total\s*payment\s*due/,
          /total\s*amount\s*due/,
          /total\s*current\s*water\s*and\s*sewer\s*charges/,
          /total\s*account\s*balance/,
          /total\s*due/,
          /amount\s*due\s*:/,
          /pay\s*this\s*amount/,
          /total\s*current\s*water\s*charges/,
          /payment\s*due/,
          /balance\s*due/,
          /new\s*balance/,
          /regular\s*monthly\s*payment/,
          /invoice\s*total/,
          /amount\s*payable/,
        ]

    amountFinal = findLabeledAmount(flat, labels) ?? null
  }

  // Utility bills: explicit "Total Payment Due$123.21"
  if (amountFinal == null || amountFinal < 5) {
    const utilTotal = flat.match(
      /Total\s+Payment\s+Due\s*\$?\s*([\d,]+\.\d{2})/i,
    )
    if (utilTotal) {
      const n = parseMoney(utilTotal[1])
      if (n != null && n > 0) amountFinal = n
    }
  }

  // Avoid treating a $0 total as valid
  if (amountFinal === 0) amountFinal = null

  // Reject tiny tier rates when a larger "total" exists later
  if (amountFinal != null && amountFinal < 10) {
    const bigger = flat.match(
      /Total\s+(?:Payment\s+)?Due\s*\$?\s*([\d,]+\.\d{2})|Total\s+Current\s+Water\s+and\s+Sewer\s+Charges\s*\$?\s*([\d,]+\.\d{2})/i,
    )
    if (bigger) {
      const n = parseMoney(bigger[1] || bigger[2])
      if (n != null && n > amountFinal) amountFinal = n
    }
  }

  if (amountFinal == null) {
    const monies = moneyTokens(flat)
      .map((m) => m.value)
      .filter((v) => v >= 5 && v < 20_000)
    if (monies.length) {
      const sorted = [...monies].sort((a, b) => b - a)
      amountFinal = sorted[0] > 5000 && sorted[1] ? sorted[1] : sorted[0]
      notes.push('Amount guessed from largest dollar figure (review carefully).')
    } else {
      notes.push('Could not find an amount due — enter it manually.')
    }
  }

  if (amountFinal === 0) amountFinal = null

  const dueDate =
    findLabeledDate(flat, [
      /next\s+payment\s+due\s+date/,
      /loan\s+due\s+date/,
      /due\s+by/,
      /due\s*date/,
      /payment\s*due\s*(date|by)?/,
      /pay\s*by/,
      /please\s*pay\s*by/,
    ]) ?? null

  if (!dueDate) notes.push('Due date not found — set due day when saving.')

  const statementDate =
    findLabeledDate(flat, [
      /statement\s*date/,
      /invoice\s*date/,
      /bill\s*date/,
      /billing\s*date/,
      /date\s*of\s*bill/,
    ]) ?? firstDate(flat.slice(0, 800))

  const { name, hint } = guessPayee(flat, fileName)
  const suggestedCategory = suggestCategory(flat, fileName)

  const autopayDetected =
    /auto[\s-]?pay|autopay|automatic(?:ally)?\s+pay|automated\s+payment|automatic\s+payment|payment\s+plan|recurring\s+payment|scheduled\s+payment|easy\s+pay|auto[\s-]?debit/i.test(
      flat,
    )

  let autopayDate =
    findLabeledDate(flat, [
      /auto[\s-]?pay(?:ment)?\s*(?:date|day|on)?/,
      /automated\s+payment\s*(?:date|on)?/,
      /automatic(?:ally)?\s+(?:payment\s+)?(?:date|on|debited)?/,
      /payment\s+will\s+be\s+(?:taken|processed|drafted)\s*(?:on)?/,
      /scheduled\s+(?:for|on)/,
      /debit\s+date/,
      /draft\s+date/,
      /withdrawal\s+date/,
    ]) ?? null

  if (autopayDetected && !autopayDate && dueDate) {
    autopayDate = dueDate
    notes.push('Autopay detected — using due date as autopay day (you can change it).')
  } else if (autopayDetected) {
    notes.push('Autopay wording found on this bill.')
  }

  let confidence: ParsedBillPdf['confidence'] = 'low'
  if (amountFinal != null && dueDate) confidence = 'high'
  else if (amountFinal != null || dueDate) confidence = 'medium'

  const dueDay = dueDate ? Number(dueDate.slice(8, 10)) : null
  const autopayDay = autopayDate
    ? Number(autopayDate.slice(8, 10))
    : autopayDetected && dueDay
      ? dueDay
      : null

  const preview = flat.replace(/\s+/g, ' ').trim().slice(0, 400)

  return {
    fileName,
    filePath,
    textPreview: preview,
    name,
    amount: amountFinal,
    dueDate,
    dueDay,
    statementDate,
    payeeHint: hint,
    suggestedCategory,
    confidence,
    notes,
    autopay: autopayDetected,
    autopayDay,
    autopayDate,
    isMortgage,
    mortgage: isMortgage ? mortgage : null,
    isCreditCard,
    creditCard: isCreditCard ? creditCard : null,
  }
}
