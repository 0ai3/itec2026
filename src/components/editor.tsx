'use client'

import { useEffect, useRef, useState } from 'react'

type Monaco = typeof import('monaco-editor')
type Yjs = typeof import('yjs')
type YWebsocket = typeof import('y-websocket')
type YMonaco = typeof import('y-monaco')

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
}

export default function Editor({
	roomId = 'monaco-room',
	language = 'typescript',
	initialCode = '',
	onCodeChange,
}: EditorProps) {
	const transportRoomId = encodeURIComponent(roomId)
	const initialCodeRef = useRef(initialCode)
	const onCodeChangeRef = useRef<EditorProps['onCodeChange']>(onCodeChange)
	const suppressOnChangeRef = useRef(false)
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
		let disposed = false
		let removeStatusListener: (() => void) | null = null
		let removeSyncListener: (() => void) | null = null
		let removeContentListener: (() => void) | null = null

		const setup = async () => {
			if (!containerRef.current || editorRef.current) {
				return
			}

			const monaco: Monaco = await import('monaco-editor')
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
				value: initialCodeRef.current,
				language,
				theme: 'vs-dark',
				minimap: { enabled: false },
				automaticLayout: true,
			})

			const contentDisposable = editorRef.current.onDidChangeModelContent(() => {
				if (suppressOnChangeRef.current) {
					return
				}
				onCodeChangeRef.current?.(editorRef.current?.getValue() ?? '')
			})
			removeContentListener = () => {
				contentDisposable.dispose()
			}

			const ydoc = new Y.Doc()
			ydocRef.current = ydoc

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
			removeContentListener?.()
			bindingRef.current?.destroy()
			bindingRef.current = null
			providerRef.current?.destroy()
			providerRef.current = null
			ydocRef.current?.destroy()
			ydocRef.current = null
			try {
				editorRef.current?.getModel()?.dispose()
				editorRef.current?.dispose()
			} catch {
			}
			editorRef.current = null
		}
	}, [transportRoomId, language])

	useEffect(() => {
		const editor = editorRef.current
		if (!editor) {
			return
		}

		const currentValue = editor.getValue()
		if (currentValue === initialCode) {
			return
		}

		suppressOnChangeRef.current = true
		editor.setValue(initialCode)
		suppressOnChangeRef.current = false
	}, [initialCode])

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