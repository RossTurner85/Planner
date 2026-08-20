export type CoachContext = {
  profileName: string
  month: string
  dashboard: {
    income: number
    spent: number
    uncategorized: number
    cash: number
    budget: { planned: number; spent: number; remaining: number }
    bills: Array<{ name: string; status: string; amount: number; dueDate: string }>
    topSpend: Array<{ name: string; total: number }>
    goals: Array<{ name: string; target_amount: number; current_amount: number }>
  }
  billStatus: Array<{ name: string; status: string; amount: number; dueDate: string }>
  spendingByCategory: Array<{ name: string; total: number }>
}

export type CoachResult = {
  source: 'local' | 'ollama'
  insights: string[]
  answer?: string
}

function money(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function getCoachInsights(ctx: CoachContext): CoachResult {
  const insights: string[] = []
  const d = ctx.dashboard

  if (d.income > 0) {
    const rate = d.spent / d.income
    if (rate > 0.95) {
      insights.push(
        `This month looks tight: you've spent ${money(d.spent)} of ${money(d.income)} income (${Math.round(rate * 100)}%).`,
      )
    } else {
      insights.push(
        `You've spent ${money(d.spent)} of ${money(d.income)} income — about ${Math.round(rate * 100)}% of pay so far.`,
      )
    }
  } else if (d.spent > 0) {
    insights.push(
      `${money(d.spent)} in tracked spending this month. Add a paycheck transaction so the coach can compare income vs spend.`,
    )
  } else {
    insights.push(
      `No transactions for ${ctx.month} yet. Import a CSV statement and the coach will start catching patterns and missed bills.`,
    )
  }

  const overdue = d.bills.filter((b) => b.status === 'overdue')
  const due = d.bills.filter((b) => b.status === 'due')
  const paid = d.bills.filter((b) => b.status === 'paid')
  if (overdue.length) {
    insights.push(
      `${overdue.length} bill${overdue.length > 1 ? 's' : ''} look unpaid/overdue: ${overdue.map((b) => b.name).join(', ')}. Check imports or mark payments.`,
    )
  } else if (due.length) {
    insights.push(
      `${due.length} bill${due.length > 1 ? 's' : ''} due soon or today: ${due.map((b) => b.name).join(', ')}.`,
    )
  } else if (paid.length) {
    insights.push(`Nice — all matched bills show as paid this month (${paid.length}).`)
  } else {
    insights.push(
      `No recurring bills set up yet. Add your fixed bills once; imports will try to match payments automatically.`,
    )
  }

  if (d.uncategorized > 0) {
    insights.push(
      `${d.uncategorized} transaction${d.uncategorized > 1 ? 's' : ''} still need a category. Categorize them and spending reports get much smarter.`,
    )
  }

  if (d.topSpend[0]) {
    insights.push(
      `Top category: ${d.topSpend[0].name} at ${money(d.topSpend[0].total)}.`,
    )
  }

  if (d.budget.planned > 0) {
    if (d.budget.remaining < 0) {
      insights.push(
        `Budgets are over by ${money(Math.abs(d.budget.remaining))}. Nudge one flexible category down or pause non-essentials.`,
      )
    } else {
      insights.push(
        `${money(d.budget.remaining)} left across budgeted categories this month.`,
      )
    }
  } else {
    insights.push(
      `No category budgets yet. Set 4–6 flexible caps (groceries, dining, shopping) — not every dollar — so tracking stays light.`,
    )
  }

  for (const g of d.goals.slice(0, 2)) {
    const pct = g.target_amount
      ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100))
      : 0
    insights.push(`Goal “${g.name}” is ${pct}% funded (${money(g.current_amount)} / ${money(g.target_amount)}).`)
  }

  return { source: 'local', insights: insights.slice(0, 6) }
}

export async function askCoach(
  ctx: CoachContext,
  question: string,
): Promise<CoachResult> {
  const local = getCoachInsights(ctx)
  const systemFacts = [
    `Profile: ${ctx.profileName}`,
    `Month: ${ctx.month}`,
    `Income: ${money(ctx.dashboard.income)}`,
    `Spent: ${money(ctx.dashboard.spent)}`,
    `Cash accounts total: ${money(ctx.dashboard.cash)}`,
    `Budget remaining: ${money(ctx.dashboard.budget.remaining)}`,
    `Bills: ${ctx.billStatus.map((b) => `${b.name}=${b.status}`).join(', ') || 'none'}`,
    `Top spend: ${ctx.spendingByCategory
      .slice(0, 8)
      .map((c) => `${c.name} ${money(c.total)}`)
      .join(', ')}`,
    `Goals: ${ctx.dashboard.goals.map((g) => g.name).join(', ') || 'none'}`,
  ].join('\n')

  try {
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:14b',
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You are a practical, calm personal finance coach for a local-only budgeting app. Be concise (3-6 short sentences). Use only the provided facts. Do not invent account numbers or balances. Prefer actionable advice.',
          },
          {
            role: 'user',
            content: `Facts:\n${systemFacts}\n\nQuestion: ${question}`,
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status}`)
    const data = (await res.json()) as {
      message?: { content?: string }
    }
    const answer = data.message?.content?.trim()
    if (answer) {
      return { source: 'ollama', insights: local.insights, answer }
    }
  } catch {
    // fall through to local answer
  }

  // Rule-based answer
  const q = question.toLowerCase()
  let answer = local.insights.join(' ')
  if (q.includes('bill')) {
    const overdue = ctx.billStatus.filter((b) => b.status === 'overdue')
    answer = overdue.length
      ? `These bills still look unpaid: ${overdue.map((b) => b.name).join(', ')}. Import recent statements or add the payment transactions, then re-check Bills.`
      : `No overdue bills for ${ctx.profileName} in ${ctx.month}. Upcoming: ${ctx.billStatus
          .filter((b) => b.status !== 'paid')
          .map((b) => `${b.name} (${b.dueDate})`)
          .join(', ') || 'nothing pending'}.`
  } else if (q.includes('where') || q.includes('spend') || q.includes('going')) {
    answer = ctx.spendingByCategory.length
      ? `Money is mainly going to: ${ctx.spendingByCategory
          .slice(0, 5)
          .map((c) => `${c.name} (${money(c.total)})`)
          .join(', ')}. Total outflows ${money(ctx.dashboard.spent)}.`
      : `No categorized spending yet this month. Import a statement and assign categories to see where money goes.`
  } else if (q.includes('budget')) {
    answer =
      ctx.dashboard.budget.planned > 0
        ? `Budgeted ${money(ctx.dashboard.budget.planned)}, spent ${money(ctx.dashboard.budget.spent)}, remaining ${money(ctx.dashboard.budget.remaining)}.`
        : `No budgets set. Start with groceries, dining, and shopping only so it stays maintainable.`
  }

  return { source: 'local', insights: local.insights, answer }
}
