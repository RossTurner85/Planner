import Database from 'better-sqlite3'
import { applyManualBillPayments, matchBillsForPeriod, type BillStatus } from './bills'
import {
  applyCategoryRules,
  isTransferRuleText,
  looksLikeTransfer,
  TRANSFER_CATEGORY,
} from './rules'
import { cleanPayee } from './payee'

const CATEGORY_TIDY_FLAG = 'categories_tidied_v1'
const REFILE_FLAG = 'refiled_uncategorized_v1'
const LINK_IMPORTS_FLAG = 'linked_legacy_statement_imports_v1'
const TRANSFERS_FLAG = 'payments_transfers_category_v1'
/** Bump the version to re-run the sweep after changing the transfer patterns. */
const TRANSFERS_SWEEP_FLAG = 'payments_transfers_sweep_v3'
const ZELLE_REGROUP_FLAG = 'zelle_regrouped_by_person_v1'
const GOAL_RANK_FLAG = 'goal_priority_backfill_v1'
const PROFILE_ROLE_FLAG = 'profile_roles_v1'

const MOTIVATION_RAW = 'motivation_raw'
const MOTIVATION_LINE = 'motivation_line'

/** [name, group, kind, emoji] — the list every profile starts with. */
const DEFAULT_CATEGORIES: Array<[string, string, string, string]> = [
  ['Other Income', 'Income', 'income', '➕'],
  ['Rent / Mortgage', 'Housing', 'expense', '🏠'],
  ['Utilities', 'Housing', 'expense', '💡'],
  ['Home Improvement', 'Housing', 'expense', '🛠️'],
  ['Groceries', 'Everyday', 'expense', '🛒'],
  ['Dining Out', 'Everyday', 'expense', '🍽️'],
  ['Gas', 'Everyday', 'expense', '⛽'],
  ['Shopping', 'Everyday', 'expense', '🛍️'],
  ['Subscriptions', 'Lifestyle', 'expense', '🔁'],
  ['Entertainment', 'Lifestyle', 'expense', '🎬'],
  ['Health', 'Lifestyle', 'expense', '❤️'],
  ['Kids', 'Lifestyle', 'expense', '🧸'],
  ['Insurance', 'Bills', 'expense', '🛡️'],
  ['Other', 'Other', 'expense', '🗂️'],
  [TRANSFER_CATEGORY, 'Transfers', 'transfer', '🔄'],
]

/** [name, categoryToAbsorbItsHistory] — null means those rows go uncategorized. */
const RETIRED_CATEGORIES: Array<[string, string | null]> = [
  ['Paycheck', 'Other Income'],
  ['Internet / Phone', 'Utilities'],
  ['Savings Contribution', 'Other'],
  ['Credit Card Payment', null],
  ['Transfer', null],
  ['Uncategorized', null],
]

function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthEndDate(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

function shortMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', {
    month: 'short',
    year: '2-digit',
  })
}

function rangeLabel(range: string, start: string, end: string): string {
  if (range === 'mom' || start === end) return shortMonthLabel(end)
  return `${shortMonthLabel(start)} – ${shortMonthLabel(end)}`
}

function pctChange(prev: number, curr: number): number | null {
  if (prev === 0 && curr === 0) return 0
  if (prev === 0) return curr > 0 ? 100 : curr < 0 ? -100 : 0
  return ((curr - prev) / Math.abs(prev)) * 100
}

/** Keeps summed floats from reaching the model as 41.870000000000005. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type ProfileRole = 'adult' | 'dependent'

export type Profile = {
  id: number
  name: string
  color: string
  created_at: string
  /** Adults own money; dependents are managed from a parent's profile. */
  role: ProfileRole
}

/** One profile or several — household reports pass every id. */
export type ProfileScope = number | number[]

function scopeIds(scope: ProfileScope): number[] {
  const raw = Array.isArray(scope) ? scope : [scope]
  return [...new Set(raw.filter((id) => Number.isInteger(id) && id > 0))]
}

/** `alias` is '' or 't.' so this drops into an existing WHERE. */
function profileWhere(
  alias: string,
  scope: ProfileScope,
): { sql: string; params: number[] } {
  const ids = scopeIds(scope)
  if (ids.length === 0) return { sql: '1=0', params: [] }
  if (ids.length === 1) return { sql: `${alias}profile_id = ?`, params: ids }
  return {
    sql: `${alias}profile_id IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  }
}

export type Account = {
  id: number
  profile_id: number
  name: string
  type: string
  institution: string | null
  balance: number
  /** Day of the month a card statement is due (1–31), when it's worth tracking */
  due_day: number | null
  created_at: string
}

export type Category = {
  id: number
  profile_id: number
  name: string
  group_name: string
  kind: string
  emoji: string | null
}

export type Transaction = {
  id: number
  profile_id: number
  account_id: number
  date: string
  amount: number
  payee: string
  memo: string | null
  category_id: number | null
  is_transfer: number
  transfer_account_id: number | null
  import_hash: string | null
  /** Who the purchase was for, when it's worth tracking */
  person_id: number | null
  category_name?: string | null
  account_name?: string
  person_name?: string | null
  /** Cleaned merchant label for display / grouping */
  payee_display?: string
  /** Stable key for collapsing same-merchant rows */
  merchant_key?: string
}

export type Goal = {
  id: number
  profile_id: number
  name: string
  target_amount: number
  current_amount: number
  target_date: string | null
  color: string | null
  status: string
  /** 1 is the goal the user cares about most; the home page shows that one. */
  priority: number
}

export type PlaidItemRow = {
  id: number
  profile_id: number
  item_id: string
  access_token: string
  env: string
  institution_id: string | null
  institution_name: string | null
  sync_cursor: string | null
  status: string
  last_error: string | null
  last_synced_at: string | null
  created_at: string
}

export type PlaidAccountRow = {
  id: number
  item_row_id: number
  plaid_account_id: string
  account_id: number | null
  name: string
  official_name: string | null
  mask: string | null
  type: string | null
  subtype: string | null
  current_balance: number | null
  available_balance: number | null
  linked: number
}

export type Person = {
  id: number
  profile_id: number
  name: string
  created_at: string
}

export class FinanceDb {
  private db: Database.Database

  constructor(filePath: string) {
    this.db = new Database(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#2F6F5E',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        institution TEXT,
        balance REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'expense',
        emoji TEXT
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        payee TEXT NOT NULL,
        memo TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        is_transfer INTEGER NOT NULL DEFAULT 0,
        transfer_account_id INTEGER,
        import_hash TEXT,
        statement_import_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_import_hash
        ON transactions(profile_id, account_id, import_hash)
        WHERE import_hash IS NOT NULL;

      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        UNIQUE(profile_id, category_id, month)
      );

      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        target_amount REAL NOT NULL,
        current_amount REAL NOT NULL DEFAULT 0,
        target_date TEXT,
        color TEXT DEFAULT '#2F6F5E',
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        due_day INTEGER NOT NULL,
        account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        payee_hint TEXT,
        frequency TEXT NOT NULL DEFAULT 'monthly',
        active INTEGER NOT NULL DEFAULT 1,
        autopay INTEGER NOT NULL DEFAULT 0,
        autopay_day INTEGER
      );

      CREATE TABLE IF NOT EXISTS category_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        match_text TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bill_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        extracted_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS statement_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        imported_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        money_in REAL NOT NULL DEFAULT 0,
        money_out REAL NOT NULL DEFAULT 0,
        date_from TEXT,
        date_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS bill_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        paid_on TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(bill_id, month)
      );
    `)

    // Migrations for existing installs
    this.ensureColumn('bills', 'autopay', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('bills', 'autopay_day', 'INTEGER')
    this.ensureColumn('bills', 'principal', 'REAL')
    this.ensureColumn('bills', 'interest', 'REAL')
    this.ensureColumn('bills', 'escrow', 'REAL')
    this.ensureColumn('bills', 'is_mortgage', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('bills', 'minimum_payment', 'REAL')
    this.ensureColumn('bills', 'statement_balance', 'REAL')
    this.ensureColumn('transactions', 'statement_import_id', 'INTEGER')
    this.ensureColumn('bills', 'next_due_date', 'TEXT')
    this.ensureColumn('transactions', 'person_id', 'INTEGER')
    this.ensureColumn('accounts', 'due_day', 'INTEGER')
    this.ensureColumn('goals', 'priority', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('profiles', 'role', "TEXT NOT NULL DEFAULT 'adult'")

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(profile_id, name)
      );

      CREATE TABLE IF NOT EXISTS plaid_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        env TEXT NOT NULL DEFAULT 'sandbox',
        institution_id TEXT,
        institution_name TEXT,
        sync_cursor TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        last_error TEXT,
        last_synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS plaid_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_row_id INTEGER NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
        plaid_account_id TEXT NOT NULL UNIQUE,
        account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        official_name TEXT,
        mask TEXT,
        type TEXT,
        subtype TEXT,
        current_balance REAL,
        available_balance REAL,
        linked INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS profile_settings (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (profile_id, key)
      );
    `)

    this.ensureColumn('transactions', 'plaid_transaction_id', 'TEXT')
    this.ensureColumn('transactions', 'pending', 'INTEGER NOT NULL DEFAULT 0')
    // SQLite counts NULLs as distinct, so a plain unique index is safe here —
    // and unlike a partial index it can be an upsert conflict target.
    this.db.exec(`
      DROP INDEX IF EXISTS idx_tx_plaid_id;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_plaid_id_v2
        ON transactions(plaid_transaction_id);
    `)

    // Always safe for installs that already had a full schema before this table existed
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bill_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        paid_on TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(bill_id, month)
      );
    `)

    this.tidyCategories()
    this.refileUncategorized()
    this.linkLegacyStatementImports()
    this.adoptTransferCategory()
    this.sweepRemainingTransfers()
    this.retireCollapsedPayeeRules()
    this.backfillGoalPriority()
    this.assignProfileRoles()
  }

  /**
   * Goals used to be listed newest-first with no notion of rank. Seed the new
   * column from creation order so an existing list keeps a stable, sensible
   * shape until the user drags anything around.
   */
  private backfillGoalPriority() {
    if (this.metaFlag(GOAL_RANK_FLAG)) return

    const profiles = this.db
      .prepare('SELECT id FROM profiles')
      .all() as Array<{ id: number }>

    const setRank = this.db.prepare('UPDATE goals SET priority = ? WHERE id = ?')

    const run = this.db.transaction(() => {
      for (const p of profiles) {
        const rows = this.db
          .prepare('SELECT id FROM goals WHERE profile_id = ? ORDER BY id ASC')
          .all(p.id) as Array<{ id: number }>
        rows.forEach((row, i) => setRank.run(i + 1, row.id))
      }
      this.setMetaFlag(GOAL_RANK_FLAG)
    })
    run()
  }

  /**
   * Kids keep their own ledgers, but they're dependents of the household —
   * either adult can open them. Ross and Nicole stay adults. Names only used
   * once, to label the existing five; after that the column is the source of
   * truth.
   */
  private assignProfileRoles() {
    if (this.metaFlag(PROFILE_ROLE_FLAG)) return
    const count = this.db
      .prepare('SELECT COUNT(*) AS c FROM profiles')
      .get() as { c: number }
    if (count.c === 0) return
    this.db
      .prepare(
        `UPDATE profiles SET role = 'dependent'
         WHERE lower(name) IN ('zac', 'zoey', 'lux')`,
      )
      .run()
    this.setMetaFlag(PROFILE_ROLE_FLAG)
  }

  /**
   * Zelle payments used to share one merchant name, so a single categorization
   * saved a rule that captured every recipient. Now that each counterparty is
   * its own merchant those rules can never match again — drop them so they
   * don't reappear as phantom entries.
   */
  private retireCollapsedPayeeRules() {
    if (this.metaFlag(ZELLE_REGROUP_FLAG)) return

    const stale = [
      'zelle payment sent',
      'zelle received',
      'zelle payment to',
      'zelle payment from',
    ]

    const run = this.db.transaction(() => {
      for (const text of stale) {
        this.db
          .prepare(
            'DELETE FROM category_rules WHERE lower(trim(match_text)) = ?',
          )
          .run(text)
      }
      this.setMetaFlag(ZELLE_REGROUP_FLAG)
    })
    run()
  }

  /**
   * Second pass, for the stragglers the first one skipped: rows that a saved
   * rule had already filed as income or spending, most of which were the
   * incoming half of a transfer whose outgoing half was excluded. Counting one
   * side and not the other is worse than counting neither, so this sweep
   * ignores the current category and repoints the rules that caused it.
   */
  private sweepRemainingTransfers() {
    if (this.metaFlag(TRANSFERS_SWEEP_FLAG)) return

    const profiles = this.db
      .prepare('SELECT id FROM profiles')
      .all() as Array<{ id: number }>

    const move = this.db.prepare(
      `UPDATE transactions SET category_id = ?, is_transfer = 1 WHERE id = ?`,
    )

    const run = this.db.transaction(() => {
      for (const p of profiles) {
        const transferId = this.ensureTransferCategory(p.id)

        const rows = this.db
          .prepare(
            `SELECT id, payee, memo FROM transactions
             WHERE profile_id = ? AND is_transfer = 0`,
          )
          .all(p.id) as Array<{
          id: number
          payee: string
          memo: string | null
        }>

        for (const row of rows) {
          if (looksLikeTransfer(row.payee, row.memo)) {
            move.run(transferId, row.id)
          }
        }

        const rules = this.db
          .prepare(
            `SELECT id, match_text FROM category_rules WHERE profile_id = ?`,
          )
          .all(p.id) as Array<{ id: number; match_text: string }>

        for (const rule of rules) {
          if (!rule.match_text || !isTransferRuleText(rule.match_text)) continue
          this.db
            .prepare('UPDATE category_rules SET category_id = ? WHERE id = ?')
            .run(transferId, rule.id)
        }
      }
      this.setMetaFlag(TRANSFERS_SWEEP_FLAG)
    })
    run()
  }

  /**
   * Adds the payments/transfers category and files existing card payments into
   * it. Only rows that were never deliberately sorted are touched — still
   * uncategorized, or parked in Other by the earlier category cleanup — so
   * nothing the user filed by hand moves out from under them.
   */
  private adoptTransferCategory() {
    if (this.metaFlag(TRANSFERS_FLAG)) return

    const profiles = this.db
      .prepare('SELECT id FROM profiles')
      .all() as Array<{ id: number }>

    const move = this.db.prepare(
      `UPDATE transactions SET category_id = ?, is_transfer = 1 WHERE id = ?`,
    )

    const run = this.db.transaction(() => {
      for (const p of profiles) {
        const transferId = this.ensureTransferCategory(p.id)

        const loose = this.db
          .prepare(
            `SELECT t.id, t.payee, t.memo FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.profile_id = ?
               AND (t.category_id IS NULL
                    OR c.name IN ('Other', 'Uncategorized'))`,
          )
          .all(p.id) as Array<{
          id: number
          payee: string
          memo: string | null
        }>

        for (const row of loose) {
          if (looksLikeTransfer(row.payee, row.memo)) {
            move.run(transferId, row.id)
          }
        }

        this.db
          .prepare(
            `UPDATE transactions SET is_transfer = 1
             WHERE profile_id = ? AND category_id IN (
               SELECT id FROM categories
               WHERE profile_id = ? AND kind = 'transfer'
             )`,
          )
          .run(p.id, p.id)
      }
      this.setMetaFlag(TRANSFERS_FLAG)
    })
    run()
  }

  /** The transfers category, created on demand for profiles that predate it. */
  private ensureTransferCategory(profileId: number): number {
    const found = this.db
      .prepare(
        `SELECT id FROM categories
         WHERE profile_id = ? AND lower(name) = lower(?)`,
      )
      .get(profileId, TRANSFER_CATEGORY) as { id: number } | undefined

    if (found) {
      // A hand-made category with this name would be an expense; correct it so
      // the exclusion actually applies.
      this.db
        .prepare(
          `UPDATE categories SET kind = 'transfer', group_name = 'Transfers'
           WHERE id = ?`,
        )
        .run(found.id)
      return found.id
    }

    const info = this.db
      .prepare(
        `INSERT INTO categories (profile_id, name, group_name, kind, emoji)
         VALUES (?, ?, 'Transfers', 'transfer', '🔄')`,
      )
      .run(profileId, TRANSFER_CATEGORY)
    return Number(info.lastInsertRowid)
  }

  /**
   * Statements imported before transactions carried a statement_import_id are
   * orphaned from their import record, so "delete import and undo" silently
   * removes nothing. Where an import's row count exactly matches the unlinked
   * transactions in its account and date range, the pairing is unambiguous and
   * we can restore the link. Anything less certain is left alone.
   */
  private linkLegacyStatementImports() {
    if (this.metaFlag(LINK_IMPORTS_FLAG)) return

    const imports = this.db
      .prepare(
        `SELECT id, account_id, imported_count, date_from, date_to
         FROM statement_imports
         WHERE imported_count > 0
           AND date_from IS NOT NULL AND date_to IS NOT NULL`,
      )
      .all() as Array<{
      id: number
      account_id: number
      imported_count: number
      date_from: string
      date_to: string
    }>

    const countUnlinked = this.db.prepare(
      `SELECT COUNT(*) AS c FROM transactions
       WHERE account_id = ? AND statement_import_id IS NULL
         AND plaid_transaction_id IS NULL
         AND date >= ? AND date <= ?`,
    )
    const link = this.db.prepare(
      `UPDATE transactions SET statement_import_id = ?
       WHERE account_id = ? AND statement_import_id IS NULL
         AND plaid_transaction_id IS NULL
         AND date >= ? AND date <= ?`,
    )

    const run = this.db.transaction(() => {
      for (const imp of imports) {
        const found = countUnlinked.get(
          imp.account_id,
          imp.date_from,
          imp.date_to,
        ) as { c: number }
        if (found.c !== imp.imported_count) continue
        link.run(imp.id, imp.account_id, imp.date_from, imp.date_to)
      }
      this.setMetaFlag(LINK_IMPORTS_FLAG)
    })
    run()
  }

  private metaFlag(key: string): boolean {
    const row = this.db
      .prepare('SELECT value FROM app_meta WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value === '1'
  }

  private setMetaFlag(key: string) {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'`,
      )
      .run(key)
  }

  /**
   * 1 when a category is the transfer kind. Every total in the app filters on
   * is_transfer, so writing this alongside category_id is what makes the
   * exclusion hold no matter how a row got its category.
   */
  private transferFlag(categoryId: number | null | undefined): number {
    if (categoryId == null) return 0
    const row = this.db
      .prepare('SELECT kind FROM categories WHERE id = ?')
      .get(categoryId) as { kind: string } | undefined
    return row?.kind === 'transfer' ? 1 : 0
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string
    }>
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  seedIfEmpty() {
    const count = this.db.prepare('SELECT COUNT(*) AS c FROM profiles').get() as {
      c: number
    }
    if (count.c > 0) return

    const insertProfile = this.db.prepare(
      'INSERT INTO profiles (name, color, role) VALUES (?, ?, ?)',
    )
    const insertAccount = this.db.prepare(
      `INSERT INTO accounts (profile_id, name, type, institution, balance)
       VALUES (?, ?, ?, ?, ?)`,
    )

    const seed = this.db.transaction(() => {
      const people: Array<{
        name: string
        color: string
        role: ProfileRole
        accounts: Array<[string, string, string, number]>
      }> = [
        {
          name: 'Ross',
          color: '#2F6F5E',
          role: 'adult',
          accounts: [
            ['Checking · Main', 'checking', 'Bank', 0],
            ['Checking · Side', 'checking', 'Bank', 0],
            ['Savings', 'savings', 'Bank', 0],
            ['Credit Card · 1', 'credit', 'Card', 0],
            ['Credit Card · 2', 'credit', 'Card', 0],
            ['Credit Card · 3', 'credit', 'Card', 0],
          ],
        },
        {
          name: 'Nicole',
          color: '#C45C26',
          role: 'adult',
          accounts: [
            ['Checking', 'checking', 'Bank', 0],
            ['Savings', 'savings', 'Bank', 0],
            ['Credit Card · 1', 'credit', 'Card', 0],
            ['Credit Card · 2', 'credit', 'Card', 0],
          ],
        },
        {
          name: 'Zac',
          color: '#3B6FA0',
          role: 'dependent',
          accounts: [['Account', 'checking', 'Bank', 0]],
        },
        {
          name: 'Zoey',
          color: '#8B5E9A',
          role: 'dependent',
          accounts: [['Account', 'checking', 'Bank', 0]],
        },
        {
          name: 'Lux',
          color: '#B08D2E',
          role: 'dependent',
          accounts: [['Account', 'checking', 'Bank', 0]],
        },
      ]

      for (const person of people) {
        const info = insertProfile.run(person.name, person.color, person.role)
        const profileId = Number(info.lastInsertRowid)
        this.seedCategories(profileId)
        for (const [name, type, institution, balance] of person.accounts) {
          insertAccount.run(profileId, name, type, institution, balance)
        }
      }
    })
    seed()
    this.assignProfileRoles()
  }

  private seedCategories(profileId: number) {
    const insert = this.db.prepare(
      `INSERT INTO categories (profile_id, name, group_name, kind, emoji)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const [name, group, kind, emoji] of DEFAULT_CATEGORIES) {
      insert.run(profileId, name, group, kind, emoji)
    }

    const rules = this.db.prepare(
      `INSERT INTO category_rules (profile_id, match_text, category_id) VALUES (?, ?, ?)`,
    )
    const ruleSpecs: Array<[string, string]> = [
      ['shell', 'Gas'],
      ['chevron', 'Gas'],
      ['starbucks', 'Dining Out'],
      ['mcdonald', 'Dining Out'],
      ['doordash', 'Dining Out'],
      ['uber eats', 'Dining Out'],
      ['netflix', 'Subscriptions'],
      ['spotify', 'Subscriptions'],
      ['amazon prime', 'Subscriptions'],
      ['walmart', 'Groceries'],
      ['costco', 'Groceries'],
      ['kroger', 'Groceries'],
      ['whole foods', 'Groceries'],
      ['paypal', 'Shopping'],
      ['amazon', 'Shopping'],
    ]

    for (const [match, catName] of ruleSpecs) {
      const cat = this.db
        .prepare(
          `SELECT id FROM categories WHERE profile_id = ? AND name = ?`,
        )
        .get(profileId, catName) as { id: number } | undefined
      if (cat) rules.run(profileId, match, cat.id)
    }
  }

  /**
   * Retires the categories we no longer offer, folding their history into a
   * replacement where one makes sense. Runs once per install — after that the
   * user is free to create categories with these names again.
   */
  private tidyCategories() {
    if (this.metaFlag(CATEGORY_TIDY_FLAG)) return

    const profiles = this.db
      .prepare('SELECT id FROM profiles')
      .all() as Array<{ id: number }>

    const run = this.db.transaction(() => {
      for (const p of profiles) this.tidyProfileCategories(p.id)
      this.setMetaFlag(CATEGORY_TIDY_FLAG)
    })
    run()
  }

  /**
   * Re-runs the merchant rules over anything still uncategorized, so the
   * retired transfer categories don't leave card payments stranded. Once only —
   * afterwards this is the Transactions page's job.
   */
  private refileUncategorized() {
    if (this.metaFlag(REFILE_FLAG)) return
    const profiles = this.db
      .prepare('SELECT id FROM profiles')
      .all() as Array<{ id: number }>
    for (const p of profiles) this.recategorizeUncategorized(p.id)
    this.setMetaFlag(REFILE_FLAG)
  }

  private tidyProfileCategories(profileId: number) {
    const find = (name: string) =>
      (this.db
        .prepare(
          `SELECT id FROM categories
           WHERE profile_id = ? AND lower(name) = lower(?)`,
        )
        .get(profileId, name) as { id: number } | undefined) ?? null

    // Gas / Transit becomes plain Gas, keeping every transaction attached.
    const gas = find('Gas / Transit')
    if (gas && !find('Gas')) {
      this.db
        .prepare(`UPDATE categories SET name = 'Gas' WHERE id = ?`)
        .run(gas.id)
    }

    const insert = this.db.prepare(
      `INSERT INTO categories (profile_id, name, group_name, kind, emoji)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const [name, group, kind, emoji] of DEFAULT_CATEGORIES) {
      if (!find(name)) insert.run(profileId, name, group, kind, emoji)
    }

    for (const [name, mergeInto] of RETIRED_CATEGORIES) {
      const cat = find(name)
      if (!cat) continue
      const target = mergeInto ? find(mergeInto) : null

      if (target) {
        this.db
          .prepare(
            `UPDATE transactions SET category_id = ?
             WHERE profile_id = ? AND category_id = ?`,
          )
          .run(target.id, profileId, cat.id)
        this.db
          .prepare(`UPDATE bills SET category_id = ? WHERE category_id = ?`)
          .run(target.id, cat.id)
        // Budgets and rules are unique per category, so drop rather than move.
        this.db
          .prepare(`DELETE FROM budgets WHERE category_id = ?`)
          .run(cat.id)
      }

      this.db
        .prepare(`DELETE FROM category_rules WHERE category_id = ?`)
        .run(cat.id)
      this.db.prepare(`DELETE FROM categories WHERE id = ?`).run(cat.id)
    }
  }

  listProfiles(): Profile[] {
    return this.db
      .prepare('SELECT * FROM profiles ORDER BY id ASC')
      .all() as Profile[]
  }

  createProfile(name: string, color: string, role: ProfileRole = 'adult'): Profile {
    const info = this.db
      .prepare('INSERT INTO profiles (name, color, role) VALUES (?, ?, ?)')
      .run(name, color, role)
    const id = Number(info.lastInsertRowid)
    this.seedCategories(id)
    return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Profile
  }

  updateProfile(id: number, name: string, color: string): Profile {
    this.db
      .prepare('UPDATE profiles SET name = ?, color = ? WHERE id = ?')
      .run(name, color, id)
    return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Profile
  }

  listAccounts(profileId: number): Account[] {
    return this.db
      .prepare(
        'SELECT * FROM accounts WHERE profile_id = ? ORDER BY type, name',
      )
      .all(profileId) as Account[]
  }

  listHouseholdAccounts(): Array<
    Account & { owner_name: string; owner_color: string; owner_role: string }
  > {
    return this.db
      .prepare(
        `SELECT a.*, p.name AS owner_name, p.color AS owner_color, p.role AS owner_role
         FROM accounts a
         JOIN profiles p ON p.id = a.profile_id
         ORDER BY CASE p.role WHEN 'adult' THEN 0 ELSE 1 END, p.id, a.type, a.name`,
      )
      .all() as Array<
      Account & { owner_name: string; owner_color: string; owner_role: string }
    >
  }

  createAccount(payload: {
    profileId: number
    name: string
    type: string
    institution?: string
    balance: number
    dueDay?: number | null
  }): Account {
    const info = this.db
      .prepare(
        `INSERT INTO accounts (profile_id, name, type, institution, balance, due_day)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.profileId,
        payload.name,
        payload.type,
        payload.institution ?? null,
        payload.balance,
        payload.dueDay ?? null,
      )
    return this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Account
  }

  updateAccount(
    id: number,
    payload: {
      name: string
      type: string
      institution?: string
      balance: number
      dueDay?: number | null
    },
  ): Account {
    this.db
      .prepare(
        `UPDATE accounts SET name = ?, type = ?, institution = ?, balance = ?,
                due_day = ?
         WHERE id = ?`,
      )
      .run(
        payload.name,
        payload.type,
        payload.institution ?? null,
        payload.balance,
        payload.dueDay ?? null,
        id,
      )
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account
  }

  deleteAccount(id: number) {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  }

  listCategories(profileId: number): Category[] {
    return this.db
      .prepare(
        `SELECT * FROM categories WHERE profile_id = ?
         ORDER BY group_name, name`,
      )
      .all(profileId) as Category[]
  }

  createCategory(payload: {
    profileId: number
    name: string
    groupName: string
    kind: string
    emoji?: string
  }): Category {
    const info = this.db
      .prepare(
        `INSERT INTO categories (profile_id, name, group_name, kind, emoji)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        payload.profileId,
        payload.name,
        payload.groupName,
        payload.kind,
        payload.emoji ?? null,
      )
    return this.db
      .prepare('SELECT * FROM categories WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Category
  }

  listPeople(profileId: number): Person[] {
    return this.db
      .prepare(
        'SELECT * FROM people WHERE profile_id = ? ORDER BY name COLLATE NOCASE',
      )
      .all(profileId) as Person[]
  }

  /** Idempotent — an existing name is returned instead of erroring. */
  createPerson(profileId: number, name: string): Person {
    const clean = name.trim()
    const existing = this.db
      .prepare(
        `SELECT * FROM people
         WHERE profile_id = ? AND lower(name) = lower(?)`,
      )
      .get(profileId, clean) as Person | undefined
    if (existing) return existing

    const info = this.db
      .prepare('INSERT INTO people (profile_id, name) VALUES (?, ?)')
      .run(profileId, clean)
    return this.db
      .prepare('SELECT * FROM people WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Person
  }

  renamePerson(id: number, name: string): Person {
    this.db
      .prepare('UPDATE people SET name = ? WHERE id = ?')
      .run(name.trim(), id)
    return this.db
      .prepare('SELECT * FROM people WHERE id = ?')
      .get(id) as Person
  }

  deletePerson(id: number) {
    const run = this.db.transaction(() => {
      this.db
        .prepare('UPDATE transactions SET person_id = NULL WHERE person_id = ?')
        .run(id)
      this.db.prepare('DELETE FROM people WHERE id = ?').run(id)
    })
    run()
  }

  assignPerson(payload: {
    ids: number[]
    personId: number | null
  }): { updated: number } {
    if (payload.ids.length === 0) return { updated: 0 }
    const stmt = this.db.prepare(
      'UPDATE transactions SET person_id = ? WHERE id = ?',
    )
    let updated = 0
    const run = this.db.transaction(() => {
      for (const id of payload.ids) {
        stmt.run(payload.personId, id)
        updated += 1
      }
    })
    run()
    return { updated }
  }

  listTransactions(
    profileId: number,
    filters?: {
      accountId?: number
      categoryId?: number
      search?: string
      from?: string
      to?: string
      limit?: number
    },
  ): Transaction[] {
    const where = ['t.profile_id = ?']
    const params: unknown[] = [profileId]
    if (filters?.accountId) {
      where.push('t.account_id = ?')
      params.push(filters.accountId)
    }
    if (filters?.categoryId) {
      where.push('t.category_id = ?')
      params.push(filters.categoryId)
    }
    if (filters?.from) {
      where.push('t.date >= ?')
      params.push(filters.from)
    }
    if (filters?.to) {
      where.push('t.date <= ?')
      params.push(filters.to)
    }
    if (filters?.search) {
      where.push('(t.payee LIKE ? OR IFNULL(t.memo, "") LIKE ?)')
      const q = `%${filters.search}%`
      params.push(q, q)
    }
    params.push(filters?.limit ?? 500)

    const rows = this.db
      .prepare(
        `SELECT t.*, c.name AS category_name, a.name AS account_name,
                pe.name AS person_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN people pe ON pe.id = t.person_id
         JOIN accounts a ON a.id = t.account_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.date DESC, t.id DESC
         LIMIT ?`,
      )
      .all(...params) as Transaction[]

    return rows.map((t) => {
      const clean = cleanPayee(t.payee, t.memo)
      return {
        ...t,
        payee_display: clean.display,
        merchant_key: clean.key,
      }
    })
  }

  /** How far back the data goes — cheap enough to run on every AI request. */
  aiDataSpan(profileId: number) {
    const row = this.db
      .prepare(
        `SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS n
         FROM transactions WHERE profile_id = ?`,
      )
      .get(profileId) as { first: string | null; last: string | null; n: number }
    return { firstDate: row.first, lastDate: row.last, count: row.n }
  }

  /**
   * The single query behind every AI data tool: filter, then roll the survivors
   * up into totals, merchants, and months. Text matching runs in JS rather than
   * SQL so a search can hit the cleaned merchant name ("Apple Cash to bank")
   * and not just the raw bank description — with two years of data on a local
   * disk, scanning is cheaper than the alternative is accurate.
   */
  aiTransactionQuery(
    profileId: number,
    f: {
      text?: string | null
      from?: string | null
      to?: string | null
      category?: string | null
      account?: string | null
      person?: string | null
      minAmount?: number | null
      maxAmount?: number | null
      direction?: 'spending' | 'income' | 'all' | null
      onlyUncategorized?: boolean | null
      includeTransfers?: boolean | null
      rowLimit?: number | null
    },
  ) {
    const unresolved: string[] = []

    const resolveOne = <T extends { id: number; name: string }>(
      list: T[],
      wanted: string,
      kind: string,
    ): T | null => {
      const want = wanted.trim().toLowerCase()
      const hit =
        list.find((x) => x.name.toLowerCase() === want) ??
        list.find((x) => x.name.toLowerCase().includes(want))
      if (!hit) unresolved.push(`${kind} "${wanted}"`)
      return hit ?? null
    }

    const where = ['t.profile_id = ?']
    const params: unknown[] = [profileId]

    if (f.from) {
      where.push('t.date >= ?')
      params.push(f.from)
    }
    if (f.to) {
      where.push('t.date <= ?')
      params.push(f.to)
    }
    if (f.category) {
      const cat = resolveOne(this.listCategories(profileId), f.category, 'category')
      if (cat) {
        where.push('t.category_id = ?')
        params.push(cat.id)
      }
    }
    if (f.account) {
      const acct = resolveOne(this.listAccounts(profileId), f.account, 'account')
      if (acct) {
        where.push('t.account_id = ?')
        params.push(acct.id)
      }
    }
    if (f.person) {
      const person = resolveOne(this.listPeople(profileId), f.person, 'person')
      if (person) {
        where.push('t.person_id = ?')
        params.push(person.id)
      }
    }
    if (f.onlyUncategorized) where.push('t.category_id IS NULL')
    // Transfers are money moving between his own accounts, so they stay out of
    // every total unless the question is actually about them.
    if (!f.includeTransfers) where.push('t.is_transfer = 0')
    if (f.direction === 'spending') where.push('t.amount < 0')
    if (f.direction === 'income') where.push('t.amount > 0')

    const raw = this.db
      .prepare(
        `SELECT t.id, t.date, t.payee, t.memo, t.amount, t.is_transfer,
                COALESCE(c.name, 'Uncategorized') AS category,
                a.name AS account,
                pe.name AS person
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN people pe ON pe.id = t.person_id
         JOIN accounts a ON a.id = t.account_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.date DESC, t.id DESC
         LIMIT 20000`,
      )
      .all(...params) as Array<{
      id: number
      date: string
      payee: string
      memo: string | null
      amount: number
      is_transfer: number
      category: string
      account: string
      person: string | null
    }>

    const needle = f.text?.trim().toLowerCase() ?? ''
    const min = f.minAmount ?? null
    const max = f.maxAmount ?? null

    const matches = raw
      .map((r) => ({ ...r, merchant: cleanPayee(r.payee, r.memo).display }))
      .filter((r) => {
        if (needle) {
          const haystack =
            `${r.payee} ${r.memo ?? ''} ${r.merchant}`.toLowerCase()
          if (!haystack.includes(needle)) return false
        }
        const size = Math.abs(r.amount)
        if (min !== null && size < min) return false
        if (max !== null && size > max) return false
        return true
      })

    let spentTotal = 0
    let incomeTotal = 0
    const merchants = new Map<string, { total: number; count: number }>()
    const months = new Map<string, { spent: number; income: number }>()

    for (const r of matches) {
      if (r.amount < 0) spentTotal += -r.amount
      else incomeTotal += r.amount

      const m = merchants.get(r.merchant) ?? { total: 0, count: 0 }
      m.total += Math.abs(r.amount)
      m.count += 1
      merchants.set(r.merchant, m)

      const key = r.date.slice(0, 7)
      const mo = months.get(key) ?? { spent: 0, income: 0 }
      if (r.amount < 0) mo.spent += -r.amount
      else mo.income += r.amount
      months.set(key, mo)
    }

    const dates = matches.map((r) => r.date).sort()
    const rowLimit = Math.min(Math.max(f.rowLimit ?? 25, 0), 200)

    return {
      matched: matches.length,
      spentTotal: round2(spentTotal),
      incomeTotal: round2(incomeTotal),
      net: round2(incomeTotal - spentTotal),
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      unresolved,
      merchants: [...merchants.entries()]
        .map(([name, v]) => ({ name, total: round2(v.total), count: v.count }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 20),
      months: [...months.entries()]
        .map(([month, v]) => ({
          month,
          spent: round2(v.spent),
          income: round2(v.income),
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      rowsTruncated: matches.length > rowLimit,
      rows: matches.slice(0, rowLimit).map((r) => ({
        id: r.id,
        date: r.date,
        merchant: r.merchant,
        amount: round2(r.amount),
        category: r.category,
        account: r.account,
        person: r.person,
      })),
    }
  }

  private adjustBalance(accountId: number, delta: number) {
    this.db
      .prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
      .run(delta, accountId)
  }

  createTransaction(payload: {
    profileId: number
    accountId: number
    date: string
    amount: number
    payee: string
    memo?: string
    categoryId?: number | null
    isTransfer?: boolean
    transferAccountId?: number | null
  }): Transaction {
    const run = this.db.transaction(() => {
      const categoryId =
        payload.categoryId ??
        applyCategoryRules(
          this.db,
          payload.profileId,
          payload.payee,
          payload.memo,
        )
      const info = this.db
        .prepare(
          `INSERT INTO transactions
           (profile_id, account_id, date, amount, payee, memo, category_id, is_transfer, transfer_account_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          payload.profileId,
          payload.accountId,
          payload.date,
          payload.amount,
          payload.payee,
          payload.memo ?? null,
          categoryId,
          payload.isTransfer || this.transferFlag(categoryId) ? 1 : 0,
          payload.transferAccountId ?? null,
        )
      this.adjustBalance(payload.accountId, payload.amount)
      if (payload.isTransfer && payload.transferAccountId) {
        this.db
          .prepare(
            `INSERT INTO transactions
             (profile_id, account_id, date, amount, payee, memo, category_id, is_transfer, transfer_account_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          )
          .run(
            payload.profileId,
            payload.transferAccountId,
            payload.date,
            -payload.amount,
            payload.payee,
            payload.memo ?? 'Transfer',
            categoryId,
            payload.accountId,
          )
        this.adjustBalance(payload.transferAccountId, -payload.amount)
      }
      return Number(info.lastInsertRowid)
    })
    const id = run()
    return this.listTransactions(payload.profileId, { limit: 1 }).find(
      (t) => t.id === id,
    )!
  }

  updateTransaction(
    id: number,
    payload: {
      accountId: number
      date: string
      amount: number
      payee: string
      memo?: string
      categoryId?: number | null
    },
  ) {
    const existing = this.db
      .prepare('SELECT * FROM transactions WHERE id = ?')
      .get(id) as Transaction
    if (!existing) return null

    const run = this.db.transaction(() => {
      this.adjustBalance(existing.account_id, -existing.amount)
      this.db
        .prepare(
          `UPDATE transactions
           SET account_id = ?, date = ?, amount = ?, payee = ?, memo = ?,
               category_id = ?, is_transfer = ?
           WHERE id = ?`,
        )
        .run(
          payload.accountId,
          payload.date,
          payload.amount,
          payload.payee,
          payload.memo ?? null,
          payload.categoryId ?? null,
          // A row paired to another account stays a transfer regardless of the
          // category it's edited into.
          existing.transfer_account_id != null
            ? 1
            : this.transferFlag(payload.categoryId),
          id,
        )
      this.adjustBalance(payload.accountId, payload.amount)
    })
    run()
    return this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id)
  }

  deleteTransaction(id: number) {
    const existing = this.db
      .prepare('SELECT * FROM transactions WHERE id = ?')
      .get(id) as Transaction | undefined
    if (!existing) return
    const run = this.db.transaction(() => {
      this.adjustBalance(existing.account_id, -existing.amount)
      this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
    })
    run()
  }

  categorizeTransaction(id: number, categoryId: number | null) {
    this.db
      .prepare(
        'UPDATE transactions SET category_id = ?, is_transfer = ? WHERE id = ?',
      )
      .run(categoryId, this.transferFlag(categoryId), id)
  }

  /**
   * Re-run merchant matching only on txs still without a real category.
   * Never overwrites a category the user (or a prior match) already set.
   */
  recategorizeUncategorized(profileId: number): { updated: number } {
    const unc = this.db
      .prepare(
        `SELECT id FROM categories WHERE profile_id = ? AND name = 'Uncategorized'`,
      )
      .get(profileId) as { id: number } | undefined

    const rows = this.db
      .prepare(
        `SELECT id, payee, memo, category_id FROM transactions
         WHERE profile_id = ?
           AND (category_id IS NULL${unc ? ' OR category_id = ?' : ''})`,
      )
      .all(
        ...(unc ? [profileId, unc.id] : [profileId]),
      ) as Array<{
      id: number
      payee: string
      memo: string | null
      category_id: number | null
    }>

    let updated = 0
    const run = this.db.transaction(() => {
      const stmt = this.db.prepare(
        'UPDATE transactions SET category_id = ?, is_transfer = ? WHERE id = ?',
      )
      for (const row of rows) {
        const next = applyCategoryRules(
          this.db,
          profileId,
          row.payee,
          row.memo,
        )
        if (next == null) continue
        if (unc && next === unc.id) continue
        if (next === row.category_id) continue
        stmt.run(next, this.transferFlag(next), row.id)
        updated += 1
      }
    })
    run()
    return { updated }
  }

  /** Assign one category to many txs; optionally save a future-import rule. */
  categorizeMany(payload: {
    ids: number[]
    categoryId: number | null
    profileId?: number
    saveRuleMatch?: string | null
  }) {
    const ids = [...new Set(payload.ids)].filter((id) => Number.isFinite(id))
    if (!ids.length) return { updated: 0 }

    const run = this.db.transaction(() => {
      const stmt = this.db.prepare(
        'UPDATE transactions SET category_id = ?, is_transfer = ? WHERE id = ?',
      )
      const flag = this.transferFlag(payload.categoryId)
      for (const id of ids) {
        stmt.run(payload.categoryId, flag, id)
      }

      if (
        payload.profileId != null &&
        payload.categoryId != null &&
        payload.saveRuleMatch &&
        payload.saveRuleMatch.trim().length >= 2
      ) {
        const match = payload.saveRuleMatch.trim()
        const existing = this.db
          .prepare(
            `SELECT id FROM category_rules
             WHERE profile_id = ? AND lower(match_text) = lower(?)`,
          )
          .get(payload.profileId, match) as { id: number } | undefined
        if (existing) {
          this.db
            .prepare(
              `UPDATE category_rules SET category_id = ? WHERE id = ?`,
            )
            .run(payload.categoryId, existing.id)
        } else {
          this.db
            .prepare(
              `INSERT INTO category_rules (profile_id, match_text, category_id)
               VALUES (?, ?, ?)`,
            )
            .run(payload.profileId, match, payload.categoryId)
        }
      }
    })
    run()
    return { updated: ids.length }
  }

  importTransactions(payload: {
    profileId: number
    accountId: number
    rows: Array<{ date: string; amount: number; payee: string; memo?: string }>
    fileName?: string
    endingBalance?: number | null
  }) {
    let imported = 0
    let skipped = 0
    let moneyIn = 0
    let moneyOut = 0
    let dateFrom: string | null = null
    let dateTo: string | null = null
    let statementImportId: number | null = null

    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO transactions
       (profile_id, account_id, date, amount, payee, memo, category_id,
        is_transfer, import_hash, statement_import_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    const run = this.db.transaction(() => {
      if (payload.fileName) {
        const created = this.db
          .prepare(
            `INSERT INTO statement_imports
             (profile_id, account_id, file_name, imported_count, skipped_count,
              money_in, money_out, date_from, date_to)
             VALUES (?, ?, ?, 0, 0, 0, 0, NULL, NULL)`,
          )
          .run(payload.profileId, payload.accountId, payload.fileName)
        statementImportId = Number(created.lastInsertRowid)
      }

      for (const row of payload.rows) {
        if (!dateFrom || row.date < dateFrom) dateFrom = row.date
        if (!dateTo || row.date > dateTo) dateTo = row.date

        const hash = [
          row.date,
          row.amount.toFixed(2),
          row.payee.trim().toLowerCase(),
          (row.memo ?? '').trim().toLowerCase(),
        ].join('|')
        const categoryId = applyCategoryRules(
          this.db,
          payload.profileId,
          row.payee,
          row.memo,
        )
        const result = insert.run(
          payload.profileId,
          payload.accountId,
          row.date,
          row.amount,
          row.payee,
          row.memo ?? null,
          categoryId,
          this.transferFlag(categoryId),
          hash,
          statementImportId,
        )
        if (result.changes > 0) {
          this.adjustBalance(payload.accountId, row.amount)
          imported += 1
          if (row.amount > 0) moneyIn += row.amount
          else moneyOut += Math.abs(row.amount)
        } else {
          skipped += 1
        }
      }

      if (payload.endingBalance != null && !Number.isNaN(payload.endingBalance)) {
        this.db
          .prepare('UPDATE accounts SET balance = ? WHERE id = ?')
          .run(payload.endingBalance, payload.accountId)
      }

      if (statementImportId != null) {
        this.db
          .prepare(
            `UPDATE statement_imports
             SET imported_count = ?, skipped_count = ?, money_in = ?, money_out = ?,
                 date_from = ?, date_to = ?
             WHERE id = ?`,
          )
          .run(
            imported,
            skipped,
            moneyIn,
            moneyOut,
            dateFrom,
            dateTo,
            statementImportId,
          )
      }
    })
    run()

    const account = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(payload.accountId) as { balance: number; name: string } | undefined

    return {
      imported,
      skipped,
      moneyIn,
      moneyOut,
      dateFrom,
      dateTo,
      accountBalance: account?.balance ?? null,
      accountName: account?.name ?? null,
      statementImportId,
    }
  }

  listStatementImports(profileId: number, limit = 40) {
    return this.db
      .prepare(
        `SELECT s.*, a.name AS account_name, a.type AS account_type,
           (SELECT COUNT(*) FROM transactions t
            WHERE t.statement_import_id = s.id) AS linked_tx_count
         FROM statement_imports s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.profile_id = ?
         ORDER BY s.id DESC
         LIMIT ?`,
      )
      .all(profileId, limit)
  }

  updateStatementImport(
    id: number,
    payload: { fileName?: string; accountId?: number },
  ) {
    const existing = this.db
      .prepare('SELECT * FROM statement_imports WHERE id = ?')
      .get(id) as
      | {
          id: number
          profile_id: number
          account_id: number
          file_name: string
        }
      | undefined
    if (!existing) throw new Error('Statement import not found')

    const fileName = (payload.fileName ?? existing.file_name).trim()
    if (!fileName) throw new Error('File name is required')
    const accountId = payload.accountId ?? existing.account_id

    const run = this.db.transaction(() => {
      if (accountId !== existing.account_id) {
        const account = this.db
          .prepare('SELECT id, profile_id FROM accounts WHERE id = ?')
          .get(accountId) as { id: number; profile_id: number } | undefined
        if (!account || account.profile_id !== existing.profile_id) {
          throw new Error('Account not found for this profile')
        }

        const txs = this.db
          .prepare(
            `SELECT id, amount FROM transactions WHERE statement_import_id = ?`,
          )
          .all(id) as Array<{ id: number; amount: number }>

        for (const tx of txs) {
          this.adjustBalance(existing.account_id, -tx.amount)
          this.adjustBalance(accountId, tx.amount)
          this.db
            .prepare('UPDATE transactions SET account_id = ? WHERE id = ?')
            .run(accountId, tx.id)
        }
      }

      this.db
        .prepare(
          `UPDATE statement_imports SET file_name = ?, account_id = ? WHERE id = ?`,
        )
        .run(fileName, accountId, id)
    })
    run()

    return this.db
      .prepare(
        `SELECT s.*, a.name AS account_name, a.type AS account_type,
           (SELECT COUNT(*) FROM transactions t
            WHERE t.statement_import_id = s.id) AS linked_tx_count
         FROM statement_imports s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.id = ?`,
      )
      .get(id)
  }

  deleteStatementImport(id: number, undoTransactions: boolean) {
    const existing = this.db
      .prepare('SELECT * FROM statement_imports WHERE id = ?')
      .get(id) as
      | {
          id: number
          account_id: number
          imported_count: number
          file_name: string
        }
      | undefined
    if (!existing) throw new Error('Statement import not found')

    let removedTx = 0
    let reversedAmount = 0

    const run = this.db.transaction(() => {
      if (undoTransactions) {
        const txs = this.db
          .prepare(
            `SELECT id, amount FROM transactions WHERE statement_import_id = ?`,
          )
          .all(id) as Array<{ id: number; amount: number }>

        for (const tx of txs) {
          this.adjustBalance(existing.account_id, -tx.amount)
          reversedAmount += tx.amount
          removedTx += 1
        }
        this.db
          .prepare('DELETE FROM transactions WHERE statement_import_id = ?')
          .run(id)
      } else {
        // Keep transactions; just unlink so future undos stay accurate
        this.db
          .prepare(
            'UPDATE transactions SET statement_import_id = NULL WHERE statement_import_id = ?',
          )
          .run(id)
      }

      this.db.prepare('DELETE FROM statement_imports WHERE id = ?').run(id)
    })
    run()

    const account = this.db
      .prepare('SELECT balance, name FROM accounts WHERE id = ?')
      .get(existing.account_id) as
      | { balance: number; name: string }
      | undefined

    return {
      fileName: existing.file_name,
      removedTransactions: removedTx,
      reversedAmount,
      accountBalance: account?.balance ?? null,
      accountName: account?.name ?? null,
    }
  }

  listBudgets(profileId: number, month: string) {
    return this.db
      .prepare(
        `SELECT b.*, c.name AS category_name, c.group_name, c.emoji,
           COALESCE((
             SELECT SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END)
             FROM transactions t
             WHERE t.profile_id = b.profile_id
               AND t.category_id = b.category_id
               AND t.date >= ?
               AND t.date <= ?
               AND t.is_transfer = 0
           ), 0) AS spent
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
         WHERE b.profile_id = ? AND b.month = ?
         ORDER BY c.group_name, c.name`,
      )
      .all(`${month}-01`, `${month}-31`, profileId, month)
  }

  upsertBudget(payload: {
    profileId: number
    categoryId: number
    month: string
    amount: number
  }) {
    this.db
      .prepare(
        `INSERT INTO budgets (profile_id, category_id, month, amount)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, category_id, month)
         DO UPDATE SET amount = excluded.amount`,
      )
      .run(payload.profileId, payload.categoryId, payload.month, payload.amount)
  }

  budgetSummary(profileId: number, month: string) {
    const budgets = this.listBudgets(profileId, month) as Array<{
      amount: number
      spent: number
    }>
    const planned = budgets.reduce((s, b) => s + b.amount, 0)
    const spent = budgets.reduce((s, b) => s + b.spent, 0)
    return {
      planned,
      spent,
      remaining: planned - spent,
      categories: budgets,
    }
  }

  listGoals(profileId: number): Goal[] {
    return this.db
      .prepare(
        `SELECT * FROM goals WHERE profile_id = ? AND status = 'active'
         ORDER BY priority ASC, id ASC`,
      )
      .all(profileId) as Goal[]
  }

  createGoal(payload: {
    profileId: number
    name: string
    targetAmount: number
    currentAmount: number
    targetDate?: string | null
    color?: string
  }) {
    // New goals land at the bottom of the ranking rather than jumping the queue.
    const last = this.db
      .prepare(
        'SELECT COALESCE(MAX(priority), 0) AS top FROM goals WHERE profile_id = ?',
      )
      .get(payload.profileId) as { top: number }

    const info = this.db
      .prepare(
        `INSERT INTO goals (profile_id, name, target_amount, current_amount, target_date, color, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.profileId,
        payload.name,
        payload.targetAmount,
        payload.currentAmount,
        payload.targetDate ?? null,
        payload.color ?? '#2F6F5E',
        last.top + 1,
      )
    return this.db
      .prepare('SELECT * FROM goals WHERE id = ?')
      .get(Number(info.lastInsertRowid))
  }

  updateGoal(
    id: number,
    payload: {
      name: string
      targetAmount: number
      currentAmount: number
      targetDate?: string | null
      color?: string
      status?: string
    },
  ) {
    this.db
      .prepare(
        `UPDATE goals
         SET name = ?, target_amount = ?, current_amount = ?, target_date = ?,
             color = ?, status = COALESCE(?, status)
         WHERE id = ?`,
      )
      .run(
        payload.name,
        payload.targetAmount,
        payload.currentAmount,
        payload.targetDate ?? null,
        payload.color ?? '#2F6F5E',
        payload.status ?? null,
        id,
      )
    return this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id)
  }

  deleteGoal(id: number) {
    this.db.prepare('DELETE FROM goals WHERE id = ?').run(id)
  }

  /**
   * Swaps a goal with its neighbour and rewrites the whole run of ranks, so a
   * list that arrived with duplicate or gappy priorities settles into 1..n
   * instead of getting stuck.
   */
  moveGoal(id: number, direction: 'up' | 'down'): Goal[] {
    const owner = this.db
      .prepare('SELECT profile_id FROM goals WHERE id = ?')
      .get(id) as { profile_id: number } | undefined
    if (!owner) return []

    const order = this.listGoals(owner.profile_id).map((g) => g.id)
    const at = order.indexOf(id)
    const to = direction === 'up' ? at - 1 : at + 1
    if (at < 0 || to < 0 || to >= order.length) {
      return this.listGoals(owner.profile_id)
    }

    order[at] = order[to]
    order[to] = id

    const setRank = this.db.prepare('UPDATE goals SET priority = ? WHERE id = ?')
    const run = this.db.transaction(() => {
      order.forEach((goalId, i) => setRank.run(i + 1, goalId))
    })
    run()

    return this.listGoals(owner.profile_id)
  }

  // ---------------------------------------------------------- profile settings

  getSetting(profileId: number, key: string): string | null {
    const row = this.db
      .prepare(
        'SELECT value FROM profile_settings WHERE profile_id = ? AND key = ?',
      )
      .get(profileId, key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(profileId: number, key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO profile_settings (profile_id, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(profile_id, key) DO UPDATE
           SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(profileId, key, value)
  }

  clearSetting(profileId: number, key: string) {
    this.db
      .prepare('DELETE FROM profile_settings WHERE profile_id = ? AND key = ?')
      .run(profileId, key)
  }

  /**
   * Both halves of the money motivation: what the user typed, and the line the
   * coach wrote back. The raw text is kept so it can be reworded later without
   * asking again.
   */
  getMotivation(profileId: number) {
    const raw = this.getSetting(profileId, MOTIVATION_RAW)
    const line = this.getSetting(profileId, MOTIVATION_LINE)
    return raw ? { raw, line: line ?? raw } : null
  }

  saveMotivation(profileId: number, raw: string, line: string) {
    const run = this.db.transaction(() => {
      this.setSetting(profileId, MOTIVATION_RAW, raw)
      this.setSetting(profileId, MOTIVATION_LINE, line)
    })
    run()
    return { raw, line }
  }

  clearMotivation(profileId: number) {
    const run = this.db.transaction(() => {
      this.clearSetting(profileId, MOTIVATION_RAW)
      this.clearSetting(profileId, MOTIVATION_LINE)
    })
    run()
  }

  listBills(profileId: number) {
    return this.db
      .prepare(
        `SELECT b.*, a.name AS account_name, c.name AS category_name,
           (SELECT d.file_path FROM bill_documents d
            WHERE d.bill_id = b.id
            ORDER BY d.id DESC LIMIT 1) AS document_path,
           (SELECT d.file_name FROM bill_documents d
            WHERE d.bill_id = b.id
            ORDER BY d.id DESC LIMIT 1) AS document_name
         FROM bills b
         LEFT JOIN accounts a ON a.id = b.account_id
         LEFT JOIN categories c ON c.id = b.category_id
         WHERE b.profile_id = ? AND b.active = 1
         ORDER BY b.due_day, b.name`,
      )
      .all(profileId)
  }

  getLatestBillDocumentPath(billId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT file_path FROM bill_documents
         WHERE bill_id = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(billId) as { file_path: string } | undefined
    return row?.file_path ?? null
  }

  createBill(payload: {
    profileId: number
    name: string
    amount: number
    /** 1–31 monthly; 0/null = no day-of-month (use nextDueDate or hide) */
    dueDay?: number | null
    nextDueDate?: string | null
    accountId?: number | null
    categoryId?: number | null
    payeeHint?: string
    frequency?: string
    autopay?: boolean | number
    autopayDay?: number | null
    principal?: number | null
    interest?: number | null
    escrow?: number | null
    isMortgage?: boolean | number
    minimumPayment?: number | null
    statementBalance?: number | null
  }) {
    const dueDay =
      payload.dueDay != null && payload.dueDay >= 1 && payload.dueDay <= 31
        ? payload.dueDay
        : 0
    const nextDue =
      payload.nextDueDate && /^\d{4}-\d{2}-\d{2}/.test(payload.nextDueDate)
        ? payload.nextDueDate.slice(0, 10)
        : null
    const autopay = payload.autopay ? 1 : 0
    const autopayDay =
      autopay && payload.autopayDay != null && payload.autopayDay >= 1
        ? payload.autopayDay
        : autopay && dueDay >= 1
          ? dueDay
          : null
    const info = this.db
      .prepare(
        `INSERT INTO bills
         (profile_id, name, amount, due_day, account_id, category_id, payee_hint, frequency,
          autopay, autopay_day, principal, interest, escrow, is_mortgage,
          minimum_payment, statement_balance, next_due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.profileId,
        payload.name,
        payload.amount,
        dueDay,
        payload.accountId ?? null,
        payload.categoryId ?? null,
        payload.payeeHint ?? null,
        payload.frequency ?? (nextDue ? 'custom' : 'monthly'),
        autopay,
        autopayDay,
        payload.principal ?? null,
        payload.interest ?? null,
        payload.escrow ?? null,
        payload.isMortgage ? 1 : 0,
        payload.minimumPayment ?? null,
        payload.statementBalance ?? null,
        nextDue,
      )
    return this.db
      .prepare('SELECT * FROM bills WHERE id = ?')
      .get(Number(info.lastInsertRowid))
  }

  updateBill(
    id: number,
    payload: {
      name: string
      amount: number
      dueDay?: number | null
      nextDueDate?: string | null
      accountId?: number | null
      categoryId?: number | null
      payeeHint?: string
      frequency?: string
      active?: number
      autopay?: boolean | number
      autopayDay?: number | null
      principal?: number | null
      interest?: number | null
      escrow?: number | null
      isMortgage?: boolean | number
      minimumPayment?: number | null
      statementBalance?: number | null
    },
  ) {
    const existing = this.db
      .prepare('SELECT * FROM bills WHERE id = ?')
      .get(id) as {
      due_day: number
      next_due_date: string | null
      autopay: number
      autopay_day: number | null
      principal: number | null
      interest: number | null
      escrow: number | null
      is_mortgage: number
      minimum_payment: number | null
      statement_balance: number | null
    } | undefined

    const dueDay =
      payload.dueDay === undefined
        ? existing?.due_day ?? 0
        : payload.dueDay != null && payload.dueDay >= 1 && payload.dueDay <= 31
          ? payload.dueDay
          : 0

    const nextDue =
      payload.nextDueDate === undefined
        ? existing?.next_due_date ?? null
        : payload.nextDueDate && /^\d{4}-\d{2}-\d{2}/.test(payload.nextDueDate)
          ? payload.nextDueDate.slice(0, 10)
          : null

    const autopay =
      payload.autopay === undefined
        ? existing?.autopay ?? 0
        : payload.autopay
          ? 1
          : 0

    let autopayDay: number | null = null
    if (autopay) {
      if (payload.autopayDay != null && payload.autopayDay >= 1) {
        autopayDay = payload.autopayDay
      } else if (existing?.autopay_day != null) {
        autopayDay = existing.autopay_day
      } else if (dueDay >= 1) {
        autopayDay = dueDay
      }
    }

    const isMortgage =
      payload.isMortgage === undefined
        ? existing?.is_mortgage ?? 0
        : payload.isMortgage
          ? 1
          : 0

    this.db
      .prepare(
        `UPDATE bills
         SET name = ?, amount = ?, due_day = ?, account_id = ?, category_id = ?,
             payee_hint = ?, frequency = ?,
             active = COALESCE(?, active),
             autopay = ?, autopay_day = ?,
             principal = COALESCE(?, principal),
             interest = COALESCE(?, interest),
             escrow = COALESCE(?, escrow),
             is_mortgage = ?,
             minimum_payment = COALESCE(?, minimum_payment),
             statement_balance = COALESCE(?, statement_balance),
             next_due_date = ?
         WHERE id = ?`,
      )
      .run(
        payload.name,
        payload.amount,
        dueDay,
        payload.accountId ?? null,
        payload.categoryId ?? null,
        payload.payeeHint ?? null,
        payload.frequency ?? (nextDue ? 'custom' : 'monthly'),
        payload.active ?? null,
        autopay,
        autopayDay,
        payload.principal ?? null,
        payload.interest ?? null,
        payload.escrow ?? null,
        isMortgage,
        payload.minimumPayment ?? null,
        payload.statementBalance ?? null,
        nextDue,
        id,
      )

    return this.db.prepare('SELECT * FROM bills WHERE id = ?').get(id)
  }

  deleteBill(id: number) {
    this.db.prepare('DELETE FROM bills WHERE id = ?').run(id)
  }

  getBillStatuses(profileId: number, month: string): BillStatus[] {
    const bills = this.listBills(profileId) as any[]
    const txs = this.listTransactions(profileId, {
      from: `${month}-01`,
      to: `${month}-31`,
      limit: 5000,
    })
    const base = matchBillsForPeriod(bills, txs, month)
    const manuals = this.db
      .prepare(
        `SELECT bill_id, paid_on FROM bill_payments
         WHERE profile_id = ? AND month = ?`,
      )
      .all(profileId, month) as Array<{ bill_id: number; paid_on: string }>
    return applyManualBillPayments(base, manuals)
  }

  markBillPaid(payload: {
    profileId: number
    billId: number
    month: string
    paidOn?: string | null
    note?: string | null
  }) {
    const bill = this.db
      .prepare('SELECT id, profile_id FROM bills WHERE id = ?')
      .get(payload.billId) as { id: number; profile_id: number } | undefined
    if (!bill || bill.profile_id !== payload.profileId) {
      throw new Error('Bill not found')
    }
    const paidOn =
      payload.paidOn && /^\d{4}-\d{2}-\d{2}/.test(payload.paidOn)
        ? payload.paidOn.slice(0, 10)
        : new Date().toISOString().slice(0, 10)

    this.db
      .prepare(
        `INSERT INTO bill_payments (profile_id, bill_id, month, paid_on, note)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(bill_id, month) DO UPDATE SET
           paid_on = excluded.paid_on,
           note = excluded.note`,
      )
      .run(
        payload.profileId,
        payload.billId,
        payload.month,
        paidOn,
        payload.note ?? null,
      )

    return this.getBillStatuses(payload.profileId, payload.month).find(
      (b) => b.id === payload.billId,
    )
  }

  unmarkBillPaid(payload: {
    profileId: number
    billId: number
    month: string
  }) {
    this.db
      .prepare(
        `DELETE FROM bill_payments
         WHERE profile_id = ? AND bill_id = ? AND month = ?`,
      )
      .run(payload.profileId, payload.billId, payload.month)
    return this.getBillStatuses(payload.profileId, payload.month).find(
      (b) => b.id === payload.billId,
    )
  }

  findCategoryByName(profileId: number, name: string): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM categories
         WHERE profile_id = ? AND lower(name) = lower(?)`,
      )
      .get(profileId, name) as { id: number } | undefined
    return row?.id ?? null
  }

  /**
   * Create or update a bill from a scanned PDF, store the document,
   * match recent payments, and categorize matched transactions.
   */
  commitBillFromPdf(payload: {
    profileId: number
    name: string
    amount: number
    dueDay?: number | null
    nextDueDate?: string | null
    payeeHint: string
    categoryId?: number | null
    accountId?: number | null
    storedFilePath: string
    originalFileName: string
    extracted: unknown
    autopay?: boolean
    autopayDay?: number | null
    principal?: number | null
    interest?: number | null
    escrow?: number | null
    isMortgage?: boolean
    minimumPayment?: number | null
    statementBalance?: number | null
    /** Search window for payment matching (YYYY-MM-DD) */
    fromDate?: string
    toDate?: string
  }) {
    const hint = (payload.payeeHint || payload.name).trim()
    const existing = this.db
      .prepare(
        `SELECT * FROM bills
         WHERE profile_id = ? AND active = 1
           AND (
             lower(name) = lower(?)
             OR lower(IFNULL(payee_hint, '')) = lower(?)
             OR lower(name) LIKE '%' || lower(?) || '%'
             OR lower(IFNULL(payee_hint, '')) LIKE '%' || lower(?) || '%'
           )
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(
        payload.profileId,
        payload.name,
        hint,
        hint.slice(0, 12),
        hint.slice(0, 12),
      ) as
        | {
            id: number
            name: string
            amount: number
            due_day: number
            next_due_date: string | null
            account_id: number | null
            category_id: number | null
            payee_hint: string | null
          }
        | undefined

    let billId: number
    let action: 'created' | 'updated'

    const breakdown = {
      principal: payload.principal ?? null,
      interest: payload.interest ?? null,
      escrow: payload.escrow ?? null,
      isMortgage: payload.isMortgage ?? false,
      minimumPayment: payload.minimumPayment ?? null,
      statementBalance: payload.statementBalance ?? null,
    }

    const dueDay =
      payload.dueDay != null && payload.dueDay >= 1 && payload.dueDay <= 31
        ? payload.dueDay
        : 0
    const nextDueDate =
      payload.nextDueDate && /^\d{4}-\d{2}-\d{2}/.test(payload.nextDueDate)
        ? payload.nextDueDate.slice(0, 10)
        : null

    if (existing) {
      this.updateBill(existing.id, {
        name: payload.name || existing.name,
        amount: payload.amount || existing.amount,
        dueDay,
        nextDueDate,
        accountId: payload.accountId ?? existing.account_id,
        categoryId: payload.categoryId ?? existing.category_id,
        payeeHint: hint || existing.payee_hint || payload.name,
        frequency: nextDueDate ? 'custom' : 'monthly',
        autopay: payload.autopay ?? false,
        autopayDay: payload.autopayDay ?? (dueDay >= 1 ? dueDay : null),
        ...breakdown,
      })
      billId = existing.id
      action = 'updated'
    } else {
      const created = this.createBill({
        profileId: payload.profileId,
        name: payload.name,
        amount: payload.amount,
        dueDay,
        nextDueDate,
        accountId: payload.accountId,
        categoryId: payload.categoryId,
        payeeHint: hint,
        autopay: payload.autopay ?? false,
        autopayDay: payload.autopayDay ?? (dueDay >= 1 ? dueDay : null),
        ...breakdown,
      }) as { id: number }
      billId = created.id
      action = 'created'
    }

    this.db
      .prepare(
        `INSERT INTO bill_documents
         (profile_id, bill_id, file_name, file_path, extracted_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        payload.profileId,
        billId,
        payload.originalFileName,
        payload.storedFilePath,
        JSON.stringify(payload.extracted),
      )

    // Add/refresh a payee rule so future statement imports categorize automatically
    if (payload.categoryId && hint) {
      const ruleExists = this.db
        .prepare(
          `SELECT id FROM category_rules
           WHERE profile_id = ? AND lower(match_text) = lower(?)`,
        )
        .get(payload.profileId, hint) as { id: number } | undefined
      if (!ruleExists) {
        this.db
          .prepare(
            `INSERT INTO category_rules (profile_id, match_text, category_id)
             VALUES (?, ?, ?)`,
          )
          .run(payload.profileId, hint.toLowerCase(), payload.categoryId)
      }
    }

    const from =
      payload.fromDate ??
      new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const to = payload.toDate ?? new Date().toISOString().slice(0, 10)

    const txs = this.listTransactions(payload.profileId, {
      from,
      to,
      limit: 5000,
    })

    const billRow = {
      id: billId,
      name: payload.name,
      amount: payload.amount,
      due_day: dueDay,
      next_due_date: nextDueDate,
      payee_hint: hint,
      account_id: payload.accountId ?? null,
      category_id: payload.categoryId ?? null,
    }

    const matched = this.matchPaymentForBill(billRow, txs)

    let categorized = 0
    if (matched && payload.categoryId) {
      this.categorizeTransaction(matched.id, payload.categoryId)
      categorized = 1
    }

    return {
      action,
      billId,
      matchedTransaction: matched
        ? {
            id: matched.id,
            date: matched.date,
            payee: matched.payee,
            amount: matched.amount,
          }
        : null,
      categorized,
    }
  }

  private matchPaymentForBill(
    bill: {
      name: string
      amount: number
      payee_hint?: string | null
    },
    transactions: Transaction[],
  ): Transaction | null {
    const hint = (bill.payee_hint || bill.name).toLowerCase()
    const expected = Math.abs(bill.amount)
    let best: Transaction | null = null
    let bestScore = 0

    for (const tx of transactions) {
      if (tx.amount >= 0) continue
      const payee = `${tx.payee} ${tx.memo ?? ''}`.toLowerCase()
      const words = hint.split(/\s+/).filter((w) => w.length > 2)
      const nameMatch =
        payee.includes(hint) ||
        words.some((w) => payee.includes(w)) ||
        (hint.length >= 4 &&
          payee.split(/\s+/).some((w) => hint.includes(w) && w.length > 3))
      if (!nameMatch && expected > 0) {
        // amount-only fallback when amounts are very close
        const amountDiff = Math.abs(Math.abs(tx.amount) - expected)
        if (amountDiff > 1 && amountDiff > expected * 0.05) continue
      } else if (!nameMatch) {
        continue
      }

      const amountDiff = Math.abs(Math.abs(tx.amount) - expected)
      const amountScore =
        amountDiff <= 1
          ? 4
          : amountDiff <= expected * 0.1
            ? 3
            : amountDiff <= expected * 0.25
              ? 1
              : 0
      if (amountScore === 0 && expected > 0) continue

      const score = amountScore + (nameMatch ? 3 : 0)
      if (score > bestScore) {
        bestScore = score
        best = tx
      }
    }
    return best
  }

  spendingByCategory(scope: ProfileScope, from: string, to: string) {
    const who = profileWhere('t.', scope)
    return this.db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorized') AS name,
                COALESCE(c.group_name, 'Other') AS group_name,
                SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${who.sql}
           AND t.date >= ? AND t.date <= ?
           AND t.is_transfer = 0
           AND t.amount < 0
         GROUP BY COALESCE(c.name, 'Uncategorized'), COALESCE(c.group_name, 'Other')
         HAVING total > 0
         ORDER BY total DESC`,
      )
      .all(...who.params, from, to) as Array<{
      name: string
      group_name: string
      total: number
    }>
  }

  spendingByMonth(scope: ProfileScope, months: number) {
    const who = profileWhere('', scope)
    return this.db
      .prepare(
        `SELECT substr(date, 1, 7) AS month,
                SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS spent,
                SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income
         FROM transactions
         WHERE ${who.sql}
           AND is_transfer = 0
           AND date >= date('now', ?)
         GROUP BY substr(date, 1, 7)
         ORDER BY month ASC`,
      )
      .all(...who.params, `-${months} months`)
  }

  /** Per-month totals across an inclusive YYYY-MM range, gaps filled with zeros. */
  monthlySeries(scope: ProfileScope, fromMonth: string, toMonth: string) {
    const who = profileWhere('', scope)
    const rows = this.db
      .prepare(
        `SELECT substr(date, 1, 7) AS month,
                COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spent,
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
                COUNT(*) AS tx_count
         FROM transactions
         WHERE ${who.sql}
           AND is_transfer = 0
           AND date >= ? AND date <= ?
         GROUP BY substr(date, 1, 7)`,
      )
      .all(...who.params, `${fromMonth}-01`, monthEndDate(toMonth)) as Array<{
      month: string
      spent: number
      income: number
      tx_count: number
    }>

    const byMonth = new Map(rows.map((r) => [r.month, r]))
    const out: Array<{
      month: string
      label: string
      spent: number
      income: number
      net: number
      txCount: number
    }> = []

    let cursor = fromMonth
    // Guard against a reversed range producing an endless walk.
    for (let i = 0; i < 240 && cursor <= toMonth; i++) {
      const hit = byMonth.get(cursor)
      const spent = Number(hit?.spent ?? 0)
      const income = Number(hit?.income ?? 0)
      out.push({
        month: cursor,
        label: shortMonthLabel(cursor),
        spent,
        income,
        net: income - spent,
        txCount: Number(hit?.tx_count ?? 0),
      })
      cursor = shiftMonthKey(cursor, 1)
    }
    return out
  }

  /** Spend per category per month — the renderer pivots this as needed. */
  categoryMonthly(scope: ProfileScope, fromMonth: string, toMonth: string) {
    const who = profileWhere('t.', scope)
    return this.db
      .prepare(
        `SELECT substr(t.date, 1, 7) AS month,
                COALESCE(c.name, 'Uncategorized') AS name,
                COALESCE(c.group_name, 'Other') AS group_name,
                SUM(-t.amount) AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${who.sql}
           AND t.is_transfer = 0
           AND t.amount < 0
           AND t.date >= ? AND t.date <= ?
         GROUP BY 1, 2, 3
         HAVING total > 0
         ORDER BY 1 ASC, total DESC`,
      )
      .all(...who.params, `${fromMonth}-01`, monthEndDate(toMonth))
  }

  /** Income grouped by cleaned payee, plus a month-by-month total. */
  incomeReport(scope: ProfileScope, fromMonth: string, toMonth: string) {
    const who = profileWhere('t.', scope)
    const rows = this.db
      .prepare(
        `SELECT t.date, t.amount, t.payee, t.memo,
                COALESCE(c.name, 'Uncategorized') AS category
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${who.sql}
           AND t.is_transfer = 0
           AND t.amount > 0
           AND t.date >= ? AND t.date <= ?`,
      )
      .all(...who.params, `${fromMonth}-01`, monthEndDate(toMonth)) as Array<{
      date: string
      amount: number
      payee: string
      memo: string | null
      category: string
    }>

    const bySource = new Map<
      string,
      { name: string; category: string; total: number; count: number; months: Set<string> }
    >()
    const byMonthTotal = new Map<string, number>()

    for (const r of rows) {
      const clean = cleanPayee(r.payee, r.memo)
      const month = r.date.slice(0, 7)
      const entry = bySource.get(clean.key) ?? {
        name: clean.display,
        category: r.category,
        total: 0,
        count: 0,
        months: new Set<string>(),
      }
      entry.total += r.amount
      entry.count += 1
      entry.months.add(month)
      bySource.set(clean.key, entry)
      byMonthTotal.set(month, (byMonthTotal.get(month) ?? 0) + r.amount)
    }

    const series = this.monthlySeries(scope, fromMonth, toMonth).map((m) => ({
      month: m.month,
      label: m.label,
      total: byMonthTotal.get(m.month) ?? 0,
    }))

    return {
      total: rows.reduce((s, r) => s + r.amount, 0),
      sources: [...bySource.values()]
        .map((e) => ({
          name: e.name,
          category: e.category,
          total: e.total,
          count: e.count,
          months: e.months.size,
        }))
        .sort((a, b) => b.total - a.total),
      byMonth: series,
    }
  }

  /**
   * Merchants charged in at least 3 of the last `months`, with the newest
   * amount compared against the average of the earlier ones. Surfaces the
   * "my internet bill went up" case without needing a bill record.
   */
  recurringChanges(scope: ProfileScope, anchorMonth: string, months: number) {
    // A month still in progress looks like a drop, so end on the last full one.
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const endMonth =
      anchorMonth === thisMonth && now.getDate() < 28
        ? shiftMonthKey(anchorMonth, -1)
        : anchorMonth
    const fromMonth = shiftMonthKey(endMonth, -(months - 1))
    const who = profileWhere('', scope)
    const rows = this.db
      .prepare(
        `SELECT date, amount, payee, memo
         FROM transactions
         WHERE ${who.sql}
           AND is_transfer = 0
           AND amount < 0
           AND date >= ? AND date <= ?`,
      )
      .all(...who.params, `${fromMonth}-01`, monthEndDate(endMonth)) as Array<{
      date: string
      amount: number
      payee: string
      memo: string | null
    }>

    const merchants = new Map<
      string,
      { name: string; monthly: Map<string, number> }
    >()

    for (const r of rows) {
      const clean = cleanPayee(r.payee, r.memo)
      const month = r.date.slice(0, 7)
      const entry = merchants.get(clean.key) ?? {
        name: clean.display,
        monthly: new Map<string, number>(),
      }
      entry.monthly.set(month, (entry.monthly.get(month) ?? 0) + -r.amount)
      merchants.set(clean.key, entry)
    }

    const out: Array<{
      name: string
      monthsSeen: number
      latest: number
      latestMonth: string
      priorAvg: number
      changeAbs: number
      changePct: number | null
    }> = []

    for (const entry of merchants.values()) {
      const seen = [...entry.monthly.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )
      if (seen.length < 3) continue
      const [latestMonth, latest] = seen[seen.length - 1]
      const prior = seen.slice(0, -1)
      const priorAvg =
        prior.reduce((s, [, v]) => s + v, 0) / Math.max(1, prior.length)
      out.push({
        name: entry.name,
        monthsSeen: seen.length,
        latest,
        latestMonth,
        priorAvg,
        changeAbs: latest - priorAvg,
        changePct: pctChange(priorAvg, latest),
      })
    }

    return out.sort((a, b) => Math.abs(b.changeAbs) - Math.abs(a.changeAbs))
  }

  /**
   * Trends for mom (2 mo compare), 3m, 6m, or 1y windows.
   * anchorMonth is YYYY-MM (usually the UI selected month).
   */
  getTrends(
    scope: ProfileScope,
    range: 'mom' | '3m' | '6m' | '1y',
    anchorMonth: string,
  ) {
    const periodMonths =
      range === 'mom' ? 1 : range === '3m' ? 3 : range === '6m' ? 6 : 12

    // Chart shows the current window length (mom shows 2 points for visual compare)
    const chartMonths = range === 'mom' ? 2 : periodMonths

    const series: Array<{
      month: string
      label: string
      spent: number
      income: number
      net: number
    }> = []

    for (let i = chartMonths - 1; i >= 0; i--) {
      const m = shiftMonthKey(anchorMonth, -i)
      const stats = this.monthTotals(scope, m)
      series.push({
        month: m,
        label: shortMonthLabel(m),
        spent: stats.spent,
        income: stats.income,
        net: stats.income - stats.spent,
      })
    }

    // Current window = last `periodMonths` of chart (for mom, just the anchor month)
    const currentStart = shiftMonthKey(anchorMonth, -(periodMonths - 1))
    const previousEnd = shiftMonthKey(currentStart, -1)
    const previousStart = shiftMonthKey(previousEnd, -(periodMonths - 1))

    const current = this.rangeTotals(
      scope,
      `${currentStart}-01`,
      monthEndDate(anchorMonth),
    )
    const previous = this.rangeTotals(
      scope,
      `${previousStart}-01`,
      monthEndDate(previousEnd),
    )

    const categoryCurrent = this.spendingByCategory(
      scope,
      `${currentStart}-01`,
      monthEndDate(anchorMonth),
    ) as Array<{ name: string; total: number; group_name: string }>
    const categoryPrevious = this.spendingByCategory(
      scope,
      `${previousStart}-01`,
      monthEndDate(previousEnd),
    ) as Array<{ name: string; total: number; group_name: string }>

    const prevMap = new Map(
      categoryPrevious.map((c) => [c.name, Number(c.total) || 0]),
    )
    const names = new Set([
      ...categoryCurrent.map((c) => c.name),
      ...categoryPrevious.map((c) => c.name),
    ])

    const categoryChanges = [...names]
      .map((name) => {
        const cur = Number(
          categoryCurrent.find((c) => c.name === name)?.total ?? 0,
        )
        const prev = prevMap.get(name) ?? 0
        const changeAbs = cur - prev
        const changePct =
          prev === 0 ? (cur > 0 ? 100 : 0) : (changeAbs / prev) * 100
        return {
          name,
          current: cur,
          previous: prev,
          changeAbs,
          changePct,
        }
      })
      .filter((c) => c.current > 0 || c.previous > 0)
      .sort((a, b) => Math.abs(b.changeAbs) - Math.abs(a.changeAbs))

    const risers = [...categoryChanges]
      .filter((c) => c.changeAbs > 0)
      .sort((a, b) => b.changeAbs - a.changeAbs)
      .slice(0, 5)
    const fallers = [...categoryChanges]
      .filter((c) => c.changeAbs < 0)
      .sort((a, b) => a.changeAbs - b.changeAbs)
      .slice(0, 5)

    const totalSpent = series.reduce((s, m) => s + m.spent, 0)
    const totalIncome = series.reduce((s, m) => s + m.income, 0)
    const avgSpent = series.length ? totalSpent / series.length : 0
    const avgIncome = series.length ? totalIncome / series.length : 0

    return {
      range,
      anchorMonth,
      periodMonths,
      currentLabel: rangeLabel(range, currentStart, anchorMonth),
      previousLabel: rangeLabel(range, previousStart, previousEnd),
      series,
      summary: {
        currentSpent: current.spent,
        currentIncome: current.income,
        currentNet: current.income - current.spent,
        previousSpent: previous.spent,
        previousIncome: previous.income,
        previousNet: previous.income - previous.spent,
        spentChangePct: pctChange(previous.spent, current.spent),
        incomeChangePct: pctChange(previous.income, current.income),
        netChangePct: pctChange(
          previous.income - previous.spent,
          current.income - current.spent,
        ),
        avgSpent,
        avgIncome,
        totalSpent,
        totalIncome,
      },
      categoryChanges: categoryChanges.slice(0, 12),
      risers,
      fallers,
    }
  }

  private monthTotals(scope: ProfileScope, month: string) {
    return this.rangeTotals(
      scope,
      `${month}-01`,
      monthEndDate(month),
    )
  }

  private rangeTotals(scope: ProfileScope, from: string, to: string) {
    const who = profileWhere('', scope)
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spent,
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income
         FROM transactions
         WHERE ${who.sql}
           AND is_transfer = 0
           AND date >= ? AND date <= ?`,
      )
      .get(...who.params, from, to) as { spent: number; income: number }
    return {
      spent: Number(row?.spent ?? 0),
      income: Number(row?.income ?? 0),
    }
  }

  dashboard(profileId: number, month: string) {
    const accounts = this.listAccounts(profileId)
    const cash = accounts
      .filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
      .reduce((s, a) => s + a.balance, 0)
    const credit = accounts
      .filter((a) => a.type === 'credit')
      .reduce((s, a) => s + a.balance, 0)

    const monthStats = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN amount > 0 AND is_transfer = 0 THEN amount ELSE 0 END) AS income,
           SUM(CASE WHEN amount < 0 AND is_transfer = 0 THEN -amount ELSE 0 END) AS spent,
           COUNT(*) AS tx_count,
           SUM(CASE WHEN category_id IS NULL AND is_transfer = 0 THEN 1 ELSE 0 END) AS uncategorized
         FROM transactions
         WHERE profile_id = ? AND date >= ? AND date <= ?`,
      )
      .get(profileId, `${month}-01`, `${month}-31`) as {
      income: number | null
      spent: number | null
      tx_count: number
      uncategorized: number
    }

    const budget = this.budgetSummary(profileId, month)
    const bills = this.getBillStatuses(profileId, month)

    const goals = this.listGoals(profileId)
    const topSpend = this.spendingByCategory(
      profileId,
      `${month}-01`,
      `${month}-31`,
    ).slice(0, 5)

    const recent = this.listTransactions(profileId, { limit: 8 })

    return {
      cash,
      creditLiability: Math.abs(Math.min(credit, 0)) + Math.max(credit, 0),
      accountCount: accounts.length,
      income: monthStats.income ?? 0,
      spent: monthStats.spent ?? 0,
      txCount: monthStats.tx_count,
      uncategorized: monthStats.uncategorized,
      budget,
      bills,
      goals,
      motivation: this.getMotivation(profileId),
      topSpend,
      recent,
      accounts,
    }
  }

  // ---------------------------------------------------------------- Plaid

  /** Items with their accounts. Access tokens are never included. */
  listPlaidItems(profileId: number) {
    const items = this.db
      .prepare(
        `SELECT id, profile_id, item_id, env, institution_id, institution_name,
                sync_cursor, status, last_error, last_synced_at, created_at
         FROM plaid_items WHERE profile_id = ? ORDER BY created_at`,
      )
      .all(profileId) as Array<Omit<PlaidItemRow, 'access_token'>>

    return items.map((item) => ({
      ...item,
      hasCursor: Boolean(item.sync_cursor),
      accounts: this.listPlaidAccounts(item.id),
    }))
  }

  /**
   * Connections the background refresh should pick up, across every profile.
   * Items awaiting a sign-in or with nothing mapped are left alone: syncing
   * those can only fail, and a failure would overwrite their status.
   */
  plaidItemsDueForSync(
    maxAgeMinutes: number,
  ): Array<Pick<PlaidItemRow, 'id' | 'env' | 'institution_name'>> {
    return this.db
      .prepare(
        `SELECT id, env, institution_name FROM plaid_items
         WHERE status != 'login_required'
           AND (last_synced_at IS NULL
                OR last_synced_at <= datetime('now', ?))
           AND EXISTS (
             SELECT 1 FROM plaid_accounts pa
             WHERE pa.item_row_id = plaid_items.id
               AND pa.linked = 1
               AND pa.account_id IS NOT NULL
           )
         ORDER BY last_synced_at IS NOT NULL, last_synced_at`,
      )
      .all(`-${Math.max(1, Math.round(maxAgeMinutes))} minutes`) as Array<
      Pick<PlaidItemRow, 'id' | 'env' | 'institution_name'>
    >
  }

  listPlaidAccounts(itemRowId: number): PlaidAccountRow[] {
    return this.db
      .prepare(
        `SELECT * FROM plaid_accounts WHERE item_row_id = ?
         ORDER BY type, name`,
      )
      .all(itemRowId) as PlaidAccountRow[]
  }

  getPlaidItem(id: number): PlaidItemRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM plaid_items WHERE id = ?')
        .get(id) as PlaidItemRow | undefined) ?? null
    )
  }

  /** Re-linking the same institution refreshes the token instead of duplicating. */
  upsertPlaidItem(payload: {
    profileId: number
    itemId: string
    accessToken: string
    env: string
    institutionId?: string | null
    institutionName?: string | null
  }): PlaidItemRow {
    this.db
      .prepare(
        `INSERT INTO plaid_items
           (profile_id, item_id, access_token, env, institution_id, institution_name)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           access_token = excluded.access_token,
           env = excluded.env,
           institution_id = COALESCE(excluded.institution_id, plaid_items.institution_id),
           institution_name = COALESCE(excluded.institution_name, plaid_items.institution_name),
           status = 'ok',
           last_error = NULL`,
      )
      .run(
        payload.profileId,
        payload.itemId,
        payload.accessToken,
        payload.env,
        payload.institutionId ?? null,
        payload.institutionName ?? null,
      )
    return this.db
      .prepare('SELECT * FROM plaid_items WHERE item_id = ?')
      .get(payload.itemId) as PlaidItemRow
  }

  /** Refreshes names and balances while keeping any account mapping intact. */
  upsertPlaidAccounts(
    itemRowId: number,
    accounts: Array<{
      plaidAccountId: string
      name: string
      officialName?: string | null
      mask?: string | null
      type?: string | null
      subtype?: string | null
      currentBalance?: number | null
      availableBalance?: number | null
    }>,
  ): PlaidAccountRow[] {
    const stmt = this.db.prepare(
      `INSERT INTO plaid_accounts
         (item_row_id, plaid_account_id, name, official_name, mask, type, subtype,
          current_balance, available_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plaid_account_id) DO UPDATE SET
         name = excluded.name,
         official_name = excluded.official_name,
         mask = excluded.mask,
         type = excluded.type,
         subtype = excluded.subtype,
         current_balance = excluded.current_balance,
         available_balance = excluded.available_balance`,
    )
    const run = this.db.transaction(() => {
      for (const a of accounts) {
        stmt.run(
          itemRowId,
          a.plaidAccountId,
          a.name,
          a.officialName ?? null,
          a.mask ?? null,
          a.type ?? null,
          a.subtype ?? null,
          a.currentBalance ?? null,
          a.availableBalance ?? null,
        )
      }
    })
    run()
    return this.listPlaidAccounts(itemRowId)
  }

  mapPlaidAccount(payload: {
    plaidAccountRowId: number
    accountId: number | null
    linked: boolean
  }) {
    this.db
      .prepare(
        'UPDATE plaid_accounts SET account_id = ?, linked = ? WHERE id = ?',
      )
      .run(
        payload.accountId,
        payload.linked && payload.accountId != null ? 1 : 0,
        payload.plaidAccountRowId,
      )
  }

  setPlaidCursor(id: number, cursor: string | null) {
    this.db
      .prepare('UPDATE plaid_items SET sync_cursor = ? WHERE id = ?')
      .run(cursor, id)
  }

  setPlaidStatus(id: number, status: string, error?: string | null) {
    this.db
      .prepare('UPDATE plaid_items SET status = ?, last_error = ? WHERE id = ?')
      .run(status, error ?? null, id)
  }

  markPlaidSynced(id: number) {
    this.db
      .prepare(
        `UPDATE plaid_items
         SET last_synced_at = datetime('now'), status = 'ok', last_error = NULL
         WHERE id = ?`,
      )
      .run(id)
  }

  setAccountBalance(accountId: number, balance: number) {
    this.db
      .prepare('UPDATE accounts SET balance = ? WHERE id = ?')
      .run(balance, accountId)
  }

  /**
   * Forgetting a bank always drops the link rows. Transactions can stay behind
   * as plain history, which is usually what you want after a year of data.
   */
  deletePlaidItem(id: number, deleteTransactions: boolean) {
    const run = this.db.transaction(() => {
      if (deleteTransactions) {
        this.db
          .prepare(
            `DELETE FROM transactions
             WHERE plaid_transaction_id IS NOT NULL
               AND account_id IN (
                 SELECT account_id FROM plaid_accounts
                 WHERE item_row_id = ? AND account_id IS NOT NULL
               )`,
          )
          .run(id)
      }
      this.db.prepare('DELETE FROM plaid_items WHERE id = ?').run(id)
    })
    run()
  }

  /**
   * Applies one page of /transactions/sync. Amounts arrive already flipped to
   * our convention (negative = money out) and categories fall back to a name
   * from Plaid's taxonomy only when our own rules have nothing to say.
   */
  applyPlaidChanges(payload: {
    profileId: number
    itemRowId: number
    added: PlaidTxInput[]
    modified: PlaidTxInput[]
    removed: string[]
  }) {
    const accountMap = new Map(
      (
        this.db
          .prepare(
            `SELECT plaid_account_id, account_id FROM plaid_accounts
             WHERE item_row_id = ? AND linked = 1 AND account_id IS NOT NULL`,
          )
          .all(payload.itemRowId) as Array<{
          plaid_account_id: string
          account_id: number
        }>
      ).map((r) => [r.plaid_account_id, r.account_id]),
    )

    const insert = this.db.prepare(
      `INSERT INTO transactions
         (profile_id, account_id, date, amount, payee, memo, category_id,
          is_transfer, plaid_transaction_id, pending)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plaid_transaction_id) DO UPDATE SET
         account_id = excluded.account_id,
         date = excluded.date,
         amount = excluded.amount,
         payee = excluded.payee,
         memo = excluded.memo,
         pending = excluded.pending,
         category_id = COALESCE(transactions.category_id, excluded.category_id),
         is_transfer = CASE
           WHEN transactions.category_id IS NULL THEN excluded.is_transfer
           ELSE transactions.is_transfer
         END`,
    )
    const dropPending = this.db.prepare(
      'DELETE FROM transactions WHERE plaid_transaction_id = ?',
    )

    let inserted = 0
    let updated = 0
    let deleted = 0
    let skipped = 0
    let earliest: string | null = null
    let latest: string | null = null
    const touchedAccounts = new Set<number>()

    const write = (tx: PlaidTxInput) => {
      const accountId = accountMap.get(tx.plaidAccountId)
      if (!accountId) {
        skipped += 1
        return
      }
      // A posted transaction supersedes the pending row it grew out of.
      if (tx.replacesPlaidId) dropPending.run(tx.replacesPlaidId)

      const categoryId =
        applyCategoryRules(this.db, payload.profileId, tx.payee, tx.memo) ??
        (tx.fallbackCategory
          ? this.findCategoryByName(payload.profileId, tx.fallbackCategory)
          : null)

      const existed = this.db
        .prepare(
          'SELECT id FROM transactions WHERE plaid_transaction_id = ?',
        )
        .get(tx.plaidId) as { id: number } | undefined

      insert.run(
        payload.profileId,
        accountId,
        tx.date,
        tx.amount,
        tx.payee,
        tx.memo,
        categoryId,
        this.transferFlag(categoryId),
        tx.plaidId,
        tx.pending ? 1 : 0,
      )
      if (existed) updated += 1
      else inserted += 1

      touchedAccounts.add(accountId)
      if (!earliest || tx.date < earliest) earliest = tx.date
      if (!latest || tx.date > latest) latest = tx.date
    }

    const run = this.db.transaction(() => {
      for (const tx of payload.added) write(tx)
      for (const tx of payload.modified) write(tx)
      for (const id of payload.removed) {
        deleted += dropPending.run(id).changes
      }
    })
    run()

    return {
      inserted,
      updated,
      deleted,
      skipped,
      earliest: earliest as string | null,
      latest: latest as string | null,
      accountIds: [...touchedAccounts],
    }
  }

  /**
   * Counts hand-entered / CSV rows sitting in the same window as freshly synced
   * bank data, so the user knows what to purge.
   */
  plaidOverlap(profileId: number, accountIds: number[], from: string, to: string) {
    if (!accountIds.length) return []
    const placeholders = accountIds.map(() => '?').join(',')
    return this.db
      .prepare(
        `SELECT t.account_id, a.name AS account_name, COUNT(*) AS count
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.profile_id = ?
           AND t.plaid_transaction_id IS NULL
           AND t.account_id IN (${placeholders})
           AND t.date >= ? AND t.date <= ?
         GROUP BY t.account_id
         ORDER BY count DESC`,
      )
      .all(profileId, ...accountIds, from, to) as Array<{
      account_id: number
      account_name: string
      count: number
    }>
  }
}

export type PlaidTxInput = {
  plaidId: string
  plaidAccountId: string
  date: string
  /** Already in our convention: negative is money out. */
  amount: number
  payee: string
  memo: string | null
  pending: boolean
  /** Plaid's pending row that this posted transaction replaces. */
  replacesPlaidId: string | null
  /** Category name from Plaid's taxonomy, used only if our rules miss. */
  fallbackCategory: string | null
}
