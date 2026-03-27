import Docker from 'dockerode'
import { Writable } from 'node:stream'
import { NextResponse } from 'next/server'
import { ensureRepoRoot, getRepoRootPath } from '@/lib/repo-storage'

export const runtime = 'nodejs'

const docker = new Docker()

type ExecuteBody = {
    ownerUid?: string
    repoId?: string
    command?: string
    image?: string
}

const isNodeCommand = (command: string) => /^(npm|npx|pnpm|yarn|node)\b/.test(command)
const isPythonCommand = (command: string) => /^(python|python3|pip|pip3)\b/.test(command)

const resolveImage = (imageValue: string | undefined, commandValue: string) => {
    const trimmedImage = imageValue?.trim()
    if (trimmedImage) {
        return trimmedImage
    }

    if (isNodeCommand(commandValue)) {
        return 'node:20-alpine'
    }

    if (isPythonCommand(commandValue)) {
        return 'python:3.11-alpine'
    }

    return 'alpine:3.20'
}

const getRequired = (value: string | undefined, name: string) => {
    if (!value || !value.trim()) {
        throw new Error(`Missing ${name}`)
    }
    return value.trim()
}

const ensureDockerAvailable = async () => {
    try {
        await docker.ping()
    } catch (error) {
        const details = error instanceof Error ? error.message : 'Docker daemon not reachable'
        throw new Error(
            `Docker is not available. Start Docker Desktop (or Docker daemon) and retry. Details: ${details}`
        )
    }
}

const pullImageIfMissing = async (image: string) => {
    try {
        await docker.getImage(image).inspect()
        return
    } catch {
    }

    const pullStream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
        docker.pull(image, (error: Error | null, stream: NodeJS.ReadableStream | undefined) => {
            if (error || !stream) {
                reject(error ?? new Error('Unable to pull image'))
                return
            }
            resolve(stream)
        })
    })

    await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(
            pullStream,
            (error) => {
                if (error) {
                    reject(error)
                    return
                }
                resolve()
            },
            () => {
            }
        )
    })
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as ExecuteBody
        const ownerUid = getRequired(body.ownerUid, 'ownerUid')
        const repoId = getRequired(body.repoId, 'repoId')
        const command = getRequired(body.command, 'command')
        const image = resolveImage(body.image, command)

        await ensureDockerAvailable()
        await pullImageIfMissing(image)

        await ensureRepoRoot(ownerUid, repoId)
        const repoRoot = getRepoRootPath(ownerUid, repoId)

        let outputData = ''
        const outputStream = new Writable({
            write(chunk, _encoding, next) {
                outputData += chunk.toString()
                next()
            },
        })

        const [result] = await docker.run(
            image,
            ['sh', '-lc', command],
            outputStream,
            {
                WorkingDir: '/workspace',
                HostConfig: {
                    AutoRemove: true,
                    Binds: [`${repoRoot}:/workspace`],
                    Memory: 256 * 1024 * 1024,
                    NanoCpus: 2_000_000_000,
                },
            }
        )

        const statusCode = (result as { StatusCode?: number }).StatusCode ?? 0

        return NextResponse.json({
            output: outputData.trim(),
            exitCode: statusCode,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Execution failed'
        const status =
            message.includes('Missing ownerUid') ||
            message.includes('Missing repoId') ||
            message.includes('Missing command')
                ? 400
                : message.includes('Docker is not available')
                    ? 503
                    : 500
        return NextResponse.json({ error: message }, { status })
    }
}