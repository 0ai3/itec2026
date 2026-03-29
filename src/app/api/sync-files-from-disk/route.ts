import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { upsertRepoFile, upsertRepoFolder, deleteRepoFolder } from '@/lib/repo-db-storage'

export const runtime = 'nodejs'

const SKIP_SYNC_DIRS = new Set([
  'node_modules', '.next', '.git', '.cache', 'dist', 'build', 'out', 'target', '.parcel-cache', '.vite', 'venv', '.venv', 'tmp', 'temp'
])

const getRepoWorkdirRoot = () =>
  process.env.ITEC_LOCAL_REPO_ROOT || process.env.ITEC_WORKDIR_ROOT || path.join(os.homedir(), 'itec-workdirs')

const getRepoWorkdir = (ownerUid: string, repoId: string) => {
  const explicit = process.env.ITEC_LOCAL_REPO_PATH
  if (explicit && explicit.trim()) {
    const explicitPath = path.resolve(explicit.trim())
    if (fsSync.existsSync(explicitPath) && fsSync.lstatSync(explicitPath).isDirectory()) {
      return explicitPath
    }
  }

  const root = path.resolve(getRepoWorkdirRoot())
  if (path.basename(root).toLowerCase() === repoId.toLowerCase()) {
    return root
  }

  const rootOwnerRepo = path.join(root, ownerUid, repoId)
  const rootRepo = path.join(root, repoId)

  if (fsSync.existsSync(rootOwnerRepo)) return rootOwnerRepo
  if (fsSync.existsSync(rootRepo)) return rootRepo

  return rootOwnerRepo
}

// Recursiv: scanează folderul și sincronizează în Firebase
type SyncStats = { files: number; directories: number };

async function syncDirToDb(ownerUid: string, repoId: string, dirPath: string, relPath = ''): Promise<SyncStats> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  let stats: SyncStats = { files: 0, directories: 0 }

  for (const entry of entries) {
    const entryName = entry.name
    const entryPath = path.join(dirPath, entryName)
    const entryRelPath = relPath ? `${relPath}/${entryName}` : entryName

    if (entry.isDirectory()) {
      if (SKIP_SYNC_DIRS.has(entryName)) continue

      stats.directories += 1
      await upsertRepoFolder(ownerUid, repoId, entryRelPath)
      const childStats = await syncDirToDb(ownerUid, repoId, entryPath, entryRelPath)
      stats.files += childStats.files
      stats.directories += childStats.directories
      continue
    }

    if (entry.isFile()) {
      if (SKIP_SYNC_DIRS.has(entryName)) continue
      stats.files += 1
      const content = await fs.readFile(entryPath, 'utf8')
      await upsertRepoFile(ownerUid, repoId, entryRelPath, content)
    }
  }

  return stats
}

export async function POST(request: Request) {
  try {
    const { ownerUid, repoId } = await request.json()
    if (!ownerUid || !repoId) {
      return NextResponse.json({ error: 'Missing ownerUid or repoId' }, { status: 400 })
    }

    // Root local repo din mediu, altfel folosește calea persistenta din homes/itec-workdirs
    const repoDiskPath = getRepoWorkdir(ownerUid, repoId)

    // Determinăm calea cea mai relevantă (explicit, owner's repo, root-repo, tmp fallback)
    const defaultRoot = path.resolve(getRepoWorkdirRoot())
    const rootOwnerRepo = path.join(defaultRoot, ownerUid, repoId)
    const rootRepo = path.join(defaultRoot, repoId)
    const tmpRepo = path.join(os.tmpdir(), 'itec-workdirs', ownerUid, repoId)

    let repoDiskPathToUse = repoDiskPath

    if (!fsSync.existsSync(repoDiskPathToUse) || !fsSync.lstatSync(repoDiskPathToUse).isDirectory()) {
      if (fsSync.existsSync(rootOwnerRepo)) repoDiskPathToUse = rootOwnerRepo
      else if (fsSync.existsSync(rootRepo)) repoDiskPathToUse = rootRepo
      else if (fsSync.existsSync(tmpRepo)) repoDiskPathToUse = tmpRepo
    }

    await fs.mkdir(repoDiskPathToUse, { recursive: true })

    const entries = await fs.readdir(repoDiskPathToUse)
    if (entries.length === 0 && repoDiskPathToUse !== tmpRepo) {
      try {
        if (fsSync.existsSync(tmpRepo) && fsSync.lstatSync(tmpRepo).isDirectory()) {
          const fallbackEntries = await fs.readdir(tmpRepo)
          if (fallbackEntries.length > 0) {
            console.warn('Using fallback temp workdir for sync:', tmpRepo)
            repoDiskPathToUse = tmpRepo
          }
        }
      } catch {
        // fallback absent
      }
    }

    await fs.mkdir(repoDiskPathToUse, { recursive: true })

    // Curățăm intrările vechi generate din directoare ignorate
    for (const skip of SKIP_SYNC_DIRS) {
      await deleteRepoFolder(ownerUid, repoId, skip)
    }

    const stats = await syncDirToDb(ownerUid, repoId, repoDiskPathToUse)
    return NextResponse.json({
      ok: true,
      repoDiskPath: repoDiskPathToUse,
      scannedFiles: stats.files,
      scannedDirectories: stats.directories,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
