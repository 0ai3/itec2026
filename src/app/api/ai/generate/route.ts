import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type GenerateRequestBody = {
  language?: string
  prompt?: string
  currentCode?: string
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
const MAX_PROMPT_CHARS = 2_000
const MAX_CODE_CHARS = 12_000

const trimToMax = (value: string, max: number, fromEnd = false) => {
  if (value.length <= max) {
    return value
  }
  return fromEnd ? value.slice(value.length - max) : value.slice(0, max)
}

const getRequiredGroqKey = () => {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    throw new Error('Missing GROQ_API_KEY')
  }
  return key
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateRequestBody
    const language = body.language?.trim() || 'plaintext'
    const prompt = trimToMax(body.prompt?.trim() ?? '', MAX_PROMPT_CHARS)
    const currentCode = trimToMax(body.currentCode ?? '', MAX_CODE_CHARS, true)

    if (!prompt) {
      return NextResponse.json({ code: '', completion: '' })
    }

    const apiKey = getRequiredGroqKey()

    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert coding assistant. Generate code only, no explanations, no markdown, no backticks.',
          },
          {
            role: 'user',
            content: `Language: ${language}\n\nTask: ${prompt}\n\nCurrent code context:\n${currentCode || '(empty)'}`,
          },
        ],
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Groq request failed (${response.status}): ${errText}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const generated =
      data.choices?.[0]?.message?.content
        ?.replace(/^```[a-zA-Z]*\n?|```$/g, '')
        .trimEnd() ?? ''

    return NextResponse.json({ code: generated, completion: generated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed'
    const status = message.includes('Missing GROQ_API_KEY') ? 500 : 502
    return NextResponse.json({ error: message, code: '', completion: '' }, { status })
  }
}
