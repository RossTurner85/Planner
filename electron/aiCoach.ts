import type { FinanceDb } from './db'
import {
  AI_TOOLS,
  runAiTool,
  type AiCard,
  type ToolOutcome,
} from './aiTools'
import {
  createResponse,
  functionCalls,
  outputText,
  type AiItem,
} from './openai'
import { requireCreds } from './aiCreds'

/**
 * The coach loop: hand the model a set of tools, let it query the database as
 * many times as it needs, then let it explain what it found. Nothing about the
 * user's money is guessed — every figure in an answer came back from a tool.
 */

/** Enough for a couple of lookups plus a chart, without runaway loops. */
const MAX_ROUNDS = 6

export type AiTurn = {
  role: 'user' | 'assistant'
  text: string
}

/** Exactly what was handed to OpenAI, so the UI can show it verbatim. */
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

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/**
 * The one thing sent on every request regardless of the question: who the user
 * is, what today is, and the names of their categories, accounts, and people so
 * the model can filter by them. Deliberately no balances or amounts — those
 * only leave the machine when a tool call actually needs them.
 */
function buildInstructions(
  db: FinanceDb,
  profileId: number,
  month: string,
): string {
  const profile = db.listProfiles().find((p) => p.id === profileId)
  const categories = db.listCategories(profileId)
  const accounts = db.listAccounts(profileId)
  const people = db.listPeople(profileId)
  const span = db.aiDataSpan(profileId)

  const catList = categories.map((c) => c.name).join(', ') || 'none yet'
  const acctList =
    accounts.map((a) => `${a.name} (${a.type})`).join(', ') || 'none yet'
  const peopleList = people.map((p) => p.name).join(', ') || 'none yet'
  const range =
    span.firstDate && span.lastDate
      ? `${span.firstDate} to ${span.lastDate}`
      : 'no transactions imported yet'

  return `You are the money coach inside Bizzy's Finance, a private desktop budgeting app. You are talking to ${profile?.name ?? 'the owner'} about their own household finances.

HOW YOU GET FACTS
- Call tools to look things up. You may call several, and you may call them again with different arguments.
- Never state a dollar amount, count, or date that did not come back from a tool in this conversation. Do not estimate, extrapolate, or fill a gap from memory.
- If a tool returns no matches, or reports an "unresolved" name, say plainly what you could not find. Never substitute a near match or invent a plausible figure.

WHAT THE DATA MEANS
- Amounts are negative for money going out and positive for money coming in.
- Transfers between the user's own accounts, and credit card payments, are flagged as transfers and left out of every total by default. Never call those spending or income. Only include them if the question is specifically about them.
- "Uncategorized" means no category has been assigned yet.
- Dates are YYYY-MM-DD and months are YYYY-MM.

HOW TO ANSWER
- Lead with the answer. One to four short sentences of plain English. No headings, no markdown tables, no bullet lists unless you are genuinely listing three or more things.
- Write money as $1,234.56.
- When the answer compares more than two numbers, call show_chart so they can see it, then describe the takeaway instead of reciting every value.
- When they ask to see specific transactions, or the answer needs several columns, call show_table.
- Call open_in_app when they would probably want to look at or fix the underlying transactions.
- Be direct about problems, and skip the cheerleading. If something looks off, such as a category with nothing in it or a pile of uncategorized rows, say so.

CONTEXT
- Today is ${todayISO()}.
- The month currently on screen is ${month}.
- Transactions on file span ${range}.
- Categories: ${catList}
- Accounts: ${acctList}
- People: ${peopleList}`
}

export async function askAiCoach(
  db: FinanceDb,
  input: {
    profileId: number
    month: string
    question: string
    history?: AiTurn[]
  },
): Promise<AiAskResult> {
  const creds = requireCreds()
  const instructions = buildInstructions(db, input.profileId, input.month)

  const items: AiItem[] = []
  // Prior turns go back as plain text: it keeps follow-ups cheap and avoids
  // replaying old tool traffic the model no longer needs.
  for (const turn of input.history ?? []) {
    if (!turn.text.trim()) continue
    items.push({ role: turn.role, content: turn.text })
  }
  items.push({ role: 'user', content: input.question })

  const cards: AiCard[] = []
  const calls: AiAuditCall[] = []
  let tokensIn = 0
  let tokensOut = 0
  let answer = ''

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS - 1
    const res = await createResponse(creds.key, {
      model: creds.model,
      instructions,
      input: items,
      // On the final round the tools are withdrawn so the model has to answer
      // with what it already has instead of looping forever.
      tools: lastRound ? [] : AI_TOOLS,
    })

    tokensIn += res.usage?.input_tokens ?? 0
    tokensOut += res.usage?.output_tokens ?? 0

    // Everything the model produced goes back verbatim next round, including
    // reasoning items, which GPT-5 models require alongside tool results.
    items.push(...res.output)

    const text = outputText(res)
    if (text) answer = text

    const wanted = functionCalls(res)
    if (wanted.length === 0) break

    for (const call of wanted) {
      let args: Record<string, unknown> = {}
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {}
      } catch {
        args = {}
      }

      let outcome: ToolOutcome
      try {
        outcome = runAiTool(db, input.profileId, call.name, args)
      } catch (err) {
        outcome = {
          output: `Error running ${call.name}: ${
            err instanceof Error ? err.message : 'unknown failure'
          }`,
        }
      }

      if (outcome.card) cards.push(outcome.card)
      calls.push({
        tool: call.name,
        args,
        sent: outcome.output,
        bytes: Buffer.byteLength(outcome.output, 'utf8'),
      })

      items.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: outcome.output,
      })
    }
  }

  return {
    answer:
      answer ||
      "I couldn't put an answer together for that. Try asking it a different way.",
    cards,
    model: creds.model,
    tokensIn,
    tokensOut,
    audit: {
      instructions,
      question: input.question,
      calls,
    },
  }
}
