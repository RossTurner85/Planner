/**
 * Background refresh for linked banks. Runs in the main process so it keeps
 * working across renderer reloads and no matter which screen is open.
 *
 * There are no webhooks in a desktop app, so this polls: once shortly after
 * launch, then on a timer. Plaid's cursor makes a no-op sync cheap, but banks
 * only post new transactions a few times a day, so the interval is measured in
 * hours rather than minutes.
 */

import type { BrowserWindow } from 'electron'
import type { FinanceDb } from './db'
import { loadCreds } from './plaidCreds'
import { syncItem, type SyncResult } from './plaidSync'

/** Don't touch a connection that was refreshed more recently than this. */
const STALE_AFTER_MIN = 4 * 60

/** How often to look for stale connections while the app is open. */
const TICK_MS = 30 * 60 * 1000

/** Long enough for the window to paint and settle before any network work. */
const LAUNCH_DELAY_MS = 8000

let timer: NodeJS.Timeout | null = null

/**
 * Syncs are serialised: two runs against the same item would race on its
 * cursor. Manual syncs queue behind whatever is in flight, while automatic
 * ones simply skip a turn.
 */
let tail: Promise<unknown> = Promise.resolve()
let pending = 0

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  pending += 1
  const run = async () => {
    try {
      return await fn()
    } finally {
      pending -= 1
    }
  }
  const next = tail.then(run, run)
  tail = next.then(
    () => {},
    () => {},
  )
  return next
}

export function syncBusy(): boolean {
  return pending > 0
}

export type AutoSyncSummary = {
  inserted: number
  updated: number
  deleted: number
  banks: string[]
}

/**
 * Refreshes every connection that has gone stale. Returns null when there was
 * nothing to do, so callers can stay quiet instead of reporting a no-op.
 */
async function refreshStale(db: FinanceDb): Promise<AutoSyncSummary | null> {
  const creds = loadCreds()
  if (!creds) return null

  const due = db
    .plaidItemsDueForSync(STALE_AFTER_MIN)
    // A link made under the other set of keys can't be synced with these.
    .filter((item) => item.env === creds.env)
  if (!due.length) return null

  const summary: AutoSyncSummary = {
    inserted: 0,
    updated: 0,
    deleted: 0,
    banks: [],
  }

  for (const item of due) {
    let res: SyncResult
    try {
      res = await syncItem(db, item.id)
    } catch {
      // A bank that errors out has already had its status recorded; the next
      // tick will try again, and the Banks screen shows the problem.
      continue
    }
    if (res.error) continue
    summary.inserted += res.inserted
    summary.updated += res.updated
    summary.deleted += res.deleted
    if (res.inserted || res.updated || res.deleted) {
      summary.banks.push(res.institutionName)
    }
  }

  return summary.banks.length ? summary : null
}

/** One pass, skipped entirely if a sync is already running. */
async function tick(db: FinanceDb, window: () => BrowserWindow | null) {
  if (syncBusy()) return
  const summary = await runExclusive(() => refreshStale(db))
  if (!summary) return
  // Only tell the renderer when something actually changed, so the UI doesn't
  // reload itself for nothing.
  window()?.webContents.send('plaid:autoSynced', summary)
}

export function startAutoSync(
  db: FinanceDb,
  window: () => BrowserWindow | null,
) {
  stopAutoSync()
  setTimeout(() => void tick(db, window), LAUNCH_DELAY_MS)
  timer = setInterval(() => void tick(db, window), TICK_MS)
}

export function stopAutoSync() {
  if (timer) clearInterval(timer)
  timer = null
}
