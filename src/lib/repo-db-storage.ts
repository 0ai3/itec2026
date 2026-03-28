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

export type RepoFileVersionSummary = {
  id: string
  createdAt: number
}

export type RepoFileVersionData = RepoFileVersionSummary & {
  content: string
  aiRanges: RepoAiRange[]
}

type RepoEntry = {
  path: string
  type: 'file' | 'directory'
  content?: string
  aiRanges?: RepoAiRange[]
}

const isSameOrChildPath = (parentPath: string, targetPath: string) =>
  targetPath === parentPath || targetPath.startsWith(`${parentPath}/`)

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

const fileHistoryRootPath = (ownerUid: string, repoId: string, relativePath: string) => {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) {
    throw new Error('Invalid file path')
  }

  const fileId = toEntryKey(normalized)
  return `users/${ownerUid}/repos/${repoId}/history/${fileId}`
}

const fileHistoryRootRef = (ownerUid: string, repoId: string, relativePath: string) => {
  const db = getServerRealtimeDb()
  return ref(db, fileHistoryRootPath(ownerUid, repoId, relativePath))
}

const fileHistoryVersionRef = (
  ownerUid: string,
  repoId: string,
  relativePath: string,
  versionId: string
) => {
  const db = getServerRealtimeDb()
  return ref(db, `${fileHistoryRootPath(ownerUid, repoId, relativePath)}/${versionId}`)
}

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
  aiRanges: RepoAiRange[] = [],
  options?: { createVersion?: boolean }
) => {
  const normalizedPath = normalizeRelativePath(filePath)
  const normalizedRanges = normalizeAiRanges(aiRanges)
  const targetFileRef = fileRef(ownerUid, repoId, normalizedPath)
  await set(targetFileRef, {
      path: normalizedPath,
      type: 'file',
      content,
      aiRanges: normalizedRanges,
      updatedAt: Date.now(),
    })

  if (options?.createVersion ?? true) {
    const versionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const versionRef = ref(getServerRealtimeDb(), `${fileHistoryRootPath(ownerUid, repoId, normalizedPath)}/${versionId}`)
    await set(versionRef, {
      createdAt: Date.now(),
      content,
      aiRanges: normalizedRanges,
    })
  }
}

export const listRepoFileVersions = async (
  ownerUid: string,
  repoId: string,
  filePath: string,
  limit = 100
): Promise<RepoFileVersionSummary[]> => {
  const snapshot = await get(fileHistoryRootRef(ownerUid, repoId, filePath))
  if (!snapshot.exists()) {
    return []
  }

  const versions = snapshot.val() as Record<string, { createdAt?: unknown }>
  return Object.entries(versions)
    .map(([id, value]) => ({
      id,
      createdAt: Number(value.createdAt) || 0,
    }))
    .filter((entry) => entry.createdAt > 0)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-Math.max(1, limit))
}

export const getRepoFileVersion = async (
  ownerUid: string,
  repoId: string,
  filePath: string,
  versionId: string
): Promise<RepoFileVersionData> => {
  const versionRef = ref(getServerRealtimeDb(), `${fileHistoryRootPath(ownerUid, repoId, filePath)}/${versionId}`)
  const snapshot = await get(versionRef)
  if (!snapshot.exists()) {
    throw new Error('Version not found')
  }

  const data = snapshot.val() as { createdAt?: unknown; content?: unknown; aiRanges?: unknown }
  const createdAt = Number(data.createdAt) || 0
  if (!createdAt) {
    throw new Error('Invalid version metadata')
  }

  return {
    id: versionId,
    createdAt,
    content: typeof data.content === 'string' ? data.content : '',
    aiRanges: normalizeAiRanges(data.aiRanges),
  }
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

export const moveRepoEntry = async (
  ownerUid: string,
  repoId: string,
  sourcePath: string,
  destinationPath: string
) => {
  const fromPath = normalizeRelativePath(sourcePath)
  const toPath = normalizeRelativePath(destinationPath)

  if (!fromPath || !toPath) {
    throw new Error('Invalid source or destination path')
  }

  if (fromPath === toPath) {
    throw new Error('Source and destination are the same')
  }

  const entries = await listRepoEntries(ownerUid, repoId)
  const sourceEntry = entries.find((entry) => entry.path === fromPath)
  if (!sourceEntry) {
    throw new Error('Source path not found')
  }

  if (sourceEntry.type === 'directory' && isSameOrChildPath(fromPath, toPath)) {
    throw new Error('Cannot move a folder into itself')
  }

  const destinationExists = entries.some((entry) => entry.path === toPath)
  if (destinationExists) {
    throw new Error('Destination path already exists')
  }

  if (sourceEntry.type === 'file') {
    const sourceRef = fileRef(ownerUid, repoId, fromPath)
    const sourceSnapshot = await get(sourceRef)
    if (!sourceSnapshot.exists()) {
      throw new Error('Source file not found')
    }

    const sourceData = sourceSnapshot.val() as {
      type?: 'file' | 'directory'
      content?: string
      aiRanges?: unknown
      updatedAt?: unknown
    }

    if (sourceData.type !== 'file') {
      throw new Error('Source path is not a file')
    }

    const targetRef = fileRef(ownerUid, repoId, toPath)
    await set(targetRef, {
      ...sourceData,
      path: toPath,
      type: 'file',
      aiRanges: normalizeAiRanges(sourceData.aiRanges),
      updatedAt: Date.now(),
    })
    await remove(sourceRef)

    const sourceHistorySnapshot = await get(fileHistoryRootRef(ownerUid, repoId, fromPath))
    if (sourceHistorySnapshot.exists()) {
      const versions = sourceHistorySnapshot.val() as Record<
        string,
        { createdAt?: unknown; content?: unknown; aiRanges?: unknown }
      >
      for (const [versionId, version] of Object.entries(versions)) {
        await set(fileHistoryVersionRef(ownerUid, repoId, toPath, versionId), {
          createdAt: Number(version.createdAt) || Date.now(),
          content: typeof version.content === 'string' ? version.content : '',
          aiRanges: normalizeAiRanges(version.aiRanges),
        })
      }
      await remove(fileHistoryRootRef(ownerUid, repoId, fromPath))
    }

    return
  }

  const subtree = entries.filter((entry) => isSameOrChildPath(fromPath, entry.path))
  if (!subtree.length) {
    throw new Error('Folder subtree not found')
  }

  const subtreePathSet = new Set(subtree.map((entry) => entry.path))
  for (const entry of subtree) {
    const suffix = entry.path.slice(fromPath.length)
    const nextPath = `${toPath}${suffix}`
    const collidingEntry = entries.find(
      (candidate) => candidate.path === nextPath && !subtreePathSet.has(candidate.path)
    )
    if (collidingEntry) {
      throw new Error(`Destination path already exists: ${nextPath}`)
    }
  }

  const patch: Record<string, null | { path: string; type: 'file' | 'directory'; updatedAt: number; content?: string; aiRanges?: RepoAiRange[] }> = {}
  const fileMoves: Array<{ from: string; to: string }> = []

  for (const entry of subtree) {
    const suffix = entry.path.slice(fromPath.length)
    const nextPath = `${toPath}${suffix}`

    const nextValue: {
      path: string
      type: 'file' | 'directory'
      updatedAt: number
      content?: string
      aiRanges?: RepoAiRange[]
    } = {
      path: nextPath,
      type: entry.type,
      updatedAt: Date.now(),
    }

    if (entry.type === 'file') {
      const sourceSnapshot = await get(fileRef(ownerUid, repoId, entry.path))
      if (!sourceSnapshot.exists()) {
        throw new Error(`Source file not found during move: ${entry.path}`)
      }

      const sourceData = sourceSnapshot.val() as {
        type?: 'file' | 'directory'
        content?: unknown
        aiRanges?: unknown
      }
      if (sourceData.type !== 'file') {
        throw new Error(`Source path is not a file during move: ${entry.path}`)
      }

      nextValue.content = typeof sourceData.content === 'string' ? sourceData.content : ''
      nextValue.aiRanges = normalizeAiRanges(sourceData.aiRanges)
    }

    patch[toEntryKey(nextPath)] = nextValue

    patch[toEntryKey(entry.path)] = null

    if (entry.type === 'file') {
      fileMoves.push({ from: entry.path, to: nextPath })
    }
  }

  await update(filesRootRef(ownerUid, repoId), patch)

  for (const item of fileMoves) {
    const sourceHistorySnapshot = await get(fileHistoryRootRef(ownerUid, repoId, item.from))
    if (!sourceHistorySnapshot.exists()) {
      continue
    }

    const versions = sourceHistorySnapshot.val() as Record<
      string,
      { createdAt?: unknown; content?: unknown; aiRanges?: unknown }
    >
    for (const [versionId, version] of Object.entries(versions)) {
      await set(fileHistoryVersionRef(ownerUid, repoId, item.to, versionId), {
        createdAt: Number(version.createdAt) || Date.now(),
        content: typeof version.content === 'string' ? version.content : '',
        aiRanges: normalizeAiRanges(version.aiRanges),
      })
    }
    await remove(fileHistoryRootRef(ownerUid, repoId, item.from))
  }

}

export const renameRepoEntry = async (
  ownerUid: string,
  repoId: string,
  sourcePath: string,
  newName: string
) => {
  const fromPath = normalizeRelativePath(sourcePath)
  const cleanName = newName.trim()

  if (!cleanName || cleanName.includes('/')) {
    throw new Error('Invalid new name')
  }

  const segments = fromPath.split('/')
  if (!segments.length) {
    throw new Error('Invalid source path')
  }

  const parent = segments.slice(0, -1).join('/')
  const toPath = parent ? `${parent}/${cleanName}` : cleanName
  await moveRepoEntry(ownerUid, repoId, fromPath, toPath)
  return toPath
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
        return a.type === 'file' ? -1 : 1
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
