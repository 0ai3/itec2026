'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
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
import Editor from '@/components/editor'
import { auth, db } from '@/lib/firebase'
import SyncedTerminal from '@/components/synced-terminal'
import RepoChat from '@/components/repo-chat'

type InviteRecord = {
  email: string
  status?: string
}

type RepoFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: RepoFileNode[]
}

type AiRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

const getFullRangeForCode = (code: string): AiRange => {
  const lines = code.split('\n')
  const endLineNumber = Math.max(1, lines.length)
  const lastLine = lines[endLineNumber - 1] ?? ''
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber,
    endColumn: lastLine.length + 1,
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const getOwnerUidFromRepoPath = (path: string) => {
  const segments = path.split('/')
  return segments.length >= 2 ? segments[1] : null
}

const getOwnerLabel = (ownerName?: string | null, ownerEmail?: string | null) => {
  if (ownerName && ownerName.trim()) {
    return ownerName
  }
  if (ownerEmail && ownerEmail.includes('@')) {
    return ownerEmail.split('@')[0]
  }
  return 'Unknown user'
}

const getLanguageFromFilePath = (filePath: string | null) => {
  if (!filePath) {
    return 'typescript'
  }
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    return 'typescript'
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
    return 'javascript'
  }
  if (filePath.endsWith('.json')) {
    return 'json'
  }
  if (filePath.endsWith('.css')) {
    return 'css'
  }
  if (filePath.endsWith('.html')) {
    return 'html'
  }
  if (filePath.endsWith('.py')) {
    return 'python'
  }
  if (filePath.endsWith('.md')) {
    return 'markdown'
  }
  if (filePath.endsWith('.cpp')) {
    return 'cpp'
  }
  return 'plaintext'
}

const getRuntimeConfigForFilePath = (filePath: string | null) => {
  if (!filePath) {
    return {
      image: 'python:3.11-alpine',
      command: 'python main.py',
    }
  }

  if (filePath.endsWith('.py')) {
    return {
      image: 'python:3.11-alpine',
      command: `python ${JSON.stringify(filePath)}`,
    }
  }

  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return {
      image: 'node:20-alpine',
      command: `node ${JSON.stringify(filePath)}`,
    }
  }

  if (filePath.endsWith('.ts')) {
    return {
      image: 'denoland/deno:alpine',
      command: `deno run --allow-read ${JSON.stringify(filePath)}`,
    }
  }

  if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
    return {
      image: 'node:20-alpine',
      command: `echo ${JSON.stringify('JSX/TSX files require a project build step (e.g. npm run build).')}`,
    }
  }

  // ADĂUGĂM SUPORT PENTRU C++
  if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.cxx')) {
    return {
      image: 'gcc:latest',
      // Compilează și rulează
      command: `g++ ${JSON.stringify(filePath)} -o out_bin && ./out_bin`,
    }
  }

  // ADĂUGĂM SUPORT PENTRU C
  if (filePath.endsWith('.c')) {
    return {
      image: 'gcc:latest',
      command: `gcc ${JSON.stringify(filePath)} -o out_bin && ./out_bin`,
    }
  }

  // ADĂUGĂM SUPORT PENTRU JAVA
  if (filePath.endsWith('.java')) {
    return {
      image: 'openjdk:21-jdk',
      command: `java ${JSON.stringify(filePath)}`,
    }
  }

  return {
    image: 'alpine:3.20',
    command: `cat ${JSON.stringify(filePath)}`,
  }
}

const findFirstFile = (nodes: RepoFileNode[]): string | null => {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.path
    }
    if (node.children?.length) {
      const nested = findFirstFile(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function FileTree({
  nodes,
  selectedFilePath,
  onSelectFile,
}: {
  nodes: RepoFileNode[]
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
}) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => {
        if (node.type === 'directory') {
          return (
            <li key={node.path}>
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide px-2 py-1 rounded bg-white/5">
                {node.name}
              </p>
              {node.children?.length ? (
                <div className="ml-3 mt-1 border-l border-white/10 pl-2">
                  <FileTree
                    nodes={node.children}
                    selectedFilePath={selectedFilePath}
                    onSelectFile={onSelectFile}
                  />
                </div>
              ) : (
                <p className="text-xs text-gray-500 ml-2">(empty)</p>
              )}
            </li>
          )
        }

        const isSelected = selectedFilePath === node.path
        return (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => onSelectFile(node.path)}
              className={`w-full text-left text-sm rounded-md px-2.5 py-1.5 truncate transition-colors ${
                isSelected ? 'bg-white/15 text-white shadow-sm' : 'hover:bg-white/10 text-gray-300'
              }`}
              title={node.path}
            >
              {node.name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

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
  const [selectedFileContent, setSelectedFileContent] = useState('')
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isSavingFile, setIsSavingFile] = useState(false)
  const [fileMessage, setFileMessage] = useState<string | null>(null)
  const [editorReplaceToken, setEditorReplaceToken] = useState(0)
  const [editorReplaceContent, setEditorReplaceContent] = useState('')
  const [editorReplaceSource, setEditorReplaceSource] = useState<'ai' | 'user'>('user')
  const [selectedFileAiRanges, setSelectedFileAiRanges] = useState<AiRange[]>([])
  const [editorAiRangesToken, setEditorAiRangesToken] = useState(0)

  useEffect(() => {
    if (!auth) {
      return
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        router.replace('/login')
      }
    })

    return () => {
      unsubscribe()
    }
  }, [router])

  useEffect(() => {
    const checkAccess = async () => {
      if (!db || !user) {
        setOwnerUid(null)
        setOwnerName(null)
        setOwnerEmail(null)
        setIsOwner(false)
        setRepoName(null)
        setCollaborationRoomId(repoId)
        setIsCheckingAccess(false)
        return
      }

      setIsCheckingAccess(true)
      setErrorMessage(null)
      setInviteError(null)
      setInviteMessage(null)

      try {
        const myRepoSnapshot = await getDoc(doc(db, 'users', user.uid, 'repos', repoId))
        if (myRepoSnapshot.exists()) {
          const myRepoData = myRepoSnapshot.data() as {
            name?: string
            role?: 'owner' | 'collaborator'
            ownerName?: string
            ownerUid?: string
            ownerEmail?: string
          }

          const isLegacyCollaboratorWithoutOwner =
            myRepoData.role === 'collaborator' && !myRepoData.ownerUid

          if (!isLegacyCollaboratorWithoutOwner) {
            const effectiveOwnerUid =
              myRepoData.role === 'collaborator' && myRepoData.ownerUid ? myRepoData.ownerUid : user.uid
            const ownerView = effectiveOwnerUid === user.uid

            setRepoName(myRepoData.name ?? repoId)
            setOwnerUid(effectiveOwnerUid)
            setOwnerName(myRepoData.ownerName ?? null)
            setOwnerEmail(myRepoData.ownerEmail ?? user.email ?? null)
            setIsOwner(ownerView)
            setCollaborationRoomId(`${effectiveOwnerUid}:${repoId}`)

            if (ownerView) {
              const invitesSnapshot = await getDocs(
                collection(db, 'users', effectiveOwnerUid, 'repos', repoId, 'invites')
              )
              setInvites(
                invitesSnapshot.docs.map((inviteDoc) => {
                  const inviteData = inviteDoc.data() as InviteRecord
                  return {
                    email: inviteData.email,
                    status: inviteData.status,
                  }
                })
              )
            } else {
              setInvites([])
            }

            setIsCheckingAccess(false)
            return
          }
        }

        const repoResults = await getDocs(collectionGroup(db, 'repos'))
        const matchingRepoDocs = repoResults.docs.filter((repoDoc) => repoDoc.id === repoId)

        if (matchingRepoDocs.length === 0) {
          setErrorMessage('Repo not found.')
          return
        }

        const currentUserEmail = normalizeEmail(user.email ?? '')
        let matchedRepo: {
          name: string
          ownerId: string
          ownerView: boolean
          ownerName?: string
          ownerEmail?: string
        } | null = null

        for (const repoDoc of matchingRepoDocs) {
          const candidateOwnerUid = getOwnerUidFromRepoPath(repoDoc.ref.path)
          if (!candidateOwnerUid) {
            continue
          }

          const data = repoDoc.data() as { name?: string; ownerName?: string; ownerEmail?: string }
          if (candidateOwnerUid === user.uid) {
            matchedRepo = {
              name: data.name ?? repoId,
              ownerId: candidateOwnerUid,
              ownerView: true,
              ownerName: data.ownerName,
              ownerEmail: data.ownerEmail,
            }
            break
          }

          if (!currentUserEmail) {
            continue
          }

          const inviteDocRef = doc(
            db,
            'users',
            candidateOwnerUid,
            'repos',
            repoId,
            'invites',
            encodeURIComponent(currentUserEmail)
          )
          const inviteDoc = await getDoc(inviteDocRef)
          if (!inviteDoc.exists()) {
            continue
          }

          matchedRepo = {
            name: data.name ?? repoId,
            ownerId: candidateOwnerUid,
            ownerView: false,
            ownerName: data.ownerName,
            ownerEmail: data.ownerEmail,
          }
          break
        }

        if (!matchedRepo) {
          setErrorMessage('You do not have access to this repo.')
          setOwnerUid(null)
          setOwnerName(null)
          setOwnerEmail(null)
          setIsOwner(false)
          setRepoName(null)
          setCollaborationRoomId(repoId)
          setInvites([])
          return
        }

        setRepoName(matchedRepo.name)
        setOwnerUid(matchedRepo.ownerId)
        setOwnerName(matchedRepo.ownerName ?? null)
        setOwnerEmail(matchedRepo.ownerEmail ?? null)
        setIsOwner(matchedRepo.ownerView)
        setCollaborationRoomId(`${matchedRepo.ownerId}:${repoId}`)

        await setDoc(
          doc(db, 'users', user.uid, 'repos', repoId),
          {
            role: matchedRepo.ownerView ? 'owner' : 'collaborator',
            ownerUid: matchedRepo.ownerId,
            ownerName: matchedRepo.ownerName ?? null,
            ownerEmail: matchedRepo.ownerEmail ?? null,
          },
          { merge: true }
        )

        if (matchedRepo.ownerView) {
          const invitesSnapshot = await getDocs(
            collection(db, 'users', matchedRepo.ownerId, 'repos', repoId, 'invites')
          )
          setInvites(
            invitesSnapshot.docs.map((inviteDoc) => {
              const inviteData = inviteDoc.data() as InviteRecord
              return {
                email: inviteData.email,
                status: inviteData.status,
              }
            })
          )
        } else {
          setInvites([])
        }
      } catch (error) {
        if (error instanceof Error) {
          setErrorMessage(error.message)
        } else {
          setErrorMessage('Unable to load repo.')
        }
        setOwnerUid(null)
        setOwnerName(null)
        setOwnerEmail(null)
        setIsOwner(false)
        setRepoName(null)
        setCollaborationRoomId(repoId)
        setInvites([])
      }

      setIsCheckingAccess(false)
    }

    void checkAccess()
  }, [repoId, user])

  const loadFileTree = useCallback(async () => {
    if (!ownerUid) {
      return
    }

    setIsLoadingFiles(true)
    try {
      const response = await fetch(
        `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}`
      )
      const data = (await response.json()) as { tree?: RepoFileNode[]; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load file tree')
      }

      const tree = data.tree ?? []
      setFileTree(tree)
      if (!selectedFilePath) {
        const firstFile = findFirstFile(tree)
        if (firstFile) {
          setSelectedFilePath(firstFile)
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
    setIsLoadingFiles(false)
  }, [ownerUid, repoId, selectedFilePath])

  useEffect(() => {
    const initFilesystem = async () => {
      if (!ownerUid) {
        return
      }

      await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init', ownerUid, repoId }),
      })

      await loadFileTree()
    }

    void initFilesystem()
  }, [ownerUid, repoId, loadFileTree])

  useEffect(() => {
    const loadSelectedFile = async () => {
      if (!ownerUid || !selectedFilePath) {
        return
      }

      try {
        const response = await fetch(
          `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(
            repoId
          )}&filePath=${encodeURIComponent(selectedFilePath)}`
        )
        const data = (await response.json()) as { content?: string; aiRanges?: AiRange[]; error?: string }
        if (!response.ok) {
          throw new Error(data.error || 'Unable to load file content')
        }
        setSelectedFileContent(data.content ?? '')
        setSelectedFileAiRanges(data.aiRanges ?? [])
        setEditorAiRangesToken((prev) => prev + 1)
        setEditorReplaceSource('user')
        setFileMessage(null)
      } catch (error) {
        if (error instanceof Error) {
          setErrorMessage(error.message)
        }
      }
    }

    void loadSelectedFile()
  }, [ownerUid, repoId, selectedFilePath])

  useEffect(() => {
    if (!ownerUid || !selectedFilePath) {
      return
    }

    const timer = setTimeout(() => {
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
        }),
      }).then(async (response) => {
        if (!response.ok) {
          const data = (await response.json()) as { error?: string }
          throw new Error(data.error || 'Unable to auto-save AI ranges')
        }
      }).catch((error: unknown) => {
        if (error instanceof Error) {
          setErrorMessage(error.message)
        }
      })
    }, 400)

    return () => clearTimeout(timer)
  }, [ownerUid, repoId, selectedFilePath, selectedFileContent, selectedFileAiRanges])

  const handleInviteCollaborator = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!db || !user || !ownerUid || !isOwner) {
      setInviteError('Only the repo owner can invite collaborators.')
      return
    }

    const normalizedInviteEmail = normalizeEmail(inviteEmail)
    if (!normalizedInviteEmail || !normalizedInviteEmail.includes('@')) {
      setInviteError('Enter a valid email address.')
      return
    }

    setInviteError(null)
    setInviteMessage(null)
    setIsInviting(true)

    try {
      const inviteRef = doc(
        db,
        'users',
        ownerUid,
        'repos',
        repoId,
        'invites',
        encodeURIComponent(normalizedInviteEmail)
      )

      await setDoc(
        inviteRef,
        {
          email: normalizedInviteEmail,
          status: 'invited',
          invitedByUid: user.uid,
          invitedByEmail: user.email ?? null,
          invitedAt: serverTimestamp(),
        },
        { merge: true }
      )

      setInvites((prevInvites) => {
        const withoutExisting = prevInvites.filter(
          (existingInvite) => normalizeEmail(existingInvite.email) !== normalizedInviteEmail
        )
        return [...withoutExisting, { email: normalizedInviteEmail, status: 'invited' }]
      })
      setInviteEmail('')
      setInviteMessage(`Invitation saved for ${normalizedInviteEmail}.`)
    } catch (error) {
      if (error instanceof Error) {
        setInviteError(error.message)
      } else {
        setInviteError('Unable to invite collaborator.')
      }
    }

    setIsInviting(false)
  }

  const handleSaveFile = async () => {
    if (!ownerUid || !selectedFilePath) {
      return
    }

    setIsSavingFile(true)
    setFileMessage(null)

    try {
      const response = await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          ownerUid,
          repoId,
          filePath: selectedFilePath,
          content: selectedFileContent,
          aiRanges: selectedFileAiRanges,
        }),
      })

      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to save file')
      }

      setFileMessage(`Saved ${selectedFilePath}`)
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }

    setIsSavingFile(false)
  }

  const handleCreateFile = async () => {
    if (!ownerUid) {
      return
    }

    const filePath = window.prompt('New file path (e.g. src/main.py):')?.trim()
    if (!filePath) {
      return
    }

    try {
      const response = await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-file',
          ownerUid,
          repoId,
          filePath,
          content: '',
        }),
      })
      const data = (await response.json()) as { tree?: RepoFileNode[]; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to create file')
      }
      setFileTree(data.tree ?? [])
      setSelectedFilePath(filePath)
      setSelectedFileAiRanges([])
      setEditorAiRangesToken((prev) => prev + 1)
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
  }

  const handleCreateFolder = async () => {
    if (!ownerUid) {
      return
    }

    const folderPath = window.prompt('New folder path (e.g. src/utils):')?.trim()
    if (!folderPath) {
      return
    }

    try {
      const response = await fetch('/api/repo-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-folder',
          ownerUid,
          repoId,
          folderPath,
        }),
      })
      const data = (await response.json()) as { tree?: RepoFileNode[]; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to create folder')
      }
      setFileTree(data.tree ?? [])
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      }
    }
  }

  const handleImportCodeFromChat = (code: string) => {
    if (!selectedFilePath) {
      setErrorMessage('Select a file before importing code from chat.')
      return
    }

    setErrorMessage(null)
    setSelectedFileContent(code)
    setSelectedFileAiRanges([getFullRangeForCode(code)])
    setEditorAiRangesToken((prev) => prev + 1)
    setEditorReplaceContent(code)
    setEditorReplaceSource('ai')
    setEditorReplaceToken((prev) => prev + 1)
    setFileMessage('Imported code from AI chat.')
  }

  const editorLanguage = useMemo(() => getLanguageFromFilePath(selectedFilePath), [selectedFilePath])
  const effectiveEditorRoom = `${collaborationRoomId}:${selectedFilePath ?? 'root'}`

  const runtimeDefaults = useMemo(
    () => getRuntimeConfigForFilePath(selectedFilePath),
    [selectedFilePath]
  )
  if (isCheckingAccess) {
    return (
      <main className="flex-1 flex flex-col bg-[#0b1220] text-gray-100">
        <Navbar />
        <section className="p-6">
          <p className="text-sm text-gray-400">Loading repo...</p>
        </section>
      </main>
    )
  }

  if (errorMessage) {
    return (
      <main className="flex-1 flex flex-col bg-[#0b1220] text-gray-100">
        <Navbar />
        <section className="p-6 max-w-3xl w-full mx-auto">
          <p className="text-sm text-red-400 mb-4">{errorMessage}</p>
          <Link href="/workspace" className="text-sm underline text-gray-200">
            Back to repos
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col bg-[#0b1220] text-gray-100">
      <Navbar />
      <section className="px-4 md:px-6 pt-4 pb-4 max-w-[1600px] w-full mx-auto">
        <div className="border border-white/10 rounded-2xl p-4 md:p-5 bg-[#111a2c] backdrop-blur-sm shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{repoName ?? 'Repo editor'}</h1>
              <div className="mt-1 flex flex-wrap gap-2 items-center text-sm">
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-gray-200">Repo ID: {repoId}</span>
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-gray-200">
                  Access: {isOwner ? 'Owner' : 'Collaborator'}
                </span>
                {!isOwner ? (
                  <span className="px-2 py-0.5 rounded-full bg-white/10 text-gray-200">
                    Owner: {getOwnerLabel(ownerName, ownerEmail)}
                  </span>
                ) : null}
              </div>
            </div>
            <Link href="/workspace" className="text-sm border border-white/20 rounded-lg px-3 py-1.5 hover:bg-white/10 w-fit">
              Back to Repos
            </Link>
          </div>

          {isOwner ? (
            <div className="mt-4 border border-white/10 rounded-xl p-4 bg-[#0f1729]">
              <h2 className="font-semibold mb-3">Invite collaborators</h2>
              <form onSubmit={handleInviteCollaborator} className="flex gap-2 flex-wrap">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="collaborator@email.com"
                className="flex-1 min-w-64 border border-white/20 rounded-lg px-3 py-2 bg-[#0b1220] text-gray-100 placeholder:text-gray-500"
              />
              <button
                type="submit"
                disabled={isInviting}
                className="bg-white text-black rounded-lg px-4 py-2 disabled:opacity-60"
              >
                {isInviting ? 'Inviting...' : 'Invite'}
              </button>
            </form>

            {inviteError ? <p className="text-sm text-red-500 mt-3">{inviteError}</p> : null}
            {inviteMessage ? <p className="text-sm text-green-600 mt-3">{inviteMessage}</p> : null}

            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Invited collaborators</p>
              {invites.length === 0 ? (
                <p className="text-sm text-gray-400">No collaborators invited yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {invites.map((invite) => (
                    <li key={invite.email} className="text-sm text-gray-200 px-2 py-1 rounded bg-white/10">
                      {invite.email} {invite.status ? `(${invite.status})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="px-4 md:px-6 pb-6 max-w-[1600px] w-full mx-auto grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        <aside className="border border-white/10 rounded-2xl p-3.5 overflow-auto bg-[#111a2c] shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Files</h2>
            <button
              type="button"
              onClick={() => void loadFileTree()}
              className="text-xs border border-white/20 rounded-md px-2 py-1 hover:bg-white/10"
            >
              Refresh
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={handleCreateFile}
              className="text-xs border border-white/20 rounded-md px-2 py-1 hover:bg-white/10"
            >
              + File
            </button>
            <button
              type="button"
              onClick={handleCreateFolder}
              className="text-xs border border-white/20 rounded-md px-2 py-1 hover:bg-white/10"
            >
              + Folder
            </button>
          </div>

          {isLoadingFiles ? (
            <p className="text-sm text-gray-400">Loading files...</p>
          ) : fileTree.length === 0 ? (
            <p className="text-sm text-gray-400">No files yet.</p>
          ) : (
            <FileTree
              nodes={fileTree}
              selectedFilePath={selectedFilePath}
              onSelectFile={setSelectedFilePath}
            />
          )}
        </aside>

        <div className="flex flex-col gap-3 min-h-0">
          <div className="border border-white/10 rounded-2xl p-3.5 bg-[#111a2c] shadow-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-gray-300">
                Active file: <strong>{selectedFilePath ?? 'None selected'}</strong>
              </p>
              <div className="flex gap-2 items-center">
                <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-gray-200">
                  Language: {editorLanguage}
                </span>
                <button
                  type="button"
                  onClick={handleSaveFile}
                  disabled={!selectedFilePath || isSavingFile}
                  className="text-sm border border-white/20 rounded-lg px-3 py-1.5 disabled:opacity-60 hover:bg-white/10"
                >
                  {isSavingFile ? 'Saving...' : 'Save file'}
                </button>
              </div>
            </div>
            {fileMessage ? <p className="text-xs text-green-600 mt-2">{fileMessage}</p> : null}
          </div>

          <div className="h-[52vh] min-h-[420px] lg:h-[60vh] border border-white/10 rounded-2xl overflow-hidden bg-[#0f1729] shadow-sm">
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
                onAiRangesChange={(ranges) => setSelectedFileAiRanges(ranges)}
                embedded
              />
            ) : (
              <div className="h-full grid place-items-center text-sm text-gray-400">
                Select a file from the sidebar.
              </div>
            )}
          </div>

          <SyncedTerminal
            roomId={collaborationRoomId}
            ownerUid={ownerUid}
            repoId={repoId}
            defaultImage={runtimeDefaults.image}
            defaultCommand={runtimeDefaults.command}
          />

          <RepoChat
            language={editorLanguage}
            filePath={selectedFilePath}
            codeContext={selectedFileContent}
            onImportCode={handleImportCodeFromChat}
          />
        </div>
      </section>
    </main>
  )
}
