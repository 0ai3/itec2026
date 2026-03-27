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
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{node.name}</p>
              {node.children?.length ? (
                <div className="ml-3 mt-1 border-l border-black/10 pl-2">
                  <FileTree
                    nodes={node.children}
                    selectedFilePath={selectedFilePath}
                    onSelectFile={onSelectFile}
                  />
                </div>
              ) : (
                <p className="text-xs text-gray-400 ml-2">(empty)</p>
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
              className={`w-full text-left text-sm rounded px-2 py-1 ${
                isSelected ? 'bg-black text-white' : 'hover:bg-black/5'
              }`}
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

  const [dockerImage, setDockerImage] = useState('python:3.11-alpine')
  const [runCommand, setRunCommand] = useState('python main.py')
  const [runOutput, setRunOutput] = useState('')
  const [isRunningCommand, setIsRunningCommand] = useState(false)

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
        const data = (await response.json()) as { content?: string; error?: string }
        if (!response.ok) {
          throw new Error(data.error || 'Unable to load file content')
        }
        setSelectedFileContent(data.content ?? '')
        setFileMessage(null)
      } catch (error) {
        if (error instanceof Error) {
          setErrorMessage(error.message)
        }
      }
    }

    void loadSelectedFile()
  }, [ownerUid, repoId, selectedFilePath])

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

  const handleRunCommand = async () => {
    if (!ownerUid) {
      return
    }

    setIsRunningCommand(true)
    setRunOutput('Running command...')

    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerUid,
          repoId,
          image: dockerImage,
          command: runCommand,
        }),
      })

      const data = (await response.json()) as { output?: string; error?: string; exitCode?: number }
      if (!response.ok) {
        throw new Error(data.error || 'Execution failed')
      }

      const outputText = data.output?.trim() || '(no output)'
      setRunOutput(`exit code: ${data.exitCode ?? 0}\n\n${outputText}`)
    } catch (error) {
      if (error instanceof Error) {
        setRunOutput(error.message)
      } else {
        setRunOutput('Execution failed')
      }
    }

    setIsRunningCommand(false)
  }

  const editorLanguage = useMemo(() => getLanguageFromFilePath(selectedFilePath), [selectedFilePath])
  const effectiveEditorRoom = `${collaborationRoomId}:${selectedFilePath ?? 'root'}`

  useEffect(() => {
    const runtime = getRuntimeConfigForFilePath(selectedFilePath)
    setDockerImage(runtime.image)
    setRunCommand(runtime.command)
  }, [selectedFilePath])

  if (isCheckingAccess) {
    return (
      <main className="flex-1 flex flex-col">
        <Navbar />
        <section className="p-6">
          <p className="text-sm text-gray-500">Loading repo...</p>
        </section>
      </main>
    )
  }

  if (errorMessage) {
    return (
      <main className="flex-1 flex flex-col">
        <Navbar />
        <section className="p-6 max-w-3xl w-full mx-auto">
          <p className="text-sm text-red-500 mb-4">{errorMessage}</p>
          <Link href="/workspace" className="text-sm underline">
            Back to repos
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col">
      <Navbar />
      <section className="px-6 pt-4 pb-4">
        <h1 className="text-xl font-semibold">{repoName ?? 'Repo editor'}</h1>
        <p className="text-sm text-gray-600">Repo ID: {repoId}</p>
        <p className="text-sm text-gray-600">Access: {isOwner ? 'Owner' : 'Collaborator'}</p>
        {!isOwner ? (
          <p className="text-sm text-gray-600">
            Collaborator, owned by: {getOwnerLabel(ownerName, ownerEmail)}
          </p>
        ) : null}

        {isOwner ? (
          <div className="mt-4 border border-black/10 rounded-xl p-4 max-w-2xl">
            <h2 className="font-semibold mb-3">Invite collaborators</h2>
            <form onSubmit={handleInviteCollaborator} className="flex gap-2 flex-wrap">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="collaborator@email.com"
                className="flex-1 min-w-64 border border-black/20 rounded-md px-3 py-2"
              />
              <button
                type="submit"
                disabled={isInviting}
                className="bg-black text-white rounded-md px-4 py-2 disabled:opacity-60"
              >
                {isInviting ? 'Inviting...' : 'Invite'}
              </button>
            </form>

            {inviteError ? <p className="text-sm text-red-500 mt-3">{inviteError}</p> : null}
            {inviteMessage ? <p className="text-sm text-green-600 mt-3">{inviteMessage}</p> : null}

            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Invited collaborators</p>
              {invites.length === 0 ? (
                <p className="text-sm text-gray-500">No collaborators invited yet.</p>
              ) : (
                <ul className="space-y-1">
                  {invites.map((invite) => (
                    <li key={invite.email} className="text-sm text-gray-700">
                      {invite.email} {invite.status ? `(${invite.status})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="px-6 pb-6 grid grid-cols-[280px_1fr] gap-4 flex-1 min-h-0">
        <aside className="border border-black/10 rounded-xl p-3 overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Files</h2>
            <button
              type="button"
              onClick={() => void loadFileTree()}
              className="text-xs border border-black/20 rounded px-2 py-1"
            >
              Refresh
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={handleCreateFile}
              className="text-xs border border-black/20 rounded px-2 py-1"
            >
              + File
            </button>
            <button
              type="button"
              onClick={handleCreateFolder}
              className="text-xs border border-black/20 rounded px-2 py-1"
            >
              + Folder
            </button>
          </div>

          {isLoadingFiles ? (
            <p className="text-sm text-gray-500">Loading files...</p>
          ) : fileTree.length === 0 ? (
            <p className="text-sm text-gray-500">No files yet.</p>
          ) : (
            <FileTree
              nodes={fileTree}
              selectedFilePath={selectedFilePath}
              onSelectFile={setSelectedFilePath}
            />
          )}
        </aside>

        <div className="flex flex-col gap-3 min-h-0">
          <div className="border border-black/10 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-gray-600">
                Active file: <strong>{selectedFilePath ?? 'None selected'}</strong>
              </p>
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={handleSaveFile}
                  disabled={!selectedFilePath || isSavingFile}
                  className="text-sm border border-black/20 rounded px-3 py-1.5 disabled:opacity-60"
                >
                  {isSavingFile ? 'Saving...' : 'Save file'}
                </button>
              </div>
            </div>
            {fileMessage ? <p className="text-xs text-green-600 mt-2">{fileMessage}</p> : null}
          </div>

          <div className="min-h-0 flex-1 border border-black/10 rounded-xl overflow-hidden">
            {selectedFilePath ? (
              <Editor
                key={effectiveEditorRoom}
                roomId={effectiveEditorRoom}
                language={editorLanguage}
                initialCode={selectedFileContent}
                onCodeChange={setSelectedFileContent}
              />
            ) : (
              <div className="h-full grid place-items-center text-sm text-gray-500">
                Select a file from the sidebar.
              </div>
            )}
          </div>

          <div className="border border-black/10 rounded-xl p-3">
            <h3 className="font-semibold mb-2">Run in Docker</h3>
            <div className="grid md:grid-cols-[220px_1fr_auto] gap-2 items-center">
              <input
                value={dockerImage}
                onChange={(event) => setDockerImage(event.target.value)}
                placeholder="python:3.11-alpine"
                className="border border-black/20 rounded px-3 py-2 text-sm"
              />
              <input
                value={runCommand}
                onChange={(event) => setRunCommand(event.target.value)}
                placeholder="python main.py"
                className="border border-black/20 rounded px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleRunCommand}
                disabled={isRunningCommand || !ownerUid}
                className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-60"
              >
                {isRunningCommand ? 'Running...' : 'Run code'}
              </button>
            </div>
            <pre className="mt-3 text-xs bg-black text-gray-100 p-3 rounded overflow-auto min-h-28 whitespace-pre-wrap">
              {runOutput || 'Run output will appear here.'}
            </pre>
          </div>
        </div>
      </section>
    </main>
  )
}
