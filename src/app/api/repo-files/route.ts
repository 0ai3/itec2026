import { NextResponse } from 'next/server'
import {
  buildRepoTreeFromEntries,
  deleteRepoFile,
  deleteRepoFolder,
  ensureRepoInitialized,
  getRepoFileContent,
  listRepoEntries,
  upsertRepoFile,
  upsertRepoFolder,
} from '@/lib/repo-db-storage'

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

    await ensureRepoInitialized(ownerUid, repoId)

    if (filePath) {
      const content = await getRepoFileContent(ownerUid, repoId, filePath)
      return NextResponse.json({ filePath, content })
    }

    const entries = await listRepoEntries(ownerUid, repoId)
    const tree = buildRepoTreeFromEntries(entries)
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

    if (action === 'init') {
      const entries = await ensureRepoInitialized(ownerUid, repoId)
      const tree = buildRepoTreeFromEntries(entries)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'save') {
      const filePath = getParam(body.filePath?.trim() ?? null, 'filePath')
      await upsertRepoFile(ownerUid, repoId, filePath, body.content ?? '')
      return NextResponse.json({ ok: true })
    }

    if (action === 'create-file') {
      const filePath = getParam(body.filePath?.trim() ?? null, 'filePath')
      await upsertRepoFile(ownerUid, repoId, filePath, body.content ?? '')
      const entries = await listRepoEntries(ownerUid, repoId)
      const tree = buildRepoTreeFromEntries(entries)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'create-folder') {
      const folderPath = getParam(body.folderPath?.trim() ?? null, 'folderPath')
      await upsertRepoFolder(ownerUid, repoId, folderPath)
      const entries = await listRepoEntries(ownerUid, repoId)
      const tree = buildRepoTreeFromEntries(entries)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'delete-file') {
      const filePath = getParam(body.filePath?.trim() ?? null, 'filePath')
      await deleteRepoFile(ownerUid, repoId, filePath)
      const entries = await listRepoEntries(ownerUid, repoId)
      const tree = buildRepoTreeFromEntries(entries)
      return NextResponse.json({ ok: true, tree })
    }

    if (action === 'delete-folder') {
      const folderPath = getParam(body.folderPath?.trim() ?? null, 'folderPath')
      await deleteRepoFolder(ownerUid, repoId, folderPath)
      const entries = await listRepoEntries(ownerUid, repoId)
      const tree = buildRepoTreeFromEntries(entries)
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
