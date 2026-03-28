'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveYjsWsUrl } from '@/lib/yjs-ws-url'

type Monaco = typeof import('monaco-editor')
type Yjs = typeof import('yjs')
type YWebsocket = typeof import('y-websocket')
type YMonaco = typeof import('y-monaco')

export type AiRange = {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
    id: string
    originalText: string
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
    filePath?: string | null
    userId?: string | null
    userName?: string | null
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

type BlockToolbar = {
    x: number
    y: number
    rangeId: string
}

type RemoteCursorState = {
    lineNumber: number
    column: number
}

function generateId() {
    return Math.random().toString(36).slice(2, 10)
}

function normalizeLineEndings(value: string) {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

const setYTextValue = (yText: import('yjs').Text, value: string) => {
    yText.delete(0, yText.length)
    if (value) {
        yText.insert(0, value)
    }
}

export default function Editor({
    roomId = 'monaco-room',
    filePath = null,
    userId = null,
    userName = null,
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
    const userIdRef = useRef(userId)
    const userNameRef = useRef(userName)
    const appliedAiRangesTokenRef = useRef<number | null>(null)
    const aiRangesRef = useRef<AiRange[]>([])
    const lineAuthorsRef = useRef<Record<number, string>>({})
    const aiDecorationIdsRef = useRef<string[]>([])
    const aiMetaRef = useRef<import('yjs').Map<string> | null>(null)
    const lastBroadcastAiRangesRef = useRef('')
    const lastBroadcastLineAuthorsRef = useRef('')
    const pendingRenderRangesRef = useRef<AiRange[] | null>(null)
    const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const appliedReplaceTokenRef = useRef<number | null>(null)
    const completionRequestSeqRef = useRef(0)
    const monacoRef = useRef<Monaco | null>(null)
    const pendingInlineCompletionRef = useRef<string | null>(null)
    const pendingEditAuthorRef = useRef<string | null>(null)
    const renderRemoteCursorsRef = useRef<(() => void) | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
    const ydocRef = useRef<import('yjs').Doc | null>(null)
    const providerRef = useRef<import('y-websocket').WebsocketProvider | null>(null)
    const bindingRef = useRef<import('y-monaco').MonacoBinding | null>(null)
    const remoteCursorWidgetsRef = useRef<Map<number, {
        widget: import('monaco-editor').editor.IContentWidget
        element: HTMLDivElement
        position: RemoteCursorState
    }>>(new Map())

    const [connectionStatus, setConnectionStatus] = useState('connecting')
    const [isEditorEmpty, setIsEditorEmpty] = useState(initialCode.length === 0)
    const [hoverAttribution, setHoverAttribution] = useState<{ x: number; y: number; text: string } | null>(null)

    // Selection popup (Pentru Fix Code)
    const [selectionPopup, setSelectionPopup] = useState<{
        x: number
        y: number
        selectedText: string
        selectedRange: import('monaco-editor').Selection
    } | null>(null)
    const [popupPrompt, setPopupPrompt] = useState('')
    const [popupLoading, setPopupLoading] = useState(false)
    const popupRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const selectionPopupRef = useRef(selectionPopup)
    const popupPromptRef = useRef(popupPrompt)

    // --- Notion-style AI Generate Popup (Ctrl + K) ---
    const [generatePopup, setGeneratePopup] = useState<{
        x: number
        y: number
        lineNumber: number
    } | null>(null)
    const [generatePrompt, setGeneratePrompt] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const generatePopupRef = useRef(generatePopup)
    const generatePromptRef = useRef(generatePrompt)

    // Block toolbar (shown on click of AI block)
    const [blockToolbar, setBlockToolbar] = useState<BlockToolbar | null>(null)
    const blockToolbarRef = useRef(blockToolbar)

    // Drag state
    const dragStateRef = useRef<{
        rangeId: string
        startMouseY: number
        startLineNumber: number
    } | null>(null)

    useEffect(() => { selectionPopupRef.current = selectionPopup }, [selectionPopup])
    useEffect(() => { popupPromptRef.current = popupPrompt }, [popupPrompt])
    useEffect(() => { generatePopupRef.current = generatePopup }, [generatePopup])
    useEffect(() => { generatePromptRef.current = generatePrompt }, [generatePrompt])
    useEffect(() => { blockToolbarRef.current = blockToolbar }, [blockToolbar])
    useEffect(() => { onCodeChangeRef.current = onCodeChange }, [onCodeChange])
    useEffect(() => { replaceContentValueRef.current = replaceContentValue }, [replaceContentValue])
    useEffect(() => { replaceContentSourceRef.current = replaceContentSource }, [replaceContentSource])
    useEffect(() => { initialAiRangesRef.current = initialAiRanges ?? [] }, [initialAiRanges])
    useEffect(() => { onAiRangesChangeRef.current = onAiRangesChange }, [onAiRangesChange])
    useEffect(() => { userIdRef.current = userId }, [userId])
    useEffect(() => { userNameRef.current = userName }, [userName])

    useEffect(() => {
        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason
            const text = typeof reason === 'string'
                ? reason
                : reason && typeof reason === 'object' && 'message' in reason
                    ? String((reason as { message?: unknown }).message ?? '')
                    : ''

            if (text.toLowerCase().includes('canceled')) {
                event.preventDefault()
            }
        }

        window.addEventListener('unhandledrejection', onUnhandledRejection)
        return () => {
            window.removeEventListener('unhandledrejection', onUnhandledRejection)
        }
    }, [])

    const hashToColor = useCallback((seed: string) => {
        let hash = 0
        for (let index = 0; index < seed.length; index += 1) {
            hash = (hash << 5) - hash + seed.charCodeAt(index)
            hash |= 0
        }
        const hue = Math.abs(hash) % 360
        return `hsl(${hue} 72% 58%)`
    }, [])

    const getCurrentUserLabel = useCallback(() => {
        const fromName = userNameRef.current?.trim()
        if (fromName) return fromName
        const fromId = userIdRef.current?.trim()
        if (fromId) return `User-${fromId.slice(0, 6)}`
        return 'Anonymous'
    }, [])

    const getAiAuthorLabel = useCallback(() => {
        return `AI (${getCurrentUserLabel()})`
    }, [getCurrentUserLabel])

    const runWithAttribution = useCallback((author: string, fn: () => void) => {
        pendingEditAuthorRef.current = author
        try {
            fn()
        } finally {
            queueMicrotask(() => {
                if (pendingEditAuthorRef.current === author) {
                    pendingEditAuthorRef.current = null
                }
            })
        }
    }, [])

    const parseLineAuthorsPayload = useCallback((payload: string): Record<number, string> | null => {
        try {
            const parsed = JSON.parse(payload) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return null
            }

            const next: Record<number, string> = {}
            for (const [rawLine, rawAuthor] of Object.entries(parsed as Record<string, unknown>)) {
                const lineNumber = Number(rawLine)
                if (!Number.isFinite(lineNumber) || lineNumber < 1) continue
                if (typeof rawAuthor !== 'string' || !rawAuthor.trim()) continue
                next[Math.floor(lineNumber)] = rawAuthor.trim()
            }

            return next
        } catch {
            return null
        }
    }, [])

    const applyLineAuthors = useCallback((lineAuthors: Record<number, string>, options?: { broadcast?: boolean }) => {
        lineAuthorsRef.current = lineAuthors

        if (options?.broadcast === false) return

        const payload = JSON.stringify(lineAuthors)
        if (payload === lastBroadcastLineAuthorsRef.current) return
        lastBroadcastLineAuthorsRef.current = payload
        aiMetaRef.current?.set('lineAuthors', payload)
    }, [])

    const upsertRemoteCursorWidget = useCallback((
        monaco: Monaco,
        editor: import('monaco-editor').editor.IStandaloneCodeEditor,
        clientId: number,
        state: { name: string; color: string; cursor: RemoteCursorState }
    ) => {
        const existing = remoteCursorWidgetsRef.current.get(clientId)
        if (existing) {
            existing.position.lineNumber = state.cursor.lineNumber
            existing.position.column = state.cursor.column
            existing.element.style.borderLeftColor = state.color
            const label = existing.element.querySelector('[data-role="cursor-label"]') as HTMLDivElement | null
            if (label) {
                label.textContent = state.name
                label.style.background = state.color
            }
            editor.layoutContentWidget(existing.widget)
            return
        }

        const element = document.createElement('div')
        element.style.position = 'relative'
        element.style.pointerEvents = 'none'
        element.style.height = '18px'
        element.style.marginTop = '-2px'
        element.style.borderLeft = `2px solid ${state.color}`

        const label = document.createElement('div')
        label.setAttribute('data-role', 'cursor-label')
        label.textContent = state.name
        label.style.position = 'absolute'
        label.style.left = '4px'
        label.style.top = '-18px'
        label.style.padding = '1px 6px'
        label.style.borderRadius = '10px'
        label.style.fontSize = '10px'
        label.style.lineHeight = '1.2'
        label.style.whiteSpace = 'nowrap'
        label.style.color = '#ffffff'
        label.style.background = state.color
        label.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'

        element.appendChild(label)

        const widgetState = {
            position: { ...state.cursor },
        }

        const widget: import('monaco-editor').editor.IContentWidget = {
            getId: () => `remote-cursor-widget-${clientId}`,
            getDomNode: () => element,
            getPosition: () => ({
                position: new monaco.Position(widgetState.position.lineNumber, widgetState.position.column),
                preference: [
                    monaco.editor.ContentWidgetPositionPreference.EXACT,
                ],
            }),
        }

        editor.addContentWidget(widget)
        remoteCursorWidgetsRef.current.set(clientId, {
            widget,
            element,
            position: widgetState.position,
        })
    }, [])

    const removeRemoteCursorWidget = useCallback((
        editor: import('monaco-editor').editor.IStandaloneCodeEditor,
        clientId: number
    ) => {
        const existing = remoteCursorWidgetsRef.current.get(clientId)
        if (!existing) return
        editor.removeContentWidget(existing.widget)
        remoteCursorWidgetsRef.current.delete(clientId)
    }, [])

    const clearRemoteCursorWidgets = useCallback((editor?: import('monaco-editor').editor.IStandaloneCodeEditor | null) => {
        const activeEditor = editor ?? editorRef.current
        if (!activeEditor) {
            remoteCursorWidgetsRef.current.clear()
            return
        }
        for (const [clientId] of remoteCursorWidgetsRef.current) {
            removeRemoteCursorWidget(activeEditor, clientId)
        }
    }, [removeRemoteCursorWidget])

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
                return { ...range, startLineNumber, startColumn, endLineNumber, endColumn }
            })
            .sort((a, b) =>
                a.startLineNumber === b.startLineNumber
                    ? a.startColumn - b.startColumn
                    : a.startLineNumber - b.startLineNumber
            )
    }, [])

    const emitAiRangesChange = useCallback(() => {
        onAiRangesChangeRef.current?.([...aiRangesRef.current])
    }, [])

    const renderAiRanges = useCallback((ranges: AiRange[]) => {
        const editor = editorRef.current
        const monaco = monacoRef.current
        if (!editor || !monaco) return

        const decorations = ranges.map((range) => ({
            range: new monaco.Range(
                range.startLineNumber,
                range.startColumn,
                range.endLineNumber,
                range.endColumn
            ),
            options: {
                className: 'ai-block-bg',
                inlineClassName: 'ai-block-text',
                linesDecorationsClassName: 'ai-block-gutter',
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
        }))

        aiDecorationIdsRef.current = editor.deltaDecorations(aiDecorationIdsRef.current, decorations)
    }, [])

    const scheduleRenderAiRanges = useCallback(
        (ranges: AiRange[]) => {
            pendingRenderRangesRef.current = ranges
            if (renderTimerRef.current) return
            renderTimerRef.current = setTimeout(() => {
                renderTimerRef.current = null
                const nextRanges = pendingRenderRangesRef.current
                pendingRenderRangesRef.current = null
                if (!nextRanges) return
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

        if (options?.broadcast === false) return

        const payload = JSON.stringify(normalized)
        if (payload === lastBroadcastAiRangesRef.current) return
        lastBroadcastAiRangesRef.current = payload
        aiMetaRef.current?.set('aiRanges', payload)
    }, [emitAiRangesChange, normalizeRanges, scheduleRenderAiRanges])

    const addAiRange = useCallback((range: Omit<AiRange, 'id' | 'originalText'> & { originalText?: string }) => {
        const editor = editorRef.current
        const model = editor?.getModel()
        const text = range.originalText ?? (model ? model.getValueInRange({
            startLineNumber: range.startLineNumber,
            startColumn: range.startColumn,
            endLineNumber: range.endLineNumber,
            endColumn: range.endColumn,
        } as import('monaco-editor').IRange) : '')
        applyAiRanges([...aiRangesRef.current, { ...range, id: generateId(), originalText: text }])
    }, [applyAiRanges])

    // Reject: restore original text for a block
    const rejectAiBlock = useCallback((rangeId: string) => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return

        const range = aiRangesRef.current.find(r => r.id === rangeId)
        if (!range) return

        model.pushEditOperations([], [{
            range: {
                startLineNumber: range.startLineNumber,
                startColumn: range.startColumn,
                endLineNumber: range.endLineNumber,
                endColumn: range.endColumn,
            },
            text: range.originalText,
        }], () => null)

        applyAiRanges(aiRangesRef.current.filter(r => r.id !== rangeId))
        setBlockToolbar(null)
    }, [applyAiRanges])

    // Accept: just remove highlight, keep text
    const acceptAiBlock = useCallback((rangeId: string) => {
        applyAiRanges(aiRangesRef.current.filter(r => r.id !== rangeId))
        setBlockToolbar(null)
    }, [applyAiRanges])

    // Undo all AI changes
    const undoAllAi = useCallback(() => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return

        const sorted = [...aiRangesRef.current].sort((a, b) => b.startLineNumber - a.startLineNumber)
        const edits = sorted.map(range => ({
            range: {
                startLineNumber: range.startLineNumber,
                startColumn: range.startColumn,
                endLineNumber: range.endLineNumber,
                endColumn: range.endColumn,
            },
            text: range.originalText,
        }))
        model.pushEditOperations([], edits, () => null)
        applyAiRanges([])
        setBlockToolbar(null)
    }, [applyAiRanges])

    const fixSelectedCode = useCallback(async () => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return

        const selection = editor.getSelection()
        const selectedRange = selection && !selection.isEmpty() ? selection : model.getFullModelRange()
        const selectedText = model.getValueInRange(selectedRange)
        if (!selectedText.trim()) return

        try {
            const response = await fetch('/api/ai-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language, filePath, mode: 'fix', code: selectedText }),
            })
            if (!response.ok) return

            const data = (await response.json()) as { completion?: string }
            const fixedCode = (data.completion ?? '').replace(/^```[a-zA-Z]*\n?|```$/g, '').trimEnd()
            if (!fixedCode) return

            runWithAttribution(getAiAuthorLabel(), () => {
                model.pushEditOperations([], [{ range: selectedRange, text: fixedCode }], () => null)
            })

            const lineCount = fixedCode.split('\n').length
            const endLineNumber = selectedRange.startLineNumber + lineCount - 1
            const endColumn = lineCount === 1
                ? selectedRange.startColumn + fixedCode.length
                : fixedCode.split('\n').slice(-1)[0].length + 1

            addAiRange({
                startLineNumber: selectedRange.startLineNumber,
                startColumn: selectedRange.startColumn,
                endLineNumber,
                endColumn,
                originalText: selectedText,
            })
        } catch { /* ignore */ }
    }, [language, filePath, addAiRange, getAiAuthorLabel, runWithAttribution])

    const handlePopupAction = useCallback(async (action: 'fix' | 'prompt') => {
        const editor = editorRef.current
        const model = editor?.getModel()
        const popup = selectionPopupRef.current
        const prompt = popupPromptRef.current
        if (!editor || !model || !popup) return

        setPopupLoading(true)

        const body = action === 'fix'
            ? { language, filePath, mode: 'fix', code: popup.selectedText }
            : { language, filePath, mode: 'fix', code: `${prompt}\n\n${popup.selectedText}` }

        try {
            const res = await fetch('/api/ai-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const data = await res.json() as { completion?: string }
            const fixed = (data.completion ?? '').replace(/^```[a-zA-Z]*\n?|```$/g, '').trimEnd()
            if (!fixed) return

            const originalText = model.getValueInRange(popup.selectedRange)
            runWithAttribution(getAiAuthorLabel(), () => {
                model.pushEditOperations([], [{ range: popup.selectedRange, text: fixed }], () => null)
            })

            const lineCount = fixed.split('\n').length
            const endLineNumber = popup.selectedRange.startLineNumber + lineCount - 1
            const endColumn = lineCount === 1
                ? popup.selectedRange.startColumn + fixed.length
                : fixed.split('\n').slice(-1)[0].length + 1

            addAiRange({
                startLineNumber: popup.selectedRange.startLineNumber,
                startColumn: popup.selectedRange.startColumn,
                endLineNumber,
                endColumn,
                originalText,
            })
        } finally {
            setPopupLoading(false)
            setSelectionPopup(null)
            setPopupPrompt('')
        }
    }, [language, filePath, addAiRange, getAiAuthorLabel, runWithAttribution])

    // --- FUNCȚIA PENTRU GENERARE NOTION-STYLE (Ctrl+K) ---
    const handleGenerateAction = useCallback(async () => {
        const editor = editorRef.current
        const model = editor?.getModel()
        const monaco = monacoRef.current
        const popup = generatePopupRef.current
        const prompt = generatePromptRef.current
        
        if (!editor || !model || !monaco || !popup || !prompt.trim()) return

        setIsGenerating(true)

        try {
            // Aici apelezi ruta de backend pentru generare
            const res = await fetch('/api/ai/generate', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    language, 
                    filePath,
                    prompt: prompt,
                    currentCode: model.getValue()
                }),
            })
            
            const data = await res.json() as { code?: string, completion?: string }
            const generatedCode = (data.code ?? data.completion ?? '').replace(/^```[a-zA-Z]*\n?|```$/g, '').trimEnd()
            
            if (!generatedCode) return

            const rangeToInsert = new monaco.Range(popup.lineNumber, 1, popup.lineNumber, 1)
            
            runWithAttribution(getAiAuthorLabel(), () => {
                model.pushEditOperations([], [{
                    range: rangeToInsert,
                    text: generatedCode + '\n'
                }], () => null)
            })

            const lineCount = generatedCode.split('\n').length
            const endLineNumber = popup.lineNumber + lineCount - 1
            const endColumn = lineCount === 1
                ? 1 + generatedCode.length
                : generatedCode.split('\n').slice(-1)[0].length + 1

            addAiRange({
                startLineNumber: popup.lineNumber,
                startColumn: 1,
                endLineNumber,
                endColumn,
                originalText: '', 
            })

        } finally {
            setIsGenerating(false)
            setGeneratePopup(null)
            setGeneratePrompt('')
            editor.focus()
        }
    }, [language, filePath, addAiRange, getAiAuthorLabel, runWithAttribution])


    // Drag: move AI block up/down
    const handleDragStart = useCallback((e: React.MouseEvent, rangeId: string) => {
        e.preventDefault()
        const range = aiRangesRef.current.find(r => r.id === rangeId)
        if (!range) return

        dragStateRef.current = {
            rangeId,
            startMouseY: e.clientY,
            startLineNumber: range.startLineNumber,
        }

        const onMouseMove = (ev: MouseEvent) => {
            const drag = dragStateRef.current
            const editor = editorRef.current
            const model = editor?.getModel()
            if (!drag || !editor || !model) return

            const lineHeight = editor.getOption(monacoRef.current!.editor.EditorOption.lineHeight)
            const deltaLines = Math.round((ev.clientY - drag.startMouseY) / lineHeight)
            if (deltaLines === 0) return

            const currentRange = aiRangesRef.current.find(r => r.id === drag.rangeId)
            if (!currentRange) return

            const totalLines = model.getLineCount()
            const blockLines = currentRange.endLineNumber - currentRange.startLineNumber
            const newStart = Math.max(1, Math.min(totalLines - blockLines, drag.startLineNumber + deltaLines))

            if (newStart === currentRange.startLineNumber) return

            const blockText = model.getValueInRange({
                startLineNumber: currentRange.startLineNumber,
                startColumn: 1,
                endLineNumber: currentRange.endLineNumber,
                endColumn: model.getLineMaxColumn(currentRange.endLineNumber),
            })

            const newEnd = newStart + blockLines
            const lineDiff = newStart - currentRange.startLineNumber

            const updatedRanges = aiRangesRef.current.map(r =>
                r.id === drag.rangeId
                    ? {
                        ...r,
                        startLineNumber: r.startLineNumber + lineDiff,
                        endLineNumber: r.endLineNumber + lineDiff,
                    }
                    : r
            )

            const lineCount = currentRange.endLineNumber - currentRange.startLineNumber + 1
            const lines: string[] = []
            for (let i = currentRange.startLineNumber; i <= currentRange.endLineNumber; i++) {
                lines.push(model.getLineContent(i))
            }

            const edits: import('monaco-editor').editor.IIdentifiedSingleEditOperation[] = []

            edits.push({
                range: {
                    startLineNumber: currentRange.startLineNumber,
                    startColumn: 1,
                    endLineNumber: currentRange.endLineNumber + 1,
                    endColumn: 1,
                },
                text: '',
            })

            edits.push({
                range: {
                    startLineNumber: newStart > currentRange.startLineNumber
                        ? newStart - lineCount + 1
                        : newStart,
                    startColumn: 1,
                    endLineNumber: newStart > currentRange.startLineNumber
                        ? newStart - lineCount + 1
                        : newStart,
                    endColumn: 1,
                },
                text: lines.join('\n') + '\n',
            })

            try {
                model.pushEditOperations([], edits, () => null)
                applyAiRanges(updatedRanges)
                drag.startLineNumber = newStart
                drag.startMouseY = ev.clientY
            } catch { /* ignore */ }
        }

        const onMouseUp = () => {
            dragStateRef.current = null
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
    }, [applyAiRanges])

    useEffect(() => {
        if (typeof replaceContentToken !== 'number') return
        if (appliedReplaceTokenRef.current === replaceContentToken) return
        appliedReplaceTokenRef.current = replaceContentToken

        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return

        const yText = ydocRef.current?.getText('monaco')
        const replaceSource = replaceContentSourceRef.current
        if (replaceSource === 'user' && yText) {
            const sharedValue = yText.toString()
            if (model.getValue() !== sharedValue) {
                model.setValue(sharedValue)
                setIsEditorEmpty(sharedValue.length === 0)
                onCodeChangeRef.current?.(sharedValue)
            }
            return
        }

        const nextValue = normalizeLineEndings(replaceContentValueRef.current ?? '')
        model.setValue(nextValue)
        model.setEOL(monacoRef.current?.editor.EndOfLineSequence.LF ?? 0)
        setIsEditorEmpty(nextValue.length === 0)

        if (yText && yText.toString() !== nextValue) {
            setYTextValue(yText, nextValue)
        }

        onCodeChangeRef.current?.(nextValue)

        if (replaceContentSourceRef.current === 'ai' && nextValue.trim()) {
            const endLineNumber = model.getLineCount()
            const endColumn = model.getLineMaxColumn(endLineNumber)
            addAiRange({ startLineNumber: 1, startColumn: 1, endLineNumber, endColumn, originalText: '' })

            const aiAuthor = getAiAuthorLabel()
            const nextLineAuthors: Record<number, string> = {}
            for (let line = 1; line <= endLineNumber; line += 1) {
                nextLineAuthors[line] = aiAuthor
            }
            applyLineAuthors(nextLineAuthors)
        }
    }, [applyAiRanges, replaceContentToken, addAiRange, getAiAuthorLabel, applyLineAuthors])

    useEffect(() => {
        if (typeof aiRangesToken !== 'number') return
        if (appliedAiRangesTokenRef.current === aiRangesToken) return
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
        let removeFixMacroAction: (() => void) | null = null
        let removeGenerateMacroAction: (() => void) | null = null // <-- Noua curățare
        let removeHoverProvider: (() => void) | null = null
        let removeSelectionListener: (() => void) | null = null
        let removeClickListener: (() => void) | null = null
        let removeAwarenessListener: (() => void) | null = null
        let removeMouseMoveListener: (() => void) | null = null
        let removeMouseLeaveListener: (() => void) | null = null
        let initialSeedApplied = false
        let initialSeedAttempted = false

        const setup = async () => {
            if (!containerRef.current || editorRef.current) return

            const monaco: Monaco = await import('monaco-editor')
            monacoRef.current = monaco
            const Y: Yjs = await import('yjs')
            const { WebsocketProvider }: YWebsocket = await import('y-websocket')
            const { MonacoBinding }: YMonaco = await import('y-monaco')

            window.MonacoEnvironment = {
                getWorker(_, label) {
                    if (label === 'json') return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker', import.meta.url), { type: 'module' })
                    if (label === 'css' || label === 'scss' || label === 'less') return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker', import.meta.url), { type: 'module' })
                    if (label === 'html' || label === 'handlebars' || label === 'razor') return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker', import.meta.url), { type: 'module' })
                    if (label === 'typescript' || label === 'javascript') return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker', import.meta.url), { type: 'module' })
                    return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url), { type: 'module' })
                },
            }

            if (disposed || !containerRef.current) return

            editorRef.current = monaco.editor.create(containerRef.current, {
                value: '',
                language,
                theme: 'vs-dark',
                minimap: { enabled: false },
                inlineSuggest: { enabled: true },
                quickSuggestions: { other: true, comments: false, strings: true },
                hover: { enabled: true },
                automaticLayout: true,
            })

            const initialModel = editorRef.current.getModel()
            if (initialModel) {
                initialModel.setEOL(monaco.editor.EndOfLineSequence.LF)
            }

            // Inject AI block styles
            const styleId = 'ai-block-styles'
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style')
                style.id = styleId
                style.textContent = `
                    .ai-block-bg {
                        background: rgba(99, 179, 237, 0.10) !important;
                        border-left: 2px solid rgba(99, 179, 237, 0.6) !important;
                    }
                    .ai-block-text {
                        color: #93c5fd !important;
                    }
                    .ai-block-gutter {
                        background: rgba(99, 179, 237, 0.35) !important;
                        width: 3px !important;
                        margin-left: 3px;
                    }
                `
                document.head.appendChild(style)
            }

            const inlineProvider = monaco.languages.registerInlineCompletionsProvider(language, {
                provideInlineCompletions: async (model, position, _context, token) => {
                    const editor = editorRef.current
                    if (!editor) return { items: [] }

                    const beforeRange = new monaco.Range(1, 1, position.lineNumber, position.column)
                    const afterRange = new monaco.Range(position.lineNumber, position.column, model.getLineCount(), model.getLineMaxColumn(model.getLineCount()))
                    const prefix = model.getValueInRange(beforeRange)
                    if (prefix.trim().length < 2) return { items: [] }
                    const suffix = model.getValueInRange(afterRange)

                    const requestSeq = completionRequestSeqRef.current + 1
                    completionRequestSeqRef.current = requestSeq

                    try {
                        if (token.isCancellationRequested) return { items: [] }
                        const response = await fetch('/api/ai-complete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ language, filePath, prefix, suffix }),
                        })
                        if (token.isCancellationRequested) return { items: [] }
                        if (requestSeq !== completionRequestSeqRef.current) return { items: [] }
                        if (!response.ok) return { items: [] }
                        const data = (await response.json()) as { completion?: string }
                        const completion = (data.completion ?? '').trimEnd()
                        if (!completion) return { items: [] }
                        pendingInlineCompletionRef.current = completion
                        return {
                            items: [{
                                insertText: completion,
                                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                            }],
                        }
                    } catch {
                        return { items: [] }
                    }
                },
                disposeInlineCompletions: () => { },
            })
            removeInlineProvider = () => inlineProvider.dispose()

            const hoverProvider = monaco.languages.registerHoverProvider(language, {
                provideHover: (_model, position) => {
                    const author = lineAuthorsRef.current[position.lineNumber]
                    return {
                        range: new monaco.Range(position.lineNumber, 1, position.lineNumber, 1),
                        contents: [{ value: `Modified by: ${author ?? 'Unknown'}` }],
                    }
                },
            })
            removeHoverProvider = () => hoverProvider.dispose()

            const fixMacroAction = editorRef.current.addAction({
                id: 'ai-fix-selection',
                label: 'AI: Fix selected code',
                keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 1,
                run: () => { void fixSelectedCode() },
            })
            removeFixMacroAction = () => fixMacroAction.dispose()

            // --- NOU: CMD + K PENTRU AI GENERATE ---
            const generateMacroAction = editorRef.current.addAction({
                id: 'ai-generate-code',
                label: 'AI: Generate code here',
                keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
                run: () => {
                    const editor = editorRef.current
                    if (!editor) return
                    
                    const position = editor.getPosition()
                    if (!position) return

                    const domNode = containerRef.current
                    if (!domNode) return

                    const scrolledVisiblePosition = editor.getScrolledVisiblePosition(position)
                    if (!scrolledVisiblePosition) return

                    const containerRect = domNode.getBoundingClientRect()

                    setGeneratePopup({
                        x: containerRect.left + scrolledVisiblePosition.left,
                        y: containerRect.top + scrolledVisiblePosition.top + 30, // Un pic sub cursor
                        lineNumber: position.lineNumber
                    })
                },
            })
            removeGenerateMacroAction = () => generateMacroAction.dispose()

            // Selection popup listener
            const selectionDisposable = editorRef.current.onDidChangeCursorSelection((e) => {
                const editor = editorRef.current
                const model = editor?.getModel()
                if (!editor || !model) return

                const selection = e.selection
                if (selection.isEmpty()) {
                    setSelectionPopup(null)
                    return
                }

                const selectedText = model.getValueInRange(selection)
                if (!selectedText.trim()) {
                    setSelectionPopup(null)
                    return
                }

                const endPosition = { lineNumber: selection.endLineNumber, column: selection.endColumn }
                const domNode = containerRef.current
                if (!domNode) return

                const scrolledVisiblePosition = editor.getScrolledVisiblePosition(endPosition)
                if (!scrolledVisiblePosition) return

                const containerRect = domNode.getBoundingClientRect()

                setSelectionPopup({
                    x: containerRect.left + scrolledVisiblePosition.left,
                    y: containerRect.top + scrolledVisiblePosition.top + scrolledVisiblePosition.height + 6,
                    selectedText,
                    selectedRange: selection,
                })
            })
            removeSelectionListener = () => selectionDisposable.dispose()

            // Click on AI block — show toolbar
            const clickDisposable = editorRef.current.onMouseDown((e) => {
                const pos = e.target.position
                if (!pos) {
                    setBlockToolbar(null)
                    return
                }

                const clickedRange = aiRangesRef.current.find(r =>
                    pos.lineNumber >= r.startLineNumber &&
                    pos.lineNumber <= r.endLineNumber
                )

                if (!clickedRange) {
                    setBlockToolbar(null)
                    return
                }

                const editor = editorRef.current
                if (!editor) return

                const domNode = containerRef.current
                if (!domNode) return

                const visPos = editor.getScrolledVisiblePosition({
                    lineNumber: clickedRange.startLineNumber,
                    column: 1,
                })
                if (!visPos) return

                const containerRect = domNode.getBoundingClientRect()

                setBlockToolbar({
                    x: containerRect.left + 60,
                    y: containerRect.top + visPos.top - 36,
                    rangeId: clickedRange.id,
                })
            })
            removeClickListener = () => clickDisposable.dispose()

            const contentDisposable = editorRef.current.onDidChangeModelContent((event) => {
                const editor = editorRef.current
                const model = editor?.getModel()
                let eventAuthorOverride: string | null = null
                if (editor && model && pendingInlineCompletionRef.current) {
                    const accepted = event.changes.find(
                        (change) =>
                            change.rangeLength === 0 &&
                            change.text.length > 0 &&
                            change.text === pendingInlineCompletionRef.current
                    )
                    if (accepted) {
                        eventAuthorOverride = getAiAuthorLabel()
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
                setIsEditorEmpty((editorRef.current?.getValue() ?? '').length === 0)
                requestAnimationFrame(() => {
                    renderRemoteCursorsRef.current?.()
                })

                if (!editor?.hasTextFocus()) {
                    return
                }

                const nextLineAuthors = { ...lineAuthorsRef.current }
                const author = eventAuthorOverride ?? pendingEditAuthorRef.current ?? getCurrentUserLabel()
                for (const change of event.changes) {
                    const insertedLineCount = Math.max(1, change.text.split('\n').length)
                    const startLine = Math.max(1, change.range.startLineNumber)
                    const endLine = Math.max(startLine, startLine + insertedLineCount - 1)
                    for (let line = startLine; line <= endLine; line += 1) {
                        nextLineAuthors[line] = author
                    }
                }
                applyLineAuthors(nextLineAuthors)
            })
            removeContentListener = () => contentDisposable.dispose()

            const ydoc = new Y.Doc()
            ydocRef.current = ydoc
            const aiMeta = ydoc.getMap<string>('meta')
            aiMetaRef.current = aiMeta

            const parseAiRangesPayload = (payload: string): AiRange[] | null => {
                try {
                    const parsed = JSON.parse(payload) as unknown
                    if (!Array.isArray(parsed)) return null
                    return parsed
                        .map((entry) => {
                            const range = entry as Record<string, unknown>
                            if (
                                typeof range.startLineNumber !== 'number' ||
                                typeof range.startColumn !== 'number' ||
                                typeof range.endLineNumber !== 'number' ||
                                typeof range.endColumn !== 'number'
                            ) return null
                            return {
                                startLineNumber: range.startLineNumber,
                                startColumn: range.startColumn,
                                endLineNumber: range.endLineNumber,
                                endColumn: range.endColumn,
                                id: typeof range.id === 'string' ? range.id : generateId(),
                                originalText: typeof range.originalText === 'string' ? range.originalText : '',
                            }
                        })
                        .filter((r): r is AiRange => Boolean(r))
                } catch { return null }
            }

            const syncAiRangesFromMeta = () => {
                const payload = aiMeta.get('aiRanges')
                if (typeof payload !== 'string') return false
                lastBroadcastAiRangesRef.current = payload
                const parsedRanges = parseAiRangesPayload(payload)
                if (!parsedRanges) return false
                applyAiRanges(parsedRanges, { broadcast: false })
                return true
            }

            const syncLineAuthorsFromMeta = () => {
                const payload = aiMeta.get('lineAuthors')
                if (typeof payload !== 'string') return false
                lastBroadcastLineAuthorsRef.current = payload
                const parsed = parseLineAuthorsPayload(payload)
                if (!parsed) return false
                applyLineAuthors(parsed, { broadcast: false })
                return true
            }

            const syncMetaFromY = () => {
                syncAiRangesFromMeta()
                syncLineAuthorsFromMeta()
            }

            aiMeta.observe(syncMetaFromY)
            removeAiMetaListener = () => aiMeta.unobserve(syncMetaFromY)

            const wsUrl = resolveYjsWsUrl(process.env.NEXT_PUBLIC_YJS_WS_URL)
            const provider = new WebsocketProvider(wsUrl, transportRoomId, ydoc)
            providerRef.current = provider
            setConnectionStatus(provider.wsconnected ? 'connected' : provider.wsconnecting ? 'connecting' : 'disconnected')

            const updateStatus = (event: { status: string }) => setConnectionStatus(event.status)
            provider.on('status', updateStatus)
            removeStatusListener = () => provider.off('status', updateStatus)

            const yText = ydoc.getText('monaco')
            const awareness = provider.awareness

            const updateSync = (isSynced: boolean) => {
                if (isSynced) {
                    setConnectionStatus('connected')
                    if (!initialSeedApplied && !initialSeedAttempted && yText.length === 0 && initialCodeRef.current) {
                        initialSeedAttempted = true

                        const clientIds = Array.from(awareness.getStates().keys())
                        clientIds.push(awareness.clientID)
                        const leaderClientId = Math.min(...clientIds)

                        if (leaderClientId === awareness.clientID) {
                            yText.insert(0, normalizeLineEndings(initialCodeRef.current))
                            initialSeedApplied = true
                        }
                    }
                    const pulled = syncAiRangesFromMeta()
                    if (!pulled && initialAiRangesRef.current.length > 0) {
                        applyAiRanges(initialAiRangesRef.current)
                    }
                    syncLineAuthorsFromMeta()
                }
            }
            provider.on('sync', updateSync)
            removeSyncListener = () => provider.off('sync', updateSync)

            const renderRemoteCursors = () => {
                const editor = editorRef.current
                if (!editor) return
                const model = editor.getModel()
                if (!model) return

                const localClientId = awareness.clientID
                const activeRemoteClientIds = new Set<number>()

                awareness.getStates().forEach((state, clientId) => {
                    if (clientId === localClientId) return
                    const clientState = state as {
                        user?: { name?: string; color?: string }
                        selection?: { anchor?: unknown; head?: unknown }
                    }

                    if (!clientState.selection?.anchor || !clientState.selection?.head) {
                        removeRemoteCursorWidget(editor, clientId)
                        return
                    }

                    const anchorAbs = Y.createAbsolutePositionFromRelativePosition(
                        clientState.selection.anchor as import('yjs').RelativePosition,
                        ydoc,
                    )
                    const headAbs = Y.createAbsolutePositionFromRelativePosition(
                        clientState.selection.head as import('yjs').RelativePosition,
                        ydoc,
                    )
                    if (!anchorAbs || !headAbs || anchorAbs.type !== yText || headAbs.type !== yText) {
                        removeRemoteCursorWidget(editor, clientId)
                        return
                    }

                    const headPos = model.getPositionAt(headAbs.index)
                    if (!headPos) {
                        removeRemoteCursorWidget(editor, clientId)
                        return
                    }

                    const name = clientState.user?.name?.trim() || `User-${String(clientId).slice(-4)}`
                    const color = clientState.user?.color?.trim() || hashToColor(String(clientId))
                    upsertRemoteCursorWidget(monaco, editor, clientId, {
                        name,
                        color,
                        cursor: {
                            lineNumber: Math.max(1, Math.floor(headPos.lineNumber)),
                            column: Math.max(1, Math.floor(headPos.column)),
                        },
                    })
                    activeRemoteClientIds.add(clientId)
                })

                for (const [clientId] of remoteCursorWidgetsRef.current) {
                    if (!activeRemoteClientIds.has(clientId)) {
                        removeRemoteCursorWidget(editor, clientId)
                    }
                }
            }
            renderRemoteCursorsRef.current = renderRemoteCursors

            const onAwarenessChange = () => {
                renderRemoteCursors()
            }

            awareness.on('change', onAwarenessChange)
            removeAwarenessListener = () => awareness.off('change', onAwarenessChange)

            const mouseMoveDisposable = editorRef.current.onMouseMove((event) => {
                const lineNumber = event.target.position?.lineNumber
                if (!lineNumber) {
                    setHoverAttribution(null)
                    return
                }
                const author = lineAuthorsRef.current[lineNumber] ?? 'Unknown'
                setHoverAttribution({
                    x: event.event.browserEvent.clientX,
                    y: event.event.browserEvent.clientY,
                    text: `Modified by: ${author}`,
                })
            })
            removeMouseMoveListener = () => mouseMoveDisposable.dispose()

            const mouseLeaveDisposable = editorRef.current.onMouseLeave(() => {
                setHoverAttribution(null)
            })
            removeMouseLeaveListener = () => mouseLeaveDisposable.dispose()

            const identitySeed = userIdRef.current?.trim() || userNameRef.current?.trim() || transportRoomId
            provider.awareness.setLocalStateField('user', {
                name: getCurrentUserLabel(),
                color: hashToColor(identitySeed),
            })
            renderRemoteCursors()

            const model = editorRef.current.getModel()
            if (model) {
                const sharedValue = normalizeLineEndings(yText.toString())
                if (model.getValue() !== sharedValue) {
                    model.setValue(sharedValue)
                }
                model.setEOL(monaco.editor.EndOfLineSequence.LF)
                bindingRef.current = new MonacoBinding(yText, model, new Set([editorRef.current]), provider.awareness)
            }
        }

        void setup()

        return () => {
            disposed = true
            removeStatusListener?.()
            removeSyncListener?.()
            removeAiMetaListener?.()
            removeContentListener?.()
            removeFixMacroAction?.()
            removeGenerateMacroAction?.() // Curățăm actiunea de Generate
            removeInlineProvider?.()
            removeHoverProvider?.()
            removeSelectionListener?.()
            removeClickListener?.()
            removeAwarenessListener?.()
            removeMouseMoveListener?.()
            removeMouseLeaveListener?.()
            pendingInlineCompletionRef.current = null
            monacoRef.current = null
            if (renderTimerRef.current) { clearTimeout(renderTimerRef.current); renderTimerRef.current = null }
            pendingRenderRangesRef.current = null
            aiMetaRef.current = null
            lastBroadcastAiRangesRef.current = ''
            lastBroadcastLineAuthorsRef.current = ''
            lineAuthorsRef.current = {}
            renderRemoteCursorsRef.current = null
            setHoverAttribution(null)
            clearRemoteCursorWidgets(editorRef.current)
            bindingRef.current?.destroy(); bindingRef.current = null
            providerRef.current?.destroy(); providerRef.current = null
            ydocRef.current?.destroy(); ydocRef.current = null
            try {
                aiDecorationIdsRef.current = []
                aiRangesRef.current = []
                editorRef.current?.getModel()?.dispose()
                editorRef.current?.dispose()
            } catch { }
            editorRef.current = null
        }
    }, [transportRoomId, language, filePath, addAiRange, applyAiRanges, fixSelectedCode, handleGenerateAction, getCurrentUserLabel, getAiAuthorLabel, hashToColor, parseLineAuthorsPayload, applyLineAuthors, upsertRemoteCursorWidget, removeRemoteCursorWidget, clearRemoteCursorWidgets])

    // --- JSX-ul pentru Pop-up-uri ---
    const selectionPopupJsx = selectionPopup && (
        <div
            ref={popupRef}
            style={{
                position: 'fixed',
                left: selectionPopup.x,
                top: selectionPopup.y,
                zIndex: 9999,
                background: '#1e1e2e',
                border: '1px solid #3b3b52',
                borderRadius: 8,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                minWidth: 240,
            }}
            onMouseDown={(e) => {
                const tag = (e.target as HTMLElement).tagName
                if (tag !== 'INPUT' && tag !== 'BUTTON') {
                    e.preventDefault()
                }
            }}
        >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#888', flex: 1 }}>AI Actions</span>
                <button
                    onClick={() => setSelectionPopup(null)}
                    style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 12 }}
                >
                    ✕
                </button>
            </div>
            <button
                onClick={() => void handlePopupAction('fix')}
                disabled={popupLoading}
                style={{
                    padding: '5px 10px',
                    borderRadius: 5,
                    border: 'none',
                    background: popupLoading ? '#4a3080' : '#6b46c1',
                    color: '#fff',
                    cursor: popupLoading ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    textAlign: 'left',
                }}
            >
                ✨ Fix code
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
                <input
                    ref={inputRef}
                    value={popupPrompt}
                    onChange={(e) => setPopupPrompt(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter' && popupPrompt.trim()) void handlePopupAction('prompt')
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Ask AI anything..."
                    autoComplete="off"
                    style={{
                        flex: 1,
                        padding: '5px 8px',
                        borderRadius: 5,
                        border: '1px solid #555',
                        background: '#2a2a3e',
                        color: '#fff',
                        fontSize: 12,
                        outline: 'none',
                    }}
                />
                <button
                    onClick={() => { if (popupPrompt.trim()) void handlePopupAction('prompt') }}
                    disabled={popupLoading || !popupPrompt.trim()}
                    style={{
                        padding: '5px 10px',
                        borderRadius: 5,
                        border: 'none',
                        background: popupLoading || !popupPrompt.trim() ? '#1a3a6b' : '#2563eb',
                        color: '#fff',
                        cursor: popupLoading || !popupPrompt.trim() ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                    }}
                >
                    →
                </button>
            </div>
            {popupLoading && <div style={{ fontSize: 11, color: '#888', textAlign: 'center' }}>Processing...</div>}
        </div>
    )

    const generatePopupJsx = generatePopup && (
        <div
            style={{
                position: 'fixed',
                left: generatePopup.x,
                top: generatePopup.y,
                zIndex: 9999,
                background: '#161b22', 
                border: '1px solid #4ade80', 
                borderRadius: 8,
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                minWidth: 350,
            }}
            onMouseDown={(e) => {
                const tag = (e.target as HTMLElement).tagName
                if (tag !== 'INPUT' && tag !== 'BUTTON') {
                    e.preventDefault()
                }
            }}
        >
            <span style={{ color: '#4ade80', fontSize: 16 }}>✨</span>
            <input
                autoFocus
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') {
                        setGeneratePopup(null)
                    }
                    if (e.key === 'Enter' && generatePrompt.trim()) {
                        void handleGenerateAction()
                    }
                }}
                disabled={isGenerating}
                placeholder={isGenerating ? "Se generează..." : "Ex: Scrie o funcție Fibonacci..."}
                style={{
                    flex: 1,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    color: '#fff',
                    fontSize: 13,
                    outline: 'none',
                }}
            />
        </div>
    )

    const blockToolbarJsx = blockToolbar && (
        <div
            style={{
                position: 'fixed',
                left: blockToolbar.x,
                top: blockToolbar.y,
                zIndex: 9998,
                background: '#1e1e2e',
                border: '1px solid #3b3b52',
                borderRadius: 6,
                padding: '4px 6px',
                display: 'flex',
                gap: 4,
                boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
                alignItems: 'center',
            }}
            onMouseDown={(e) => e.preventDefault()}
        >
            <span style={{ fontSize: 10, color: '#60a5fa', marginRight: 4, fontWeight: 600 }}>AI Block</span>
            <button
                onClick={() => acceptAiBlock(blockToolbar.rangeId)}
                title="Accept — keep code, remove highlight"
                style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 11 }}
            >
                ✓ Accept
            </button>
            <button
                onClick={() => rejectAiBlock(blockToolbar.rangeId)}
                title="Reject — restore original code"
                style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 11 }}
            >
                ✕ Reject
            </button>
            <button
                onMouseDown={(e) => handleDragStart(e, blockToolbar.rangeId)}
                title="Drag to move block"
                style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #555', background: '#2a2a3e', color: '#aaa', cursor: 'grab', fontSize: 11 }}
            >
                ⠿ Move
            </button>
            <button
                onClick={undoAllAi}
                title="Undo all AI changes"
                style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #555', background: '#2a2a3e', color: '#f59e0b', cursor: 'pointer', fontSize: 11 }}
            >
                ↩ Undo AI
            </button>
            <button
                onClick={() => setBlockToolbar(null)}
                style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid #555', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 11 }}
            >
                ✕
            </button>
        </div>
    )

    if (embedded) {
        return (
            <div className="h-full w-full bg-black/95 relative">
                <div ref={containerRef} className="h-full w-full" />
                {isEditorEmpty && !generatePopup && !selectionPopup && (
                    <div
                        style={{
                            position: 'absolute',
                            top: 12,
                            left: 14,
                            color: '#6e7681',
                            fontSize: 12,
                            pointerEvents: 'none',
                            userSelect: 'none',
                        }}
                    >
                        Press <strong>Cmd+K</strong> / <strong>Ctrl+K</strong> to open inline suggestions
                    </div>
                )}
                {selectionPopupJsx}
                {generatePopupJsx}
                {blockToolbarJsx}
                {hoverAttribution && (
                    <div
                        style={{
                            position: 'fixed',
                            left: hoverAttribution.x + 12,
                            top: hoverAttribution.y + 12,
                            zIndex: 10001,
                            background: '#161b22',
                            border: '1px solid #30363d',
                            borderRadius: 6,
                            padding: '6px 8px',
                            color: '#c9d1d9',
                            fontSize: 11,
                            pointerEvents: 'none',
                            boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
                        }}
                    >
                        {hoverAttribution.text}
                    </div>
                )}
            </div>
        )
    }

    return (
        <main style={{ padding: 24, position: 'relative' }}>
            <h1 style={{ marginBottom: 12, fontSize: 24, fontWeight: 600 }}>
                Collaborative Monaco Editor (Yjs)
            </h1>
            <p style={{ marginBottom: 8 }}>Room: <strong>{roomId}</strong></p>
            <p style={{ marginBottom: 8 }}>Transport room: <strong>{transportRoomId}</strong></p>
            <p style={{ marginBottom: 12 }}>
                WebSocket: <strong>{resolveYjsWsUrl(process.env.NEXT_PUBLIC_YJS_WS_URL)}</strong> | Status: <strong>{connectionStatus}</strong>
            </p>
            <button
                style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 6, border: '1px solid #555', background: '#6b46c1', color: '#fff', cursor: 'pointer' }}
                onClick={() => void fixSelectedCode()}
            >
                AI Fix selected code
            </button>
            <div
                ref={containerRef}
                style={{ height: '55vh', width: '100%', border: '1px solid #333', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}
            />
            {isEditorEmpty && !generatePopup && !selectionPopup && (
                <div
                    style={{
                        position: 'absolute',
                        top: 132,
                        left: 38,
                        color: '#6e7681',
                        fontSize: 12,
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    Press <strong>Cmd+K</strong> / <strong>Ctrl+K</strong> to open inline suggestions
                </div>
            )}
            {selectionPopupJsx}
            {generatePopupJsx}
            {blockToolbarJsx}
            {hoverAttribution && (
                <div
                    style={{
                        position: 'fixed',
                        left: hoverAttribution.x + 12,
                        top: hoverAttribution.y + 12,
                        zIndex: 10001,
                        background: '#161b22',
                        border: '1px solid #30363d',
                        borderRadius: 6,
                        padding: '6px 8px',
                        color: '#c9d1d9',
                        fontSize: 11,
                        pointerEvents: 'none',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
                    }}
                >
                    {hoverAttribution.text}
                </div>
            )}
        </main>
    )
}