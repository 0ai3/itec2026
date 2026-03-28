import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type CompletionRequestBody = {
	language?: string
	filePath?: string
	prefix?: string
	suffix?: string
	mode?: 'completion' | 'fix'
	code?: string
}

const getLanguageFromFilePath = (filePath?: string) => {
	if (!filePath) return ''
	const lowerPath = filePath.trim().toLowerCase()
	if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) return 'typescript'
	if (lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx')) return 'javascript'
	if (lowerPath.endsWith('.json')) return 'json'
	if (lowerPath.endsWith('.css')) return 'css'
	if (lowerPath.endsWith('.html')) return 'html'
	if (lowerPath.endsWith('.py')) return 'python'
	if (lowerPath.endsWith('.md')) return 'markdown'
	if (lowerPath.endsWith('.cpp') || lowerPath.endsWith('.cc') || lowerPath.endsWith('.cxx')) return 'cpp'
	if (lowerPath.endsWith('.c')) return 'c'
	if (lowerPath.endsWith('.java')) return 'java'
	if (lowerPath.endsWith('.rs')) return 'rust'
	if (lowerPath.endsWith('.go')) return 'go'
	if (lowerPath.endsWith('.php')) return 'php'
	if (lowerPath.endsWith('.rb')) return 'ruby'
	if (lowerPath.endsWith('.r')) return 'r'
	if (lowerPath.endsWith('.lua')) return 'lua'
	return ''
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
		const languageFromPath = getLanguageFromFilePath(body.filePath)
		const language = languageFromPath || body.language?.trim() || 'plaintext'
		const mode = body.mode ?? 'completion'
		const apiKey = getRequiredGroqKey()

		const isFix = mode === 'fix'
		const maxSource = 20_000
		const sourceCode = isFix ? trimToMax(body.code ?? '', maxSource, true) : ''
		const prefix = isFix ? '' : trimToMax(body.prefix ?? '', MAX_PREFIX_CHARS, true)
		const suffix = isFix ? '' : trimToMax(body.suffix ?? '', MAX_SUFFIX_CHARS, false)

		if (!isFix && prefix.trim().length < 2) {
			return NextResponse.json({ completion: '' })
		}

		if (isFix && sourceCode.trim().length === 0) {
			return NextResponse.json({ completion: '' })
		}

		const systemPrompt = isFix
			? 'You are an expert software engineer. Rewrite the selected code to be correct, clean, and idiomatic. Return only the corrected code with no markdown, no backticks, no explanation.'
			: 'You are an expert coding assistant. Return only code that continues from the prefix at the cursor position. No markdown, no backticks, no explanation.'

		const userPrompt = isFix
			? `Language: ${language}\n\nFix the selected code block exactly and return only the fixed code (do not add explanation).\n\nCode:\n${sourceCode}`
			: `Language: ${language}\n\nComplete the code at <CURSOR>.\n\nPrefix:\n${prefix}\n<CURSOR>\nSuffix:\n${suffix}`

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
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
			}),
			cache: 'no-store',
		})
		

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>
		}
		const completion = data.choices?.[0]?.message?.content?.replace(/^```[a-zA-Z]*\n?|```$/g, '').trimEnd() ?? ''

		return NextResponse.json({ completion });
	
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Completion failed';
		const status = message.includes('Missing GROQ_API_KEY') ? 500 : 502;
		return NextResponse.json({ error: message, completion: '' }, { status });
	}
}
