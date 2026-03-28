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
  depth = 0,
}: {
  nodes: RepoFileNode[]
  selectedFilePath: string | null
  selectedFolderPath: string
  onSelectFile: (p: string) => void
  onSelectFolder: (p: string) => void
  onDropFilesToFolder: (folder: string, files: File[]) => void
  depth?: number
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const handleDrop = (e: DragEvent<HTMLDivElement>, folderPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) onDropFilesToFolder(folderPath, files)
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {nodes.map((node) => {
        if (node.type === 'directory') {
          const isOpen = !collapsed[node.path]
          return (
            <li key={node.path}>
              <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
                onDrop={(e) => handleDrop(e, node.path)}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCollapsed(prev => ({ ...prev, [node.path]: isOpen }))
                    onSelectFolder(node.path)
                  }}
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
              onClick={() => onSelectFile(node.path)}
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

  // UI state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)

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

  /* ── Selected file ── */
  useEffect(() => {
    const load = async () => {
      if (!ownerUid || !selectedFilePath) return
      setIsLoadingSelectedFile(true)
      try {
        const res = await fetch(`/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(selectedFilePath)}`)
        const data = (await res.json()) as { content?: string; aiRanges?: AiRange[]; error?: string }
        const content = data.content ?? ''
        setSelectedFileContent(content)
        setSelectedFileAiRanges(normalizeAiRanges(data.aiRanges ?? [], content))
        setEditorAiRangesToken(p => p + 1); setEditorReplaceSource('user'); setFileMessage(null)
      } catch (e) { if (e instanceof Error) setErrorMessage(e.message) }
      setIsLoadingSelectedFile(false)
    }
    void load()
  }, [ownerUid, repoId, selectedFilePath])

  /* ── Auto-save ── */
  useEffect(() => {
    if (!ownerUid || !selectedFilePath || isLoadingSelectedFile) return
    const t = setTimeout(() => {
      void fetch('/api/repo-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', ownerUid, repoId, filePath: selectedFilePath, content: selectedFileContent, aiRanges: selectedFileAiRanges }) })
        .then(async r => { if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error || 'Auto-save failed') } })
        .catch(e => { if (e instanceof Error) setErrorMessage(e.message) })
    }, 400)
    return () => clearTimeout(t)
  }, [ownerUid, repoId, selectedFilePath, selectedFileContent, selectedFileAiRanges, isLoadingSelectedFile])

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
      const res = await fetch('/api/repo-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', ownerUid, repoId, filePath: selectedFilePath, content: selectedFileContent, aiRanges: selectedFileAiRanges }) })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Unable to save')
      setFileMessage(`Saved`)
    } catch (e) { if (e instanceof Error) setErrorMessage(e.message) }
    setIsSavingFile(false)
  }

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
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) void handleDropFilesToFolder(selectedFolderPath || '', files)
  }, [handleDropFilesToFolder, selectedFolderPath])

  const handleImportCodeFromChat = (code: string) => {
    if (!selectedFilePath) { setErrorMessage('Select a file before importing.'); return }
    setErrorMessage(null); setSelectedFileContent(code); setSelectedFileAiRanges([getFullRangeForCode(code)])
    setEditorAiRangesToken(p => p + 1); setEditorReplaceContent(code); setEditorReplaceSource('ai')
    setEditorReplaceToken(p => p + 1); setFileMessage('Imported code from AI.')
  }

  const editorLanguage = useMemo(() => getLanguageFromFilePath(selectedFilePath), [selectedFilePath])
  const effectiveEditorRoom = `${collaborationRoomId}:${selectedFilePath ?? 'root'}`
  const runtimeDefaults = useMemo(() => getRuntimeConfigForFilePath(selectedFilePath), [selectedFilePath])

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
          disabled={!selectedFilePath || isSavingFile}
          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: isSavingFile ? '#8b949e' : '#e6edf3', fontSize: 12, cursor: 'pointer' }}
        >
          {isSavingFile ? 'Saving…' : '⌘S Save'}
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
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
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
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {selectedFilePath ? (
              <Editor
                key={effectiveEditorRoom}
                roomId={effectiveEditorRoom}
                language={editorLanguage}
                initialCode={selectedFileContent}
                onCodeChange={setSelectedFileContent}
                replaceContentToken={editorReplaceToken}
                replaceContentValue={editorReplaceContent}
                replaceContentSource={editorReplaceSource}
                initialAiRanges={selectedFileAiRanges}
                aiRangesToken={editorAiRangesToken}
                onAiRangesChange={(r) => setSelectedFileAiRanges(r)}
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
    </main>
  )
}