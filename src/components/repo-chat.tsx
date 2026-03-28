'use client'

import { FormEvent, useMemo, useState } from 'react'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  importCode?: string
}

type RepoChatProps = {
  language: string
  filePath: string | null
  codeContext: string
  onImportCode: (code: string) => void
}

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export default function RepoChat({ language, filePath, codeContext, onImportCode }: RepoChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const importEnabled = Boolean(filePath)
  const messagePayload = useMemo(
    () => messages.map((message) => ({ role: message.role, content: message.content })),
    [messages]
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const userPrompt = prompt.trim()
    if (!userPrompt) {
      return
    }

    const nextUserMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      content: userPrompt,
    }

    setPrompt('')
    setChatError(null)
    setIsSending(true)
    setMessages((prev) => [...prev, nextUserMessage])

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          filePath,
          codeContext,
          messages: [...messagePayload, { role: 'user', content: userPrompt }],
        }),
      })

      const data = (await response.json()) as { reply?: string; importCode?: string; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to get AI response')
      }

      const nextAssistantMessage: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: data.reply?.trim() || 'No response received.',
        importCode: data.importCode?.trim() || undefined,
      }

      setMessages((prev) => [...prev, nextAssistantMessage])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to get AI response'
      setChatError(message)
    }

    setIsSending(false)
  }

  return (
    <section className="border border-white/10 rounded-xl p-3 flex flex-col min-h-65 max-h-90 bg-[#111a2c] text-gray-100">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">AI Chat</h3>
        <p className="text-xs text-gray-400">{filePath ? `File: ${filePath}` : 'Select a file to import code'}</p>
      </div>

      <div className="flex-1 overflow-auto border border-white/10 rounded p-2 bg-[#0b1220]">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-400">Ask for refactors, bug fixes, or new code snippets.</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((message) => (
              <li key={message.id} className="text-sm">
                <p className="font-medium mb-1 text-gray-200">{message.role === 'user' ? 'You' : 'Assistant'}</p>
                <p className="whitespace-pre-wrap text-gray-300">{message.content}</p>
                {message.role === 'assistant' && message.importCode ? (
                  <button
                    type="button"
                    onClick={() => onImportCode(message.importCode ?? '')}
                    disabled={!importEnabled}
                    className="mt-2 text-xs border border-white/20 rounded px-2 py-1 disabled:opacity-60 hover:bg-white/10"
                    title={importEnabled ? 'Replace current file with this code' : 'Select a file first'}
                  >
                    Import code
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask AI about this repo..."
          className="flex-1 border border-white/20 rounded px-3 py-2 text-sm bg-[#0b1220] text-gray-100 placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={isSending || !prompt.trim()}
          className="bg-white text-black rounded px-3 py-2 text-sm disabled:opacity-60"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>

      {chatError ? <p className="text-xs text-red-600 mt-2">{chatError}</p> : null}
    </section>
  )
}
