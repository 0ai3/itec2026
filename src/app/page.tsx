'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Monaco = typeof import('monaco-editor')

declare global {
	interface Window {
		MonacoEnvironment?: {
			getWorker: (_: unknown, label: string) => Worker
		}
	}
}

export default function Page() {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
	const runnerRef = useRef<HTMLIFrameElement | null>(null)
	const [output, setOutput] = useState<string[]>([])

	const handleRun = useCallback(() => {
		const code = editorRef.current?.getValue()

		if (!code) {
			setOutput(['No code to run.'])
			return
		}

		setOutput([])

		const iframe = runnerRef.current
		if (!iframe) {
			setOutput(['Runner not ready.'])
			return
		}

		const escapedCode = JSON.stringify(code)
		iframe.srcdoc = `<!doctype html>
<html>
  <body>
    <script>
      const send = (type, args) => parent.postMessage({ source: 'monaco-runner', type, args }, '*');
      const normalize = (arg) => {
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); } catch { return String(arg); }
      };
      console.log = (...args) => send('log', args.map(normalize));
      console.error = (...args) => send('error', args.map(normalize));
      window.onerror = (message, source, lineno, colno) => {
        send('error', [String(message) + ' at ' + String(lineno) + ':' + String(colno)]);
      };
      try {
        const userCode = ${escapedCode};
        new Function(userCode)();
        send('done', ['Execution finished']);
      } catch (error) {
        const errorText = error instanceof Error ? error.stack || error.message : String(error);
        send('error', [errorText]);
      }
    </script>
  </body>
</html>`
	}, [])

	const handleClear = useCallback(() => {
		setOutput([])
	}, [])

	useEffect(() => {
		let disposed = false

		const setup = async () => {
			if (!containerRef.current || editorRef.current) {
				return
			}

			const monaco: Monaco = await import('monaco-editor')

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
				value: "function hello() {\n  console.log('Monaco is working!')\n}\n\nhello()\n",
				language: 'typescript',
				theme: 'vs-dark',
				minimap: { enabled: false },
				automaticLayout: true,
			})
		}

		void setup()

		return () => {
			disposed = true
			editorRef.current?.dispose()
			editorRef.current = null
		}
	}, [])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const payload = event.data as
				| { source?: string; type?: string; args?: string[] }
				| undefined

			if (payload?.source !== 'monaco-runner') {
				return
			}

			const text = (payload.args ?? []).join(' ')
			if (!text) {
				return
			}

			setOutput((prev) => [...prev, payload.type === 'error' ? `Error: ${text}` : text])
		}

		window.addEventListener('message', onMessage)
		return () => {
			window.removeEventListener('message', onMessage)
		}
	}, [])

	return (
		<main style={{ padding: 24 }}>
			<h1 style={{ marginBottom: 12, fontSize: 24, fontWeight: 600 }}>
				Monaco Editor Test
			</h1>
			<p style={{ marginBottom: 16 }}>Testing direct import from `monaco-editor`.</p>
			<div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
				<button
					onClick={handleRun}
					style={{
						padding: '8px 12px',
						borderRadius: 6,
						border: '1px solid #444',
						background: '#111',
						color: '#fff',
						cursor: 'pointer',
					}}
				>
					Run code
				</button>
				<button
					onClick={handleClear}
					style={{
						padding: '8px 12px',
						borderRadius: 6,
						border: '1px solid #444',
						background: 'transparent',
						color: '#fff',
						cursor: 'pointer',
					}}
				>
					Clear output
				</button>
			</div>
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
			<section
				style={{
					border: '1px solid #333',
					borderRadius: 8,
					padding: 12,
					minHeight: 120,
					background: '#0a0a0a',
					color: '#ddd',
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
					fontSize: 13,
					whiteSpace: 'pre-wrap',
				}}
			>
				{output.length === 0 ? 'Output will appear here.' : output.join('\n')}
			</section>
			<iframe
				ref={runnerRef}
				sandbox="allow-scripts"
				title="Monaco code runner"
				style={{ display: 'none' }}
			/>
		</main>
	)
}
