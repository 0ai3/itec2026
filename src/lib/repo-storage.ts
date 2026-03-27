import path from 'node:path'
import fs from 'node:fs/promises'

const REPOS_ROOT = path.join(process.cwd(), '.runtime-repos')

const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_')

const normalizeRelativePath = (relativePath: string) => {
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/')).replace(/^\/+/, '')
  if (!normalized || normalized === '.') {
    return ''
  }
  if (normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error('Invalid file path')
  }
  return normalized
}

export const getRepoRootPath = (ownerUid: string, repoId: string) => {
  const safeOwner = sanitizeId(ownerUid)
  const safeRepo = sanitizeId(repoId)
  return path.join(REPOS_ROOT, safeOwner, safeRepo)
}

export const resolveRepoPath = (ownerUid: string, repoId: string, relativePath = '') => {
  const repoRoot = getRepoRootPath(ownerUid, repoId)
  const safeRelative = normalizeRelativePath(relativePath)
  const targetPath = path.join(repoRoot, safeRelative)
  if (!targetPath.startsWith(repoRoot)) {
    throw new Error('Invalid file path')
  }
  return { repoRoot, safeRelative, targetPath }
}

export const ensureRepoRoot = async (ownerUid: string, repoId: string) => {
  const repoRoot = getRepoRootPath(ownerUid, repoId)
  await fs.mkdir(repoRoot, { recursive: true })
  return repoRoot
}

export type RepoFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: RepoFileNode[]
}

export const buildRepoTree = async (repoRoot: string, baseRelative = ''): Promise<RepoFileNode[]> => {
  const currentDir = baseRelative ? path.join(repoRoot, baseRelative) : repoRoot
  let entries = await fs.readdir(currentDir, { withFileTypes: true })

  entries = entries.filter((entry) => !entry.name.startsWith('.'))

  const nodes: RepoFileNode[] = []

  for (const entry of entries) {
    const childRelative = baseRelative
      ? path.posix.join(baseRelative.replaceAll('\\', '/'), entry.name)
      : entry.name

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: childRelative,
        type: 'directory',
        children: await buildRepoTree(repoRoot, childRelative),
      })
    } else {
      nodes.push({
        name: entry.name,
        path: childRelative,
        type: 'file',
      })
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

  return nodes
}
