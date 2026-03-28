'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Yjs = typeof import('yjs')
type YWebsocket = typeof import('y-websocket')

type SyncedTerminalProps = {
  roomId: string
  ownerUid: string | null
  repoId: string
  defaultImage: string
  defaultCommand: string
}

const setYTextValue = (yText: import('yjs').Text, value: string) => {
  yText.delete(0, yText.length)
  if (value) {
    yText.insert(0, value)
  }
}

const isNodeCommand = (command: string) => /^(npm|npx|pnpm|yarn|node)\b/.test(command)
const isPythonCommand = (command: string) => /^(python|python3|pip|pip3)\b/.test(command)
const inputRequestPattern = /(EOFError|EOF when reading a line|No line found)/i

const resolveExecutionImage = (imageValue: string, commandValue: string, defaultImageValue: string) => {
  const trimmedImage = imageValue.trim()
  const trimmedCommand = commandValue.trim()

  if (trimmedImage && trimmedImage !== defaultImageValue) {
    return trimmedImage
  }

  if (isNodeCommand(trimmedCommand)) {
    return 'node:20-alpine'
  }

  if (isPythonCommand(trimmedCommand)) {
    return 'python:3.11-alpine'
  }

  return trimmedImage || 'alpine:3.20'
}

export default function SyncedTerminal({
  roomId,
  ownerUid,
  repoId,
  defaultImage,
  defaultCommand,
}: SyncedTerminalProps) {
  const transportRoomId = useMemo(() => encodeURIComponent(`${roomId}:terminal`), [roomId])
  const defaultImageRef = useRef(defaultImage)
  const defaultCommandRef = useRef(defaultCommand)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [image, setImage] = useState(defaultImage)
  const [command, setCommand] = useState(defaultCommand)
  const [output, setOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [pendingInputCommand, setPendingInputCommand] = useState<string | null>(null)
  const [pendingInputBuffer, setPendingInputBuffer] = useState('')
  const commandHistoryRef = useRef<string[]>([])
  const lastRunCommandRef = useRef('')
  const commandInputRef = useRef<HTMLInputElement | null>(null)
  const isCommandInputFocusedRef = useRef(false)

  const ydocRef = useRef<import('yjs').Doc | null>(null)
  const providerRef = useRef<import('y-websocket').WebsocketProvider | null>(null)
  const yImageRef = useRef<import('yjs').Text | null>(null)
  const yCommandRef = useRef<import('yjs').Text | null>(null)
  const yOutputRef = useRef<import('yjs').Text | null>(null)
  const suppressSyncRef = useRef(false)

  useEffect(() => {
    defaultImageRef.current = defaultImage
  }, [defaultImage])

  useEffect(() => {
    defaultCommandRef.current = defaultCommand
  }, [defaultCommand])

  useEffect(() => {
    setImage(defaultImage)
    const yImage = yImageRef.current
    if (!yImage) {
      return
    }

    suppressSyncRef.current = true
    setYTextValue(yImage, defaultImage)
    suppressSyncRef.current = false
  }, [defaultImage])

  useEffect(() => {
    setCommand(defaultCommand)
    const yCommand = yCommandRef.current
    if (!yCommand) {
      return
    }

    suppressSyncRef.current = true
    setYTextValue(yCommand, defaultCommand)
    suppressSyncRef.current = false
  }, [defaultCommand])

  useEffect(() => {
    let disposed = false
    let removeStatusListener: (() => void) | null = null
    let removeSyncListener: (() => void) | null = null
    let removeImageObserver: (() => void) | null = null
    let removeCommandObserver: (() => void) | null = null
    let removeOutputObserver: (() => void) | null = null
    let initialSeedApplied = false

    const setup = async () => {
      const Y: Yjs = await import('yjs')
      const { WebsocketProvider }: YWebsocket = await import('y-websocket')

      if (disposed) {
        return
      }

      const ydoc = new Y.Doc()
      ydocRef.current = ydoc

      const wsUrl = process.env.NEXT_PUBLIC_YJS_WS_URL ?? 'ws://localhost:1234'
      const provider = new WebsocketProvider(wsUrl, transportRoomId, ydoc)
      providerRef.current = provider

      setConnectionStatus(
        provider.wsconnected ? 'connected' : provider.wsconnecting ? 'connecting' : 'disconnected'
      )

      const updateStatus = (event: { status: string }) => {
        setConnectionStatus(event.status)
      }
      provider.on('status', updateStatus)
      removeStatusListener = () => {
        provider.off('status', updateStatus)
      }

      const yImage = ydoc.getText('terminal-image')
      const yCommand = ydoc.getText('terminal-command')
      const yOutput = ydoc.getText('terminal-output')

      yImageRef.current = yImage
      yCommandRef.current = yCommand
      yOutputRef.current = yOutput

      setImage(yImage.toString() || defaultImageRef.current)
      setCommand(yCommand.toString() || defaultCommandRef.current)
      setOutput(yOutput.toString())

      const imageObserver = () => {
        if (suppressSyncRef.current) {
          return
        }
        setImage(yImage.toString())
      }
      yImage.observe(imageObserver)
      removeImageObserver = () => {
        yImage.unobserve(imageObserver)
      }

      const commandObserver = () => {
        if (suppressSyncRef.current) {
          return
        }
        if (isCommandInputFocusedRef.current) {
          return
        }
        setCommand(yCommand.toString())
      }
      yCommand.observe(commandObserver)
      removeCommandObserver = () => {
        yCommand.unobserve(commandObserver)
      }

      const outputObserver = () => {
        if (suppressSyncRef.current) {
          return
        }
        setOutput(yOutput.toString())
      }
      yOutput.observe(outputObserver)
      removeOutputObserver = () => {
        yOutput.unobserve(outputObserver)
      }

      const updateSync = (isSynced: boolean) => {
        if (isSynced) {
          setConnectionStatus('connected')

          if (!initialSeedApplied) {
            if (yImage.length === 0 && defaultImageRef.current) {
              setYTextValue(yImage, defaultImageRef.current)
            }
            if (yCommand.length === 0 && defaultCommandRef.current) {
              setYTextValue(yCommand, defaultCommandRef.current)
            }
            initialSeedApplied = true
          }
        }
      }
      provider.on('sync', updateSync)
      removeSyncListener = () => {
        provider.off('sync', updateSync)
      }
    }

    void setup()

    return () => {
      disposed = true
      removeStatusListener?.()
      removeSyncListener?.()
      removeImageObserver?.()
      removeCommandObserver?.()
      removeOutputObserver?.()
      providerRef.current?.destroy()
      providerRef.current = null
      ydocRef.current?.destroy()
      ydocRef.current = null
      yImageRef.current = null
      yCommandRef.current = null
      yOutputRef.current = null
    }
  }, [transportRoomId])

  const handleImageChange = (nextValue: string) => {
    setImage(nextValue)
    const yImage = yImageRef.current
    if (!yImage) {
      return
    }
    suppressSyncRef.current = true
    setYTextValue(yImage, nextValue)
    suppressSyncRef.current = false
  }

  const handleCommandChange = (nextValue: string) => {
    setCommand(nextValue)
  }

  const syncCommandToShared = (nextValue: string) => {
    const yCommand = yCommandRef.current
    if (!yCommand) {
      return
    }
    suppressSyncRef.current = true
    setYTextValue(yCommand, nextValue)
    suppressSyncRef.current = false
  }

  const appendOutput = useCallback((message: string) => {
    const yOutput = yOutputRef.current
    if (!yOutput) {
      setOutput((prev) => (prev ? `${prev}\n\n${message}` : message))
      return
    }

    const current = yOutput.toString()
    const next = current ? `${current}\n\n${message}` : message

    suppressSyncRef.current = true
    setYTextValue(yOutput, next)
    suppressSyncRef.current = false
    setOutput(next)
  }, [])

  const handleClearOutput = useCallback(() => {
    const yOutput = yOutputRef.current
    if (!yOutput) {
      setOutput('')
      return
    }

    suppressSyncRef.current = true
    setYTextValue(yOutput, '')
    suppressSyncRef.current = false
    setOutput('')
  }, [])

  const rememberCommand = useCallback((value: string) => {
    const normalized = value.trim()
    if (!normalized) {
      return
    }

    const next = commandHistoryRef.current.filter((entry) => entry !== normalized)
    next.push(normalized)
    commandHistoryRef.current = next.slice(-100)
  }, [])

  const commandNeedsInput = (text: string) => inputRequestPattern.test(text)

  const runCommand = useCallback(
    async (commandValue: string, stdinValue: string) => {
      const resolvedImage = resolveExecutionImage(image, commandValue, defaultImageRef.current)
      if (resolvedImage !== image) {
        handleImageChange(resolvedImage)
      }

      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerUid,
          repoId,
          image: resolvedImage,
          command: commandValue,
          stdin: stdinValue,
        }),
      })

      const data = (await response.json()) as { output?: string; error?: string; exitCode?: number }
      if (!response.ok) {
        throw new Error(data.error || 'Execution failed')
      }

      const outputText = data.output?.trim() || '(no output)'
      const stdinSummary = stdinValue ? '\n[stdin provided]' : ''
      appendOutput(
        `$ ${commandValue}\n[image: ${resolvedImage}]${stdinSummary}\nexit code: ${data.exitCode ?? 0}\n${outputText}`
      )

      if (commandNeedsInput(outputText)) {
        setPendingInputCommand(commandValue)
        setPendingInputBuffer(stdinValue)
        appendOutput('↳ Program is waiting for input. Type a value and press Enter. Use /cancel to stop.')
      } else {
        setPendingInputCommand(null)
        setPendingInputBuffer('')
      }
    },
    [appendOutput, image, ownerUid, repoId]
  )

  const handleRunCode = useCallback(async () => {
    if (!ownerUid) {
      setTerminalError('Owner information missing for this repo.')
      return
    }

    const typedCommand = command.trim()
    const commandValue = typedCommand || lastRunCommandRef.current
    if (!commandValue) {
      setTerminalError('Command is required')
      return
    }

    handleClearOutput()

    if (pendingInputCommand) {
      if (commandValue === '/cancel') {
        setPendingInputCommand(null)
        setPendingInputBuffer('')
        handleCommandChange('')
        syncCommandToShared('')
        setTerminalError(null)
        appendOutput('↳ Input cancelled.')
        return
      }

      const mergedInput = pendingInputBuffer ? `${pendingInputBuffer}\n${commandValue}` : commandValue
      setTerminalError(null)
      setHistoryIndex(null)
      appendOutput(`> ${commandValue}`)
      handleCommandChange('')
      syncCommandToShared('')
      setIsRunning(true)

      try {
        await runCommand(pendingInputCommand, mergedInput)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Execution failed'
        setTerminalError(message)
        appendOutput(`$ ${pendingInputCommand}\nERROR: ${message}`)
      } finally {
        setIsRunning(false)
        commandInputRef.current?.focus()
      }
      return
    }

    setPendingInputCommand(null)
    setPendingInputBuffer('')
    setTerminalError(null)
    setIsRunning(true)
    setHistoryIndex(null)
    rememberCommand(commandValue)
    lastRunCommandRef.current = commandValue
    syncCommandToShared(commandValue)

    try {
      await runCommand(commandValue, '')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed'
      setTerminalError(message)
      appendOutput(`$ ${commandValue}\nERROR: ${message}`)
    } finally {
      setIsRunning(false)
      commandInputRef.current?.focus()
    }
  }, [appendOutput, command, handleClearOutput, ownerUid, pendingInputBuffer, pendingInputCommand, rememberCommand, runCommand])

  const handleCommandKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleRunCode()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      void handleRunCode()
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()

      const history = commandHistoryRef.current
      if (history.length === 0) {
        return
      }

      if (historyIndex === null) {
        const nextIndex = history.length - 1
        setHistoryIndex(nextIndex)
        handleCommandChange(history[nextIndex])
        syncCommandToShared(history[nextIndex])
        return
      }

      const nextIndex = Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIndex)
      handleCommandChange(history[nextIndex])
      syncCommandToShared(history[nextIndex])
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()

      const history = commandHistoryRef.current
      if (history.length === 0 || historyIndex === null) {
        return
      }

      const nextIndex = historyIndex + 1
      if (nextIndex >= history.length) {
        setHistoryIndex(null)
        handleCommandChange('')
        syncCommandToShared('')
        return
      }

      setHistoryIndex(nextIndex)
      handleCommandChange(history[nextIndex])
      syncCommandToShared(history[nextIndex])
    }
  }

  return (
    <div className="border border-white/10 rounded-xl p-3 relative z-10 bg-[#111a2c] text-gray-100">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Synced Terminal</h3>
        <p className="text-xs text-gray-400">Status: {connectionStatus}</p>
      </div>

      <div className="grid md:grid-cols-[220px_auto_auto] gap-2 items-center">
        
        <button
          type="button"
          onClick={handleRunCode}
          disabled={isRunning || !ownerUid || (!command.trim() && !lastRunCommandRef.current)}
          className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-60"
        >
          {isRunning ? 'Running...' : 'Run'}
        </button>
        <button
          type="button"
          onClick={handleClearOutput}
          className="border border-white/20 rounded px-4 py-2 text-sm hover:bg-white/10"
        >
          Clear
        </button>
      </div>

      {terminalError ? <p className="text-xs text-red-600 mt-2">{terminalError}</p> : null}

      <div className="mt-3 bg-black text-gray-100 rounded border border-black/30 overflow-hidden">
        <pre className="text-xs p-3 min-h-28 max-h-64 overflow-auto whitespace-pre-wrap border-b border-white/10">
          {output || 'Shared terminal output will appear here.'}
        </pre>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-green-400 text-sm">$</span>
          <input
            ref={commandInputRef}
            value={command}
            onChange={(event) => {
              setHistoryIndex(null)
              handleCommandChange(event.target.value)
            }}
            onFocus={() => {
              isCommandInputFocusedRef.current = true
            }}
            onBlur={() => {
              isCommandInputFocusedRef.current = false
            }}
            onKeyDown={handleCommandKeyDown}
            placeholder={
              pendingInputCommand
                ? 'Program input mode: type value and press Enter (/cancel to stop)'
                : 'Type any command in /workspace and press Enter'
            }
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-500"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        {pendingInputCommand
          ? 'Input mode: Enter sends input to the running program. Type /cancel to exit input mode.'
          : 'Press Enter to run. Use ↑/↓ for command history.'}
      </p>
    </div>
  )
}
