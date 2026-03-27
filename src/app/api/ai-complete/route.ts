import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type CompletionRequestBody = {
	language?: string
	prefix?: string
	suffix?: string
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
const MAX_PREFIX_CHARS = 8_000
const MAX_SUFFIX_CHARS = 2_000

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
		const body = (await req.json()) as CompletionRequestBody
		const language = body.language?.trim() || 'plaintext'
		const prefix = trimToMax(body.prefix ?? '', MAX_PREFIX_CHARS, true)
		const suffix = trimToMax(body.suffix ?? '', MAX_SUFFIX_CHARS, false)

		if (prefix.trim().length < 2) {
			return NextResponse.json({ completion: '' })
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
				temperature: 0.2,
				max_tokens: 160,
				messages: [
					{
						role: 'system',
						content:
							'You are an expert coding assistant. Return only code that continues from the prefix at the cursor position. No markdown, no backticks, no explanation.',
					},
					{
						role: 'user',
						content: `Language: ${language}\n\nComplete the code at <CURSOR>.\n\nPrefix:\n${prefix}\n<CURSOR>\nSuffix:\n${suffix}`,
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
		const completion = data.choices?.[0]?.message?.content?.replace(/^```[a-zA-Z]*\n?|```$/g, '').trimEnd() ?? ''

		return NextResponse.json({ completion })
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Completion failed'
		const status = message.includes('Missing GROQ_API_KEY') ? 500 : 502
		return NextResponse.json({ error: message, completion: '' }, { status })
	}
}
