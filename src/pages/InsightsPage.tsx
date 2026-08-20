import { useEffect, useMemo, useState } from 'react'
import type { CoachAsk } from '../App'
import type { InsightTab, NavOptions, PageId, Profile } from '../types'
import { money, monthLabel } from '../lib/format'
import { OverviewTab } from '../components/insights/OverviewTab'
import { TrendsTab } from '../components/insights/TrendsTab'
import { ReportsTab } from '../components/insights/ReportsTab'
import { CoachTab } from '../components/insights/CoachTab'

type Props = {
  profileId: number
  profiles: Profile[]
  month: string
  /** Owned by App so the bottom bar can deep-link straight to Coach. */
  tab: InsightTab
  onTabChange: (tab: InsightTab) => void
  onNavigate: (page: PageId, opts?: NavOptions) => void
  /** Set when another screen sent a question here to be asked on arrival. */
  coachAsk?: CoachAsk | null
}

const TABS: Array<{ id: InsightTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'reports', label: 'Reports' },
  { id: 'coach', label: 'Coach' },
]

const BLURB: Record<InsightTab, string> = {
  overview:
    'How this month actually went — what came in, what went out, and what moved since last month.',
  trends:
    'The longer view. Three months to a year of spending, income, and the bills that crept up on you.',
  reports:
    'Clean write-ups you can read start to finish, by month, by year, by category.',
  coach:
    'Plain-language takes on your numbers, plus anything you want to ask about them.',
}

export function InsightsPage({
  profileId,
  profiles,
  month,
  tab,
  onTabChange,
  onNavigate,
  coachAsk,
}: Props) {
  const [scope, setScope] = useState<'profile' | 'household'>('profile')
  const profileIds = useMemo(
    () => (scope === 'household' ? profiles.map((p) => p.id) : [profileId]),
    [scope, profiles, profileId],
  )
  const [strip, setStrip] = useState<{
    spent: number
    income: number
    net: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rows = await window.finance.reports.monthlySeries(
        profileIds,
        month,
        month,
      )
      if (cancelled) return
      const m = rows[0]
      setStrip({
        spent: m?.spent ?? 0,
        income: m?.income ?? 0,
        net: m?.net ?? 0,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [profileIds, month])

  return (
    <div className="insights-page">
      <section className="setup-summary">
        <div>
          <div className="home-kicker">Money in · {monthLabel(month)}</div>
          <div className="setup-summary-num">
            {strip ? money(strip.income) : '—'}
          </div>
        </div>
        <div>
          <div className="home-kicker">Money out</div>
          <div className="setup-summary-num">
            {strip ? money(strip.spent) : '—'}
          </div>
        </div>
        <div>
          <div className="home-kicker">Kept</div>
          <div
            className={`setup-summary-num ${
              strip ? (strip.net >= 0 ? 'amount-pos' : 'amount-neg') : ''
            }`}
          >
            {strip ? money(strip.net) : '—'}
          </div>
        </div>
      </section>

      <div className="setup-tabs">
        <div className="segmented">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'active' : ''}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== 'coach' ? (
          <div className="segmented insight-scope">
            <button
              type="button"
              className={scope === 'profile' ? 'active' : ''}
              onClick={() => setScope('profile')}
            >
              This profile
            </button>
            <button
              type="button"
              className={scope === 'household' ? 'active' : ''}
              onClick={() => setScope('household')}
            >
              Household
            </button>
          </div>
        ) : null}
      </div>

      <p className="muted setup-blurb">
        {BLURB[tab]}
        {tab !== 'coach' && scope === 'household'
          ? ' Combined by category name across everyone.'
          : ''}
      </p>

      {tab === 'overview' ? (
        <OverviewTab profileIds={profileIds} month={month} />
      ) : null}
      {tab === 'trends' ? (
        <TrendsTab profileIds={profileIds} month={month} />
      ) : null}
      {tab === 'reports' ? (
        <ReportsTab
          profileId={profileId}
          profileIds={profileIds}
          month={month}
        />
      ) : null}
      {tab === 'coach' ? (
        <CoachTab
          profileId={profileId}
          month={month}
          onNavigate={onNavigate}
          autoAsk={coachAsk}
        />
      ) : null}
    </div>
  )
}
