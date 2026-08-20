# Bizzy's Finance

Local-first personal finance desktop app for Windows. Track spending, bills, flexible budgets, goals, and reports across multiple people (profiles) — all data stays on your PC.

## Features (v1)

- **Profiles**: Ross, Nicole, Zac, Zoey, Lux (editable) with separate money
- **Accounts & transactions** with categories and auto-rules
- **Bills** with paid/due/overdue status (matched from imported transactions)
- **Flexible budgets** (a few caps — not YNAB-level overwhelm)
- **CSV statement import** and **PDF bill scan** (amount/due date/payee → bill + payment match)
- **Trends**: month over month, 3 month, 6 month, 1 year (spend/income/category shifts)
- **AI coach** (built-in insights; uses Ollama if running locally)

## Run

```bash
cd "C:\Users\rosst\Desktop\Programming stuff and Ideas\Bizzys_Finance"
npm install
npm run electron:dev
```

## Tips

1. Pick a profile in the left sidebar
2. Set starting balances on **Accounts**
3. Add recurring bills under **Bills**, or scan **PDF bills** under **Import**
4. **Import** bank CSV exports so payments get matched
5. Categorize a few transactions; rules learn common merchants after PDF bills are saved
6. Budget only 3–5 flexible categories so it stays maintainable
7. Optional: run [Ollama](https://ollama.com) + `qwen2.5-coder:14b` for richer coach answers

## PDF bills

- Works best with PDFs that have **selectable text** (not pure photos)
- Multi-select is supported
- After save: creates/updates the bill, copies the PDF into local app data, matches recent payments, categorizes the match, and adds a category rule for future statement imports
- Image-only scanned PDFs: amount/date may be blank — fill in before save (OCR can come later)

## Data location

SQLite database lives under Electron `userData` (local only). No cloud, no bank login. The GitHub repo is the **app code**, not your transactions.

## Standalone installers

Windows and Mac are **different files**. A `.exe` will not run on Nicole's Mac. A `.dmg` will not run on this PC.

Installers are published at [github.com/RossTurner85/Planner/releases](https://github.com/RossTurner85/Planner/releases). The GitHub repo is named Planner; the app is still Bizzy's Finance.

### Windows (this PC)

```bash
npm run dist:win
```

The installer lands in `%LOCALAPPDATA%\BizzysFinance-release` as `Bizzys-Finance-Setup-0.1.1.exe`. Packaging writes there instead of `release/` because this project lives on Desktop, and OneDrive locks the folder electron-builder needs to rename.

Run the new Setup file once. You do **not** uninstall first — your accounts live in `%APPDATA%\bizzys-finance`, which the installer never touches.

### Mac (Nicole)

Do **not** send her the Windows Setup exe. She needs `Bizzys-Finance-0.1.4.dmg` from GitHub Releases.

macOS will often say an unsigned GitHub download is **damaged**. It is not. After putting the app in Applications, run this in Terminal:

```bash
xattr -cr "/Applications/Bizzy's Finance.app"
open "/Applications/Bizzy's Finance.app"
```

Until we pay for an Apple developer ID and notarize, that Terminal step is required for downloads from the internet. Until household WiFi sharing is done, her Mac keeps its own empty database. Don't copy `finance.db` onto her machine.

### Updates

1. Bump `"version"` in `package.json`.
2. Commit, tag `v0.1.2`, and push — GitHub Actions builds Windows + Mac and attaches them to the release.
3. Installed apps check GitHub a few seconds after launch, and from **Accounts & Statements** → **Check for updates**.

Windows can download and apply the update in the app. Unsigned Mac builds can *see* that an update exists, then open the GitHub download page (macOS blocks silent updates until the app is signed).

On this PC you can still install from the local build folder or **Install from a file…** without waiting for GitHub.