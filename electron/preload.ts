import { contextBridge, ipcRenderer } from 'electron'

const api = {
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (name: string, color: string) =>
      ipcRenderer.invoke('profiles:create', name, color),
    update: (id: number, name: string, color: string) =>
      ipcRenderer.invoke('profiles:update', id, name, color),
  },
  accounts: {
    list: (profileId: number) => ipcRenderer.invoke('accounts:list', profileId),
    listHousehold: () => ipcRenderer.invoke('accounts:listHousehold'),
    create: (payload: unknown) => ipcRenderer.invoke('accounts:create', payload),
    update: (id: number, payload: unknown) =>
      ipcRenderer.invoke('accounts:update', id, payload),
    delete: (id: number) => ipcRenderer.invoke('accounts:delete', id),
  },
  transactions: {
    list: (profileId: number, filters?: unknown) =>
      ipcRenderer.invoke('transactions:list', profileId, filters),
    create: (payload: unknown) =>
      ipcRenderer.invoke('transactions:create', payload),
    update: (id: number, payload: unknown) =>
      ipcRenderer.invoke('transactions:update', id, payload),
    delete: (id: number) => ipcRenderer.invoke('transactions:delete', id),
    categorize: (id: number, categoryId: number | null) =>
      ipcRenderer.invoke('transactions:categorize', id, categoryId),
    categorizeMany: (payload: unknown) =>
      ipcRenderer.invoke('transactions:categorizeMany', payload),
    recategorizeUncategorized: (profileId: number) =>
      ipcRenderer.invoke('transactions:recategorizeUncategorized', profileId),
    assignPerson: (payload: unknown) =>
      ipcRenderer.invoke('transactions:assignPerson', payload),
  },
  people: {
    list: (profileId: number) => ipcRenderer.invoke('people:list', profileId),
    create: (profileId: number, name: string) =>
      ipcRenderer.invoke('people:create', profileId, name),
    rename: (id: number, name: string) =>
      ipcRenderer.invoke('people:rename', id, name),
    delete: (id: number) => ipcRenderer.invoke('people:delete', id),
  },
  categories: {
    list: (profileId: number) =>
      ipcRenderer.invoke('categories:list', profileId),
    create: (payload: unknown) =>
      ipcRenderer.invoke('categories:create', payload),
    findByName: (profileId: number, name: string) =>
      ipcRenderer.invoke('categories:findByName', profileId, name),
  },
  budgets: {
    list: (profileId: number, month: string) =>
      ipcRenderer.invoke('budgets:list', profileId, month),
    upsert: (payload: unknown) => ipcRenderer.invoke('budgets:upsert', payload),
    summary: (profileId: number, month: string) =>
      ipcRenderer.invoke('budgets:summary', profileId, month),
  },
  goals: {
    list: (profileId: number) => ipcRenderer.invoke('goals:list', profileId),
    create: (payload: unknown) => ipcRenderer.invoke('goals:create', payload),
    update: (id: number, payload: unknown) =>
      ipcRenderer.invoke('goals:update', id, payload),
    delete: (id: number) => ipcRenderer.invoke('goals:delete', id),
    move: (id: number, direction: 'up' | 'down') =>
      ipcRenderer.invoke('goals:move', id, direction),
  },
  motivation: {
    get: (profileId: number) => ipcRenderer.invoke('motivation:get', profileId),
    save: (payload: unknown) => ipcRenderer.invoke('motivation:save', payload),
    clear: (profileId: number) =>
      ipcRenderer.invoke('motivation:clear', profileId),
  },
  bills: {
    list: (profileId: number) => ipcRenderer.invoke('bills:list', profileId),
    create: (payload: unknown) => ipcRenderer.invoke('bills:create', payload),
    update: (id: number, payload: unknown) =>
      ipcRenderer.invoke('bills:update', id, payload),
    delete: (id: number) => ipcRenderer.invoke('bills:delete', id),
    status: (profileId: number, month: string) =>
      ipcRenderer.invoke('bills:status', profileId, month),
    markPaid: (payload: unknown) =>
      ipcRenderer.invoke('bills:markPaid', payload),
    unmarkPaid: (payload: unknown) =>
      ipcRenderer.invoke('bills:unmarkPaid', payload),
    openDocument: (billId: number) =>
      ipcRenderer.invoke('bills:openDocument', billId),
  },
  reports: {
    spendingByCategory: (
      scope: number | number[],
      from: string,
      to: string,
    ) => ipcRenderer.invoke('reports:spendingByCategory', scope, from, to),
    spendingByMonth: (scope: number | number[], months: number) =>
      ipcRenderer.invoke('reports:spendingByMonth', scope, months),
    trends: (
      scope: number | number[],
      range: 'mom' | '3m' | '6m' | '1y',
      month: string,
    ) => ipcRenderer.invoke('reports:trends', scope, range, month),
    monthlySeries: (
      scope: number | number[],
      fromMonth: string,
      toMonth: string,
    ) => ipcRenderer.invoke('reports:monthlySeries', scope, fromMonth, toMonth),
    categoryMonthly: (
      scope: number | number[],
      fromMonth: string,
      toMonth: string,
    ) =>
      ipcRenderer.invoke(
        'reports:categoryMonthly',
        scope,
        fromMonth,
        toMonth,
      ),
    incomeReport: (
      scope: number | number[],
      fromMonth: string,
      toMonth: string,
    ) => ipcRenderer.invoke('reports:incomeReport', scope, fromMonth, toMonth),
    recurring: (
      scope: number | number[],
      anchorMonth: string,
      months: number,
    ) => ipcRenderer.invoke('reports:recurring', scope, anchorMonth, months),
  },
  dashboard: {
    get: (profileId: number, month: string) =>
      ipcRenderer.invoke('dashboard:get', profileId, month),
  },
  import: {
    pickCsv: () => ipcRenderer.invoke('import:pickCsv'),
    pickBankPdfs: () => ipcRenderer.invoke('import:pickBankPdfs'),
    commit: (payload: unknown) => ipcRenderer.invoke('import:commit', payload),
    statementHistory: (profileId: number) =>
      ipcRenderer.invoke('import:statementHistory', profileId),
    updateStatement: (payload: unknown) =>
      ipcRenderer.invoke('import:updateStatement', payload),
    deleteStatement: (payload: unknown) =>
      ipcRenderer.invoke('import:deleteStatement', payload),
    pickBillPdfs: () => ipcRenderer.invoke('import:pickBillPdfs'),
    commitBillPdf: (payload: unknown) =>
      ipcRenderer.invoke('import:commitBillPdf', payload),
  },
  coach: {
    insights: (profileId: number, month: string) =>
      ipcRenderer.invoke('coach:insights', profileId, month),
    ask: (profileId: number, month: string, question: string) =>
      ipcRenderer.invoke('coach:ask', profileId, month, question),
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    saveKey: (payload: unknown) => ipcRenderer.invoke('ai:saveKey', payload),
    setModel: (model: string) => ipcRenderer.invoke('ai:setModel', model),
    clearKey: () => ipcRenderer.invoke('ai:clearKey'),
    ask: (payload: unknown) => ipcRenderer.invoke('ai:ask', payload),
  },
  plaid: {
    status: () => ipcRenderer.invoke('plaid:status'),
    saveKeys: (payload: unknown) =>
      ipcRenderer.invoke('plaid:saveKeys', payload),
    clearKeys: () => ipcRenderer.invoke('plaid:clearKeys'),
    items: (profileId: number) => ipcRenderer.invoke('plaid:items', profileId),
    connectStart: (profileId: number) =>
      ipcRenderer.invoke('plaid:connectStart', profileId),
    connectPoll: (profileId: number, linkToken: string) =>
      ipcRenderer.invoke('plaid:connectPoll', profileId, linkToken),
    reconnect: (itemRowId: number) =>
      ipcRenderer.invoke('plaid:reconnect', itemRowId),
    finishMapping: (payload: unknown) =>
      ipcRenderer.invoke('plaid:finishMapping', payload),
    sync: (itemRowId: number, awaitHistory?: boolean) =>
      ipcRenderer.invoke('plaid:sync', itemRowId, awaitHistory),
    syncAll: (profileId: number) =>
      ipcRenderer.invoke('plaid:syncAll', profileId),
    /** Fires when the background refresh actually brought something in. */
    onAutoSynced: (cb: (summary: unknown) => void) => {
      const handler = (_e: unknown, summary: unknown) => cb(summary)
      ipcRenderer.on('plaid:autoSynced', handler)
      return () => ipcRenderer.removeListener('plaid:autoSynced', handler)
    },
    disconnect: (itemRowId: number, deleteTransactions: boolean) =>
      ipcRenderer.invoke('plaid:disconnect', itemRowId, deleteTransactions),
  },
  app: {
    dataPath: () => ipcRenderer.invoke('app:dataPath'),
    version: () => ipcRenderer.invoke('app:version'),
    updateStatus: () => ipcRenderer.invoke('app:updateStatus'),
    updateApply: () => ipcRenderer.invoke('app:updateApply'),
    updatePick: () => ipcRenderer.invoke('app:updatePick'),
    onUpdateAvailable: (cb: (status: unknown) => void) => {
      const handler = (_e: unknown, status: unknown) => cb(status)
      ipcRenderer.on('app:updateAvailable', handler)
      return () => ipcRenderer.removeListener('app:updateAvailable', handler)
    },
    onUpdateProgress: (cb: (percent: number) => void) => {
      const handler = (_e: unknown, percent: number) => cb(percent)
      ipcRenderer.on('app:updateProgress', handler)
      return () => ipcRenderer.removeListener('app:updateProgress', handler)
    },
  },
}

contextBridge.exposeInMainWorld('finance', api)

export type FinanceApi = typeof api
