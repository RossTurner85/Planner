import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  screen,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import pdfParse from 'pdf-parse'
import { FinanceDb } from './db'
import { parseStatementCsv } from './importCsv'
import { parseBillText } from './parseBillPdf'
import { parseBankStatementText } from './parseBankStatementPdf'
import {
  getCoachInsights,
  askCoach,
  type CoachContext,
} from './coach'
import { verifyCreds, type PlaidEnv } from './plaid'
import { clearCreds, credStatus, saveCreds } from './plaidCreds'
import { AI_MODELS, verifyKey } from './openai'
import { aiStatus, clearKey, saveKey, saveModel } from './aiCreds'
import { askAiCoach, type AiTurn } from './aiCoach'
import { writeMotivationLine } from './motivation'
import { runExclusive, startAutoSync, stopAutoSync } from './plaidAuto'
import {
  disconnect as plaidDisconnect,
  finishMapping,
  pollConnect,
  startConnect,
  startReconnect,
  syncAll,
  syncItem,
} from './plaidSync'
import {
  applyFoundUpdate,
  checkUpdates,
  pickAndApplyInstaller,
  setupAutoUpdater,
} from './updater'

let mainWindow: BrowserWindow | null = null
let db: FinanceDb

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

/**
 * Keep the same data folder in development and in a packaged install, so
 * installing the app never starts you over with an empty database.
 */
app.setPath('userData', path.join(app.getPath('appData'), 'bizzys-finance'))

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  revealWindow(mainWindow)
})

/**
 * Chromium stops painting a window it thinks is covered, which makes the app
 * show a frozen frame while the editor is in front — hot reloads look like they
 * did nothing. Only relaxed in development; in a shipped build, letting a hidden
 * window idle is the polite thing to do.
 */
if (isDev) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
}

function revealWindow(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(1320, area.width)
  const height = Math.min(860, area.height)
  win.setBounds({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  })
  if (win.isMinimized()) win.restore()
  win.show()
  win.moveTop()
  win.focus()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 800,
    minHeight: 560,
    title: "Bizzy's Finance",
    backgroundColor: '#e8ebe4',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: !isDev,
    },
  })

  mainWindow.once('ready-to-show', () => revealWindow(mainWindow))
  mainWindow.webContents.on('did-fail-load', (_event, _code, desc, url) => {
    dialog.showErrorBox(
      "Bizzy's Finance could not open",
      `${desc}\n\n${url || ''}`,
    )
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // If the page hangs, still put a window on this monitor.
  setTimeout(() => revealWindow(mainWindow), 2500)
}

function registerIpc() {
  ipcMain.handle('profiles:list', () => db.listProfiles())
  ipcMain.handle('profiles:create', (_e, name: string, color: string) =>
    db.createProfile(name, color),
  )
  ipcMain.handle('profiles:update', (_e, id: number, name: string, color: string) =>
    db.updateProfile(id, name, color),
  )

  ipcMain.handle('accounts:list', (_e, profileId: number) =>
    db.listAccounts(profileId),
  )
  ipcMain.handle('accounts:listHousehold', () => db.listHouseholdAccounts())
  ipcMain.handle(
    'accounts:create',
    (
      _e,
      payload: {
        profileId: number
        name: string
        type: string
        institution?: string
        balance: number
        dueDay?: number | null
      },
    ) => db.createAccount(payload),
  )
  ipcMain.handle(
    'accounts:update',
    (
      _e,
      id: number,
      payload: {
        name: string
        type: string
        institution?: string
        balance: number
        dueDay?: number | null
      },
    ) => db.updateAccount(id, payload),
  )
  ipcMain.handle('accounts:delete', (_e, id: number) => db.deleteAccount(id))

  ipcMain.handle(
    'transactions:list',
    (
      _e,
      profileId: number,
      filters?: {
        accountId?: number
        categoryId?: number
        search?: string
        from?: string
        to?: string
        limit?: number
      },
    ) => db.listTransactions(profileId, filters),
  )
  ipcMain.handle(
    'transactions:create',
    (
      _e,
      payload: {
        profileId: number
        accountId: number
        date: string
        amount: number
        payee: string
        memo?: string
        categoryId?: number | null
        isTransfer?: boolean
        transferAccountId?: number | null
      },
    ) => db.createTransaction(payload),
  )
  ipcMain.handle(
    'transactions:update',
    (
      _e,
      id: number,
      payload: {
        accountId: number
        date: string
        amount: number
        payee: string
        memo?: string
        categoryId?: number | null
      },
    ) => db.updateTransaction(id, payload),
  )
  ipcMain.handle('transactions:delete', (_e, id: number) =>
    db.deleteTransaction(id),
  )
  ipcMain.handle(
    'transactions:categorize',
    (_e, id: number, categoryId: number | null) =>
      db.categorizeTransaction(id, categoryId),
  )
  ipcMain.handle(
    'transactions:categorizeMany',
    (
      _e,
      payload: {
        ids: number[]
        categoryId: number | null
        profileId?: number
        saveRuleMatch?: string | null
      },
    ) => db.categorizeMany(payload),
  )
  ipcMain.handle(
    'transactions:recategorizeUncategorized',
    (_e, profileId: number) => db.recategorizeUncategorized(profileId),
  )
  ipcMain.handle(
    'transactions:assignPerson',
    (_e, payload: { ids: number[]; personId: number | null }) =>
      db.assignPerson(payload),
  )

  ipcMain.handle('people:list', (_e, profileId: number) =>
    db.listPeople(profileId),
  )
  ipcMain.handle('people:create', (_e, profileId: number, name: string) =>
    db.createPerson(profileId, name),
  )
  ipcMain.handle('people:rename', (_e, id: number, name: string) =>
    db.renamePerson(id, name),
  )
  ipcMain.handle('people:delete', (_e, id: number) => db.deletePerson(id))

  ipcMain.handle('categories:list', (_e, profileId: number) =>
    db.listCategories(profileId),
  )
  ipcMain.handle(
    'categories:create',
    (
      _e,
      payload: {
        profileId: number
        name: string
        groupName: string
        kind: string
        emoji?: string
      },
    ) => db.createCategory(payload),
  )

  ipcMain.handle('budgets:list', (_e, profileId: number, month: string) =>
    db.listBudgets(profileId, month),
  )
  ipcMain.handle(
    'budgets:upsert',
    (
      _e,
      payload: {
        profileId: number
        categoryId: number
        month: string
        amount: number
      },
    ) => db.upsertBudget(payload),
  )
  ipcMain.handle('budgets:summary', (_e, profileId: number, month: string) =>
    db.budgetSummary(profileId, month),
  )

  ipcMain.handle('goals:list', (_e, profileId: number) =>
    db.listGoals(profileId),
  )
  ipcMain.handle(
    'goals:create',
    (
      _e,
      payload: {
        profileId: number
        name: string
        targetAmount: number
        currentAmount: number
        targetDate?: string | null
        color?: string
      },
    ) => db.createGoal(payload),
  )
  ipcMain.handle(
    'goals:update',
    (
      _e,
      id: number,
      payload: {
        name: string
        targetAmount: number
        currentAmount: number
        targetDate?: string | null
        color?: string
        status?: string
      },
    ) => db.updateGoal(id, payload),
  )
  ipcMain.handle('goals:delete', (_e, id: number) => db.deleteGoal(id))
  ipcMain.handle('goals:move', (_e, id: number, direction: 'up' | 'down') =>
    db.moveGoal(id, direction),
  )

  ipcMain.handle('motivation:get', (_e, profileId: number) =>
    db.getMotivation(profileId),
  )
  ipcMain.handle(
    'motivation:save',
    (_e, payload: { profileId: number; raw: string }) =>
      settled(async () => {
        const raw = payload.raw.trim()
        if (!raw) throw new Error('Tell me what you are working toward first.')
        const written = await writeMotivationLine(raw)
        const saved = db.saveMotivation(payload.profileId, raw, written.line)
        return { ...saved, reworded: written.reworded, note: written.note }
      }),
  )
  ipcMain.handle('motivation:clear', (_e, profileId: number) =>
    db.clearMotivation(profileId),
  )

  ipcMain.handle('bills:list', (_e, profileId: number) => db.listBills(profileId))
  ipcMain.handle(
    'bills:create',
    (
      _e,
      payload: {
        profileId: number
        name: string
        amount: number
        dueDay?: number | null
        nextDueDate?: string | null
        accountId?: number | null
        categoryId?: number | null
        payeeHint?: string
        frequency?: string
        autopay?: boolean
        autopayDay?: number | null
        principal?: number | null
        interest?: number | null
        escrow?: number | null
        isMortgage?: boolean
        minimumPayment?: number | null
        statementBalance?: number | null
      },
    ) => db.createBill(payload),
  )
  ipcMain.handle(
    'bills:update',
    (
      _e,
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
        autopay?: boolean
        autopayDay?: number | null
        principal?: number | null
        interest?: number | null
        escrow?: number | null
        isMortgage?: boolean
        minimumPayment?: number | null
        statementBalance?: number | null
      },
    ) => db.updateBill(id, payload),
  )
  ipcMain.handle('bills:delete', (_e, id: number) => db.deleteBill(id))
  ipcMain.handle('bills:status', (_e, profileId: number, month: string) =>
    db.getBillStatuses(profileId, month),
  )
  ipcMain.handle('bills:openDocument', async (_e, billId: number) => {
    const filePath = db.getLatestBillDocumentPath(billId)
    if (!filePath) {
      return { ok: false as const, error: 'No PDF saved for this bill yet.' }
    }
    if (!fs.existsSync(filePath)) {
      return {
        ok: false as const,
        error: 'Saved bill file is missing from disk.',
      }
    }
    const err = await shell.openPath(filePath)
    if (err) return { ok: false as const, error: err }
    return { ok: true as const }
  })
  ipcMain.handle(
    'bills:markPaid',
    (
      _e,
      payload: {
        profileId: number
        billId: number
        month: string
        paidOn?: string | null
        note?: string | null
      },
    ) => db.markBillPaid(payload),
  )
  ipcMain.handle(
    'bills:unmarkPaid',
    (
      _e,
      payload: { profileId: number; billId: number; month: string },
    ) => db.unmarkBillPaid(payload),
  )

  ipcMain.handle(
    'reports:spendingByCategory',
    (_e, scope: number | number[], from: string, to: string) =>
      db.spendingByCategory(scope, from, to),
  )
  ipcMain.handle(
    'reports:spendingByMonth',
    (_e, scope: number | number[], months: number) =>
      db.spendingByMonth(scope, months),
  )
  ipcMain.handle(
    'reports:trends',
    (
      _e,
      scope: number | number[],
      range: 'mom' | '3m' | '6m' | '1y',
      month: string,
    ) => db.getTrends(scope, range, month),
  )
  ipcMain.handle(
    'reports:monthlySeries',
    (_e, scope: number | number[], fromMonth: string, toMonth: string) =>
      db.monthlySeries(scope, fromMonth, toMonth),
  )
  ipcMain.handle(
    'reports:categoryMonthly',
    (_e, scope: number | number[], fromMonth: string, toMonth: string) =>
      db.categoryMonthly(scope, fromMonth, toMonth),
  )
  ipcMain.handle(
    'reports:incomeReport',
    (_e, scope: number | number[], fromMonth: string, toMonth: string) =>
      db.incomeReport(scope, fromMonth, toMonth),
  )
  ipcMain.handle(
    'reports:recurring',
    (_e, scope: number | number[], anchorMonth: string, months: number) =>
      db.recurringChanges(scope, anchorMonth, months),
  )
  ipcMain.handle('dashboard:get', (_e, profileId: number, month: string) =>
    db.dashboard(profileId, month),
  )

  ipcMain.handle('import:pickCsv', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import account statement (CSV)',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const text = fs.readFileSync(filePath, 'utf8')
    const parsed = parseStatementCsv(text)
    return {
      filePath,
      fileName: path.basename(filePath),
      rows: parsed.rows,
      endingBalance: parsed.endingBalance,
      startingBalance: parsed.startingBalance,
      notes: parsed.notes,
    }
  })

  ipcMain.handle(
    'import:commit',
    (
      _e,
      payload: {
        profileId: number
        accountId: number
        rows: Array<{
          date: string
          amount: number
          payee: string
          memo?: string
        }>
        fileName?: string
        endingBalance?: number | null
      },
    ) => db.importTransactions(payload),
  )

  ipcMain.handle('import:statementHistory', (_e, profileId: number) =>
    db.listStatementImports(profileId),
  )

  ipcMain.handle(
    'import:updateStatement',
    (
      _e,
      payload: { id: number; fileName?: string; accountId?: number },
    ) => db.updateStatementImport(payload.id, payload),
  )

  ipcMain.handle(
    'import:deleteStatement',
    (
      _e,
      payload: { id: number; undoTransactions?: boolean },
    ) =>
      db.deleteStatementImport(
        payload.id,
        payload.undoTransactions !== false,
      ),
  )

  ipcMain.handle('import:pickBankPdfs', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import statement PDFs (bank or credit card activity)',
      filters: [{ name: 'PDF statements', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || !result.filePaths.length) return null

    const files: Array<{
      filePath: string
      fileName: string
      rows: Array<{ date: string; amount: number; payee: string; memo?: string }>
      endingBalance: number | null
      notes: string[]
      confidence: 'high' | 'medium' | 'low'
      textPreview: string
    }> = []

    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath)
      try {
        const buffer = fs.readFileSync(filePath)
        const data = await pdfParse(buffer)
        const parsed = parseBankStatementText(data.text || '')
        files.push({
          filePath,
          fileName,
          rows: parsed.rows,
          endingBalance: parsed.endingBalance,
          notes: parsed.notes,
          confidence: parsed.confidence,
          textPreview: parsed.textPreview,
        })
      } catch (err) {
        files.push({
          filePath,
          fileName,
          rows: [],
          endingBalance: null,
          notes: [
            `Could not read this PDF: ${
              err instanceof Error ? err.message : 'unknown error'
            }. Scanned image PDFs need a CSV export or OCR later.`,
          ],
          confidence: 'low',
          textPreview: '',
        })
      }
    }
    return files
  })

  ipcMain.handle('import:pickBillPdfs', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import bill PDFs',
      filters: [{ name: 'PDF bills', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || !result.filePaths.length) return null

    const parsed = []
    for (const filePath of result.filePaths) {
      try {
        const buffer = fs.readFileSync(filePath)
        const data = await pdfParse(buffer)
        const fileName = path.basename(filePath)
        parsed.push(parseBillText(data.text || '', fileName, filePath))
      } catch (err) {
        parsed.push({
          fileName: path.basename(filePath),
          filePath,
          textPreview: '',
          name: path.basename(filePath, '.pdf'),
          amount: null,
          dueDate: null,
          dueDay: null,
          statementDate: null,
          payeeHint: path.basename(filePath, '.pdf'),
          suggestedCategory: null,
          confidence: 'low' as const,
          notes: [
            `Could not read this PDF automatically: ${
              err instanceof Error ? err.message : 'unknown error'
            }. Enter fields manually (scanned image PDFs need OCR later).`,
          ],
          autopay: false,
          autopayDay: null,
          autopayDate: null,
          isMortgage: false,
          mortgage: null,
          isCreditCard: false,
          creditCard: null,
        })
      }
    }
    return parsed
  })

  ipcMain.handle(
    'import:commitBillPdf',
    (
      _e,
        payload: {
        profileId: number
        name: string
        amount: number
        dueDay?: number | null
        nextDueDate?: string | null
        payeeHint: string
        categoryId?: number | null
        accountId?: number | null
        sourceFilePath: string
        originalFileName: string
        extracted?: unknown
        autopay?: boolean
        autopayDay?: number | null
        principal?: number | null
        interest?: number | null
        escrow?: number | null
        isMortgage?: boolean
        minimumPayment?: number | null
        statementBalance?: number | null
      },
    ) => {
      const billsDir = path.join(
        app.getPath('userData'),
        'bills',
        String(payload.profileId),
      )
      fs.mkdirSync(billsDir, { recursive: true })
      const safeName = payload.originalFileName.replace(/[^\w.\- ()]+/g, '_')
      const dest = path.join(billsDir, `${Date.now()}-${safeName}`)
      try {
        fs.copyFileSync(payload.sourceFilePath, dest)
      } catch {
        // still allow save without local copy if copy fails
      }
      const stored = fs.existsSync(dest) ? dest : payload.sourceFilePath

      const categoryId = payload.categoryId ?? null
      return db.commitBillFromPdf({
        profileId: payload.profileId,
        name: payload.name,
        amount: payload.amount,
        dueDay: payload.dueDay ?? null,
        nextDueDate: payload.nextDueDate ?? null,
        payeeHint: payload.payeeHint,
        categoryId,
        accountId: payload.accountId,
        storedFilePath: stored,
        originalFileName: payload.originalFileName,
        extracted: payload.extracted ?? null,
        autopay: payload.autopay ?? false,
        autopayDay: payload.autopayDay ?? null,
        principal: payload.principal ?? null,
        interest: payload.interest ?? null,
        escrow: payload.escrow ?? null,
        isMortgage: payload.isMortgage ?? false,
        minimumPayment: payload.minimumPayment ?? null,
        statementBalance: payload.statementBalance ?? null,
      })
    },
  )

  ipcMain.handle(
    'categories:findByName',
    (_e, profileId: number, name: string) =>
      db.findCategoryByName(profileId, name),
  )

  ipcMain.handle('coach:insights', async (_e, profileId: number, month: string) => {
    const ctx = buildCoachContext(profileId, month)
    return getCoachInsights(ctx)
  })

  ipcMain.handle(
    'coach:ask',
    async (_e, profileId: number, month: string, question: string) => {
      const ctx = buildCoachContext(profileId, month)
      return askCoach(ctx, question)
    },
  )

  ipcMain.handle('ai:status', () => ({
    ...aiStatus(),
    models: AI_MODELS,
  }))
  ipcMain.handle('ai:saveKey', (_e, payload: { key: string; model?: string }) =>
    settled(async () => {
      const key = payload.key.trim()
      if (!key) throw new Error('Paste your OpenAI API key first.')
      await verifyKey(key)
      saveKey({ key, model: payload.model })
      return aiStatus()
    }),
  )
  ipcMain.handle('ai:setModel', (_e, model: string) =>
    settled(() => {
      saveModel(model)
      return aiStatus()
    }),
  )
  ipcMain.handle('ai:clearKey', () =>
    settled(() => {
      clearKey()
      return aiStatus()
    }),
  )
  ipcMain.handle(
    'ai:ask',
    (
      _e,
      payload: {
        profileId: number
        month: string
        question: string
        history?: AiTurn[]
      },
    ) => settled(() => askAiCoach(db, payload)),
  )

  ipcMain.handle('plaid:status', () => credStatus())
  ipcMain.handle(
    'plaid:saveKeys',
    (_e, payload: { clientId: string; secret: string; env: PlaidEnv }) =>
      settled(async () => {
        await verifyCreds({
          clientId: payload.clientId.trim(),
          secret: payload.secret.trim(),
          env: payload.env,
        })
        saveCreds(payload)
        return credStatus()
      }),
  )
  ipcMain.handle('plaid:clearKeys', () =>
    settled(() => {
      clearCreds()
      return credStatus()
    }),
  )

  ipcMain.handle('plaid:items', (_e, profileId: number) =>
    db.listPlaidItems(profileId),
  )
  ipcMain.handle('plaid:connectStart', (_e, profileId: number) =>
    settled(async () => {
      const started = await startConnect(profileId)
      await shell.openExternal(started.url)
      return started
    }),
  )
  ipcMain.handle(
    'plaid:connectPoll',
    (_e, profileId: number, linkToken: string) =>
      settled(() => pollConnect(db, profileId, linkToken)),
  )
  ipcMain.handle('plaid:reconnect', (_e, itemRowId: number) =>
    settled(async () => {
      const started = await startReconnect(db, itemRowId)
      await shell.openExternal(started.url)
      return started
    }),
  )
  ipcMain.handle(
    'plaid:finishMapping',
    (
      _e,
      payload: {
        profileId: number
        itemRowId: number
        choices: Array<{
          plaidAccountRowId: number
          accountId: number | null
          create: boolean
          name: string
          type: string
        }>
      },
    ) =>
      settled(() => {
        finishMapping(db, payload)
        return db.listPlaidAccounts(payload.itemRowId)
      }),
  )
  // Queued behind the background refresh so the two can't fight over a cursor.
  ipcMain.handle(
    'plaid:sync',
    (_e, itemRowId: number, awaitHistory?: boolean) =>
      settled(() =>
        runExclusive(() => syncItem(db, itemRowId, { awaitHistory })),
      ),
  )
  ipcMain.handle('plaid:syncAll', (_e, profileId: number) =>
    settled(() => runExclusive(() => syncAll(db, profileId))),
  )
  ipcMain.handle(
    'plaid:disconnect',
    (_e, itemRowId: number, deleteTransactions: boolean) =>
      settled(() => plaidDisconnect(db, itemRowId, deleteTransactions)),
  )

  ipcMain.handle('app:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('app:dataPath', () => app.getPath('userData'))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:updateStatus', () => checkUpdates())
  ipcMain.handle('app:updateApply', () => applyFoundUpdate(mainWindow))
  ipcMain.handle('app:updatePick', () => pickAndApplyInstaller(mainWindow))
}

/**
 * Network-facing calls fail in ordinary ways (bad keys, bank offline), so the
 * renderer gets a result it can show instead of an IPC exception.
 */
async function settled<T>(
  fn: () => Promise<T> | T,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Something went wrong.',
    }
  }
}

function buildCoachContext(profileId: number, month: string): CoachContext {
  const profile = db.listProfiles().find((p) => p.id === profileId)
  const dash = db.dashboard(profileId, month)
  const bills = db.getBillStatuses(profileId, month)
  const byCat = db.spendingByCategory(profileId, `${month}-01`, `${month}-31`)
  return {
    profileName: profile?.name ?? 'Profile',
    month,
    dashboard: dash,
    billStatus: bills,
    spendingByCategory: byCat,
  }
}

app.whenReady().then(() => {
  if (!gotLock) return
  try {
    const dataDir = path.join(app.getPath('userData'), 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    db = new FinanceDb(path.join(dataDir, 'finance.db'))
    db.seedIfEmpty()
    registerIpc()
    setupAutoUpdater(() => mainWindow)
    createWindow()
    startAutoSync(db, () => mainWindow)
    scheduleUpdateCheck()
  } catch (err) {
    dialog.showErrorBox(
      "Bizzy's Finance could not start",
      err instanceof Error ? err.message : String(err),
    )
    app.quit()
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopAutoSync()
  if (process.platform !== 'darwin') app.quit()
})

/** Quiet look at GitHub (and the local build folder) a few seconds after launch. */
function scheduleUpdateCheck() {
  if (!app.isPackaged) return
  setTimeout(() => {
    void checkUpdates().then((status) => {
      if (status.available) {
        mainWindow?.webContents.send('app:updateAvailable', status)
      }
    })
  }, 8000)
}
