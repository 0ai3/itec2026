import fs from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { buildRepoTree, ensureRepoRoot, resolveRepoPath } from '@/lib/repo-storage'

export const runtime = 'nodejs'

const getParam = (value: string | null, name: string) => {
  if (!value || !value.trim()) {
    throw new Error(`Missing ${name}`)
  }
  return value.trim()
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const ownerUid = getParam(searchParams.get('ownerUid'), 'ownerUid')
    const repoId = getParam(searchParams.get('repoId'), 'repoId')
    const filePath = searchParams.get('filePath')?.trim()

    const repoRoot = await ensureRepoRoot(ownerUid, repoId)

    if (filePath) {
      const { targetPath } = resolveRepoPath(ownerUid, repoId, filePath)
      const content = await fs.readFile(targetPath, 'utf8')
      return NextResponse.json({ filePath, content })
    }

    const tree = await buildRepoTree(repoRoot)
    return NextResponse.json({ tree })
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Unable to load repo files.' }, { status: 400 })
  }
}

type PostBody = {
  ownerUid?: string
  repoId?: string
  action?: 'init' | 'save' | 'create-file' | 'create-folder' | 'delete-file' | 'delete-folder'
  filePath?: string
  folderPath?: string
  content?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PostBody

    const ownerUid = getParam(body.ownerUid?.trim() ?? null, 'ownerUid')
    const repoId = getParam(body.repoId?.trim() ?? null, 'repoId')
    const action = body.action

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 })
    }

    const repoRoot = await ensureRepoRoot(ownerUid, repoId)

    if (action === 'init') {
      const readmePath = path.join(repoRoot, 'README.md')
      const mainPath = path.join(repoRoot, 'main.py')

      try {
        await fs.access(readmePath)
      } catch {
        await fs.writeFile(readmePath, `# ${repoId}\n\nRepository initialized.\n`, 'utf8')
      }

      try {
        await fs.access(mainPath)
      } catch {
        await fs.writeFile(mainPath, 'print("Hello from iTECify")\n', 'utf8')
      }

      const tree = await buildRepoTree(repoRoot)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'save') {
      const filePath = getParam(body.filePath?.trim() ?? null, 'filePath')
      const { targetPath } = resolveRepoPath(ownerUid, repoId, filePath)
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, body.content ?? '', 'utf8')
      return NextResponse.json({ ok: true })
    }

    if (action === 'create-file') {
      const filePath = getParam(body.filePath?.trim() ?? null, 'filePath')
      const { targetPath } = resolveRepoPath(ownerUid, repoId, filePath)
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, body.content ?? '', 'utf8')
      const tree = await buildRepoTree(repoRoot)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'create-folder') {
      const folderPath = getParam(body.folderPath?.trim() ?? null, 'folderPath')
      const { targetPath } = resolveRepoPath(ownerUid, repoId, folderPath)
      await fs.mkdir(targetPath, { recursive: true })
      const tree = await buildRepoTree(repoRoot)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'delete-file') {
      const filePath = getParam(body.filePath?.trim() ?? null, 'filePath')
      const { targetPath } = resolveRepoPath(ownerUid, repoId, filePath)
      await fs.rm(targetPath, { force: true })
      const tree = await buildRepoTree(repoRoot)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'delete-folder') {
      const folderPath = getParam(body.folderPath?.trim() ?? null, 'folderPath')
      const { targetPath } = resolveRepoPath(ownerUid, repoId, folderPath)
      await fs.rm(targetPath, { recursive: true, force: true })
      const tree = await buildRepoTree(repoRoot)
      return NextResponse.json({ ok: true, tree })
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Unable to update repo files.' }, { status: 400 })
  }
}
