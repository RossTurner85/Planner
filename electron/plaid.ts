/**
 * Minimal Plaid REST client. Plaid authenticates with client_id + secret in
 * the request body, so there is nothing to gain from the official SDK here —
 * this keeps the dependency list short and the calls easy to read.
 */

export type PlaidEnv = 'sandbox' | 'production'

export type PlaidCreds = {
  clientId: string
  secret: string
  env: PlaidEnv
}

const HOSTS: Record<PlaidEnv, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
}

/** 24 months is Plaid's maximum and can't be raised after the Item exists. */
export const MAX_HISTORY_DAYS = 730

export class PlaidError extends Error {
  code: string
  type: string
  constructor(message: string, code: string, type: string) {
    super(message)
    this.name = 'PlaidError'
    this.code = code
    this.type = type
  }
}

async function call<T>(
  creds: PlaidCreds,
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${HOSTS[creds.env]}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      secret: creds.secret,
      ...body,
    }),
  })

  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new PlaidError(
      `Plaid returned an unreadable response (${res.status})`,
      'PARSE_ERROR',
      'API_ERROR',
    )
  }

  if (!res.ok) {
    const err = json as {
      error_message?: string
      display_message?: string
      error_code?: string
      error_type?: string
    }
    throw new PlaidError(
      err.display_message || err.error_message || `Plaid error ${res.status}`,
      err.error_code ?? 'UNKNOWN',
      err.error_type ?? 'API_ERROR',
    )
  }

  return json as T
}

export type LinkTokenCreated = {
  link_token: string
  hosted_link_url?: string
  expiration: string
}

/**
 * Hosted Link: we get a URL to open in the user's real browser, which is the
 * only reliable way to complete bank OAuth from a desktop app.
 */
export function createLinkToken(
  creds: PlaidCreds,
  opts: { clientUserId: string; appName: string; historyDays?: number },
) {
  return call<LinkTokenCreated>(creds, '/link/token/create', {
    client_name: opts.appName,
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: opts.clientUserId },
    products: ['transactions'],
    transactions: {
      days_requested: Math.min(
        MAX_HISTORY_DAYS,
        opts.historyDays ?? MAX_HISTORY_DAYS,
      ),
    },
    hosted_link: {},
  })
}

/** Update mode — re-authenticate an Item whose login broke. */
export function createUpdateLinkToken(
  creds: PlaidCreds,
  opts: { clientUserId: string; appName: string; accessToken: string },
) {
  return call<LinkTokenCreated>(creds, '/link/token/create', {
    client_name: opts.appName,
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: opts.clientUserId },
    access_token: opts.accessToken,
    hosted_link: {},
  })
}

export type LinkSessionInstitution = {
  institution_id: string | null
  name: string | null
}

export type LinkTokenGet = {
  link_sessions?: Array<{
    link_session_id: string
    finished_at?: string | null
    results?: {
      item_add_results?: Array<{
        public_token: string
        institution?: LinkSessionInstitution | null
        accounts?: Array<{ id: string; mask?: string | null }>
      }>
    }
    on_success?: { public_token?: string } | null
    on_exit?: unknown
  }>
}

export function getLinkToken(creds: PlaidCreds, linkToken: string) {
  return call<LinkTokenGet>(creds, '/link/token/get', { link_token: linkToken })
}

/**
 * Pulls the finished session's public token out of a /link/token/get response.
 * Prefers `results` because `on_success` predates multi-item sessions.
 */
export function publicTokenFromSession(res: LinkTokenGet): {
  publicToken: string
  institution: LinkSessionInstitution | null
} | null {
  for (const session of res.link_sessions ?? []) {
    const add = session.results?.item_add_results?.[0]
    if (add?.public_token) {
      return {
        publicToken: add.public_token,
        institution: add.institution ?? null,
      }
    }
    if (session.on_success?.public_token) {
      return { publicToken: session.on_success.public_token, institution: null }
    }
  }
  return null
}

export function exchangePublicToken(creds: PlaidCreds, publicToken: string) {
  return call<{ access_token: string; item_id: string }>(
    creds,
    '/item/public_token/exchange',
    { public_token: publicToken },
  )
}

export type PlaidAccount = {
  account_id: string
  name: string
  official_name: string | null
  mask: string | null
  type: string
  subtype: string | null
  balances: {
    current: number | null
    available: number | null
    limit: number | null
  }
}

export function getAccounts(creds: PlaidCreds, accessToken: string) {
  return call<{
    accounts: PlaidAccount[]
    item: { item_id: string; institution_id: string | null }
  }>(creds, '/accounts/get', { access_token: accessToken })
}

export function getInstitution(creds: PlaidCreds, institutionId: string) {
  return call<{ institution: { institution_id: string; name: string } }>(
    creds,
    '/institutions/get_by_id',
    { institution_id: institutionId, country_codes: ['US'] },
  )
}

export type PlaidTransaction = {
  transaction_id: string
  account_id: string
  /** Positive means money left the account — the opposite of our convention. */
  amount: number
  date: string
  authorized_date: string | null
  name: string
  merchant_name: string | null
  pending: boolean
  pending_transaction_id: string | null
  personal_finance_category: {
    primary: string
    detailed: string
  } | null
}

export type TransactionsSync = {
  added: PlaidTransaction[]
  modified: PlaidTransaction[]
  removed: Array<{ transaction_id: string }>
  next_cursor: string
  has_more: boolean
}

export function syncTransactions(
  creds: PlaidCreds,
  accessToken: string,
  cursor: string | null,
) {
  return call<TransactionsSync>(creds, '/transactions/sync', {
    access_token: accessToken,
    ...(cursor ? { cursor } : {}),
    count: 500,
  })
}

export function removeItem(creds: PlaidCreds, accessToken: string) {
  return call<{ request_id: string }>(creds, '/item/remove', {
    access_token: accessToken,
  })
}

/** Cheap credential check — fails fast on a bad client_id/secret pair. */
export async function verifyCreds(creds: PlaidCreds): Promise<void> {
  await call(creds, '/institutions/get', {
    count: 1,
    offset: 0,
    country_codes: ['US'],
  })
}
