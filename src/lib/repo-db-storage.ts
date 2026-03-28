import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { getServerFirestore } from '@/lib/server-firestore'

export type RepoFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: RepoFileNode[]
}

type RepoEntry = {
  path: string
  type: 'file' | 'directory'
  content?: string
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

const filesCollection = (ownerUid: string, repoId: string) => {
  const db = getServerFirestore()
  return collection(db, 'users', ownerUid, 'repos', repoId, 'files')
}

const fileDoc = (ownerUid: string, repoId: string, relativePath: string) => {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) {
    throw new Error('Invalid file path')
  }

  const docId = encodeURIComponent(normalized)
  return doc(filesCollection(ownerUid, repoId), docId)
}

export const listRepoEntries = async (ownerUid: string, repoId: string): Promise<RepoEntry[]> => {
  const snapshot = await getDocs(filesCollection(ownerUid, repoId))
  return snapshot.docs
    .map((entryDoc) => {
      const data = entryDoc.data() as { path?: string; type?: 'file' | 'directory'; content?: string }
      if (!data.path || (data.type !== 'file' && data.type !== 'directory')) {
        return null
      }
      return {
        path: normalizeRelativePath(data.path),
        type: data.type,
        content: data.content,
      }
    })
    .filter((entry): entry is RepoEntry => Boolean(entry))
}

export const getRepoFileContent = async (ownerUid: string, repoId: string, filePath: string) => {
  const fileRef = fileDoc(ownerUid, repoId, filePath)
  const snapshot = await getDoc(fileRef)
  if (!snapshot.exists()) {
    throw new Error(`File not found: ${filePath}`)
  }

  const data = snapshot.data() as { type?: 'file' | 'directory'; content?: string }
  if (data.type !== 'file') {
    throw new Error('Path is not a file')
  }

  return data.content ?? ''
}

export const upsertRepoFile = async (
  ownerUid: string,
  repoId: string,
  filePath: string,
  content: string
) => {
  const normalizedPath = normalizeRelativePath(filePath)
  const fileRef = fileDoc(ownerUid, repoId, normalizedPath)
  await setDoc(
    fileRef,
    {
      path: normalizedPath,
      type: 'file',
      content,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

export const upsertRepoFolder = async (ownerUid: string, repoId: string, folderPath: string) => {
  const normalizedPath = normalizeRelativePath(folderPath)
  const folderRef = fileDoc(ownerUid, repoId, normalizedPath)
  await setDoc(
    folderRef,
    {
      path: normalizedPath,
      type: 'directory',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

export const deleteRepoFile = async (ownerUid: string, repoId: string, filePath: string) => {
  const fileRef = fileDoc(ownerUid, repoId, filePath)
  await deleteDoc(fileRef)
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

  const db = getServerFirestore()
  const batch = writeBatch(db)
  for (const entry of toDelete) {
    batch.delete(fileDoc(ownerUid, repoId, entry.path))
  }
  await batch.commit()
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
