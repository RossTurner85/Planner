import type { FinanceDb } from './db'
import type { AiTool } from './openai'

/**
 * The tools the coach is allowed to call. Every number the model reports has to
 * come back from one of these, which is the whole point: SQLite does the
 * arithmetic and the model only decides what to look up and how to say it.
 *
 * Tool arguments never carry a profile id — that is injected here from the
 * app's current profile so a question can't reach another profile's data.
 */

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

/** What a tool call produced: text for the model, plus optional UI. */
export type ToolOutcome = {
  output: string
  card?: AiCard
}

/** Shorthand for a required-but-nullable strict-mode property. */
function nullable(type: string, description: string) {
  return { type: [type, 'null'], description }
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
): AiTool {
  return {
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      // Strict mode wants every key listed; optional ones are nullable above.
      required: Object.keys(properties),
      additionalProperties: false,
    },
  }
}

export const AI_TOOLS: AiTool[] = [
  tool(
    'search_transactions',
    'Find transactions and get their totals. This is the main tool: use it for any "how much did I spend on/at X" question. Returns the match count, totals, a merchant breakdown, a per-month breakdown, and a sample of rows. Amounts are negative for money out and positive for money in.',
    {
      text: nullable(
        'string',
        'Merchant or description to match, e.g. "costco". Matches the cleaned merchant name and the raw bank description. Omit to match everything.',
      ),
      from: nullable('string', 'Earliest date, YYYY-MM-DD.'),
      to: nullable('string', 'Latest date, YYYY-MM-DD.'),
      category: nullable('string', 'Exact category name from the list you were given.'),
      account: nullable('string', 'Exact account name from the list you were given.'),
      person: nullable('string', 'Exact person name from the list you were given.'),
      min_amount: nullable('number', 'Smallest absolute dollar size, e.g. 100 for "over $100".'),
      max_amount: nullable('number', 'Largest absolute dollar size.'),
      direction: {
        type: ['string', 'null'],
        enum: ['spending', 'income', 'all'],
        description: 'Limit to money out, money in, or both. Defaults to both.',
      },
      only_uncategorized: nullable('boolean', 'True to return only transactions with no category.'),
      include_transfers: nullable(
        'boolean',
        'Transfers and card payments are excluded by default. Pass true only when the question is about them.',
      ),
      row_limit: nullable('number', 'How many sample rows to return, 0-200. Defaults to 25.'),
    },
  ),
  tool(
    'spending_by_category',
    'Total spending per category over a date range, largest first. Use for "where is my money going".',
    {
      from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
      to: { type: 'string', description: 'End date, YYYY-MM-DD.' },
    },
  ),
  tool(
    'monthly_totals',
    'Income, spending, and net for each month in a range. Use for trends over time and for comparing periods.',
    {
      from_month: { type: 'string', description: 'First month, YYYY-MM.' },
      to_month: { type: 'string', description: 'Last month, YYYY-MM.' },
    },
  ),
  tool(
    'category_monthly',
    'Spending per category per month across a range. Use to see how one category moved over time.',
    {
      from_month: { type: 'string', description: 'First month, YYYY-MM.' },
      to_month: { type: 'string', description: 'Last month, YYYY-MM.' },
      category: nullable('string', 'Limit to one category name.'),
    },
  ),
  tool(
    'income_sources',
    'Income totals grouped by payer, plus income per month, over a month range.',
    {
      from_month: { type: 'string', description: 'First month, YYYY-MM.' },
      to_month: { type: 'string', description: 'Last month, YYYY-MM.' },
    },
  ),
  tool(
    'recurring_changes',
    'Merchants billed in at least 3 of the last N months whose newest charge differs from their earlier average. Use for subscription creep and "did a bill go up".',
    {
      anchor_month: { type: 'string', description: 'Month to end on, YYYY-MM.' },
      months: { type: 'number', description: 'How many months back to look, e.g. 6.' },
    },
  ),
  tool('bills_status', 'Every tracked bill for a month with its amount, due date, and paid/due/overdue status.', {
    month: { type: 'string', description: 'Month, YYYY-MM.' },
  }),
  tool('budget_status', 'Budget caps for a month with spent and remaining per category.', {
    month: { type: 'string', description: 'Month, YYYY-MM.' },
  }),
  tool(
    'month_overview',
    'Snapshot of one month: income, spending, uncategorized count, cash on hand, card balances, top categories, bills, and goals.',
    { month: { type: 'string', description: 'Month, YYYY-MM.' } },
  ),
  tool(
    'show_chart',
    'Draw a chart for the user. Call this whenever the answer compares more than two numbers — it is much easier to read than a list. Use donut for shares of a whole, bar for comparing items, line for change over time.',
    {
      chart: {
        type: 'string',
        enum: ['bar', 'line', 'donut'],
        description: 'Chart type.',
      },
      title: { type: 'string', description: 'Short title, e.g. "Dining by month".' },
      note: nullable('string', 'One short line under the chart.'),
      points: {
        type: 'array',
        description: 'Up to 24 points, in the order they should appear.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Axis or slice label, e.g. "Mar 2026".' },
            value: { type: 'number', description: 'Dollar amount, positive.' },
          },
          required: ['label', 'value'],
          additionalProperties: false,
        },
      },
    },
  ),
  tool(
    'show_table',
    'Show a table for the user. Good for transaction lists and anything with several columns. Format money yourself, e.g. "$1,204.55".',
    {
      title: { type: 'string', description: 'Short title.' },
      note: nullable('string', 'One short line under the table.'),
      columns: {
        type: 'array',
        description: 'Up to 6 columns.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Column heading.' },
            numeric: {
              type: 'boolean',
              description: 'True for amounts, so the column is right-aligned.',
            },
          },
          required: ['label', 'numeric'],
          additionalProperties: false,
        },
      },
      rows: {
        type: 'array',
        description: 'Up to 40 rows. Each row needs one cell per column.',
        items: {
          type: 'object',
          properties: {
            cells: {
              type: 'array',
              description: 'Cell text, in column order.',
              items: { type: 'string' },
            },
          },
          required: ['cells'],
          additionalProperties: false,
        },
      },
    },
  ),
  tool(
    'open_in_app',
    'Offer the user a button that jumps to a screen in the app, optionally pre-filtered. Use it when they would likely want to see or edit the underlying transactions.',
    {
      label: { type: 'string', description: 'Button text, e.g. "See Costco transactions".' },
      page: {
        type: 'string',
        enum: ['transactions', 'bills', 'budgets', 'goals', 'insights', 'home', 'setup'],
        description: 'Which screen to open.',
      },
      month: nullable('string', 'Month to show, YYYY-MM.'),
      search: nullable('string', 'Transactions only: pre-fill the search box.'),
      from: nullable('string', 'Transactions only: range start, YYYY-MM-DD.'),
      to: nullable('string', 'Transactions only: range end, YYYY-MM-DD.'),
    },
  ),
]

type Args = Record<string, unknown>

const str = (a: Args, k: string): string | null => {
  const v = a[k]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
const num = (a: Args, k: string): number | null => {
  const v = a[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
const bool = (a: Args, k: string): boolean | null =>
  typeof a[k] === 'boolean' ? (a[k] as boolean) : null

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return `${month}-28`
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/** Runs one tool call and returns the string the model will read. */
export function runAiTool(
  db: FinanceDb,
  profileId: number,
  name: string,
  args: Args,
): ToolOutcome {
  switch (name) {
    case 'search_transactions': {
      const direction = str(args, 'direction')
      const result = db.aiTransactionQuery(profileId, {
        text: str(args, 'text'),
        from: str(args, 'from'),
        to: str(args, 'to'),
        category: str(args, 'category'),
        account: str(args, 'account'),
        person: str(args, 'person'),
        minAmount: num(args, 'min_amount'),
        maxAmount: num(args, 'max_amount'),
        direction:
          direction === 'spending' || direction === 'income' || direction === 'all'
            ? direction
            : null,
        onlyUncategorized: bool(args, 'only_uncategorized'),
        includeTransfers: bool(args, 'include_transfers'),
        rowLimit: num(args, 'row_limit'),
      })
      return { output: json(result) }
    }

    case 'spending_by_category': {
      const from = str(args, 'from')
      const to = str(args, 'to')
      if (!from || !to) return { output: 'Error: from and to dates are required.' }
      return { output: json(db.spendingByCategory(profileId, from, to)) }
    }

    case 'monthly_totals': {
      const from = str(args, 'from_month')
      const to = str(args, 'to_month')
      if (!from || !to) return { output: 'Error: from_month and to_month are required.' }
      const rows = db.monthlySeries(profileId, from, to).map((m) => ({
        month: m.month,
        income: m.income,
        spent: m.spent,
        net: m.net,
        transactions: m.txCount,
      }))
      return { output: json(rows) }
    }

    case 'category_monthly': {
      const from = str(args, 'from_month')
      const to = str(args, 'to_month')
      if (!from || !to) return { output: 'Error: from_month and to_month are required.' }
      const wanted = str(args, 'category')?.toLowerCase() ?? null
      const rows = db.categoryMonthly(profileId, from, to) as Array<{
        month: string
        name: string
        total: number
      }>
      const filtered = wanted
        ? rows.filter((r) => r.name.toLowerCase().includes(wanted))
        : rows
      return { output: json(filtered) }
    }

    case 'income_sources': {
      const from = str(args, 'from_month')
      const to = str(args, 'to_month')
      if (!from || !to) return { output: 'Error: from_month and to_month are required.' }
      return { output: json(db.incomeReport(profileId, from, to)) }
    }

    case 'recurring_changes': {
      const anchor = str(args, 'anchor_month')
      if (!anchor) return { output: 'Error: anchor_month is required.' }
      const months = Math.min(Math.max(num(args, 'months') ?? 6, 3), 24)
      return { output: json(db.recurringChanges(profileId, anchor, months)) }
    }

    case 'bills_status': {
      const month = str(args, 'month')
      if (!month) return { output: 'Error: month is required.' }
      return { output: json(db.getBillStatuses(profileId, month)) }
    }

    case 'budget_status': {
      const month = str(args, 'month')
      if (!month) return { output: 'Error: month is required.' }
      const rows = db.listBudgets(profileId, month) as Array<{
        category_name: string
        amount: number
        spent: number
      }>
      return {
        output: json({
          summary: db.budgetSummary(profileId, month),
          categories: rows.map((r) => ({
            category: r.category_name,
            cap: r.amount,
            spent: r.spent,
            remaining: Math.round((r.amount - r.spent) * 100) / 100,
          })),
        }),
      }
    }

    case 'month_overview': {
      const month = str(args, 'month')
      if (!month) return { output: 'Error: month is required.' }
      const d = db.dashboard(profileId, month)
      return {
        output: json({
          month,
          income: d.income,
          spent: d.spent,
          net: Math.round((d.income - d.spent) * 100) / 100,
          transactions: d.txCount,
          uncategorized: d.uncategorized,
          cashOnHand: d.cash,
          cardBalances: d.creditLiability,
          budget: d.budget,
          topCategories: d.topSpend,
          bills: d.bills.map((b) => ({
            name: b.name,
            amount: b.amount,
            status: b.status,
            dueDate: b.dueDate,
          })),
          goals: d.goals.map((g) => ({
            name: g.name,
            target: g.target_amount,
            saved: g.current_amount,
          })),
        }),
      }
    }

    case 'show_chart': {
      const chart = str(args, 'chart')
      const raw = Array.isArray(args.points) ? args.points : []
      const points = raw
        .map((p) => p as { label?: unknown; value?: unknown })
        .filter((p) => typeof p.label === 'string' && typeof p.value === 'number')
        .slice(0, 24)
        .map((p) => ({ label: p.label as string, value: p.value as number }))
      if (points.length === 0) {
        return { output: 'Error: the chart needs at least one point with a label and a number.' }
      }
      return {
        output: `Chart shown to the user with ${points.length} points. Do not repeat the numbers in full — just say what it shows.`,
        card: {
          kind: 'chart',
          chart: chart === 'line' ? 'line' : chart === 'donut' ? 'donut' : 'bar',
          title: str(args, 'title') ?? 'Chart',
          note: str(args, 'note'),
          points,
        },
      }
    }

    case 'show_table': {
      const rawCols = Array.isArray(args.columns) ? args.columns : []
      const columns = rawCols
        .map((c) => c as { label?: unknown; numeric?: unknown })
        .filter((c) => typeof c.label === 'string')
        .slice(0, 6)
        .map((c) => ({ label: c.label as string, numeric: c.numeric === true }))
      const rawRows = Array.isArray(args.rows) ? args.rows : []
      const rows = rawRows
        .map((r) => (r as { cells?: unknown }).cells)
        .filter((cells): cells is unknown[] => Array.isArray(cells))
        .slice(0, 40)
        .map((cells) =>
          columns.map((_, i) => {
            const cell = cells[i]
            return cell === null || cell === undefined ? '' : String(cell)
          }),
        )
      if (columns.length === 0 || rows.length === 0) {
        return { output: 'Error: the table needs at least one column and one row.' }
      }
      return {
        output: `Table shown to the user with ${rows.length} rows. Do not repeat it in full — just summarize the point.`,
        card: {
          kind: 'table',
          title: str(args, 'title') ?? 'Details',
          note: str(args, 'note'),
          columns,
          rows,
        },
      }
    }

    case 'open_in_app': {
      const page = str(args, 'page')
      const allowed = [
        'transactions',
        'bills',
        'budgets',
        'goals',
        'insights',
        'home',
        'setup',
      ]
      if (!page || !allowed.includes(page)) {
        return { output: `Error: page must be one of ${allowed.join(', ')}.` }
      }
      const month = str(args, 'month')
      return {
        output: 'Button shown to the user.',
        card: {
          kind: 'link',
          label: str(args, 'label') ?? 'Open',
          page,
          tab: null,
          month,
          search: str(args, 'search'),
          from: str(args, 'from') ?? (month ? `${month}-01` : null),
          to: str(args, 'to') ?? (month ? monthEnd(month) : null),
        },
      }
    }

    default:
      return { output: `Error: unknown tool "${name}".` }
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}
