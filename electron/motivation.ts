/**
 * Turns the user's own answer to "what's your biggest money motivation?" into
 * one line worth reading every day. The raw answer is always kept, so a failed
 * or key-less rewrite degrades to their own words rather than to nothing.
 */

import { loadCreds } from './aiCreds'
import { createResponse, outputText } from './openai'

const INSTRUCTIONS = `You write a single line of encouragement for someone's personal budget app.

The user has said what motivates them about money. Turn it into ONE sentence they will see on their home page every day.

Rules:
- Second person, present tense, warm but not syrupy.
- 12 words or fewer. It has to fit on one line in a narrow column.
- Tie it to the specific thing they said. No generic "you've got this".
- No quotation marks, no emoji, no exclamation marks, no hashtags.
- Never invent details they didn't give: no amounts, dates, names, or places.
- Do not mention budgeting apps, AI, or coaching. Just speak to them.

Reply with the sentence and nothing else.`

/** Cleans the user's words up enough to stand on their own as a fallback. */
export function plainMotivation(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return ''
  const capped = text[0].toUpperCase() + text.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

/** Strips the flourishes models add even when told not to. */
function tidy(line: string): string {
  return line
    .trim()
    .split('\n')[0]
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type MotivationLine = {
  line: string
  /** False when this is just the user's own words tidied up. */
  reworded: boolean
  /** Why the rewrite was skipped, for a quiet note in the UI. */
  note?: string
}

export async function writeMotivationLine(
  raw: string,
): Promise<MotivationLine> {
  const fallback = plainMotivation(raw)
  const creds = loadCreds()
  if (!creds) {
    return {
      line: fallback,
      reworded: false,
      note: 'Add an OpenAI key in Insights → AI Coach and the coach will word this for you.',
    }
  }

  try {
    const res = await createResponse(creds.key, {
      model: creds.model,
      instructions: INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: `What motivates me about money: ${raw.trim()}`,
        },
      ],
      tools: [],
      max_output_tokens: 200,
    })
    const line = tidy(outputText(res))
    // A model that returns nothing usable shouldn't wipe out their answer.
    if (!line) return { line: fallback, reworded: false }
    return { line, reworded: true }
  } catch (err) {
    return {
      line: fallback,
      reworded: false,
      note: err instanceof Error ? err.message : 'Could not reach OpenAI.',
    }
  }
}
