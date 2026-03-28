'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { onAuthStateChanged, type User } from 'firebase/auth'
import Navbar from '@/components/Navbar'
import Editor, { type AiRange } from '@/components/editor'
import { auth, db } from '@/lib/firebase'
import SyncedTerminal from '@/components/synced-terminal'
import RepoChat from '@/components/repo-chat'

/* ─── Types ─────────────────────────────────────────────────────────────── */

type InviteRecord = { email: string; status?: string }

type RepoFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: RepoFileNode[]
}

type FileVersionSummary = {
  id: string
  createdAt: number
}

type ExplorerContextMenuState = {
  x: number
  y: number
  entryPath: string
  entryType: 'file' | 'directory'
}

type ExplorerDragPayload = {
  entryPath: string
  entryType: 'file' | 'directory'
}

const EXPLORER_DND_MIME = 'application/x-itec-repo-entry'
const EXPLORER_DND_TEXT_PREFIX = '__ITEC_REPO_ENTRY__:'

const encodeExplorerDragPayload = (payload: ExplorerDragPayload) => JSON.stringify(payload)

const decodeExplorerDragPayload = (raw: string): ExplorerDragPayload | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ExplorerDragPayload>
    if (!parsed.entryPath || (parsed.entryType !== 'file' && parsed.entryType !== 'directory')) {
      return null
    }
    return {
      entryPath: parsed.entryPath,
      entryType: parsed.entryType,
    }
  } catch {
    return null
  }
}

const setExplorerDragPayload = (dataTransfer: DataTransfer, payload: ExplorerDragPayload) => {
  const encoded = encodeExplorerDragPayload(payload)
  dataTransfer.setData(EXPLORER_DND_MIME, encoded)
  dataTransfer.setData('text/plain', `${EXPLORER_DND_TEXT_PREFIX}${encoded}`)
}

const getExplorerDragPayload = (dataTransfer: DataTransfer): ExplorerDragPayload | null => {
  const fromMime = decodeExplorerDragPayload(dataTransfer.getData(EXPLORER_DND_MIME))
  if (fromMime) {
    return fromMime
  }

  const plain = dataTransfer.getData('text/plain')
  if (!plain.startsWith(EXPLORER_DND_TEXT_PREFIX)) {
    return null
  }

  return decodeExplorerDragPayload(plain.slice(EXPLORER_DND_TEXT_PREFIX.length))
}

const generateAiRangeId = () => Math.random().toString(36).slice(2, 10)

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const getFullRangeForCode = (code: string): AiRange => {
  const lines = code.split('\n')
  const endLineNumber = Math.max(1, lines.length)
  const lastLine = lines[endLineNumber - 1] ?? ''
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber,
    endColumn: lastLine.length + 1,
    id: generateAiRangeId(),
    originalText: code,
  }
}

const normalizeAiRange = (range: Partial<AiRange>, code: string): AiRange => {
  const startLineNumber = Math.max(1, Math.floor(range.startLineNumber ?? 1))
  const startColumn = Math.max(1, Math.floor(range.startColumn ?? 1))
  const endLineNumber = Math.max(startLineNumber, Math.floor(range.endLineNumber ?? startLineNumber))
  const endColumn =
    endLineNumber === startLineNumber
      ? Math.max(startColumn, Math.floor(range.endColumn ?? startColumn))
      : Math.max(1, Math.floor(range.endColumn ?? 1))

  let originalText = range.originalText ?? ''
  if (!originalText) {
    const lines = code.split('\n')
    if (startLineNumber === endLineNumber) {
      const line = lines[startLineNumber - 1] ?? ''
      originalText = line.slice(startColumn - 1, endColumn - 1)
    } else {
      const partial = []
      for (let lineNo = startLineNumber; lineNo <= endLineNumber; lineNo += 1) {
        const line = lines[lineNo - 1] ?? ''
        if (lineNo === startLineNumber) {
          partial.push(line.slice(startColumn - 1))
        } else if (lineNo === endLineNumber) {
          partial.push(line.slice(0, endColumn - 1))
        } else {
          partial.push(line)
        }
      }
      originalText = partial.join('\n')
    }
  }

  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
    id: range.id ?? generateAiRangeId(),
    originalText,
  }
}

const normalizeAiRanges = (ranges: Array<Partial<AiRange>> = [], code = ''): AiRange[] =>
  ranges.map((range) => normalizeAiRange(range, code))

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const getOwnerUidFromRepoPath = (path: string) => {
  const segments = path.split('/')
  return segments.length >= 2 ? segments[1] : null
}

const getOwnerLabel = (ownerName?: string | null, ownerEmail?: string | null) => {
  if (ownerName?.trim()) return ownerName
  if (ownerEmail?.includes('@')) return ownerEmail.split('@')[0]
  return 'Unknown user'
}

const getLanguageFromFilePath = (filePath: string | null) => {
  if (!filePath) return 'typescript'
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript'
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript'
  if (filePath.endsWith('.json')) return 'json'
  if (filePath.endsWith('.css')) return 'css'
  if (filePath.endsWith('.html')) return 'html'
  if (filePath.endsWith('.py')) return 'python'
  if (filePath.endsWith('.md')) return 'markdown'
  if (filePath.endsWith('.cpp')) return 'cpp'
  if (filePath.endsWith('.c')) return 'c'
  if (filePath.endsWith('.java')) return 'java'
  if (filePath.endsWith('.rs')) return 'rust'
  return 'plaintext'
}

const getRuntimeConfigForFilePath = (filePath: string | null) => {
  if (!filePath) return { image: 'python:3.11-alpine', command: 'python main.py' }
  if (filePath.endsWith('.py')) return { image: 'python:3.11-alpine', command: `python ${JSON.stringify(filePath)}` }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return { image: 'node:20-alpine', command: `node ${JSON.stringify(filePath)}` }
  if (filePath.endsWith('.ts')) return { image: 'denoland/deno:alpine', command: `deno run --allow-read ${JSON.stringify(filePath)}` }
  if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) return { image: 'node:20-alpine', command: `echo ${JSON.stringify('JSX/TSX files require a project build step.')}` }
  if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.cxx')) return { image: 'gcc:latest', command: `g++ ${JSON.stringify(filePath)} -o out_bin && ./out_bin` }
  if (filePath.endsWith('.c')) return { image: 'gcc:latest', command: `gcc ${JSON.stringify(filePath)} -o out_bin && ./out_bin` }
  if (filePath.endsWith('.java')) return { image: 'openjdk:21-jdk', command: `java ${JSON.stringify(filePath)}` }
  if (filePath.endsWith('.rs')) return { image: 'rust:latest', command: `rustc ${JSON.stringify(filePath)} -O -o out_bin && ./out_bin` }
  return { image: 'alpine:3.20', command: `cat ${JSON.stringify(filePath)}` }
}

const findFirstFile = (nodes: RepoFileNode[]): string | null => {
  for (const node of nodes) {
    if (node.type === 'file') return node.path
    if (node.children?.length) {
      const nested = findFirstFile(node.children)
      if (nested) return nested
    }
  }
  return null
}

const getParentFolderPath = (filePath: string) => {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

const getBaseName = (entryPath: string) => {
  const parts = entryPath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? entryPath
}

const remapPathAfterMove = (currentPath: string, sourcePath: string, destinationPath: string) => {
  if (currentPath === sourcePath) {
    return destinationPath
  }

  if (currentPath.startsWith(`${sourcePath}/`)) {
    return `${destinationPath}${currentPath.slice(sourcePath.length)}`
  }

  return currentPath
}

/* ─── File icon ──────────────────────────────────────────────────────────── */

const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  ts: { icon: 'TS', color: '#3178c6' },
  tsx: { icon: 'TS', color: '#3178c6' },
  js: { icon: 'JS', color: '#f7df1e' },
  jsx: { icon: 'JS', color: '#f7df1e' },
  py: { icon: 'PY', color: '#3572A5' },
  json: { icon: '{}', color: '#cbcb41' },
  css: { icon: 'CS', color: '#563d7c' },
  html: { icon: 'HT', color: '#e34c26' },
  md: { icon: 'MD', color: '#6e7681' },
  cpp: { icon: 'C+', color: '#f34b7d' },
  c: { icon: 'C', color: '#555555' },
  java: { icon: 'JV', color: '#b07219' },
  rs: { icon: 'RS', color: '#dea584' },
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const info = FILE_ICONS[ext] ?? { icon: '·', color: '#6e7681' }
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        color: info.color,
        minWidth: 18,
        textAlign: 'center',
        fontFamily: 'monospace',
        letterSpacing: '-0.5px',
      }}
    >
      {info.icon}
    </span>
  )
}

/* ─── FileTree ───────────────────────────────────────────────────────────── */

function FileTree({
  nodes,
  selectedFilePath,
  selectedFolderPath,
  onSelectFile,
  onSelectFolder,
  onDropFilesToFolder,
  onDropEntryToFolder,
  onDragHoverFolder,
  isMoveAlreadyTriggered,
  getActiveDragEntry,
  onDragEntryStart,
  onDragEntryEnd,
  onOpenContextMenu,
  depth = 0,
}: {
  nodes: RepoFileNode[]
  selectedFilePath: string | null
  selectedFolderPath: string
  onSelectFile: (p: string) => void
  onSelectFolder: (p: string) => void
  onDropFilesToFolder: (folder: string, files: File[]) => void
  onDropEntryToFolder: (entryPath: string, entryType: 'file' | 'directory', folderPath: string) => void
  onDragHoverFolder: (folderPath: string) => void
  isMoveAlreadyTriggered: () => boolean
  getActiveDragEntry: () => ExplorerDragPayload | null
  onDragEntryStart: (entryPath: string, entryType: 'file' | 'directory') => void
  onDragEntryEnd: () => void
  onOpenContextMenu: (event: React.MouseEvent<HTMLElement>, entryPath: string, entryType: 'file' | 'directory') => void
  depth?: number
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const handleDrop = (e: DragEvent<HTMLElement>, folderPath: string) => {
    e.preventDefault()
    e.stopPropagation()

    if (isMoveAlreadyTriggered()) {
      onDragEntryEnd()
      return
    }

    const payload = getActiveDragEntry() ?? getExplorerDragPayload(e.dataTransfer)
    if (payload) {
      onDragEntryEnd()
      onDropEntryToFolder(payload.entryPath, payload.entryType, folderPath)
      return
    }

    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) onDropFilesToFolder(folderPath, files)
  }

  const handleDragStart = (
    event: DragEvent<HTMLElement>,
    entryPath: string,
    entryType: 'file' | 'directory'
  ) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    setExplorerDragPayload(event.dataTransfer, { entryPath, entryType })
    onDragEntryStart(entryPath, entryType)
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {nodes.map((node) => {
        if (node.type === 'directory') {
          const isOpen = !collapsed[node.path]
          return (
            <li key={node.path}>
              <div
                data-repo-drop-target="folder"
                data-repo-path={node.path}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDragHoverFolder(node.path)
                  const payload = getActiveDragEntry() ?? getExplorerDragPayload(e.dataTransfer)
                  e.dataTransfer.dropEffect = payload ? 'move' : 'copy'
                }}
                onDrop={(e) => handleDrop(e, node.path)}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => handleDragStart(event, node.path, 'directory')}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onDragHoverFolder(node.path)
                    const payload = getActiveDragEntry() ?? getExplorerDragPayload(event.dataTransfer)
                    event.dataTransfer.dropEffect = payload ? 'move' : 'copy'
                  }}
                  onDrop={(event) => handleDrop(event, node.path)}
                  onClick={() => {
                    setCollapsed(prev => ({ ...prev, [node.path]: isOpen }))
                    onSelectFolder(node.path)
                  }}
                  onContextMenu={(event) => onOpenContextMenu(event, node.path, 'directory')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    width: '100%',
                    background: selectedFolderPath === node.path ? 'rgba(255,255,255,0.07)' : 'transparent',
                    border: 'none',
                    color: '#c9d1d9',
                    cursor: 'pointer',
                    padding: `3px 8px 3px ${8 + depth * 12}px`,
                    fontSize: 13,
                    textAlign: 'left',
                    borderRadius: 4,
                  }}
                >
                  <span style={{ fontSize: 10, color: '#6e7681', minWidth: 12 }}>{isOpen ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 11, color: '#6e7681', minWidth: 18, textAlign: 'center' }}>📁</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {node.name}
                  </span>
                </button>
                {isOpen && node.children?.length ? (
                  <FileTree
                    nodes={node.children}
                    selectedFilePath={selectedFilePath}
                    selectedFolderPath={selectedFolderPath}
                    onSelectFile={onSelectFile}
                    onSelectFolder={onSelectFolder}
                    onDropFilesToFolder={onDropFilesToFolder}
                    onDropEntryToFolder={onDropEntryToFolder}
                    onDragHoverFolder={onDragHoverFolder}
                    isMoveAlreadyTriggered={isMoveAlreadyTriggered}
                    getActiveDragEntry={getActiveDragEntry}
                    onDragEntryStart={onDragEntryStart}
                    onDragEntryEnd={onDragEntryEnd}
                    onOpenContextMenu={onOpenContextMenu}
                    depth={depth + 1}
                  />
                ) : null}
              </div>
            </li>
          )
        }

        const isSelected = selectedFilePath === node.path
        return (
          <li key={node.path}>
            <button
              type="button"
              draggable
              onDragStart={(event) => handleDragStart(event, node.path, 'file')}
              onDragOver={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onDragHoverFolder(getParentFolderPath(node.path))
                const payload = getActiveDragEntry() ?? getExplorerDragPayload(event.dataTransfer)
                event.dataTransfer.dropEffect = payload ? 'move' : 'copy'
              }}
              onDrop={(event) => handleDrop(event, getParentFolderPath(node.path))}
              data-repo-drop-target="file"
              data-repo-path={node.path}
              onClick={() => onSelectFile(node.path)}
              onContextMenu={(event) => onOpenContextMenu(event, node.path, 'file')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                background: isSelected ? 'rgba(88,166,255,0.12)' : 'transparent',
                border: 'none',
                borderLeft: isSelected ? '2px solid #58a6ff' : '2px solid transparent',
                color: isSelected ? '#e6edf3' : '#8b949e',
                cursor: 'pointer',
                padding: `3px 8px 3px ${6 + depth * 12}px`,
                fontSize: 13,
                textAlign: 'left',
                borderRadius: '0 4px 4px 0',
                transition: 'background 0.1s, color 0.1s',
              }}
            >
              <FileIcon name={node.name} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.name}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/* ─── Resize hook ────────────────────────────────────────────────────────── */

function useResize(initialPx: number, min: number, max: number, direction: 'horizontal' | 'vertical' = 'horizontal') {
  const [size, setSize] = useState(initialPx)
  const dragging = useRef(false)
  const startPos = useRef(0)
  const startSize = useRef(initialPx)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
    startSize.current = size

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = direction === 'horizontal'
        ? ev.clientX - startPos.current
        : startPos.current - ev.clientY
      setSize(Math.min(max, Math.max(min, startSize.current + delta)))
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [size, min, max, direction])

  return { size, onMouseDown }
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function RepoEditorPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const repoId = params.id

  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null)
  const [ownerUid, setOwnerUid] = useState<string | null>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [repoName, setRepoName] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invites, setInvites] = useState<InviteRecord[]>([])
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [isInviting, setIsInviting] = useState(false)
  const [isCheckingAccess, setIsCheckingAccess] = useState(Boolean(auth))
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [collaborationRoomId, setCollaborationRoomId] = useState<string>(repoId)

  const [fileTree, setFileTree] = useState<RepoFileNode[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [selectedFolderPath, setSelectedFolderPath] = useState('')
  const [selectedFileContent, setSelectedFileContent] = useState('')
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isSavingFile, setIsSavingFile] = useState(false)
  const [fileMessage, setFileMessage] = useState<string | null>(null)
  const [editorReplaceToken, setEditorReplaceToken] = useState(0)
  const [editorReplaceContent, setEditorReplaceContent] = useState('')
  const [editorReplaceSource, setEditorReplaceSource] = useState<'ai' | 'user'>('user')
  const [selectedFileAiRanges, setSelectedFileAiRanges] = useState<AiRange[]>([])
  const [editorAiRangesToken, setEditorAiRangesToken] = useState(0)
  const [fileVersions, setFileVersions] = useState<FileVersionSummary[]>([])
  const [selectedVersionIndex, setSelectedVersionIndex] = useState<number | null>(null)
  const [previewVersionContent, setPreviewVersionContent] = useState('')
  const [previewVersionAiRanges, setPreviewVersionAiRanges] = useState<AiRange[]>([])
  const [isLoadingVersionHistory, setIsLoadingVersionHistory] = useState(false)
  const [isLoadingVersionPreview, setIsLoadingVersionPreview] = useState(false)
  const [isRestoringVersion, setIsRestoringVersion] = useState(false)

  // UI state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const activeDragEntryRef = useRef<ExplorerDragPayload | null>(null)
  const dragHoverFolderRef = useRef<string>('')
  const dragMoveTriggeredRef = useRef(false)
  const moveInFlightRef = useRef(false)
  const selectedFilePathRef = useRef<string | null>(null)
  const selectedFileLoadRequestRef = useRef(0)
  const lastPersistedSnapshotRef = useRef<{ path: string | null; content: string; aiRangesKey: string }>({
    path: null,
    content: '',
    aiRangesKey: '[]',
  })

  useEffect(() => {
    selectedFilePathRef.current = selectedFilePath
  }, [selectedFilePath])

  const handleEditorCodeChange = useCallback((editorFilePath: string, code: string) => {
    if (selectedFilePathRef.current !== editorFilePath) {
      return
    }
    setSelectedFileContent(code)
  }, [])

  const handleEditorAiRangesChange = useCallback((editorFilePath: string, ranges: AiRange[]) => {
    if (selectedFilePathRef.current !== editorFilePath) {
      return
    }
    setSelectedFileAiRanges(ranges)
  }, [])

  // Resize panels
  const sidebar = useResize(220, 140, 400, 'horizontal')
  const terminal = useResize(220, 80, 500, 'vertical')

  /* ── Auth ── */
  useEffect(() => {
    if (!auth) return
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (!nextUser) router.replace('/login')
    })
    return unsub
  }, [router])

  /* ── Access check ── */
  useEffect(() => {
    const checkAccess = async () => {
      if (!db || !user) {
        setOwnerUid(null); setOwnerName(null); setOwnerEmail(null)
        setIsOwner(false); setRepoName(null); setCollaborationRoomId(repoId)
        setIsCheckingAccess(false); return
      }
      setIsCheckingAccess(true); setErrorMessage(null)

      try {
        const myRepoSnap = await getDoc(doc(db, 'users', user.uid, 'repos', repoId))
        if (myRepoSnap.exists()) {
          const d = myRepoSnap.data() as { name?: string; role?: 'owner' | 'collaborator'; ownerName?: string; ownerUid?: string; ownerEmail?: string }
          const isLegacy = d.role === 'collaborator' && !d.ownerUid
          if (!isLegacy) {
            const effOwner = d.role === 'collaborator' && d.ownerUid ? d.ownerUid : user.uid
            const ownerView = effOwner === user.uid
            setRepoName(d.name ?? repoId); setOwnerUid(effOwner); setOwnerName(d.ownerName ?? null)
            setOwnerEmail(d.ownerEmail ?? user.email ?? null); setIsOwner(ownerView)
            setCollaborationRoomId(`${effOwner}:${repoId}`)
            if (ownerView) {
              const invSnap = await getDocs(collection(db, 'users', effOwner, 'repos', repoId, 'invites'))
              setInvites(invSnap.docs.map(d2 => { const id = d2.data() as InviteRecord; return { email: id.email, status: id.status } }))
            } else setInvites([])
            setIsCheckingAccess(false); return
          }
        }

        const repoResults = await getDocs(collectionGroup(db, 'repos'))
        const matching = repoResults.docs.filter(d2 => d2.id === repoId)
        if (!matching.length) { setErrorMessage('Repo not found.'); return }

        const curEmail = normalizeEmail(user.email ?? '')
        let matched: { name: string; ownerId: string; ownerView: boolean; ownerName?: string; ownerEmail?: string } | null = null

        for (const repoDoc of matching) {
          const candOwner = getOwnerUidFromRepoPath(repoDoc.ref.path)
          if (!candOwner) continue
          const data = repoDoc.data() as { name?: string; ownerName?: string; ownerEmail?: string }
          if (candOwner === user.uid) { matched = { name: data.name ?? repoId, ownerId: candOwner, ownerView: true, ownerName: data.ownerName, ownerEmail: data.ownerEmail }; break }
          if (!curEmail) continue
          const invRef = doc(db, 'users', candOwner, 'repos', repoId, 'invites', encodeURIComponent(curEmail))
          const invDoc = await getDoc(invRef)
          if (!invDoc.exists()) continue
          matched = { name: data.name ?? repoId, ownerId: candOwner, ownerView: false, ownerName: data.ownerName, ownerEmail: data.ownerEmail }
          break
        }

        if (!matched) { setErrorMessage('You do not have access to this repo.'); setIsCheckingAccess(false); return }

        setRepoName(matched.name); setOwnerUid(matched.ownerId); setOwnerName(matched.ownerName ?? null)
        setOwnerEmail(matched.ownerEmail ?? null); setIsOwner(matched.ownerView)
        setCollaborationRoomId(`${matched.ownerId}:${repoId}`)
        await setDoc(doc(db, 'users', user.uid, 'repos', repoId), { role: matched.ownerView ? 'owner' : 'collaborator', ownerUid: matched.ownerId, ownerName: matched.ownerName ?? null, ownerEmail: matched.ownerEmail ?? null }, { merge: true })
        if (matched.ownerView) {
          const invSnap = await getDocs(collection(db, 'users', matched.ownerId, 'repos', repoId, 'invites'))
          setInvites(invSnap.docs.map(d2 => { const id = d2.data() as InviteRecord; return { email: id.email, status: id.status } }))
        } else setInvites([])
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : 'Unable to load repo.')
      }
      setIsCheckingAccess(false)
    }
    void checkAccess()
  }, [repoId, user])

  /* ── File tree ── */
  const loadFileTree = useCallback(async (opts?: { silent?: boolean }) => {
    if (!ownerUid) return
    if (!opts?.silent) setIsLoadingFiles(true)
    try {
      const res = await fetch(`/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}`)
      const data = (await res.json()) as { tree?: RepoFileNode[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Unable to load file tree')
      const tree = data.tree ?? []
      setFileTree(tree)
      if (!selectedFilePath) { const f = findFirstFile(tree); if (f) setSelectedFilePath(f) }
    } catch (e) { if (e instanceof Error) setErrorMessage(e.message) }
    if (!opts?.silent) setIsLoadingFiles(false)
  }, [ownerUid, repoId, selectedFilePath])

  useEffect(() => {
    const init = async () => {
      if (!ownerUid) return
      await fetch('/api/repo-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'init', ownerUid, repoId }) })
      await loadFileTree()
    }
    void init()
  }, [ownerUid, repoId, loadFileTree])

  useEffect(() => {
    if (!ownerUid) return
    const interval = setInterval(() => void loadFileTree({ silent: true }), 1500)
    return () => clearInterval(interval)
  }, [ownerUid, loadFileTree])

  const loadFileVersions = useCallback(async () => {
    if (!ownerUid || !selectedFilePath) {
      setFileVersions([])
      setSelectedVersionIndex(null)
      setPreviewVersionContent('')
      setPreviewVersionAiRanges([])
      return
    }

    setIsLoadingVersionHistory(true)
    try {
      const response = await fetch(
        `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(selectedFilePath)}&history=1`
      )
      const data = (await response.json()) as { versions?: FileVersionSummary[]; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load file history')
      }

      const versions = (data.versions ?? []).sort((a, b) => a.createdAt - b.createdAt)
      setFileVersions(versions)
      setSelectedVersionIndex(versions.length ? versions.length - 1 : null)
      setPreviewVersionContent('')
      setPreviewVersionAiRanges([])
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
    setIsLoadingVersionHistory(false)
  }, [ownerUid, repoId, selectedFilePath])

  /* ── Selected file ── */
  useEffect(() => {
    const load = async () => {
      if (!ownerUid || !selectedFilePath) return
      const requestId = selectedFileLoadRequestRef.current + 1
      selectedFileLoadRequestRef.current = requestId
      const requestedPath = selectedFilePath
      setIsLoadingSelectedFile(true)
      try {
        const res = await fetch(`/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(selectedFilePath)}`)
        const data = (await res.json()) as { content?: string; aiRanges?: AiRange[]; error?: string }
        if (!res.ok) {
          throw new Error(data.error || 'Unable to load file')
        }
        if (selectedFileLoadRequestRef.current !== requestId) {
          return
        }
        const content = data.content ?? ''
        const normalizedRanges = normalizeAiRanges(data.aiRanges ?? [], content)
        setSelectedFileContent(content)
        setSelectedFileAiRanges(normalizedRanges)
        lastPersistedSnapshotRef.current = {
          path: requestedPath,
          content,
          aiRangesKey: JSON.stringify(normalizedRanges),
        }
        setPreviewVersionContent('')
        setPreviewVersionAiRanges([])
        setEditorAiRangesToken(p => p + 1); setEditorReplaceSource('user'); setFileMessage(null)
        await loadFileVersions()
      } catch (e) { if (e instanceof Error) setErrorMessage(e.message) }
      if (selectedFileLoadRequestRef.current === requestId) {
        setIsLoadingSelectedFile(false)
      }
    }
    void load()
  }, [ownerUid, repoId, selectedFilePath, loadFileVersions])

  /* ── Auto-save (2s) ── */
  useEffect(() => {
    if (!ownerUid || !selectedFilePath) return
    const intervalId = setInterval(() => {
      if (!ownerUid || !selectedFilePath || isLoadingSelectedFile || moveInFlightRef.current || isSavingFile) {
        return
      }

      const aiRangesKey = JSON.stringify(selectedFileAiRanges)
      const lastSnapshot = lastPersistedSnapshotRef.current
      const hasChanges =
        lastSnapshot.path !== selectedFilePath ||
        lastSnapshot.content !== selectedFileContent ||
        lastSnapshot.aiRangesKey !== aiRangesKey

      if (!hasChanges) {
        return
      }

      void fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          ownerUid,
          repoId,
          filePath: selectedFilePath,
          content: selectedFileContent,
          aiRanges: selectedFileAiRanges,
          createVersion: false,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const data = (await response.json()) as { error?: string }
            throw new Error(data.error || 'Auto-save failed')
          }
          lastPersistedSnapshotRef.current = {
            path: selectedFilePath,
            content: selectedFileContent,
            aiRangesKey,
          }
        })
        .catch((error) => {
          if (error instanceof Error) {
            setErrorMessage(error.message)
          }
        })
    }, 2_000)

    return () => clearInterval(intervalId)
  }, [ownerUid, repoId, selectedFilePath, selectedFileContent, selectedFileAiRanges, isLoadingSelectedFile, isSavingFile])

  const handleInvite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!db || !user || !ownerUid || !isOwner) { setInviteError('Only the repo owner can invite.'); return }
    const em = normalizeEmail(inviteEmail)
    if (!em.includes('@')) { setInviteError('Enter a valid email.'); return }
    setInviteError(null); setInviteMessage(null); setIsInviting(true)
    try {
      await setDoc(doc(db, 'users', ownerUid, 'repos', repoId, 'invites', encodeURIComponent(em)), { email: em, status: 'invited', invitedByUid: user.uid, invitedByEmail: user.email ?? null, invitedAt: serverTimestamp() }, { merge: true })
      setInvites(prev => [...prev.filter(i => normalizeEmail(i.email) !== em), { email: em, status: 'invited' }])
      setInviteEmail(''); setInviteMessage(`Invited ${em}`)
    } catch (e) { setInviteError(e instanceof Error ? e.message : 'Unable to invite.') }
    setIsInviting(false)
  }

  const handleSaveFile = async () => {
    if (!ownerUid || !selectedFilePath) return
    setIsSavingFile(true); setFileMessage(null)
    try {
      const res = await fetch('/api/repo-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', ownerUid, repoId, filePath: selectedFilePath, content: selectedFileContent, aiRanges: selectedFileAiRanges, createVersion: true }) })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Unable to save')
      lastPersistedSnapshotRef.current = {
        path: selectedFilePath,
        content: selectedFileContent,
        aiRangesKey: JSON.stringify(selectedFileAiRanges),
      }
      setFileMessage(`Saved`)
      await loadFileVersions()
    } catch (e) { if (e instanceof Error) setErrorMessage(e.message) }
    setIsSavingFile(false)
  }

  const handleTimelinePreview = useCallback(async (index: number) => {
    if (!ownerUid || !selectedFilePath) {
      return
    }

    const version = fileVersions[index]
    if (!version) {
      return
    }

    setSelectedVersionIndex(index)
    setIsLoadingVersionPreview(true)
    try {
      const response = await fetch(
        `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(selectedFilePath)}&versionId=${encodeURIComponent(version.id)}`
      )
      const data = (await response.json()) as { content?: string; aiRanges?: AiRange[]; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load file version')
      }

      const content = data.content ?? ''
      setPreviewVersionContent(content)
      setPreviewVersionAiRanges(normalizeAiRanges(data.aiRanges ?? [], content))
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
    setIsLoadingVersionPreview(false)
  }, [ownerUid, repoId, selectedFilePath, fileVersions])

  const handleRestoreSelectedVersion = useCallback(async () => {
    if (!ownerUid || !selectedFilePath || selectedVersionIndex == null) {
      return
    }

    setIsRestoringVersion(true)
    try {
      const response = await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          ownerUid,
          repoId,
          filePath: selectedFilePath,
          content: previewVersionContent,
          aiRanges: previewVersionAiRanges,
          createVersion: true,
        }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to restore selected version')
      }

      setSelectedFileContent(previewVersionContent)
      setSelectedFileAiRanges(previewVersionAiRanges)
      setEditorReplaceContent(previewVersionContent)
      setEditorReplaceSource('user')
      setEditorReplaceToken((prev) => prev + 1)
      setEditorAiRangesToken((prev) => prev + 1)
      setFileMessage('Version restored')
      await loadFileVersions()
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
    setIsRestoringVersion(false)
  }, [
    ownerUid,
    selectedFilePath,
    selectedVersionIndex,
    previewVersionContent,
    previewVersionAiRanges,
    repoId,
    loadFileVersions,
  ])

  const handleCreateFile = async () => {
    if (!ownerUid) return
    const inputPath = window.prompt(selectedFolderPath ? `File name (folder: ${selectedFolderPath}):` : 'File path (e.g. src/main.py):')?.trim()
    if (!inputPath) return
    const norm = inputPath.replaceAll('\\', '/').replace(/^\/+/, '')
    const filePath = selectedFolderPath && !norm.includes('/') ? `${selectedFolderPath}/${norm}` : norm
    try {
      const res = await fetch('/api/repo-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-file', ownerUid, repoId, filePath, content: '' }) })
      const data = (await res.json()) as { tree?: RepoFileNode[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Unable to create file')
      setFileTree(data.tree ?? []); setSelectedFilePath(filePath); setSelectedFolderPath(getParentFolderPath(filePath))
      setSelectedFileContent(''); setSelectedFileAiRanges([]); setEditorReplaceContent(''); setEditorReplaceSource('user')
      setEditorReplaceToken(p => p + 1); setEditorAiRangesToken(p => p + 1)
    } catch (e) { if (e instanceof Error) setErrorMessage(e.message) }
  }

  const handleCreateFolder = async () => {
    if (!ownerUid) return
    const folderPath = window.prompt('Folder path (e.g. src/utils):')?.trim()
    if (!folderPath) return
    try {
      const res = await fetch('/api/repo-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-folder', ownerUid, repoId, folderPath }) })
      const data = (await res.json()) as { tree?: RepoFileNode[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Unable to create folder')
      setFileTree(data.tree ?? [])
    } catch (e) { if (e instanceof Error) setErrorMessage(e.message) }
  }

  const handleRenameEntry = useCallback(async (entryPath: string, entryType: 'file' | 'directory') => {
    if (!ownerUid) return

    const currentName = getBaseName(entryPath)
    const newName = window.prompt(`Rename ${entryType}:`, currentName)?.trim()
    if (!newName || newName === currentName) return

    try {
      const response = await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rename-entry',
          ownerUid,
          repoId,
          sourcePath: entryPath,
          newName,
        }),
      })

      const data = (await response.json()) as {
        tree?: RepoFileNode[]
        sourcePath?: string
        destinationPath?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || 'Unable to rename entry')
      }

      const nextTree = data.tree ?? []
      setFileTree(nextTree)
      setSelectedFolderPath((prev) =>
        data.destinationPath ? remapPathAfterMove(prev, entryPath, data.destinationPath) : prev
      )

      const currentSelectedPath = selectedFilePathRef.current
      const selectedIsRenamed =
        currentSelectedPath != null &&
        data.destinationPath != null &&
        (currentSelectedPath === entryPath || currentSelectedPath.startsWith(`${entryPath}/`))

      if (selectedIsRenamed && currentSelectedPath && data.destinationPath) {
        const nextSelected = remapPathAfterMove(currentSelectedPath, entryPath, data.destinationPath)
        setSelectedFilePath(nextSelected)
      }

      setFileMessage('Renamed')
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
  }, [ownerUid, repoId])

  const moveEntryToPath = useCallback(async (
    sourcePath: string,
    sourceType: 'file' | 'directory',
    destinationPath: string
  ) => {
    if (!ownerUid) return

    if (destinationPath === sourcePath) {
      setFileMessage('Dropped in same location.')
      return
    }
    if (sourceType === 'directory' && (destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`))) {
      setFileMessage('Cannot move a folder into itself.')
      return
    }

    setFileMessage(`Moving ${sourcePath} → ${destinationPath}…`)
    moveInFlightRef.current = true

    try {
      const response = await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move-entry',
          ownerUid,
          repoId,
          sourcePath,
          destinationPath,
        }),
      })

      const data = (await response.json()) as {
        tree?: RepoFileNode[]
        sourcePath?: string
        destinationPath?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || `Unable to move ${sourceType}`)
      }

      const movedTo = data.destinationPath ?? destinationPath
      setFileTree(data.tree ?? [])
      setSelectedFolderPath((prev) => remapPathAfterMove(prev, sourcePath, movedTo))

      const currentSelectedPath = selectedFilePathRef.current
      const selectedIsMoved =
        currentSelectedPath != null &&
        (currentSelectedPath === sourcePath || currentSelectedPath.startsWith(`${sourcePath}/`))

      if (selectedIsMoved && currentSelectedPath) {
        const nextSelected = remapPathAfterMove(currentSelectedPath, sourcePath, movedTo)
        setSelectedFilePath(nextSelected)

        const reloadResponse = await fetch(
          `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(nextSelected)}`
        )
        const reloadData = (await reloadResponse.json()) as {
          content?: string
          aiRanges?: AiRange[]
          error?: string
        }
        if (reloadResponse.ok) {
          const canonicalContent = reloadData.content ?? ''
          const canonicalRanges = normalizeAiRanges(reloadData.aiRanges ?? [], canonicalContent)
          lastPersistedSnapshotRef.current = {
            path: nextSelected,
            content: canonicalContent,
            aiRangesKey: JSON.stringify(canonicalRanges),
          }
          setSelectedFileContent(canonicalContent)
          setSelectedFileAiRanges(canonicalRanges)
          setEditorReplaceContent(canonicalContent)
          setEditorReplaceSource('user')
          setEditorReplaceToken((prev) => prev + 1)
          setEditorAiRangesToken((prev) => prev + 1)
        }
      }

      setFileMessage('Moved')
    } catch (error) {
      if (error instanceof Error) {
        setFileMessage(`Move failed: ${error.message}`)
      }
    } finally {
      moveInFlightRef.current = false
    }
  }, [ownerUid, repoId])

  const handleMoveEntry = useCallback((entryPath: string, entryType: 'file' | 'directory') => {
    const currentParent = getParentFolderPath(entryPath)
    const destinationFolderInput = window.prompt(
      'Move to folder path (empty for root):',
      currentParent
    )
    if (destinationFolderInput === null) return

    const destinationFolder = destinationFolderInput
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
    const baseName = getBaseName(entryPath)
    const destinationPath = destinationFolder ? `${destinationFolder}/${baseName}` : baseName

    void moveEntryToPath(entryPath, entryType, destinationPath)
  }, [moveEntryToPath])

  const handleDropEntryToFolder = useCallback((
    entryPath: string,
    entryType: 'file' | 'directory',
    folderPath: string
  ) => {
    dragMoveTriggeredRef.current = true
    const baseName = getBaseName(entryPath)
    const destinationPath = folderPath ? `${folderPath}/${baseName}` : baseName
    void moveEntryToPath(entryPath, entryType, destinationPath)
  }, [moveEntryToPath])

  const handleDragEntryStart = useCallback((entryPath: string, entryType: 'file' | 'directory') => {
    activeDragEntryRef.current = { entryPath, entryType }
    dragHoverFolderRef.current = getParentFolderPath(entryPath)
    dragMoveTriggeredRef.current = false
    setFileMessage(`Dragging ${entryPath}`)
  }, [])

  const handleDragEntryEnd = useCallback(() => {
    activeDragEntryRef.current = null
    dragHoverFolderRef.current = ''
    dragMoveTriggeredRef.current = false
    setFileMessage((prev) => (prev?.startsWith('Dragging ') ? null : prev))
  }, [])

  const handleDragHoverFolder = useCallback((folderPath: string) => {
    dragHoverFolderRef.current = folderPath
  }, [])

  const isMoveAlreadyTriggered = useCallback(() => dragMoveTriggeredRef.current, [])

  const getActiveDragEntry = useCallback(() => activeDragEntryRef.current, [])

  const handleDeleteEntry = useCallback(async (entryPath: string, entryType: 'file' | 'directory') => {
    if (!ownerUid) return

    const confirmed = window.confirm(
      entryType === 'directory'
        ? `Delete folder "${entryPath}" and all its contents?`
        : `Delete file "${entryPath}"?`
    )
    if (!confirmed) return

    try {
      const response = await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: entryType === 'directory' ? 'delete-folder' : 'delete-file',
          ownerUid,
          repoId,
          ...(entryType === 'directory' ? { folderPath: entryPath } : { filePath: entryPath }),
        }),
      })

      const data = (await response.json()) as { tree?: RepoFileNode[]; error?: string }
      if (!response.ok) {
        throw new Error(data.error || `Unable to delete ${entryType}`)
      }

      const nextTree = data.tree ?? []
      setFileTree(nextTree)

      const selectedIsDeleted =
        selectedFilePath != null &&
        (selectedFilePath === entryPath || selectedFilePath.startsWith(`${entryPath}/`))
      if (selectedIsDeleted) {
        const fallback = findFirstFile(nextTree)
        setSelectedFilePath(fallback)
      }

      const folderIsDeleted =
        selectedFolderPath === entryPath || selectedFolderPath.startsWith(`${entryPath}/`)
      if (folderIsDeleted) {
        setSelectedFolderPath('')
      }

      setFileMessage('Deleted')
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
  }, [ownerUid, repoId, selectedFilePath, selectedFolderPath])

  const handleDropFilesToFolder = useCallback(async (folderPath: string, files: File[]) => {
    if (!ownerUid || !files.length) return
    setFileMessage(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`)
    try {
      for (const file of files) {
        const content = await file.text()
        const target = folderPath ? `${folderPath}/${file.name}` : file.name
        const res = await fetch('/api/repo-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-file', ownerUid, repoId, filePath: target, content }) })
        const data = (await res.json()) as { tree?: RepoFileNode[]; error?: string }
        if (!res.ok) throw new Error(data.error || `Unable to upload ${file.name}`)
        setFileTree(data.tree ?? [])
      }
      setSelectedFolderPath(folderPath); setFileMessage(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}.`)
    } catch (e) { if (e instanceof Error) setErrorMessage(e.message); setFileMessage(null) }
  }, [ownerUid, repoId])

  const handleDropFilesAnywhere = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault()

    if (dragMoveTriggeredRef.current) {
      handleDragEntryEnd()
      return
    }

    const internalPayload = activeDragEntryRef.current ?? getExplorerDragPayload(e.dataTransfer)
    if (internalPayload) {
      const destinationFolderPath = dragHoverFolderRef.current
      handleDropEntryToFolder(internalPayload.entryPath, internalPayload.entryType, destinationFolderPath)

      handleDragEntryEnd()
      return
    }

    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) void handleDropFilesToFolder(selectedFolderPath || '', files)
  }, [handleDragEntryEnd, handleDropEntryToFolder, handleDropFilesToFolder, selectedFolderPath])

  const handleExplorerRootDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.target === event.currentTarget) {
      dragHoverFolderRef.current = ''
    }
    const payload = activeDragEntryRef.current ?? getExplorerDragPayload(event.dataTransfer)
    event.dataTransfer.dropEffect = payload ? 'move' : 'copy'
  }, [])

  const handleExplorerRootDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()

    if (dragMoveTriggeredRef.current) {
      handleDragEntryEnd()
      return
    }

    const payload = activeDragEntryRef.current ?? getExplorerDragPayload(event.dataTransfer)
    if (payload) {
      event.stopPropagation()
      handleDragEntryEnd()
      handleDropEntryToFolder(payload.entryPath, payload.entryType, '')
      return
    }

    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length) {
      void handleDropFilesToFolder('', files)
    }
  }, [handleDropEntryToFolder, handleDropFilesToFolder, handleDragEntryEnd])

  const handleOpenContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>, entryPath: string, entryType: 'file' | 'directory') => {
      event.preventDefault()
      event.stopPropagation()
      setExplorerContextMenu({
        x: event.clientX,
        y: event.clientY,
        entryPath,
        entryType,
      })
    },
    []
  )

  useEffect(() => {
    const closeMenu = () => setExplorerContextMenu(null)
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (contextMenuRef.current && target && contextMenuRef.current.contains(target)) {
        return
      }
      closeMenu()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', closeMenu)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', closeMenu)
    }
  }, [])

  useEffect(() => {
    const handleWindowDragOver = (event: Event) => {
      const dragEvent = event as globalThis.DragEvent
      if (!activeDragEntryRef.current) {
        return
      }

      dragEvent.preventDefault()
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.dropEffect = 'move'
      }
    }

    const handleWindowDragEnd = () => {
      const activePayload = activeDragEntryRef.current
      if (!activePayload) {
        return
      }

      if (!dragMoveTriggeredRef.current) {
        const sourceParent = getParentFolderPath(activePayload.entryPath)
        const destinationFolderPath = dragHoverFolderRef.current
        if (destinationFolderPath !== sourceParent) {
          handleDropEntryToFolder(activePayload.entryPath, activePayload.entryType, destinationFolderPath)
        }
      }

      handleDragEntryEnd()
    }

    window.addEventListener('dragover', handleWindowDragOver, true)
    window.addEventListener('dragend', handleWindowDragEnd, true)

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver, true)
      window.removeEventListener('dragend', handleWindowDragEnd, true)
    }
  }, [handleDropEntryToFolder, handleDragEntryEnd])

  const handleImportCodeFromChat = (code: string) => {
    if (!selectedFilePath) { setErrorMessage('Select a file before importing.'); return }
    setErrorMessage(null); setSelectedFileContent(code); setSelectedFileAiRanges([getFullRangeForCode(code)])
    setEditorAiRangesToken(p => p + 1); setEditorReplaceContent(code); setEditorReplaceSource('ai')
    setEditorReplaceToken(p => p + 1); setFileMessage('Imported code from AI.')
  }

  const editorLanguage = useMemo(() => getLanguageFromFilePath(selectedFilePath), [selectedFilePath])
  const effectiveEditorRoom = `${collaborationRoomId}:${selectedFilePath ?? 'root'}`
  const runtimeDefaults = useMemo(() => getRuntimeConfigForFilePath(selectedFilePath), [selectedFilePath])
  const isHtmlPreviewFile = Boolean(
    selectedFilePath &&
      (selectedFilePath.toLowerCase().endsWith('.html') || selectedFilePath.toLowerCase().endsWith('.htm'))
  )
  const selectedVersion =
    selectedVersionIndex != null && selectedVersionIndex >= 0
      ? fileVersions[selectedVersionIndex] ?? null
      : null
  const selectedVersionTimeLabel = selectedVersion
    ? new Date(selectedVersion.createdAt).toLocaleString()
    : '—'

  /* ── Loading / Error screens ── */
  if (isCheckingAccess) return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117', color: '#e6edf3' }}>
      <Navbar />
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <p style={{ color: '#8b949e', fontSize: 14 }}>Loading repo…</p>
      </div>
    </main>
  )

  if (errorMessage) return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117', color: '#e6edf3' }}>
      <Navbar />
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#f85149', fontSize: 14, marginBottom: 16 }}>{errorMessage}</p>
          <Link href="/workspace" style={{ color: '#58a6ff', fontSize: 13 }}>← Back to repos</Link>
        </div>
      </div>
    </main>
  )

  /* ── Main layout ── */
  return (
    <main
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117', color: '#e6edf3', overflow: 'hidden', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDrop={handleDropFilesAnywhere}
    >
      <Navbar/>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid #21262d', background: '#161b22', flexShrink: 0, minHeight: 42 }}>
        <Link href="/workspace" style={{ color: '#8b949e', fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          ← repos
        </Link>
        <span style={{ color: '#21262d' }}>/</span>
        <span style={{ color: '#e6edf3', fontSize: 13, fontWeight: 600 }}>{repoName ?? repoId}</span>
        <span style={{ padding: '2px 8px', borderRadius: 20, background: isOwner ? 'rgba(88,166,255,0.15)' : 'rgba(163,113,247,0.15)', color: isOwner ? '#58a6ff' : '#a371f7', fontSize: 11, fontWeight: 600, letterSpacing: '0.03em' }}>
          {isOwner ? 'owner' : 'collaborator'}
        </span>
        {!isOwner && (
          <span style={{ color: '#8b949e', fontSize: 11 }}>by {getOwnerLabel(ownerName, ownerEmail)}</span>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Save indicator */}
        {fileMessage && (
          <span style={{ fontSize: 11, color: '#3fb950', transition: 'opacity 0.3s' }}>{fileMessage}</span>
        )}

        {/* Save button */}
        <button
          onClick={handleSaveFile}
          disabled={!selectedFilePath || isSavingFile || isLoadingSelectedFile}
          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: isSavingFile ? '#8b949e' : '#e6edf3', fontSize: 12, cursor: 'pointer' }}
        >
          {isLoadingSelectedFile ? 'Loading…' : isSavingFile ? 'Saving…' : '⌘S Save'}
        </button>

        {/* Invite (owner only, colapsabil) */}
        {isOwner && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setInviteOpen(o => !o)}
              style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #30363d', background: inviteOpen ? 'rgba(88,166,255,0.1)' : 'transparent', color: '#58a6ff', fontSize: 12, cursor: 'pointer' }}
            >
              + Invite
            </button>
            {inviteOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 16, width: 320, zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#e6edf3' }}>Invite collaborators</p>
                <form onSubmit={handleInvite} style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="email@example.com"
                    style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3', fontSize: 12, outline: 'none' }}
                  />
                  <button type="submit" disabled={isInviting} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#238636', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                    {isInviting ? '…' : 'Send'}
                  </button>
                </form>
                {inviteError && <p style={{ fontSize: 11, color: '#f85149', marginTop: 6 }}>{inviteError}</p>}
                {inviteMessage && <p style={{ fontSize: 11, color: '#3fb950', marginTop: 6 }}>{inviteMessage}</p>}
                {invites.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>Invited</p>
                    {invites.map(inv => (
                      <div key={inv.email} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: '#c9d1d9' }}>
                        <span>{inv.email}</span>
                        <span style={{ color: '#8b949e' }}>{inv.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedFilePath && fileVersions.length > 0 && (
        <div style={{ borderBottom: '1px solid #21262d', background: '#0f141b', padding: '8px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Time travel
            </span>
            <span style={{ fontSize: 11, color: '#8b949e' }}>
              {isLoadingVersionHistory ? 'loading history…' : `${fileVersions.length} checkpoints`}
            </span>
            <span style={{ fontSize: 11, color: '#8b949e' }}>Selected: {selectedVersionTimeLabel}</span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => {
                setSelectedVersionIndex(fileVersions.length ? fileVersions.length - 1 : null)
                setPreviewVersionContent('')
                setPreviewVersionAiRanges([])
              }}
              style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 11, cursor: 'pointer' }}
            >
              Live
            </button>
            <button
              type="button"
              onClick={() => void handleRestoreSelectedVersion()}
              disabled={isRestoringVersion || selectedVersionIndex == null}
              style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #30363d', background: isRestoringVersion ? '#30363d' : '#1f6feb', color: '#fff', fontSize: 11, cursor: 'pointer', opacity: isRestoringVersion || selectedVersionIndex == null ? 0.7 : 1 }}
            >
              {isRestoringVersion ? 'Restoring…' : 'Restore this version'}
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, fileVersions.length - 1)}
            step={1}
            value={selectedVersionIndex ?? Math.max(0, fileVersions.length - 1)}
            onChange={(event) => {
              const idx = Number(event.target.value)
              void handleTimelinePreview(idx)
            }}
            style={{ width: '100%' }}
          />

          {isLoadingVersionPreview ? (
            <p style={{ marginTop: 6, fontSize: 11, color: '#8b949e' }}>Loading preview…</p>
          ) : previewVersionContent ? (
            <pre
              style={{
                marginTop: 6,
                maxHeight: 120,
                overflow: 'auto',
                background: '#0d1117',
                border: '1px solid #21262d',
                borderRadius: 6,
                padding: '8px 10px',
                color: '#c9d1d9',
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              {previewVersionContent.slice(0, 5000)}
            </pre>
          ) : (
            <p style={{ marginTop: 6, fontSize: 11, color: '#6e7681' }}>
              Move the slider to preview an older version, then click “Restore this version”.
            </p>
          )}
        </div>
      )}

      {/* ── Workspace ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Sidebar ── */}
        <div style={{ width: sidebar.size, minWidth: sidebar.size, display: 'flex', flexDirection: 'column', borderRight: '1px solid #21262d', background: '#0d1117', overflow: 'hidden', flexShrink: 0 }}>
          {/* Sidebar header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Explorer</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={handleCreateFile} title="New file" style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14, padding: '0 3px', lineHeight: 1 }}>+</button>
              <button onClick={handleCreateFolder} title="New folder" style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 13, padding: '0 3px', lineHeight: 1 }}>📁</button>
              <button onClick={() => void loadFileTree()} title="Refresh" style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 13, padding: '0 3px', lineHeight: 1 }}>↻</button>
            </div>
          </div>

          {/* File list */}
          <div
            style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}
            onDragOver={handleExplorerRootDragOver}
            onDrop={handleExplorerRootDrop}
          >
            {isLoadingFiles ? (
              <p style={{ fontSize: 12, color: '#8b949e', padding: '8px 12px' }}>Loading…</p>
            ) : fileTree.length === 0 ? (
              <p style={{ fontSize: 12, color: '#8b949e', padding: '8px 12px' }}>No files yet. Drop files here or click +</p>
            ) : (
              <FileTree
                nodes={fileTree}
                selectedFilePath={selectedFilePath}
                selectedFolderPath={selectedFolderPath}
                onSelectFile={(p) => { setSelectedFilePath(p); setSelectedFolderPath(getParentFolderPath(p)) }}
                onSelectFolder={setSelectedFolderPath}
                onDropFilesToFolder={handleDropFilesToFolder}
                onDropEntryToFolder={handleDropEntryToFolder}
                onDragHoverFolder={handleDragHoverFolder}
                isMoveAlreadyTriggered={isMoveAlreadyTriggered}
                getActiveDragEntry={getActiveDragEntry}
                onDragEntryStart={handleDragEntryStart}
                onDragEntryEnd={handleDragEntryEnd}
                onOpenContextMenu={handleOpenContextMenu}
              />
            )}
          </div>
        </div>

        {/* ── Sidebar resize handle ── */}
        <div
          onMouseDown={sidebar.onMouseDown}
          style={{ width: 4, cursor: 'col-resize', background: 'transparent', flexShrink: 0, transition: 'background 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#388bfd')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        />

        {/* ── Editor + terminal column ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Tab bar */}
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #21262d', background: '#161b22', flexShrink: 0, height: 36, paddingLeft: 4, gap: 0, overflowX: 'auto' }}>
            {selectedFilePath ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', height: '100%', borderRight: '1px solid #21262d', borderBottom: '2px solid #388bfd', background: '#0d1117' }}>
                <FileIcon name={selectedFilePath.split('/').pop() ?? ''} />
                <span style={{ fontSize: 13, color: '#e6edf3', whiteSpace: 'nowrap' }}>{selectedFilePath.split('/').pop()}</span>
                <span style={{ fontSize: 11, color: '#8b949e', marginLeft: 2 }}>{editorLanguage}</span>
              </div>
            ) : (
              <span style={{ fontSize: 12, color: '#8b949e', padding: '0 14px' }}>No file open</span>
            )}
            <div style={{ flex: 1 }} />
            {/* Terminal toggle */}
            <button
              onClick={() => setTerminalOpen(o => !o)}
              style={{ height: '100%', padding: '0 14px', background: 'transparent', border: 'none', borderLeft: '1px solid #21262d', color: terminalOpen ? '#e6edf3' : '#8b949e', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              ⊟ Terminal
            </button>
          </div>

          {/* Editor area */}
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex' }}>
            <div style={{ flex: isHtmlPreviewFile ? '0 0 55%' : 1, minWidth: 0, borderRight: isHtmlPreviewFile ? '1px solid #21262d' : 'none' }}>
              {selectedFilePath ? (
                <Editor
                  key={effectiveEditorRoom}
                  roomId={effectiveEditorRoom}
                  language={editorLanguage}
                  initialCode={selectedFileContent}
                  onCodeChange={(code) => handleEditorCodeChange(selectedFilePath, code)}
                  replaceContentToken={editorReplaceToken}
                  replaceContentValue={editorReplaceContent}
                  replaceContentSource={editorReplaceSource}
                  initialAiRanges={selectedFileAiRanges}
                  aiRangesToken={editorAiRangesToken}
                  onAiRangesChange={(ranges) => handleEditorAiRangesChange(selectedFilePath, ranges)}
                  embedded
                />
              ) : (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: '#8b949e', fontSize: 14, marginBottom: 8 }}>No file selected</p>
                    <p style={{ color: '#6e7681', fontSize: 12 }}>Pick a file from the explorer or drop files anywhere</p>
                  </div>
                </div>
              )}
            </div>

            {isHtmlPreviewFile && (
              <div style={{ flex: '0 0 45%', minWidth: 280, display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
                <div style={{
                  height: 32,
                  borderBottom: '1px solid #21262d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 10px',
                  fontSize: 11,
                  color: '#8b949e',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  background: '#161b22',
                }}>
                  <span>Live Preview</span>
                  <span style={{ color: '#6e7681' }}>{selectedFilePath}</span>
                </div>
                <iframe
                  title="Live HTML Preview"
                  srcDoc={selectedFileContent}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                  style={{
                    flex: 1,
                    width: '100%',
                    border: 'none',
                    background: '#ffffff',
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Terminal panel ── */}
          {terminalOpen && (
            <>
              {/* Terminal resize handle */}
              <div
                onMouseDown={terminal.onMouseDown}
                style={{ height: 4, cursor: 'row-resize', background: 'transparent', flexShrink: 0, transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#388bfd')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              />
              <div style={{ height: terminal.size, minHeight: terminal.size, borderTop: '1px solid #21262d', flexShrink: 0, overflow: 'hidden' }}>
                <SyncedTerminal
                  roomId={collaborationRoomId}
                  ownerUid={ownerUid}
                  repoId={repoId}
                  defaultImage={runtimeDefaults.image}
                  defaultCommand={runtimeDefaults.command}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Floating AI chat button ── */}
      <button
        onClick={() => setChatOpen(o => !o)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: chatOpen ? '#388bfd' : '#238636',
          border: 'none',
          color: '#fff',
          fontSize: 20,
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.2s, transform 0.2s',
        }}
        title="AI Chat"
      >
        {chatOpen ? '×' : '✦'}
      </button>

      {/* ── Floating AI chat panel ── */}
      {chatOpen && (
        <div style={{
          position: 'fixed',
          bottom: 84,
          right: 24,
          width: 360,
          maxHeight: '60vh',
          zIndex: 199,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <RepoChat
            language={editorLanguage}
            filePath={selectedFilePath}
            codeContext={selectedFileContent}
            onImportCode={(code) => { handleImportCodeFromChat(code); setChatOpen(false) }}
          />
        </div>
      )}

      {explorerContextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            left: explorerContextMenu.x,
            top: explorerContextMenu.y,
            minWidth: 150,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            zIndex: 400,
            overflow: 'hidden',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              void handleRenameEntry(explorerContextMenu.entryPath, explorerContextMenu.entryType)
              setExplorerContextMenu(null)
            }}
            style={{ width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 'none', color: '#c9d1d9', fontSize: 12, cursor: 'pointer' }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              void handleMoveEntry(explorerContextMenu.entryPath, explorerContextMenu.entryType)
              setExplorerContextMenu(null)
            }}
            style={{ width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 'none', color: '#c9d1d9', fontSize: 12, cursor: 'pointer' }}
          >
            Move
          </button>
          <button
            type="button"
            onClick={() => {
              void handleDeleteEntry(explorerContextMenu.entryPath, explorerContextMenu.entryType)
              setExplorerContextMenu(null)
            }}
            style={{ width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 'none', color: '#f85149', fontSize: 12, cursor: 'pointer' }}
          >
            Delete
          </button>
        </div>
      )}
    </main>
  )
}