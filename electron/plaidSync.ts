import type { FinanceDb, PlaidTxInput } from './db'
import {
  PlaidError,
  createLinkToken,
  createUpdateLinkToken,
  exchangePublicToken,
  getAccounts,
  getInstitution,
  getLinkToken,
  publicTokenFromSession,
  removeItem,
  syncTransactions,
  type PlaidAccount,
  type PlaidTransaction,
} from './plaid'
import { requireCreds, sealToken, unsealToken } from './plaidCreds'
import { TRANSFER_CATEGORY } from './rules'

/**
 * Bridges Plaid's API to our database: link sessions, the incremental
 * transaction sync, and the guesswork of matching bank accounts to the ones
 * already in the app.
 */

const APP_NAME = "Bizzy's Finance"

/** How long we're willing to wait for Plaid's first history fill. */
const HISTORY_ATTEMPTS = 12
const HISTORY_WAIT_MS = 5000

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Plaid's personal finance categories mapped onto our much shorter list. Our
 * own merchant rules run first, so this is only a fallback for merchants we
 * have never seen.
 */
const DETAILED_CATEGORY: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: 'Groceries',
  TRANSPORTATION_GAS: 'Gas',
  RENT_AND_UTILITIES_RENT: 'Rent / Mortgage',
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'Utilities',
  RENT_AND_UTILITIES_TELEPHONE: 'Utilities',
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: 'Utilities',
  RENT_AND_UTILITIES_WATER: 'Utilities',
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE: 'Utilities',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'Rent / Mortgage',
  // Card payments and moves between your own accounts aren't spending — the
  // purchases they cover were already counted on the card.
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: TRANSFER_CATEGORY,
  TRANSFER_OUT_ACCOUNT_TRANSFER: TRANSFER_CATEGORY,
  TRANSFER_IN_ACCOUNT_TRANSFER: TRANSFER_CATEGORY,
  TRANSFER_OUT_SAVINGS: TRANSFER_CATEGORY,
  TRANSFER_IN_SAVINGS: TRANSFER_CATEGORY,
  GENERAL_SERVICES_INSURANCE: 'Insurance',
  ENTERTAINMENT_TV_AND_MOVIES: 'Subscriptions',
  ENTERTAINMENT_MUSIC_AND_AUDIO: 'Subscriptions',
  GENERAL_MERCHANDISE_CHILDREN: 'Kids',
}

const PRIMARY_CATEGORY: Record<string, string> = {
  INCOME: 'Other Income',
  TRANSFER_IN: 'Other',
  TRANSFER_OUT: 'Other',
  LOAN_PAYMENTS: 'Other',
  BANK_FEES: 'Other',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Dining Out',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Home Improvement',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Health',
  GENERAL_SERVICES: 'Other',
  GOVERNMENT_AND_NON_PROFIT: 'Other',
  TRANSPORTATION: 'Other',
  TRAVEL: 'Other',
  RENT_AND_UTILITIES: 'Utilities',
}

function fallbackCategory(tx: PlaidTransaction): string | null {
  const pfc = tx.personal_finance_category
  if (!pfc) return null
  return DETAILED_CATEGORY[pfc.detailed] ?? PRIMARY_CATEGORY[pfc.primary] ?? null
}

/** Plaid: positive is money leaving. Us: negative is money leaving. */
function toRow(tx: PlaidTransaction): PlaidTxInput {
  return {
    plaidId: tx.transaction_id,
    plaidAccountId: tx.account_id,
    date: tx.date,
    amount: -tx.amount,
    payee: tx.merchant_name?.trim() || tx.name.trim(),
    memo: tx.merchant_name && tx.merchant_name !== tx.name ? tx.name : null,
    pending: tx.pending,
    replacesPlaidId: tx.pending_transaction_id,
    fallbackCategory: fallbackCategory(tx),
  }
}

/** Our account type that best fits a Plaid account. */
export function localType(account: PlaidAccount): string {
  if (account.type === 'credit') return 'credit'
  if (account.type === 'loan') return 'credit'
  if (account.subtype === 'savings' || account.subtype === 'money market') {
    return 'savings'
  }
  if (account.type === 'investment') return 'investment'
  return 'checking'
}

/**
 * Credit balances are reported as the amount owed. We store debt as a negative
 * balance so a card behaves like every other account in the app.
 */
function localBalance(type: string, current: number | null): number | null {
  if (current == null) return null
  return type === 'credit' ? -Math.abs(current) : current
}

export type ConnectStart = {
  linkToken: string
  url: string
}

export async function startConnect(profileId: number): Promise<ConnectStart> {
  const creds = requireCreds()
  const res = await createLinkToken(creds, {
    clientUserId: `profile-${profileId}`,
    appName: APP_NAME,
  })
  if (!res.hosted_link_url) {
    throw new Error(
      'Plaid did not return a Hosted Link URL. Enable Hosted Link for this ' +
        'client ID in the Plaid dashboard, then try again.',
    )
  }
  return { linkToken: res.link_token, url: res.hosted_link_url }
}

export async function startReconnect(
  db: FinanceDb,
  itemRowId: number,
): Promise<ConnectStart> {
  const creds = requireCreds()
  const item = db.getPlaidItem(itemRowId)
  if (!item) throw new Error('That bank connection no longer exists.')
  const res = await createUpdateLinkToken(creds, {
    clientUserId: `profile-${item.profile_id}`,
    appName: APP_NAME,
    accessToken: unsealToken(item.access_token),
  })
  if (!res.hosted_link_url) {
    throw new Error('Plaid did not return a Hosted Link URL for the repair.')
  }
  return { linkToken: res.link_token, url: res.hosted_link_url }
}

export type ConnectPollResult =
  | { state: 'pending' }
  | {
      state: 'linked'
      itemRowId: number
      institutionName: string
      accounts: Array<{
        id: number
        plaidAccountId: string
        label: string
        mask: string | null
        suggestedType: string
        suggestedAccountId: number | null
        balance: number | null
      }>
    }

/**
 * Hosted Link runs in the user's browser, so there is no callback to listen
 * for — we ask Plaid whether the session finished and pick up the public token.
 */
export async function pollConnect(
  db: FinanceDb,
  profileId: number,
  linkToken: string,
): Promise<ConnectPollResult> {
  const creds = requireCreds()
  const session = await getLinkToken(creds, linkToken)
  const found = publicTokenFromSession(session)
  if (!found) return { state: 'pending' }

  const exchanged = await exchangePublicToken(creds, found.publicToken)
  const accountsRes = await getAccounts(creds, exchanged.access_token)

  let institutionName = found.institution?.name ?? null
  const institutionId =
    found.institution?.institution_id ?? accountsRes.item.institution_id ?? null
  if (!institutionName && institutionId) {
    try {
      const inst = await getInstitution(creds, institutionId)
      institutionName = inst.institution.name
    } catch {
      // A missing display name is cosmetic; keep going.
    }
  }

  const item = db.upsertPlaidItem({
    profileId,
    itemId: exchanged.item_id,
    accessToken: sealToken(exchanged.access_token),
    env: creds.env,
    institutionId,
    institutionName: institutionName ?? 'Bank',
  })

  db.upsertPlaidAccounts(
    item.id,
    accountsRes.accounts.map((a) => ({
      plaidAccountId: a.account_id,
      name: a.name,
      officialName: a.official_name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      currentBalance: a.balances.current,
      availableBalance: a.balances.available,
    })),
  )

  const existing = db.listAccounts(profileId)
  const rows = db.listPlaidAccounts(item.id)

  return {
    state: 'linked',
    itemRowId: item.id,
    institutionName: institutionName ?? 'Bank',
    accounts: rows.map((row) => {
      const plaid = accountsRes.accounts.find(
        (a) => a.account_id === row.plaid_account_id,
      )
      const type = plaid ? localType(plaid) : 'checking'
      const match = row.mask
        ? existing.find(
            (a) => a.type === type && a.name.includes(row.mask as string),
          )
        : undefined
      return {
        id: row.id,
        plaidAccountId: row.plaid_account_id,
        label: row.mask ? `${row.name} ••${row.mask}` : row.name,
        mask: row.mask,
        suggestedType: type,
        suggestedAccountId: row.account_id ?? match?.id ?? null,
        balance: localBalance(type, row.current_balance),
      }
    }),
  }
}

export type SyncResult = {
  itemRowId: number
  institutionName: string
  inserted: number
  updated: number
  deleted: number
  skipped: number
  earliest: string | null
  latest: string | null
  overlap: Array<{ account_id: number; account_name: string; count: number }>
  needsReconnect?: boolean
  /** Plaid is still assembling this bank's history — try again shortly. */
  historyPending?: boolean
  error?: string
}

/**
 * Pulls every page Plaid has for this item. The first run walks the full 24
 * months we requested at link time; later runs only see what changed.
 */
export async function syncItem(
  db: FinanceDb,
  itemRowId: number,
  opts: { awaitHistory?: boolean } = {},
): Promise<SyncResult> {
  const creds = requireCreds()
  const item = db.getPlaidItem(itemRowId)
  if (!item) throw new Error('That bank connection no longer exists.')

  const base: SyncResult = {
    itemRowId,
    institutionName: item.institution_name ?? 'Bank',
    inserted: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    earliest: null,
    latest: null,
    overlap: [],
  }

  /**
   * Access tokens belong to the environment that issued them, so a leftover
   * Sandbox link would fail with an opaque Plaid error after switching keys.
   */
  if (item.env !== creds.env) {
    return {
      ...base,
      error: `This bank was connected in ${
        item.env === 'sandbox' ? 'Sandbox' : 'Production'
      }, but your keys are now ${
        creds.env === 'sandbox' ? 'Sandbox' : 'Production'
      }. Forget it and connect again.`,
    }
  }

  /**
   * Syncing with nothing mapped would move the cursor past history we can
   * never ask for again, so refuse instead.
   */
  const linked = db
    .listPlaidAccounts(itemRowId)
    .filter((a) => a.linked && a.account_id != null)
  if (!linked.length) {
    return {
      ...base,
      error: 'Choose which accounts to import before syncing this bank.',
    }
  }

  const accessToken = unsealToken(item.access_token)
  let cursor = item.sync_cursor
  const touched = new Set<number>()

  const drainPages = async () => {
    for (let page = 0; page < 200; page += 1) {
      const res = await syncTransactions(creds, accessToken, cursor)
      const applied = db.applyPlaidChanges({
        profileId: item.profile_id,
        itemRowId,
        added: res.added.map(toRow),
        modified: res.modified.map(toRow),
        removed: res.removed.map((r) => r.transaction_id),
      })

      base.inserted += applied.inserted
      base.updated += applied.updated
      base.deleted += applied.deleted
      base.skipped += applied.skipped
      if (
        applied.earliest &&
        (!base.earliest || applied.earliest < base.earliest)
      ) {
        base.earliest = applied.earliest
      }
      if (applied.latest && (!base.latest || applied.latest > base.latest)) {
        base.latest = applied.latest
      }
      for (const id of applied.accountIds) touched.add(id)

      cursor = res.next_cursor
      // Only commit the cursor once the page is safely written.
      db.setPlaidCursor(itemRowId, cursor)
      if (!res.has_more) return
    }
  }

  /**
   * Plaid pulls history in the background after a bank is linked, and the first
   * sync usually lands before any of it is ready. Production apps get told via
   * webhook; with no server to receive one, we wait and ask again.
   */
  const firstRun = !item.sync_cursor
  const attempts = opts.awaitHistory && firstRun ? HISTORY_ATTEMPTS : 1

  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await drainPages()
      if (base.inserted > 0 || attempt === attempts - 1) break
      await delay(HISTORY_WAIT_MS)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    const needsLogin =
      err instanceof PlaidError && err.code === 'ITEM_LOGIN_REQUIRED'
    db.setPlaidStatus(
      itemRowId,
      needsLogin ? 'login_required' : 'error',
      message,
    )
    return { ...base, needsReconnect: needsLogin, error: message }
  }

  // Balances come from the bank rather than from summing our rows.
  try {
    const fresh = await getAccounts(creds, accessToken)
    db.upsertPlaidAccounts(
      itemRowId,
      fresh.accounts.map((a) => ({
        plaidAccountId: a.account_id,
        name: a.name,
        officialName: a.official_name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        currentBalance: a.balances.current,
        availableBalance: a.balances.available,
      })),
    )
    for (const row of db.listPlaidAccounts(itemRowId)) {
      if (!row.linked || row.account_id == null) continue
      const plaid = fresh.accounts.find(
        (a) => a.account_id === row.plaid_account_id,
      )
      if (!plaid) continue
      const balance = localBalance(
        localType(plaid),
        plaid.balances.current,
      )
      if (balance != null) db.setAccountBalance(row.account_id, balance)
    }
  } catch {
    // Transactions are the important part; stale balances can wait.
  }

  db.markPlaidSynced(itemRowId)

  if (base.earliest && base.latest) {
    base.overlap = db.plaidOverlap(
      item.profile_id,
      [...touched],
      base.earliest,
      base.latest,
    )
  }
  if (firstRun && base.inserted === 0) base.historyPending = true
  return base
}

export async function syncAll(
  db: FinanceDb,
  profileId: number,
): Promise<SyncResult[]> {
  const out: SyncResult[] = []
  for (const item of db.listPlaidItems(profileId)) {
    out.push(await syncItem(db, item.id))
  }
  return out
}

export async function disconnect(
  db: FinanceDb,
  itemRowId: number,
  deleteTransactions: boolean,
) {
  const item = db.getPlaidItem(itemRowId)
  if (!item) return
  try {
    await removeItem(requireCreds(), unsealToken(item.access_token))
  } catch {
    // Even if Plaid refuses, drop our local copy so the UI stays honest.
  }
  db.deletePlaidItem(itemRowId, deleteTransactions)
}

/** Creates the local accounts a link needs, then maps them one to one. */
export function finishMapping(
  db: FinanceDb,
  payload: {
    profileId: number
    itemRowId: number
    choices: Array<{
      plaidAccountRowId: number
      /** null + create=false means "don't import this account". */
      accountId: number | null
      create: boolean
      name: string
      type: string
    }>
  },
) {
  const item = db.getPlaidItem(payload.itemRowId)
  const institution = item?.institution_name ?? undefined
  const before = db.listPlaidAccounts(payload.itemRowId)
  let newlyLinked = false

  for (const choice of payload.choices) {
    let accountId = choice.accountId
    if (choice.create) {
      const row = before.find((a) => a.id === choice.plaidAccountRowId)
      const created = db.createAccount({
        profileId: payload.profileId,
        name: choice.name,
        type: choice.type,
        institution,
        balance: localBalance(choice.type, row?.current_balance ?? null) ?? 0,
      })
      accountId = created.id
    }
    const was = before.find((a) => a.id === choice.plaidAccountRowId)
    if (accountId != null && !(was?.linked && was.account_id != null)) {
      newlyLinked = true
    }
    db.mapPlaidAccount({
      plaidAccountRowId: choice.plaidAccountRowId,
      accountId,
      linked: accountId != null,
    })
  }

  /**
   * An account linked after the first sync missed everything the cursor
   * already consumed. Clearing it replays the full history — upserts keep the
   * transactions we already have from doubling up.
   */
  if (newlyLinked && item?.sync_cursor) {
    db.setPlaidCursor(payload.itemRowId, null)
  }
}