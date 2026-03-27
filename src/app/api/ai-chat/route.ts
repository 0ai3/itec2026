import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ChatRequestBody = {
  language?: string
  filePath?: string
  codeContext?: string
  messages?: ChatMessage[]
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
const MAX_CONTEXT_CHARS = 12_000
const MAX_MESSAGES = 20

const getRequiredGroqKey = () => {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    throw new Error('Missing GROQ_API_KEY')
  }
  return key
}

const trimToMax = (value: string, max: number) => {
  if (value.length <= max) {
    return value
  }
  return value.slice(value.length - max)
}

const extractCodeBlocks = (text: string) => {
  const matches = Array.from(text.matchAll(/```(?:[\w+-]+)?\n([\s\S]*?)```/g))
  if (matches.length === 0) {
    return ''
  }
  return matches.map((match) => match[1].trim()).filter(Boolean).join('\n\n')
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody
    const language = body.language?.trim() || 'plaintext'
    const filePath = body.filePath?.trim() || ''
    const codeContext = trimToMax(body.codeContext ?? '', MAX_CONTEXT_CHARS)

    const incomingMessages = (body.messages ?? [])
      .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content?.trim())
      .slice(-MAX_MESSAGES)

    if (incomingMessages.length === 0) {
      return NextResponse.json({ reply: 'Ask me something about your code.', importCode: '' })
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
        max_tokens: 700,
        messages: [
          {
            role: 'system',
            content:
              'You are a coding assistant inside a collaborative web IDE. Give concise, practical answers. When proposing code, include complete code blocks so it can be imported directly.',
          },
          {
            role: 'system',
            content: `Active language: ${language}. Active file: ${filePath || 'unknown'}. Current file content:\n${codeContext || '(empty)'}`,
          },
          ...incomingMessages,
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

    const reply = data.choices?.[0]?.message?.content?.trim() ?? 'No response received.'
    const importCode = extractCodeBlocks(reply)

    return NextResponse.json({ reply, importCode })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat failed'
    const status = message.includes('Missing GROQ_API_KEY') ? 500 : 502
    return NextResponse.json({ error: message, reply: '', importCode: '' }, { status })
  }
}
