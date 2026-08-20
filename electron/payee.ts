/**
 * Clean bank/credit payee strings into a readable display name + stable merchant key.
 */

export type CleanPayee = {
  display: string
  key: string
}

/** Prefer longer patterns first when matching. */
const MERCHANT_ALIASES: Array<{ match: RegExp; display: string; key: string }> = [
  { match: /amazon\s*prime|amznprime|prime\s*video/i, display: 'Amazon Prime', key: 'amazon-prime' },
  { match: /amazon\.?com|amzn\s*mktpl|amazon\s*mktpl|amznpharma/i, display: 'Amazon', key: 'amazon' },
  { match: /mcdonald'?s|mcdonalds/i, display: "McDonald's", key: 'mcdonalds' },
  { match: /subway\b/i, display: 'Subway', key: 'subway' },
  { match: /starbucks/i, display: 'Starbucks', key: 'starbucks' },
  { match: /raising\s*canes|raising\s*cane/i, display: "Raising Cane's", key: 'raising-canes' },
  { match: /taco\s*bell/i, display: 'Taco Bell', key: 'taco-bell' },
  { match: /dollar\s*tree/i, display: 'Dollar Tree', key: 'dollar-tree' },
  { match: /hot\s*topic/i, display: 'Hot Topic', key: 'hot-topic' },
  { match: /old\s*navy/i, display: 'Old Navy', key: 'old-navy' },
  { match: /auntie\s*anne/i, display: "Auntie Anne's", key: 'auntie-annes' },
  { match: /charleys\s*philly|philly\s*steak/i, display: "Charleys Philly", key: 'charleys' },
  { match: /harbor\s*freight/i, display: 'Harbor Freight', key: 'harbor-freight' },
  { match: /openai|chatgpt/i, display: 'OpenAI / ChatGPT', key: 'openai' },
  { match: /linkedin/i, display: 'LinkedIn', key: 'linkedin' },
  { match: /jobright/i, display: 'Jobright', key: 'jobright' },
  { match: /t[\s-]*mobile/i, display: 'T-Mobile', key: 't-mobile' },
  { match: /so\s*cal\s*edison|socal\s*edison|sce\b/i, display: 'SoCal Edison', key: 'socal-edison' },
  { match: /socalgas|so\s*cal\s*gas/i, display: 'SoCalGas', key: 'socal-gas' },
  { match: /jcsd|jurupa/i, display: 'JCSD Water', key: 'jcsd' },
  { match: /new\s*american\s*fnd|new\s*american\s*funding|naf\b/i, display: 'New American Funding', key: 'new-american-funding' },
  { match: /barclaycard|barclays/i, display: 'Barclays', key: 'barclays' },
  { match: /payment\s+to\s+chase\s+card/i, display: 'Chase card payment', key: 'chase-card-payment' },
  { match: /payment\s+thank\s*you/i, display: 'Card payment received', key: 'card-payment-received' },
  { match: /\bvenmo\b/i, display: 'Venmo', key: 'venmo' },
  { match: /stater\s*bros|staterbros/i, display: 'Stater Bros', key: 'stater-bros' },
  { match: /lowes|lowe'?s/i, display: "Lowe's", key: 'lowes' },
  { match: /crunch\s*fit/i, display: 'Crunch Fitness', key: 'crunch' },
  { match: /rdg\s*ortho|riverside\s*dental|dental\s*grou/i, display: 'RDG Ortho / Dental', key: 'rdg-dental' },
  // Money moving onto the Apple Cash card is spending; money coming back to the
  // bank is not, so the two directions can't share a merchant.
  { match: /apple\s*cash\s*bank\s*xfer/i, display: 'Apple Cash to bank', key: 'apple-cash-to-bank' },
  { match: /apple\s*cash\s*sent/i, display: 'Apple Cash loaded', key: 'apple-cash-loaded' },
  { match: /apple\s*cash/i, display: 'Apple Cash', key: 'apple-cash' },
  { match: /american\s*residen/i, display: 'American Residential', key: 'american-residential' },
  { match: /california\s*edd|edd\s*di\s*deposit/i, display: 'CA EDD', key: 'ca-edd' },
  { match: /\birs\b|tax\s*ref/i, display: 'IRS', key: 'irs' },
  { match: /isc2/i, display: 'ISC2', key: 'isc2' },
  { match: /pollyspies/i, display: 'Pollyspies', key: 'pollyspies' },
  { match: /nyx\*nayax|nayax\s*vending/i, display: 'Vending', key: 'vending' },
  { match: /pos\s*debit/i, display: 'Card purchase', key: 'pos-debit' },
  { match: /online\s*transfer\s+from/i, display: 'Transfer in', key: 'transfer-in' },
  { match: /online\s*transfer\s+to/i, display: 'Transfer out', key: 'transfer-out' },
  { match: /atm\s*withdrawal/i, display: 'ATM withdrawal', key: 'atm' },
  { match: /interest\s*charge/i, display: 'Interest charge', key: 'interest-charge' },
]

function stripNoise(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  // Excel-ish formula fragments from Barclays card last-4
  s = s.replace(/="?\d+"?/g, ' ')
  // Common bank suffixes / IDs
  s = s.replace(/\bWEB\s*ID[:\s]*\w+/gi, ' ')
  s = s.replace(/\bPPD\s*ID[:\s]*\w+/gi, ' ')
  s = s.replace(/\bACH\s*ID[:\s]*\w+/gi, ' ')
  s = s.replace(/\btransaction#:\s*\d+/gi, ' ')
  s = s.replace(/\b\d{6,}\b/g, ' ')
  // Amazon-style *order suffix
  s = s.replace(/\*[A-Z0-9]{6,}/gi, ' ')
  // Trailing state codes alone after place names are kept; strip bare zip
  s = s.replace(/\b\d{5}(?:-\d{4})?\b/g, ' ')
  // Card last 4 noise
  s = s.replace(/\bend(ing)?\s+in\s+\d{4}\b/gi, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function titleCaseWords(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^(llc|inc|co|usa|ca|tx|ny|fl)$/i.test(w)) return w.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
}

function fallbackDisplay(stripped: string): string {
  // Drop noisy leading markers
  let s = stripped
    .replace(/^(pos\s+debit|debit\s+card|ach\s+debit|ach\s+credit|debit|credit)\s+/i, '')
    .trim()
  // Take first meaningful chunk before location piles
  if (s.length > 42) s = s.slice(0, 42).replace(/\s+\S*$/, '').trim()
  if (!s) s = stripped.slice(0, 40) || 'Unknown'
  return titleCaseWords(s)
}

function fallbackKey(display: string): string {
  return display
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'unknown'
}

/**
 * Bank confirmation codes tacked onto the end of a person-to-person payment,
 * e.g. "JPM99b3mi2yz" or "BAChkmsrswyf". Names never look like these.
 */
function stripReference(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.trim()
  const last = parts[parts.length - 1]
  const looksLikeCode =
    (last.length >= 8 && /^[A-Za-z0-9]+$/.test(last) && /\d/.test(last)) ||
    (last.length >= 10 && /^[A-Za-z]+$/.test(last) && /[A-Z]/.test(last.slice(1)))
  return (looksLikeCode ? parts.slice(0, -1) : parts).join(' ')
}

/**
 * Zelle is the one case where the counterparty *is* the merchant. Collapsing
 * every recipient under a single "Zelle payment sent" name means one category
 * choice lands on everyone you've ever paid, so each person gets their own.
 */
function personToPerson(text: string): CleanPayee | null {
  const m =
    /zelle\s+(?:payment\s+)?(sent\s+to|received\s+from|to|from)\s+(.+)$/i.exec(
      text,
    )
  if (!m) return null
  const who = stripReference(m[2])
  if (!who) return null
  const inbound = /from/i.test(m[1])
  const display = `Zelle ${inbound ? 'from' : 'to'} ${who}`
  return { display, key: fallbackKey(display) }
}

export function cleanPayee(raw: string, memo?: string | null): CleanPayee {
  const original = (raw || '').trim() || 'Unknown'
  const combined = `${original} ${memo ?? ''}`
  const stripped = stripNoise(original)

  const person = personToPerson(stripped) ?? personToPerson(original)
  if (person) return person

  for (const entry of MERCHANT_ALIASES) {
    if (entry.match.test(combined) || entry.match.test(stripped)) {
      return { display: entry.display, key: entry.key }
    }
  }

  const display = fallbackDisplay(stripped || original)
  return { display, key: fallbackKey(display) }
}
