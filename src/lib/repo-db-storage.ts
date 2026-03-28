import { get, ref, remove, set, update } from 'firebase/database'
import { getServerRealtimeDb } from '@/lib/server-realtime-db'

export type RepoFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: RepoFileNode[]
}

export type RepoAiRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

type RepoEntry = {
  path: string
  type: 'file' | 'directory'
  content?: string
  aiRanges?: RepoAiRange[]
}

const normalizeAiRanges = (value: unknown): RepoAiRange[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      const range = entry as {
        startLineNumber?: unknown
        startColumn?: unknown
        endLineNumber?: unknown
        endColumn?: unknown
      }
      const start = Number(range.startLineNumber)
      const startCol = Number(range.startColumn)
      const end = Number(range.endLineNumber)
      const endCol = Number(range.endColumn)
      if (!Number.isFinite(start) || !Number.isFinite(startCol) || !Number.isFinite(end) || !Number.isFinite(endCol)) {
        return null
      }

      const startLineNumber = Math.max(1, Math.floor(start))
      const startColumn = Math.max(1, Math.floor(startCol))
      const endLineNumber = Math.max(startLineNumber, Math.floor(end))
      const endColumn =
        endLineNumber === startLineNumber
          ? Math.max(startColumn, Math.floor(endCol))
          : Math.max(1, Math.floor(endCol))
      return { startLineNumber, startColumn, endLineNumber, endColumn }
    })
    .filter((range): range is RepoAiRange => Boolean(range))
}

const normalizeRelativePath = (relativePath: string) => {
  const normalized = relativePath
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/')

  if (!normalized) {
    return ''
  }

  if (normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error('Invalid file path')
  }

  return normalized
}

const toEntryKey = (relativePath: string) => {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) {
    throw new Error('Invalid file path')
  }
  return Buffer.from(normalized, 'utf8').toString('base64url')
}

const filesRootPath = (ownerUid: string, repoId: string) =>
  `users/${ownerUid}/repos/${repoId}/files`

const filesRootRef = (ownerUid: string, repoId: string) => {
  const db = getServerRealtimeDb()
  return ref(db, filesRootPath(ownerUid, repoId))
}

const fileRef = (ownerUid: string, repoId: string, relativePath: string) => {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) {
    throw new Error('Invalid file path')
  }

  const entryId = toEntryKey(normalized)
  const db = getServerRealtimeDb()
  return ref(db, `${filesRootPath(ownerUid, repoId)}/${entryId}`)
}

export const listRepoEntries = async (ownerUid: string, repoId: string): Promise<RepoEntry[]> => {
  const snapshot = await get(filesRootRef(ownerUid, repoId))
  if (!snapshot.exists()) {
    return []
  }

  const entries = snapshot.val() as Record<
    string,
    { path?: string; type?: 'file' | 'directory'; content?: string; aiRanges?: unknown }
  >
  return Object.values(entries)
    .map((data): RepoEntry | null => {
      if (!data.path || (data.type !== 'file' && data.type !== 'directory')) {
        return null
      }
      return {
        path: normalizeRelativePath(data.path),
        type: data.type,
        content: data.content,
        aiRanges: normalizeAiRanges(data.aiRanges),
      }
    })
    .filter((entry): entry is RepoEntry => Boolean(entry))
}

export const getRepoFileData = async (ownerUid: string, repoId: string, filePath: string) => {
  const targetFileRef = fileRef(ownerUid, repoId, filePath)
  const snapshot = await get(targetFileRef)
  if (!snapshot.exists()) {
    throw new Error(`File not found: ${filePath}`)
  }

  const data = snapshot.val() as { type?: 'file' | 'directory'; content?: string; aiRanges?: unknown }
  if (data.type !== 'file') {
    throw new Error('Path is not a file')
  }

  return {
    content: data.content ?? '',
    aiRanges: normalizeAiRanges(data.aiRanges),
  }
}

export const upsertRepoFile = async (
  ownerUid: string,
  repoId: string,
  filePath: string,
  content: string,
  aiRanges: RepoAiRange[] = []
) => {
  const normalizedPath = normalizeRelativePath(filePath)
  const targetFileRef = fileRef(ownerUid, repoId, normalizedPath)
  await set(targetFileRef, {
      path: normalizedPath,
      type: 'file',
      content,
      aiRanges: normalizeAiRanges(aiRanges),
      updatedAt: Date.now(),
    })
}

export const upsertRepoFolder = async (ownerUid: string, repoId: string, folderPath: string) => {
  const normalizedPath = normalizeRelativePath(folderPath)
  const targetFolderRef = fileRef(ownerUid, repoId, normalizedPath)
  await set(targetFolderRef, {
      path: normalizedPath,
      type: 'directory',
      updatedAt: Date.now(),
    })
}

export const deleteRepoFile = async (ownerUid: string, repoId: string, filePath: string) => {
  const targetFileRef = fileRef(ownerUid, repoId, filePath)
  await remove(targetFileRef)
}

export const deleteRepoFolder = async (ownerUid: string, repoId: string, folderPath: string) => {
  const normalizedFolder = normalizeRelativePath(folderPath)
  const entries = await listRepoEntries(ownerUid, repoId)
  const toDelete = entries.filter(
    (entry) => entry.path === normalizedFolder || entry.path.startsWith(`${normalizedFolder}/`)
  )

  if (toDelete.length === 0) {
    return
  }

  const patch: Record<string, null> = {}
  for (const entry of toDelete) {
    patch[toEntryKey(entry.path)] = null
  }

  await update(filesRootRef(ownerUid, repoId), patch)
}

export const ensureRepoInitialized = async (ownerUid: string, repoId: string) => {
  const entries = await listRepoEntries(ownerUid, repoId)
  if (entries.length > 0) {
    return entries
  }

  await Promise.all([
    upsertRepoFile(ownerUid, repoId, 'README.md', `# ${repoId}\n\nRepository initialized.\n`),
    upsertRepoFile(ownerUid, repoId, 'main.py', 'print("Hello from iTECify")\n'),
  ])

  return listRepoEntries(ownerUid, repoId)
}

export const buildRepoTreeFromEntries = (entries: RepoEntry[]): RepoFileNode[] => {
  type InternalNode = RepoFileNode & { childrenMap?: Map<string, InternalNode> }

  const root: InternalNode = {
    name: '',
    path: '',
    type: 'directory',
    children: [],
    childrenMap: new Map<string, InternalNode>(),
  }

  const ensureDir = (dirPath: string): InternalNode => {
    if (!dirPath) {
      return root
    }

    const parts = dirPath.split('/')
    let cursor = root
    let currentPath = ''

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const existing = cursor.childrenMap?.get(part)
      if (existing) {
        cursor = existing
        continue
      }

      const nextDir: InternalNode = {
        name: part,
        path: currentPath,
        type: 'directory',
        children: [],
        childrenMap: new Map<string, InternalNode>(),
      }
      cursor.children?.push(nextDir)
      cursor.childrenMap?.set(part, nextDir)
      cursor = nextDir
    }

    return cursor
  }

  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))

  for (const entry of sorted) {
    if (!entry.path) {
      continue
    }

    const parts = entry.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const parent = ensureDir(parentPath)

    if (entry.type === 'directory') {
      ensureDir(entry.path)
      continue
    }

    const existing = parent.children?.find((child) => child.path === entry.path)
    if (!existing) {
      parent.children?.push({
        name,
        path: entry.path,
        type: 'file',
      })
    }
  }

  const sortNodes = (nodes: RepoFileNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const node of nodes) {
      if (node.type === 'directory' && node.children) {
        sortNodes(node.children)
      }
    }
  }

  sortNodes(root.children ?? [])
  return root.children ?? []
}
