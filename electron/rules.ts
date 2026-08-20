import type Database from 'better-sqlite3'
import { cleanPayee } from './payee'

/**
 * Holds money moving between your own accounts — card payments, bank
 * transfers. Its 'transfer' kind is what keeps these rows out of every
 * spending, income, and budget total.
 */
export const TRANSFER_CATEGORY = 'Payments & Transfers'

/**
 * Payee fragments that mean "this is a payment or transfer, not a purchase".
 * A card payment shows up twice — leaving the checking account and again as a
 * credit on the card — so counting either side would inflate both spending and
 * income. Kept narrow on purpose: a real bill that happens to say "payment"
 * (rent, insurance) must not land here.
 */
export const TRANSFER_MATCHES: string[] = [
  'credit card payment',
  'creditcard pymt',
  'credit crd autopay',
  'crd autopay',
  'card autopay',
  'autopay payment',
  'automatic payment',
  'online payment, thank you',
  'payment, thank you',
  'payment thank you',
  'thank you-online payment',
  'online payment',
  'internet payment',
  'mobile payment',
  'electronic payment',
  'payment received',
  'payment to chase',
  'card ending in',
  'online transfer',
  'transfer to',
  'transfer from',
  'wire transfer',
  'balance transfer',
  'acct xfer',
  'xfer to',
  'xfer from',
  // Bank ACH descriptions for paying a card or funding an outside account.
  'citi card online',
  'bank $transfer',
  // Cashing out Apple Cash. Loading it ("apple cash sent") stays spending,
  // since that's where the money actually gets used.
  'apple cash bank xfer',
]

/**
 * Saved rules with these names were pointed at income or spending categories
 * before transfers had a home of their own.
 */
const TRANSFER_RULE_TEXTS = new Set([
  'transfer',
  'transfer in',
  'transfer out',
  'incoming transfer',
  'outgoing transfer',
])

/** True when a saved rule is really about transfers, whatever it points at. */
export function isTransferRuleText(matchText: string): boolean {
  const clean = matchText.trim().toLowerCase()
  return TRANSFER_RULE_TEXTS.has(clean) || looksLikeTransfer(clean)
}

/**
 * Built-in merchant → category name. Matched as substring on payee/memo.
 * Longer match_text wins. Keep terms specific to avoid false positives.
 * Prefer leaving unknown merchants uncategorized.
 */
const BUILTIN_MERCHANT_CATEGORIES: Array<[string, string]> = [
  // Subscriptions (before generic amazon)
  ['amazon prime', 'Subscriptions'],
  ['prime video', 'Subscriptions'],
  ['youtube premium', 'Subscriptions'],
  ['apple.com/bill', 'Subscriptions'],
  ['apple music', 'Subscriptions'],
  ['disney plus', 'Subscriptions'],
  ['disney+', 'Subscriptions'],
  ['hulu', 'Subscriptions'],
  ['netflix', 'Subscriptions'],
  ['spotify', 'Subscriptions'],
  ['hbo max', 'Subscriptions'],
  ['max.com', 'Subscriptions'],
  ['paramount+', 'Subscriptions'],
  ['peacock', 'Subscriptions'],
  ['adobe', 'Subscriptions'],
  ['microsoft 365', 'Subscriptions'],
  ['icloud', 'Subscriptions'],
  ['dropbox', 'Subscriptions'],
  ['canva', 'Subscriptions'],
  ['anthropic', 'Subscriptions'],
  ['openai', 'Subscriptions'],
  ['chatgpt', 'Subscriptions'],
  ['cursor', 'Subscriptions'],
  ['github', 'Subscriptions'],

  // Dining
  ['uber eats', 'Dining Out'],
  ['doordash', 'Dining Out'],
  ['grubhub', 'Dining Out'],
  ['postmates', 'Dining Out'],
  ['mcdonald', 'Dining Out'],
  ['mcdonalds', 'Dining Out'],
  ['starbucks', 'Dining Out'],
  ['chipotle', 'Dining Out'],
  ['in-n-out', 'Dining Out'],
  ['in n out', 'Dining Out'],
  ['chick-fil-a', 'Dining Out'],
  ['chickfila', 'Dining Out'],
  ['taco bell', 'Dining Out'],
  ['burger king', 'Dining Out'],
  ['wendys', 'Dining Out'],
  ["wendy's", 'Dining Out'],
  ['panera', 'Dining Out'],
  ['subway', 'Dining Out'],
  ['domino', 'Dining Out'],
  ['pizza hut', 'Dining Out'],
  ['papa john', 'Dining Out'],
  ['dunkin', 'Dining Out'],
  ['coffee bean', 'Dining Out'],
  ['peets coffee', 'Dining Out'],
  ['dutch bros', 'Dining Out'],
  ['jack in the box', 'Dining Out'],
  ['sonic drive', 'Dining Out'],
  ['whataburger', 'Dining Out'],
  ['five guys', 'Dining Out'],
  ['shake shack', 'Dining Out'],
  ['wingstop', 'Dining Out'],
  ['panda express', 'Dining Out'],

  // Gas
  ['shell', 'Gas'],
  ['chevron', 'Gas'],
  ['arco', 'Gas'],
  ['exxon', 'Gas'],
  ['mobil', 'Gas'],
  ['valero', 'Gas'],
  ['circle k', 'Gas'],
  ['76 gas', 'Gas'],
  ['76 station', 'Gas'],
  ['ampm', 'Gas'],
  ['speedway', 'Gas'],
  ['costco gas', 'Gas'],

  // Rides / transit — no transit category, so park them in Other
  ['uber', 'Other'],
  ['lyft', 'Other'],
  ['metro transit', 'Other'],

  // Groceries
  ['whole foods', 'Groceries'],
  ['trader joe', 'Groceries'],
  ['food 4 less', 'Groceries'],
  ['food4less', 'Groceries'],
  ['albertsons', 'Groceries'],
  ['sprouts', 'Groceries'],
  ['walmart', 'Groceries'],
  ['costco', 'Groceries'],
  ['kroger', 'Groceries'],
  ['safeway', 'Groceries'],
  ['ralphs', 'Groceries'],
  ['vons', 'Groceries'],
  ['aldi', 'Groceries'],
  ['heb ', 'Groceries'],
  ['h-e-b', 'Groceries'],
  ['winco', 'Groceries'],
  ['stater bros', 'Groceries'],
  ['grocery outlet', 'Groceries'],
  ['smart final', 'Groceries'],

  // Health
  ['ortho', 'Health'],
  ['dental', 'Health'],
  ['dentist', 'Health'],
  ['pharmacy', 'Health'],
  ['walgreens', 'Health'],
  ['cvs', 'Health'],
  ['rite aid', 'Health'],
  ['medical', 'Health'],
  ['hospital', 'Health'],
  ['optom', 'Health'],
  ['optometry', 'Health'],
  ['vision', 'Health'],
  ['lenscrafters', 'Health'],
  ['delta dental', 'Health'],
  ['kaiser', 'Health'],
  ['urgent care', 'Health'],
  ['physio', 'Health'],
  ['chiropract', 'Health'],
  ['labcorp', 'Health'],
  ['quest diagnostics', 'Health'],
  ['planned parenthood', 'Health'],

  // Housing / bills
  ['new american funding', 'Rent / Mortgage'],
  ['american funding', 'Rent / Mortgage'],
  ['mortgage', 'Rent / Mortgage'],
  ['rocket mortgage', 'Rent / Mortgage'],
  ['loan depot', 'Rent / Mortgage'],
  ['loandepot', 'Rent / Mortgage'],
  ['better.com', 'Rent / Mortgage'],
  ['mr. cooper', 'Rent / Mortgage'],
  ['mr cooper', 'Rent / Mortgage'],
  ['pennymac', 'Rent / Mortgage'],
  ['rent payment', 'Rent / Mortgage'],
  ['property management', 'Rent / Mortgage'],

  ['southern california edison', 'Utilities'],
  ['so cal gas', 'Utilities'],
  ['socalgas', 'Utilities'],
  ['edison', 'Utilities'],
  ['sdge', 'Utilities'],
  ['pge ', 'Utilities'],
  ['pg&e', 'Utilities'],
  ['burrtec', 'Utilities'],
  ['waste management', 'Utilities'],
  ['republic services', 'Utilities'],
  ['water district', 'Utilities'],
  ['utility', 'Utilities'],

  // Internet and phone now roll into Utilities
  ['spectrum', 'Utilities'],
  ['xfinity', 'Utilities'],
  ['comcast', 'Utilities'],
  ['cox communication', 'Utilities'],
  ['verizon', 'Utilities'],
  ['t-mobile', 'Utilities'],
  ['tmobile', 'Utilities'],
  ['at&t', 'Utilities'],
  ['att wireless', 'Utilities'],
  ['mint mobile', 'Utilities'],

  // Insurance
  ['geico', 'Insurance'],
  ['progressive', 'Insurance'],
  ['state farm', 'Insurance'],
  ['allstate', 'Insurance'],
  ['usaa', 'Insurance'],
  ['farmers insurance', 'Insurance'],
  ['liberty mutual', 'Insurance'],
  ['nationwide insurance', 'Insurance'],
  ['health insurance', 'Insurance'],
  ['auto insurance', 'Insurance'],

  // Entertainment
  ['amc theatres', 'Entertainment'],
  ['regal cinemas', 'Entertainment'],
  ['cinemark', 'Entertainment'],
  ['ticketmaster', 'Entertainment'],
  ['stubhub', 'Entertainment'],
  ['steam purchase', 'Entertainment'],
  ['playstation', 'Entertainment'],
  ['nintendo', 'Entertainment'],
  ['xbox', 'Entertainment'],

  // Kids
  ['toys r us', 'Kids'],
  ['daycare', 'Kids'],
  ['childcare', 'Kids'],
  ['school tuition', 'Kids'],
  ['primary school', 'Kids'],

  // Home improvement
  ['home depot', 'Home Improvement'],
  ['lowes', 'Home Improvement'],
  ["lowe's", 'Home Improvement'],
  ['ace hardware', 'Home Improvement'],
  ['harbor freight', 'Home Improvement'],
  ['sherwin williams', 'Home Improvement'],
  ['sherwin-williams', 'Home Improvement'],
  ['menards', 'Home Improvement'],
  ['tractor supply', 'Home Improvement'],

  // Shopping (more generic — after prime)
  ['best buy', 'Shopping'],
  ['target', 'Shopping'],
  ['ebay', 'Shopping'],
  ['etsy', 'Shopping'],
  ['apple store', 'Shopping'],
  ['amazon', 'Shopping'],
  ['paypal', 'Shopping'],
  ['temu', 'Shopping'],
  ['shein', 'Shopping'],
  ['nike', 'Shopping'],
  ['nordstrom', 'Shopping'],
  ['macys', 'Shopping'],
  ["macy's", 'Shopping'],
  ['walmart.com', 'Shopping'],

  // Income
  ['direct dep', 'Other Income'],
  ['payroll', 'Other Income'],
  ['salary', 'Other Income'],
  ['employer', 'Other Income'],

  ...TRANSFER_MATCHES.map(
    (match): [string, string] => [match, TRANSFER_CATEGORY],
  ),

  // Person-to-person apps usually are real spending, so they stay counted.
  ['venmo', 'Other'],
  ['zelle', 'Other'],
  ['cash app', 'Other'],
]

function categoryIdByName(
  db: Database.Database,
  profileId: number,
  name: string,
): number | null {
  const row = db
    .prepare(
      `SELECT id FROM categories WHERE profile_id = ? AND lower(name) = lower(?)`,
    )
    .get(profileId, name) as { id: number } | undefined
  return row?.id ?? null
}

function searchText(payee: string, memo?: string | null): string {
  const cleaned = cleanPayee(payee, memo)
  return `${payee} ${memo ?? ''} ${cleaned.display} ${cleaned.key}`.toLowerCase()
}

/** True when a row reads as a card payment or account-to-account move. */
export function looksLikeTransfer(payee: string, memo?: string | null): boolean {
  const hay = searchText(payee, memo)
  return TRANSFER_MATCHES.some((m) => hay.includes(m))
}

function matchBuiltinCategory(hay: string): string | null {
  let best: { match: string; cat: string } | null = null
  for (const [match, cat] of BUILTIN_MERCHANT_CATEGORIES) {
    if (match.length < 3) continue
    if (!hay.includes(match.toLowerCase())) continue
    if (!best || match.length > best.match.length) {
      best = { match, cat }
    }
  }
  return best?.cat ?? null
}

/**
 * Resolve a category for a merchant. User rules first, then built-in heuristics.
 * Returns null when uncertain (leave Uncategorized).
 */
export function applyCategoryRules(
  db: Database.Database,
  profileId: number,
  payee: string,
  memo?: string | null,
): number | null {
  const hay = searchText(payee, memo)

  const rules = db
    .prepare(
      `SELECT match_text, category_id FROM category_rules WHERE profile_id = ?
       ORDER BY length(match_text) DESC`,
    )
    .all(profileId) as Array<{ match_text: string; category_id: number }>

  for (const rule of rules) {
    const text = rule.match_text?.trim()
    if (text && text.length >= 2 && hay.includes(text.toLowerCase())) {
      return rule.category_id
    }
  }

  const builtinName = matchBuiltinCategory(hay)
  if (builtinName) {
    const id = categoryIdByName(db, profileId, builtinName)
    if (id != null) return id
  }

  return null
}
