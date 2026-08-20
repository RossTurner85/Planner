import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Account, Profile } from '../types'
import { money } from '../lib/format'
import { AccountsSection } from '../components/setup/AccountsSection'
import { StatementsSection } from '../components/setup/StatementsSection'
import { BillImportSection } from '../components/setup/BillImportSection'
import { BanksSection } from '../components/setup/BanksSection'
import { AppUpdateSection } from '../components/setup/AppUpdateSection'

type Props = {
  profileId: number
  profiles: Profile[]
  /** Deep link from Home — opens Accounts with this one expanded. */
  focusAccountId?: number | null
}

type Tab = 'accounts' | 'banks' | 'statements' | 'bills'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'banks', label: 'Bank sync' },
  { id: 'statements', label: 'Statements' },
  { id: 'bills', label: 'Bill PDFs' },
]

const BLURB: Record<Tab, string> = {
  accounts:
    'Every place money sits in the household — checking, savings, cards, cash. Tagged by who owns it. Home still shows one person at a time.',
  banks:
    'Connect a bank once and transactions arrive on their own — up to 24 months of history on the first pull, then only what changed.',
  statements:
    'Bring in bank or card activity from a CSV or PDF. Duplicates are skipped, so re-importing the same file is safe.',
  bills:
    'Drop in utility, phone, insurance, or card PDFs. The app reads the amount due and due date, then links the payment when it shows up.',
}

const CASH_TYPES = new Set(['checking', 'savings', 'cash'])

export function SetupPage({ profileId, profiles, focusAccountId = null }: Props) {
  const [tab, setTab] = useState<Tab>('accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [household, setHousehold] = useState<Account[]>([])

  const reloadAccounts = useCallback(async () => {
    const [mine, all] = await Promise.all([
      window.finance.accounts.list(profileId),
      window.finance.accounts.listHousehold(),
    ])
    setAccounts(mine)
    setHousehold(all)
  }, [profileId])

  useEffect(() => {
    void reloadAccounts()
  }, [reloadAccounts])

  useEffect(() => {
    if (focusAccountId != null) setTab('accounts')
  }, [focusAccountId])

  const totals = useMemo(() => {
    let cash = 0
    let cards = 0
    for (const a of household) {
      if (CASH_TYPES.has(a.type)) cash += a.balance
      else if (a.type === 'credit') cards += a.balance
    }
    return { cash, cards, count: household.length }
  }, [household])

  return (
    <div className="setup-page">
      <section className="setup-summary">
        <div>
          <div className="home-kicker">Cash on hand</div>
          <div className="setup-summary-num">{money(totals.cash)}</div>
        </div>
        <div>
          <div className="home-kicker">Card balances</div>
          <div className="setup-summary-num">
            {money(Math.abs(totals.cards))}
          </div>
        </div>
        <div>
          <div className="home-kicker">Accounts</div>
          <div className="setup-summary-num">{totals.count}</div>
        </div>
      </section>

      <div className="setup-tabs">
        <div className="segmented">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="muted setup-blurb">{BLURB[tab]}</p>

      {tab === 'accounts' ? (
        <AccountsSection
          profileId={profileId}
          profiles={profiles}
          accounts={household}
          reload={reloadAccounts}
          focusAccountId={focusAccountId}
        />
      ) : null}

      {tab === 'banks' ? (
        <BanksSection
          profileId={profileId}
          accounts={accounts}
          reloadAccounts={reloadAccounts}
        />
      ) : null}

      {tab === 'statements' ? (
        <StatementsSection
          profileId={profileId}
          accounts={accounts}
          reloadAccounts={reloadAccounts}
          onNeedAccount={() => setTab('accounts')}
        />
      ) : null}

      {tab === 'bills' ? (
        <BillImportSection profileId={profileId} accounts={accounts} />
      ) : null}

      <AppUpdateSection />
    </div>
  )
}
