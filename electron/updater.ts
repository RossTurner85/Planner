import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const GITHUB_RELEASES_URL =
  'https://github.com/RossTurner85/bizzys-finance/releases/latest'

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

let lastStatus: AppUpdateStatus | null = null
let updaterReady = false

/**
 * Same folder `npm run dist:win` writes to. Ross can still install from here
 * without waiting for GitHub.
 */
export function defaultFeedDir(): string {
  if (process.platform === 'win32') {
    const local =
      process.env.LOCALAPPDATA ||
      path.join(app.getPath('appData'), '..', 'Local')
    return path.join(local, 'BizzysFinance-release')
  }
  return path.join(os.homedir(), 'BizzysFinance-release')
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  if (updaterReady) return
  updaterReady = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('download-progress', (progress) => {
    getWindow()?.webContents.send(
      'app:updateProgress',
      Math.round(progress.percent),
    )
  })
}

export async function checkUpdates(): Promise<AppUpdateStatus> {
  const current = app.getVersion()
  const feedDir = defaultFeedDir()
  const packaged = app.isPackaged
  const local = findLatestInstaller(feedDir)
  const localNewer =
    local && compareVersions(local.version, current) > 0 ? local : null

  let githubVersion: string | null = null
  let githubError: string | null = null
  if (packaged) {
    try {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo?.version ?? null
      if (version && compareVersions(version, current) > 0) {
        githubVersion = version
      }
    } catch (err) {
      githubError =
        err instanceof Error ? err.message : 'Could not reach GitHub.'
    }
  }

  const githubWins =
    githubVersion &&
    (!localNewer || compareVersions(githubVersion, localNewer.version) >= 0)

  if (githubWins && githubVersion) {
    lastStatus = {
      current,
      packaged,
      feedDir,
      available: true,
      latest: githubVersion,
      installerPath: null,
      installerName: null,
      source: 'github',
      message: `Version ${githubVersion} is on GitHub. Your accounts stay put.`,
    }
    return lastStatus
  }

  if (localNewer) {
    lastStatus = {
      current,
      packaged,
      feedDir,
      available: true,
      latest: localNewer.version,
      installerPath: localNewer.filePath,
      installerName: path.basename(localNewer.filePath),
      source: 'local',
      message: `Version ${localNewer.version} is in the build folder. Your accounts stay put; the app will close, update, and reopen.`,
    }
    return lastStatus
  }

  lastStatus = {
    current,
    packaged,
    feedDir,
    available: false,
    latest: local?.version ?? githubVersion,
    installerPath: null,
    installerName: null,
    source: null,
    message: packaged
      ? githubError
        ? `You are on ${current}. GitHub check failed: ${githubError}`
        : `You are on ${current}. Nothing newer on GitHub or in the build folder.`
      : 'Dev build — updates apply to the installed app, not this window.',
  }
  return lastStatus
}

export async function applyFoundUpdate(
  win: BrowserWindow | null,
): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  const status = lastStatus?.available ? lastStatus : await checkUpdates()
  if (!status.available || !status.latest) {
    return { ok: false, error: status.message }
  }
  if (status.source === 'github') {
    return applyGithubUpdate(win, status.latest)
  }
  if (status.installerPath) {
    return applyInstaller(win, status.installerPath, status.latest)
  }
  return { ok: false, error: 'No installer was found for that update.' }
}

export async function pickAndApplyInstaller(
  win: BrowserWindow | null,
): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  const openOpts: OpenDialogOptions = {
    title: "Choose a Bizzy's Finance installer",
    defaultPath: defaultFeedDir(),
    filters:
      process.platform === 'win32'
        ? [{ name: 'Installer', extensions: ['exe'] }]
        : [{ name: 'Disk image', extensions: ['dmg'] }],
    properties: ['openFile'],
  }
  const picked = win
    ? await dialog.showOpenDialog(win, openOpts)
    : await dialog.showOpenDialog(openOpts)
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: false, error: 'Cancelled.', cancelled: true }
  }
  const filePath = picked.filePaths[0]
  const version = versionFromFileName(path.basename(filePath)) ?? 'this file'
  return applyInstaller(win, filePath, version)
}

async function applyGithubUpdate(
  win: BrowserWindow | null,
  versionLabel: string,
): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  const macUnsigned = process.platform === 'darwin'
  const boxOpts: MessageBoxOptions = {
    type: 'question',
    buttons: macUnsigned
      ? ['Open download page', 'Not now']
      : ['Install and restart', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: "Update Bizzy's Finance",
    message: `Version ${versionLabel} is available.`,
    detail: macUnsigned
      ? 'macOS blocks silent updates until the app is signed. Download the disk image, open it, and replace the app. Your data stays on this Mac.'
      : 'The app will download the update, close, and reopen. Accounts, bills, and history stay in the same folder they already use.',
  }
  const choice = win
    ? await dialog.showMessageBox(win, boxOpts)
    : await dialog.showMessageBox(boxOpts)
  if (choice.response !== 0) {
    return { ok: false, error: 'Cancelled.', cancelled: true }
  }

  if (macUnsigned) {
    await shell.openExternal(GITHUB_RELEASES_URL)
    return { ok: true }
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      return { ok: false, error: 'GitHub did not report an update to download.' }
    }
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  } catch (err) {
    await shell.openExternal(GITHUB_RELEASES_URL)
    return {
      ok: false,
      error:
        (err instanceof Error ? err.message : 'Download failed.') +
        ' Opened the GitHub releases page instead.',
    }
  }
}

async function applyInstaller(
  win: BrowserWindow | null,
  installerPath: string,
  versionLabel: string,
): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  if (!fs.existsSync(installerPath)) {
    return { ok: false, error: 'That installer is no longer on disk.' }
  }

  if (process.platform === 'darwin') {
    await shell.openPath(installerPath)
    return { ok: true }
  }

  if (process.platform !== 'win32') {
    return {
      ok: false,
      error: 'In-app install from a file is Windows or Mac for now.',
    }
  }

  const boxOpts: MessageBoxOptions = {
    type: 'question',
    buttons: ['Install and restart', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: "Update Bizzy's Finance",
    message: `Install version ${versionLabel}?`,
    detail:
      'The app will close, the installer will run, and it should reopen on its own. Accounts, bills, and history stay in the same folder they already use.',
  }
  const choice = win
    ? await dialog.showMessageBox(win, boxOpts)
    : await dialog.showMessageBox(boxOpts)
  if (choice.response !== 0) {
    return { ok: false, error: 'Cancelled.', cancelled: true }
  }

  scheduleSilentInstall(installerPath)
  return { ok: true }
}

/**
 * NSIS cannot overwrite files that are still open. Wait a couple of seconds
 * after this process exits, then run the installer silently.
 */
function scheduleSilentInstall(installerPath: string) {
  const setup = installerPath.replace(/"/g, '')
  const cmd = process.env.ComSpec || 'cmd.exe'
  app.once('will-quit', () => {
    spawn(
      cmd,
      ['/d', '/s', '/c', `ping 127.0.0.1 -n 4 >nul & "${setup}" /S`],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    ).unref()
  })
  app.quit()
}

function findLatestInstaller(
  feedDir: string,
): { version: string; filePath: string } | null {
  if (!fs.existsSync(feedDir)) return null

  const ymlPath = path.join(feedDir, 'latest.yml')
  if (fs.existsSync(ymlPath)) {
    const parsed = parseLatestYml(fs.readFileSync(ymlPath, 'utf8'))
    if (parsed) {
      const filePath = path.join(feedDir, parsed.fileName)
      if (fs.existsSync(filePath)) {
        return { version: parsed.version, filePath }
      }
    }
  }

  const names = fs
    .readdirSync(feedDir)
    .filter((name) => /\.exe$/i.test(name) && /setup/i.test(name))
  let best: { version: string; filePath: string } | null = null
  for (const name of names) {
    const version = versionFromFileName(name)
    if (!version) continue
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, filePath: path.join(feedDir, name) }
    }
  }
  return best
}

function parseLatestYml(
  text: string,
): { version: string; fileName: string } | null {
  const version = text.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1]
  const fileName = (
    text.match(/^path:\s*['"]?(.+?)['"]?\s*$/m)?.[1] ||
    text.match(/^\s+url:\s*['"]?(.+?)['"]?\s*$/m)?.[1]
  )?.trim()
  if (!version || !fileName) return null
  return { version, fileName }
}

function versionFromFileName(name: string): string | null {
  return name.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null
}

/** Numeric dotted compare. 1.2.10 beats 1.2.2. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}
