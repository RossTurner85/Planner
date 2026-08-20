export type ProfileRole = 'adult' | 'dependent'

export type Profile = {
  id: number
  name: string
  color: string
  created_at: string
  role: ProfileRole
}

export type Account = {
  id: number
  profile_id: number
  name: string
  type: string
  institution: string | null
  balance: number
  /** Day of the month a card statement is due (1–31) */
  due_day: number | null
  /** Set when listing the household's accounts together. */
  owner_name?: string
  owner_color?: string
  owner_role?: string
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
  person_id: number | null
  category_name?: string | null
  account_name?: string
  person_name?: string | null
  payee_display?: string
  merchant_key?: string
}

export type Person = {
  id: number
  profile_id: number
  name: string
  created_at: string
}

export type BillStatus = {
  id: number
  name: string
  amount: number
  due_day: number | null
  next_due_date?: string | null
  dueDate: string
  status: 'paid' | 'due' | 'overdue' | 'upcoming'
  matchedTxId?: number
  matchedAmount?: number
  matchedDate?: string | null
  paidSource?: 'transaction' | 'manual' | null
  paidManually?: boolean
  payee_hint?: string | null
  account_id?: number | null
  category_id?: number | null
  autopay?: number | boolean
  autopay_day?: number | null
  autopayDate?: string | null
  principal?: number | null
  interest?: number | null
  escrow?: number | null
  is_mortgage?: number | boolean
  minimum_payment?: number | null
  statement_balance?: number | null
  document_path?: string | null
  document_name?: string | null
}

export type Goal = {
  id: number
  profile_id: number
  name: string
  target_amount: number
  current_amount: number
  target_date: string | null
  color: string
  status: string
  /** 1 is the goal the user cares about most; the home page shows that one. */
  priority: number
}

/** What the user said drives them, plus the line the coach wrote from it. */
export type Motivation = {
  raw: string
  line: string
}

export type MotivationSaved = Motivation & {
  /** False when the line is just their own words tidied up. */
  reworded: boolean
  note?: string
}

export type Dashboard = {
  cash: number
  creditLiability: number
  accountCount: number
  income: number
  spent: number
  txCount: number
  uncategorized: number
  budget: {
    planned: number
    spent: number
    remaining: number
    categories: Array<{
      category_id: number
      category_name: string
      amount: number
      spent: number
      emoji?: string
    }>
  }
  bills: BillStatus[]
  goals: Goal[]
  motivation: Motivation | null
  topSpend: Array<{ name: string; total: number }>
  recent: Transaction[]
  accounts: Account[]
}

export type ImportRow = {
  date: string
  amount: number
  payee: string
  memo?: string
}

export type MortgageBreakdown = {
  principal: number | null
  interest: number | null
  escrow: number | null
  regularPayment: number | null
  pastDue: number | null
  fees: number | null
}

export type CreditCardBreakdown = {
  statementBalance: number | null
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
  isMortgage: boolean
  mortgage: MortgageBreakdown | null
  isCreditCard: boolean
  creditCard: CreditCardBreakdown | null
}

/** Editable draft after PDF scan */
export type BillPdfDraft = ParsedBillPdf & {
  amountInput: string
  /** Empty = no day-of-month schedule */
  dueDayInput: string
  /** Optional full date YYYY-MM-DD — only that month lists this bill */
  nextDueDateInput: string
  categoryId: number | ''
  accountId: number | ''
  autopay: boolean
  autopayDayInput: string
  principalInput: string
  interestInput: string
  escrowInput: string
  statementBalanceInput: string
  minimumPaymentInput: string
  saveResult?: string | null
}

export type TrendRange = 'mom' | '3m' | '6m' | '1y'

export type TrendsData = {
  range: TrendRange
  anchorMonth: string
  periodMonths: number
  currentLabel: string
  previousLabel: string
  series: Array<{
    month: string
    label: string
    spent: number
    income: number
    net: number
  }>
  summary: {
    currentSpent: number
    currentIncome: number
    currentNet: number
    previousSpent: number
    previousIncome: number
    previousNet: number
    spentChangePct: number | null
    incomeChangePct: number | null
    netChangePct: number | null
    avgSpent: number
    avgIncome: number
    totalSpent: number
    totalIncome: number
  }
  categoryChanges: Array<{
    name: string
    current: number
    previous: number
    changeAbs: number
    changePct: number
  }>
  risers: Array<{
    name: string
    current: number
    previous: number
    changeAbs: number
    changePct: number
  }>
  fallers: Array<{
    name: string
    current: number
    previous: number
    changeAbs: number
    changePct: number
  }>
}

export type MonthPoint = {
  month: string
  label: string
  spent: number
  income: number
  net: number
  txCount: number
}

export type CategoryMonthRow = {
  month: string
  name: string
  group_name: string
  total: number
}

export type IncomeReport = {
  total: number
  sources: Array<{
    name: string
    category: string
    total: number
    count: number
    months: number
  }>
  byMonth: Array<{ month: string; label: string; total: number }>
}

export type RecurringChange = {
  name: string
  monthsSeen: number
  latest: number
  latestMonth: string
  priorAvg: number
  changeAbs: number
  changePct: number | null
}

export type StatementImport = {
  id: number
  profile_id: number
  account_id: number
  file_name: string
  imported_count: number
  skipped_count: number
  money_in: number
  money_out: number
  date_from: string | null
  date_to: string | null
  created_at: string
  account_name?: string
  account_type?: string
  /** Transactions still linked to this import (can be undone). */
  linked_tx_count?: number
}

export type PageId =
  | 'home'
  | 'transactions'
  | 'budgets'
  | 'bills'
  | 'goals'
  | 'insights'
  | 'setup'

/** Sub-tabs inside Insights — App owns the value so links can deep-link. */
export type InsightTab = 'overview' | 'trends' | 'reports' | 'coach'

export type NavOptions = {
  accountId?: number
  tab?: InsightTab
  /** Transactions page: pre-fill the search box and date range on arrival. */
  search?: string
  from?: string
  to?: string
  /** Insights → Coach: ask this the moment the tab opens. */
  coachQuestion?: string
}

export type AiModelInfo = { id: string; label: string; blurb: string }

export type AiStatus = {
  configured: boolean
  keyHint: string | null
  model: string
  encryptionAvailable: boolean
  models: AiModelInfo[]
}

/** Something the coach chose to draw rather than describe. */
export type AiCard =
  | {
      kind: 'chart'
      chart: 'bar' | 'line' | 'donut'
      title: string
      note: string | null
      points: Array<{ label: string; value: number }>
    }
  | {
      kind: 'table'
      title: string
      note: string | null
      columns: Array<{ label: string; numeric: boolean }>
      rows: string[][]
    }
  | {
      kind: 'link'
      label: string
      page: string
      tab: string | null
      month: string | null
      search: string | null
      from: string | null
      to: string | null
    }

export type AiAuditCall = {
  tool: string
  args: Record<string, unknown>
  sent: string
  bytes: number
}

export type AiAskResult = {
  answer: string
  cards: AiCard[]
  model: string
  tokensIn: number
  tokensOut: number
  audit: {
    instructions: string
    question: string
    calls: AiAuditCall[]
  }
}

export type AiTurn = { role: 'user' | 'assistant'; text: string }

export type UpdateSource = 'github' | 'local'

export type AppUpdateStatus = {
  current: string
  packaged: boolean
  feedDir: string
  available: boolean
  latest: string | null
  installerPath: string | null
  installerName: string | null
  source: UpdateSource | null
  message: string
}

export type AppUpdateApplyResult =
  | { ok: true }
  | { ok: false; error: string; cancelled?: boolean }

declare global {
  interface Window {
    finance: {
      profiles: {
        list: () => Promise<Profile[]>
        create: (name: string, color: string) => Promise<Profile>
        update: (id: number, name: string, color: string) => Promise<Profile>
      }
      accounts: {
        list: (profileId: number) => Promise<Account[]>
        listHousehold: () => Promise<Account[]>
        create: (payload: unknown) => Promise<Account>
        update: (id: number, payload: unknown) => Promise<Account>
        delete: (id: number) => Promise<void>
      }
      transactions: {
        list: (profileId: number, filters?: unknown) => Promise<Transaction[]>
        create: (payload: unknown) => Promise<Transaction>
        update: (id: number, payload: unknown) => Promise<unknown>
        delete: (id: number) => Promise<void>
        categorize: (id: number, categoryId: number | null) => Promise<void>
        categorizeMany: (payload: {
          ids: number[]
          categoryId: number | null
          profileId?: number
          saveRuleMatch?: string | null
        }) => Promise<{ updated: number }>
        assignPerson: (payload: {
          ids: number[]
          personId: number | null
        }) => Promise<{ updated: number }>
        recategorizeUncategorized: (
          profileId: number,
        ) => Promise<{ updated: number }>
      }
      categories: {
        list: (profileId: number) => Promise<Category[]>
        create: (payload: {
          profileId: number
          name: string
          groupName: string
          kind: string
          emoji?: string
        }) => Promise<Category>
        findByName: (profileId: number, name: string) => Promise<number | null>
      }
      people: {
        list: (profileId: number) => Promise<Person[]>
        create: (profileId: number, name: string) => Promise<Person>
        rename: (id: number, name: string) => Promise<Person>
        delete: (id: number) => Promise<void>
      }
      budgets: {
        list: (profileId: number, month: string) => Promise<unknown[]>
        upsert: (payload: unknown) => Promise<void>
        summary: (profileId: number, month: string) => Promise<{
          planned: number
          spent: number
          remaining: number
          categories: Array<{
            category_id: number
            category_name: string
            amount: number
            spent: number
            emoji?: string
            group_name?: string
          }>
        }>
      }
      goals: {
        list: (profileId: number) => Promise<Goal[]>
        create: (payload: unknown) => Promise<Goal>
        update: (id: number, payload: unknown) => Promise<Goal>
        delete: (id: number) => Promise<void>
        move: (id: number, direction: 'up' | 'down') => Promise<Goal[]>
      }
      motivation: {
        get: (profileId: number) => Promise<Motivation | null>
        save: (payload: {
          profileId: number
          raw: string
        }) => Promise<IpcResult<MotivationSaved>>
        clear: (profileId: number) => Promise<void>
      }
      bills: {
        list: (profileId: number) => Promise<unknown[]>
        create: (payload: unknown) => Promise<unknown>
        update: (id: number, payload: unknown) => Promise<unknown>
        delete: (id: number) => Promise<void>
        status: (profileId: number, month: string) => Promise<BillStatus[]>
        markPaid: (payload: {
          profileId: number
          billId: number
          month: string
          paidOn?: string | null
          note?: string | null
        }) => Promise<BillStatus | undefined>
        unmarkPaid: (payload: {
          profileId: number
          billId: number
          month: string
        }) => Promise<BillStatus | undefined>
        openDocument: (
          billId: number,
        ) => Promise<{ ok: boolean; error?: string }>
      }
      reports: {
        spendingByCategory: (
          scope: number | number[],
          from: string,
          to: string,
        ) => Promise<Array<{ name: string; total: number; group_name: string }>>
        spendingByMonth: (
          scope: number | number[],
          months: number,
        ) => Promise<Array<{ month: string; spent: number; income: number }>>
        trends: (
          scope: number | number[],
          range: TrendRange,
          month: string,
        ) => Promise<TrendsData>
        monthlySeries: (
          scope: number | number[],
          fromMonth: string,
          toMonth: string,
        ) => Promise<MonthPoint[]>
        categoryMonthly: (
          scope: number | number[],
          fromMonth: string,
          toMonth: string,
        ) => Promise<CategoryMonthRow[]>
        incomeReport: (
          scope: number | number[],
          fromMonth: string,
          toMonth: string,
        ) => Promise<IncomeReport>
        recurring: (
          scope: number | number[],
          anchorMonth: string,
          months: number,
        ) => Promise<RecurringChange[]>
      }
      dashboard: {
        get: (profileId: number, month: string) => Promise<Dashboard>
      }
      import: {
        pickCsv: () => Promise<{
          filePath: string
          fileName: string
          rows: ImportRow[]
          endingBalance?: number | null
          startingBalance?: number | null
          notes?: string[]
        } | null>
        pickBankPdfs: () => Promise<
          Array<{
            filePath: string
            fileName: string
            rows: ImportRow[]
            endingBalance: number | null
            notes: string[]
            confidence: 'high' | 'medium' | 'low'
            textPreview: string
          }> | null
        >
        commit: (payload: unknown) => Promise<{
          imported: number
          skipped: number
          moneyIn?: number
          moneyOut?: number
          dateFrom?: string | null
          dateTo?: string | null
          accountBalance?: number | null
          accountName?: string | null
        }>
        statementHistory: (profileId: number) => Promise<StatementImport[]>
        updateStatement: (payload: {
          id: number
          fileName?: string
          accountId?: number
        }) => Promise<StatementImport>
        deleteStatement: (payload: {
          id: number
          undoTransactions?: boolean
        }) => Promise<{
          fileName: string
          removedTransactions: number
          reversedAmount: number
          accountBalance: number | null
          accountName: string | null
        }>
        pickBillPdfs: () => Promise<ParsedBillPdf[] | null>
        commitBillPdf: (payload: unknown) => Promise<{
          action: 'created' | 'updated'
          billId: number
          matchedTransaction: {
            id: number
            date: string
            payee: string
            amount: number
          } | null
          categorized: number
        }>
      }
      coach: {
        insights: (
          profileId: number,
          month: string,
        ) => Promise<{ source: string; insights: string[] }>
        ask: (
          profileId: number,
          month: string,
          question: string,
        ) => Promise<{ source: string; insights: string[]; answer?: string }>
      }
      ai: {
        status: () => Promise<AiStatus>
        saveKey: (payload: {
          key: string
          model?: string
        }) => Promise<IpcResult<AiStatus>>
        setModel: (model: string) => Promise<IpcResult<AiStatus>>
        clearKey: () => Promise<IpcResult<AiStatus>>
        ask: (payload: {
          profileId: number
          month: string
          question: string
          history?: AiTurn[]
        }) => Promise<IpcResult<AiAskResult>>
      }
      plaid: {
        status: () => Promise<PlaidStatus>
        saveKeys: (payload: {
          clientId: string
          secret: string
          env: PlaidEnv
        }) => Promise<PlaidResult<PlaidStatus>>
        clearKeys: () => Promise<PlaidResult<PlaidStatus>>
        items: (profileId: number) => Promise<PlaidItem[]>
        connectStart: (
          profileId: number,
        ) => Promise<PlaidResult<{ linkToken: string; url: string }>>
        connectPoll: (
          profileId: number,
          linkToken: string,
        ) => Promise<PlaidResult<PlaidConnectPoll>>
        reconnect: (
          itemRowId: number,
        ) => Promise<PlaidResult<{ linkToken: string; url: string }>>
        finishMapping: (payload: {
          profileId: number
          itemRowId: number
          choices: PlaidMappingChoice[]
        }) => Promise<PlaidResult<PlaidLinkedAccount[]>>
        sync: (
          itemRowId: number,
          awaitHistory?: boolean,
        ) => Promise<PlaidResult<PlaidSyncResult>>
        syncAll: (
          profileId: number,
        ) => Promise<PlaidResult<PlaidSyncResult[]>>
        /** Returns an unsubscribe function. */
        onAutoSynced: (cb: (summary: AutoSyncSummary) => void) => () => void
        disconnect: (
          itemRowId: number,
          deleteTransactions: boolean,
        ) => Promise<PlaidResult<void>>
      }
      app: {
        dataPath: () => Promise<string>
        version: () => Promise<string>
        updateStatus: () => Promise<AppUpdateStatus>
        updateApply: () => Promise<AppUpdateApplyResult>
        updatePick: () => Promise<AppUpdateApplyResult>
        onUpdateAvailable: (cb: (status: AppUpdateStatus) => void) => () => void
        onUpdateProgress: (cb: (percent: number) => void) => () => void
      }
    }
  }
}

export type PlaidEnv = 'sandbox' | 'production'

/** What the background bank refresh brought in, when it brought anything. */
export type AutoSyncSummary = {
  inserted: number
  updated: number
  deleted: number
  banks: string[]
}

/** Main-process calls that touch the network report failure instead of throwing. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export type PlaidResult<T> = IpcResult<T>

export type PlaidStatus = {
  configured: boolean
  env: PlaidEnv
  clientIdHint: string | null
  encryptionAvailable: boolean
}

export type PlaidLinkedAccount = {
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

export type PlaidItem = {
  id: number
  profile_id: number
  item_id: string
  env: string
  institution_id: string | null
  institution_name: string | null
  status: string
  last_error: string | null
  last_synced_at: string | null
  created_at: string
  hasCursor: boolean
  accounts: PlaidLinkedAccount[]
}

export type PlaidConnectPoll =
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

export type PlaidMappingChoice = {
  plaidAccountRowId: number
  accountId: number | null
  create: boolean
  name: string
  type: string
}

export type PlaidSyncResult = {
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
  historyPending?: boolean
  error?: string
}

export {}
