import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { upsertRepoFile, upsertRepoFolder, deleteRepoFolder } from '@/lib/repo-db-storage'

export const runtime = 'nodejs'

const SKIP_SYNC_DIRS = new Set([
  'node_modules', '.next', '.git', '.cache', 'dist', 'build', 'out', 'target', '.parcel-cache', '.vite', 'venv', '.venv', 'tmp', 'temp'
])

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

    // Folosim exact același workdir pe care rulează terminalul (%TEMP%/itec-workdirs)
    const repoDiskPath = path.join(os.tmpdir(), 'itec-workdirs', ownerUid, repoId)
    await fs.mkdir(repoDiskPath, { recursive: true })

    // Curățăm intrările vechi generate din directoare ignorate
    for (const skip of SKIP_SYNC_DIRS) {
      await deleteRepoFolder(ownerUid, repoId, skip)
    }

    const stats = await syncDirToDb(ownerUid, repoId, repoDiskPath)
    return NextResponse.json({
      ok: true,
      repoDiskPath,
      scannedFiles: stats.files,
      scannedDirectories: stats.directories,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
