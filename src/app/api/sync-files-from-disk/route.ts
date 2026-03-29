import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { upsertRepoFile, upsertRepoFolder } from '@/lib/repo-db-storage'

export const runtime = 'nodejs'

// Recursiv: scanează folderul și sincronizează în Firebase
async function syncDirToDb(ownerUid: string, repoId: string, dirPath: string, relPath = '') {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await upsertRepoFolder(ownerUid, repoId, entryRelPath)
      await syncDirToDb(ownerUid, repoId, entryPath, entryRelPath)
    } else if (entry.isFile()) {
      const content = await fs.readFile(entryPath, 'utf8')
      await upsertRepoFile(ownerUid, repoId, entryRelPath, content)
    }
  }
}

export async function POST(request: Request) {
  try {
    const { ownerUid, repoId, repoDiskPath } = await request.json()
    if (!ownerUid || !repoId || !repoDiskPath) {
      return NextResponse.json({ error: 'Missing ownerUid, repoId, or repoDiskPath' }, { status: 400 })
    }
    await syncDirToDb(ownerUid, repoId, repoDiskPath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
