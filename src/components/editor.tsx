'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Monaco = typeof import('monaco-editor')
type Yjs = typeof import('yjs')
type YWebsocket = typeof import('y-websocket')
type YMonaco = typeof import('y-monaco')

type AiRange = {
	startLineNumber: number
	startColumn: number
	endLineNumber: number
	endColumn: number
}

declare global {
	interface Window {
		MonacoEnvironment?: {
			getWorker: (_: unknown, label: string) => Worker
		}
	}
}

type EditorProps = {
	roomId?: string
	language?: string
	initialCode?: string
	onCodeChange?: (code: string) => void
	replaceContentToken?: number
	replaceContentValue?: string
	replaceContentSource?: 'ai' | 'user'
	initialAiRanges?: AiRange[]
	aiRangesToken?: number
	onAiRangesChange?: (ranges: AiRange[]) => void
	embedded?: boolean
}

export default function Editor({
	roomId = 'monaco-room',
	language = 'typescript',
	initialCode = '',
	onCodeChange,
	replaceContentToken,
	replaceContentValue,
	replaceContentSource = 'user',
	initialAiRanges,
	aiRangesToken,
	onAiRangesChange,
	embedded = false,
}: EditorProps) {
	const transportRoomId = encodeURIComponent(roomId)
	const initialCodeRef = useRef(initialCode)
	const onCodeChangeRef = useRef<EditorProps['onCodeChange']>(onCodeChange)
	const replaceContentValueRef = useRef(replaceContentValue)
	const replaceContentSourceRef = useRef<EditorProps['replaceContentSource']>(replaceContentSource)
	const initialAiRangesRef = useRef<AiRange[]>(initialAiRanges ?? [])
	const onAiRangesChangeRef = useRef<EditorProps['onAiRangesChange']>(onAiRangesChange)
	const appliedAiRangesTokenRef = useRef<number | null>(null)
	const aiRangesRef = useRef<AiRange[]>([])
	const aiDecorationIdsRef = useRef<string[]>([])
	const aiMetaRef = useRef<import('yjs').Map<string> | null>(null)
	const lastBroadcastAiRangesRef = useRef('')
	const pendingRenderRangesRef = useRef<AiRange[] | null>(null)
	const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const appliedReplaceTokenRef = useRef<number | null>(null)
	const completionAbortRef = useRef<AbortController | null>(null)
	const monacoRef = useRef<Monaco | null>(null)
	const pendingInlineCompletionRef = useRef<string | null>(null)
	const containerRef = useRef<HTMLDivElement | null>(null)
	const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
	const ydocRef = useRef<import('yjs').Doc | null>(null)
	const providerRef = useRef<import('y-websocket').WebsocketProvider | null>(null)
	const bindingRef = useRef<import('y-monaco').MonacoBinding | null>(null)
	const [connectionStatus, setConnectionStatus] = useState('connecting')

	useEffect(() => {
		onCodeChangeRef.current = onCodeChange
	}, [onCodeChange])

	useEffect(() => {
		replaceContentValueRef.current = replaceContentValue
	}, [replaceContentValue])

	useEffect(() => {
		replaceContentSourceRef.current = replaceContentSource
	}, [replaceContentSource])

	useEffect(() => {
		initialAiRangesRef.current = initialAiRanges ?? []
	}, [initialAiRanges])

	useEffect(() => {
		onAiRangesChangeRef.current = onAiRangesChange
	}, [onAiRangesChange])

	const normalizeRanges = useCallback((ranges: AiRange[]) => {
		return ranges
			.map((range) => {
				const startLineNumber = Math.max(1, Math.floor(range.startLineNumber))
				const startColumn = Math.max(1, Math.floor(range.startColumn))
				const endLineNumber = Math.max(startLineNumber, Math.floor(range.endLineNumber))
				const endColumn =
					endLineNumber === startLineNumber
						? Math.max(startColumn, Math.floor(range.endColumn))
						: Math.max(1, Math.floor(range.endColumn))
				return { startLineNumber, startColumn, endLineNumber, endColumn }
			})
			.sort((a, b) =>
				a.startLineNumber === b.startLineNumber
					? a.startColumn === b.startColumn
						? a.endLineNumber === b.endLineNumber
							? a.endColumn - b.endColumn
							: a.endLineNumber - b.endLineNumber
						: a.startColumn - b.startColumn
					: a.startLineNumber - b.startLineNumber
			)
	}, [])

	const emitAiRangesChange = useCallback(() => {
		onAiRangesChangeRef.current?.([...aiRangesRef.current])
	}, [])

	const renderAiRanges = useCallback((ranges: AiRange[]) => {
		const editor = editorRef.current
		const monaco = monacoRef.current
		if (!editor || !monaco) {
			return
		}

		const decorations = ranges.map((range) => ({
			range: new monaco.Range(
				range.startLineNumber,
				range.startColumn,
				range.endLineNumber,
				range.endColumn
			),
			options: {
				inlineClassName: 'ai-generated-code-bg',
				stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			},
		}))

		aiDecorationIdsRef.current = editor.deltaDecorations(aiDecorationIdsRef.current, decorations)
	}, [])

	const scheduleRenderAiRanges = useCallback(
		(ranges: AiRange[]) => {
			pendingRenderRangesRef.current = ranges

			if (renderTimerRef.current) {
				return
			}

			renderTimerRef.current = setTimeout(() => {
				renderTimerRef.current = null
				const nextRanges = pendingRenderRangesRef.current
				pendingRenderRangesRef.current = null
				if (!nextRanges) {
					return
				}
				renderAiRanges(nextRanges)
			}, 0)
		},
		[renderAiRanges]
	)

	const applyAiRanges = useCallback((ranges: AiRange[], options?: { broadcast?: boolean }) => {
		const normalized = normalizeRanges(ranges)
		aiRangesRef.current = normalized
		emitAiRangesChange()
		scheduleRenderAiRanges(normalized)

		if (options?.broadcast === false) {
			return
		}

		const payload = JSON.stringify(normalized)
		if (payload === lastBroadcastAiRangesRef.current) {
			return
		}

		lastBroadcastAiRangesRef.current = payload
		aiMetaRef.current?.set('aiRanges', payload)
	}, [emitAiRangesChange, normalizeRanges, scheduleRenderAiRanges])

	const addAiRange = useCallback((range: AiRange) => {
		applyAiRanges([...aiRangesRef.current, range])
	}, [applyAiRanges])

	useEffect(() => {
		if (typeof replaceContentToken !== 'number') {
			return
		}

		if (appliedReplaceTokenRef.current === replaceContentToken) {
			return
		}

		appliedReplaceTokenRef.current = replaceContentToken

		const editor = editorRef.current
		const model = editor?.getModel()
		if (!editor || !model) {
			return
		}

		const nextValue = replaceContentValueRef.current ?? ''
		model.setValue(nextValue)
		onCodeChangeRef.current?.(nextValue)

		if (replaceContentSourceRef.current === 'ai' && nextValue.trim()) {
			const endLineNumber = model.getLineCount()
			const endColumn = model.getLineMaxColumn(endLineNumber)
			applyAiRanges([
				{
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber,
				endColumn,
				},
			])
		}
	}, [applyAiRanges, replaceContentToken])

	useEffect(() => {
		if (typeof aiRangesToken !== 'number') {
			return
		}

		if (appliedAiRangesTokenRef.current === aiRangesToken) {
			return
		}

		appliedAiRangesTokenRef.current = aiRangesToken
		applyAiRanges(initialAiRangesRef.current ?? [])
	}, [aiRangesToken, applyAiRanges])

	useEffect(() => {
		let disposed = false
		let removeStatusListener: (() => void) | null = null
		let removeSyncListener: (() => void) | null = null
		let removeAiMetaListener: (() => void) | null = null
		let removeContentListener: (() => void) | null = null
		let removeInlineProvider: (() => void) | null = null
		let initialSeedApplied = false

		const setup = async () => {
			if (!containerRef.current || editorRef.current) {
				return
			}

			const monaco: Monaco = await import('monaco-editor')
			monacoRef.current = monaco
			const Y: Yjs = await import('yjs')
			const { WebsocketProvider }: YWebsocket = await import('y-websocket')
			const { MonacoBinding }: YMonaco = await import('y-monaco')

			window.MonacoEnvironment = {
				getWorker(_, label) {
					if (label === 'json') {
						return new Worker(
							new URL('monaco-editor/esm/vs/language/json/json.worker', import.meta.url),
							{ type: 'module' }
						)
					}
					if (label === 'css' || label === 'scss' || label === 'less') {
						return new Worker(
							new URL('monaco-editor/esm/vs/language/css/css.worker', import.meta.url),
							{ type: 'module' }
						)
					}
					if (label === 'html' || label === 'handlebars' || label === 'razor') {
						return new Worker(
							new URL('monaco-editor/esm/vs/language/html/html.worker', import.meta.url),
							{ type: 'module' }
						)
					}
					if (label === 'typescript' || label === 'javascript') {
						return new Worker(
							new URL('monaco-editor/esm/vs/language/typescript/ts.worker', import.meta.url),
							{ type: 'module' }
						)
					}

					return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url), {
						type: 'module',
					})
				},
			}

			if (disposed || !containerRef.current) {
				return
			}

			editorRef.current = monaco.editor.create(containerRef.current, {
				value: '',
				language,
				theme: 'vs-dark',
				minimap: { enabled: false },
				inlineSuggest: { enabled: true },
				quickSuggestions: {
					other: true,
					comments: false,
					strings: true,
				},
				automaticLayout: true,
			})

			const inlineProvider = monaco.languages.registerInlineCompletionsProvider(language, {
				provideInlineCompletions: async (model, position) => {
					const editor = editorRef.current
					if (!editor) {
						return { items: [] }
					}

					const beforeRange = new monaco.Range(1, 1, position.lineNumber, position.column)
					const afterRange = new monaco.Range(
						position.lineNumber,
						position.column,
						model.getLineCount(),
						model.getLineMaxColumn(model.getLineCount())
					)

					const prefix = model.getValueInRange(beforeRange)
					if (prefix.trim().length < 2) {
						return { items: [] }
					}

					const suffix = model.getValueInRange(afterRange)

					completionAbortRef.current?.abort()
					const abortController = new AbortController()
					completionAbortRef.current = abortController

					try {
						const response = await fetch('/api/ai-complete', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								language,
								prefix,
								suffix,
							}),
							signal: abortController.signal,
						})

						if (!response.ok) {
							return { items: [] }
						}

						const data = (await response.json()) as { completion?: string }
						const completion = (data.completion ?? '').trimEnd()
						if (!completion) {
							return { items: [] }
						}

						pendingInlineCompletionRef.current = completion

						return {
							items: [
								{
									insertText: completion,
									range: new monaco.Range(
										position.lineNumber,
										position.column,
										position.lineNumber,
										position.column
									),
								},
							],
						}
					} catch {
						return { items: [] }
					}
				},
				disposeInlineCompletions: () => {
					completionAbortRef.current?.abort()
				},
			})
			removeInlineProvider = () => {
				inlineProvider.dispose()
			}

			const contentDisposable = editorRef.current.onDidChangeModelContent((event) => {
				const editor = editorRef.current
				const model = editor?.getModel()
				if (editor && model && pendingInlineCompletionRef.current) {
					const accepted = event.changes.find(
						(change) =>
							change.rangeLength === 0 &&
							change.text.length > 0 &&
							change.text === pendingInlineCompletionRef.current
					)

					if (accepted) {
						const start = model.getPositionAt(accepted.rangeOffset)
						const end = model.getPositionAt(accepted.rangeOffset + accepted.text.length)
						addAiRange({
							startLineNumber: start.lineNumber,
							startColumn: start.column,
							endLineNumber: end.lineNumber,
							endColumn: end.column,
						})
					}

					pendingInlineCompletionRef.current = null
				}

				onCodeChangeRef.current?.(editorRef.current?.getValue() ?? '')
			})
			removeContentListener = () => {
				contentDisposable.dispose()
			}

			const ydoc = new Y.Doc()
			ydocRef.current = ydoc
			const aiMeta = ydoc.getMap<string>('meta')
			aiMetaRef.current = aiMeta

			const parseAiRangesPayload = (payload: string) => {
				try {
					const parsed = JSON.parse(payload) as unknown
					if (!Array.isArray(parsed)) {
						return null
					}
					return parsed
						.map((entry) => {
							const range = entry as {
								startLineNumber?: unknown
								startColumn?: unknown
								endLineNumber?: unknown
								endColumn?: unknown
							}
							if (
								typeof range.startLineNumber !== 'number' ||
								typeof range.startColumn !== 'number' ||
								typeof range.endLineNumber !== 'number' ||
								typeof range.endColumn !== 'number'
							) {
								return null
							}
							return {
								startLineNumber: range.startLineNumber,
								startColumn: range.startColumn,
								endLineNumber: range.endLineNumber,
								endColumn: range.endColumn,
							}
						})
						.filter((range): range is AiRange => Boolean(range))
				} catch {
					return null
				}
			}

			const syncAiRangesFromMeta = () => {
				const payload = aiMeta.get('aiRanges')
				if (typeof payload !== 'string') {
					return false
				}

				lastBroadcastAiRangesRef.current = payload
				const parsedRanges = parseAiRangesPayload(payload)
				if (!parsedRanges) {
					return false
				}

				applyAiRanges(parsedRanges, { broadcast: false })
				return true
			}

			const onAiMetaChange = () => {
				syncAiRangesFromMeta()
			}

			aiMeta.observe(onAiMetaChange)
			removeAiMetaListener = () => {
				aiMeta.unobserve(onAiMetaChange)
			}

			const wsUrl = process.env.NEXT_PUBLIC_YJS_WS_URL ?? 'ws://localhost:1234'
			const provider = new WebsocketProvider(wsUrl, transportRoomId, ydoc)
			providerRef.current = provider
			setConnectionStatus(
				provider.wsconnected
					? 'connected'
					: provider.wsconnecting
						? 'connecting'
						: 'disconnected'
			)

			const updateStatus = (event: { status: string }) => {
				setConnectionStatus(event.status)
			}
			provider.on('status', updateStatus)
			removeStatusListener = () => {
				provider.off('status', updateStatus)
			}

			const updateSync = (isSynced: boolean) => {
				if (isSynced) {
					setConnectionStatus('connected')
					if (!initialSeedApplied && yText.length === 0 && initialCodeRef.current) {
						yText.insert(0, initialCodeRef.current)
						initialSeedApplied = true
					}

					const pulledFromMeta = syncAiRangesFromMeta()
					if (!pulledFromMeta && initialAiRangesRef.current.length > 0) {
						applyAiRanges(initialAiRangesRef.current)
					}
				}
			}
			provider.on('sync', updateSync)
			removeSyncListener = () => {
				provider.off('sync', updateSync)
			}

			provider.awareness.setLocalStateField('user', {
				name: `User-${Math.floor(Math.random() * 1000)}`,
				color: '#60a5fa',
			})

			const yText = ydoc.getText('monaco')
			const model = editorRef.current.getModel()
			if (model) {
				bindingRef.current = new MonacoBinding(
					yText,
					model,
					new Set([editorRef.current]),
					provider.awareness
				)
			}
		}

		void setup()

		return () => {
			disposed = true
			removeStatusListener?.()
			removeSyncListener?.()
			removeAiMetaListener?.()
			removeContentListener?.()
			removeInlineProvider?.()
			completionAbortRef.current?.abort()
			completionAbortRef.current = null
			pendingInlineCompletionRef.current = null
			monacoRef.current = null
			if (renderTimerRef.current) {
				clearTimeout(renderTimerRef.current)
				renderTimerRef.current = null
			}
			pendingRenderRangesRef.current = null
			aiMetaRef.current = null
			lastBroadcastAiRangesRef.current = ''
			bindingRef.current?.destroy()
			bindingRef.current = null
			providerRef.current?.destroy()
			providerRef.current = null
			ydocRef.current?.destroy()
			ydocRef.current = null
			try {
				aiDecorationIdsRef.current = []
				aiRangesRef.current = []
				editorRef.current?.getModel()?.dispose()
				editorRef.current?.dispose()
			} catch {
			}
			editorRef.current = null
		}
	}, [transportRoomId, language, addAiRange, applyAiRanges])

	if (embedded) {
		return (
			<div className="h-full w-full bg-black/95">
				<div ref={containerRef} className="h-full w-full" />
			</div>
		)
	}

	return (
		<main style={{ padding: 24 }}>
			<h1 style={{ marginBottom: 12, fontSize: 24, fontWeight: 600 }}>
				Collaborative Monaco Editor (Yjs)
			</h1>
			<p style={{ marginBottom: 8 }}>
				Room: <strong>{roomId}</strong>
			</p>
			<p style={{ marginBottom: 8 }}>
				Transport room: <strong>{transportRoomId}</strong>
			</p>
			<p style={{ marginBottom: 16 }}>
				WebSocket: <strong>{process.env.NEXT_PUBLIC_YJS_WS_URL ?? 'ws://localhost:1234'}</strong>{' '}
				| Status: <strong>{connectionStatus}</strong>
			</p>
			<div
				ref={containerRef}
				style={{
					height: '55vh',
					width: '100%',
					border: '1px solid #333',
					borderRadius: 8,
					overflow: 'hidden',
					marginBottom: 12,
				}}
			/>
		</main>
	)
}