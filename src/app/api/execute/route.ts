import Docker from 'dockerode'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { NextResponse } from 'next/server'
import { ensureRepoInitialized, listRepoEntries } from '@/lib/repo-db-storage'
import { ESLint } from 'eslint'
// @ts-expect-error - plugin package does not provide default export typings
import pluginSecurity from 'eslint-plugin-security'

export const runtime = 'nodejs'

const docker = new Docker()

type ExecuteBody = {
    ownerUid?: string
    repoId?: string
    command?: string
    image?: string
    stdin?: string
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
        // Imaginea nu există, continuăm cu descărcarea
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
            (error) => (error ? reject(error) : resolve()),
            () => {}
        )
    })
}

const buildShellCommand = (command: string, stdin: string) => {
    if (!stdin) return command
    const delimiter = '__COPILOT_STDIN__'
    return `cat <<'${delimiter}' | ${command}\n${stdin}\n${delimiter}`
}

const withRuntimePath = (image: string, command: string) => {
    const lower = image.toLowerCase()
    if (lower.startsWith('rust:') || lower.includes('/rust:')) {
        return `export PATH=/usr/local/cargo/bin:$PATH; ${command}`
    }

    return command
}

const writeWorkspaceFromDb = async (ownerUid: string, repoId: string) => {
    await ensureRepoInitialized(ownerUid, repoId)
    const entries = await listRepoEntries(ownerUid, repoId)

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'itec-repo-'))

    for (const entry of entries) {
        const targetPath = path.join(tempRoot, entry.path)
        if (entry.type === 'directory') {
            await fs.mkdir(targetPath, { recursive: true })
            continue
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.writeFile(targetPath, entry.content ?? '', 'utf8')
    }

    return tempRoot
}

async function scanJavaScriptCode(code: string) {
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            plugins: { security: pluginSecurity },
            languageOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
            },
            rules: {
                'no-eval': 'error',
                'no-implied-eval': 'error',
                'security/detect-eval-with-expression': 'error',
                'security/detect-child-process': 'error', // Fără execuții de terminal
                'security/detect-non-literal-fs-filename': 'error', // Fără citire de fișiere de sistem sensibile
                'no-restricted-imports': ['error', 'child_process', 'node:child_process', 'fs', 'node:fs']
            },
        }],
    });

    const results = await eslint.lintText(code);
    
    // Extragem doar erorile (ignorăm warning-urile)
    const errors = results[0]?.messages.filter(msg => msg.severity === 2) || [];
    
    if (errors.length > 0) {
        // Formăm un mesaj frumos cu toate problemele găsite
        const errorMessages = errors.map(e => `Linia ${e.line}: ${e.message}`).join('\n');
        return errorMessages;
    }
    
    return null; // Null înseamnă că e "Curat", putem rula!
}

export async function POST(req: Request) {
    let containerForCleanup: Docker.Container | null = null
    let timeoutId: NodeJS.Timeout | undefined // Adăugat pentru a preveni memory leaks
    let tempRepoRoot: string | null = null

    try {
        const body = (await req.json()) as ExecuteBody
        const ownerUid = getRequired(body.ownerUid, 'ownerUid')
        const repoId = getRequired(body.repoId, 'repoId')
        const command = getRequired(body.command, 'command')
        const image = body.image?.trim() || 'python:3.11-alpine'
        const stdin = typeof body.stdin === 'string' ? body.stdin : ''

        await ensureDockerAvailable()
        await pullImageIfMissing(image)
        tempRepoRoot = await writeWorkspaceFromDb(ownerUid, repoId)
// Scanăm doar dacă e vorba de Node sau Deno (JavaScript/TypeScript)
        if (image.includes('node') || image.includes('deno')) {
// Extragem numele fișierului din comanda "node fisier.js"
         const filePathMatch = command.match(/["']?([^"']+\.(?:js|ts|jsx|tsx))["']?$/i);

         if (filePathMatch) {
            // Acum folosim tempRepoRoot pe care tocmai l-ai generat mai sus!
            const fullPath = path.join(tempRepoRoot, filePathMatch[1])

            try{
                const codeToScan = await fs.readFile(fullPath, 'utf8');
                const securityAlerts = await scanJavaScriptCode(codeToScan);

                if(securityAlerts) {
                    // Oprim execuția și returnăm cod 403 (Forbidden)
                    return NextResponse.json({
                        error: "Executie blocata din motive de securitate!",
                        output: `Alerta de securitate:\n\n${securityAlerts}`
                    }, {status: 403});
                }
            }catch(e){
                console.log("Nu am putut citi fisierul pt scanare", e);
            }
         }
        }

        let outputData = ''
        const outputStream = new Writable({
            write(chunk, _encoding, next) {
                outputData += chunk.toString()
                next()
            },
        })

        const wrappedCommand = withRuntimePath(image, buildShellCommand(command, stdin))
        const TIMEOUT_MS = 30_000

        const runPromise = async () => {
            containerForCleanup = await docker.createContainer({
                Image: image,
                Cmd: ['sh', '-lc', wrappedCommand],
                WorkingDir: '/workspace',
                HostConfig: {
                    AutoRemove: false,
                    Binds: [`${tempRepoRoot}:/workspace`],
                    Memory: 256 * 1024 * 1024,
                    NanoCpus: 2_000_000_000,
                },
            })

            const stream = await containerForCleanup.attach({ stream: true, stdout: true, stderr: true })
            containerForCleanup.modem.demuxStream(stream, outputStream, outputStream)

            await containerForCleanup.start()
            return containerForCleanup.wait()
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Timeout: execution exceeded ${TIMEOUT_MS / 1000} seconds and was stopped.`))
            }, TIMEOUT_MS)
        })

        const result = (await Promise.race([runPromise(), timeoutPromise])) as {
            StatusCode?: number
        }

        // Optimizare: Oprim timer-ul dacă execuția s-a terminat cu succes (eliberăm Event Loop-ul)
        if (timeoutId) clearTimeout(timeoutId)

        const statusCode = result?.StatusCode ?? 0

        return NextResponse.json({
            output: outputData.trim(),
            exitCode: statusCode,
        })
    } catch (error) {
        // Curățăm timer-ul și în caz de eroare
        if (timeoutId) clearTimeout(timeoutId)

        if (error instanceof Error && error.message.includes('Timeout') && containerForCleanup) {
            try {
                await (containerForCleanup as Docker.Container).kill()
            } catch {
                // Ignorăm eroarea dacă a fost deja distrus
            }
        }

        const message = error instanceof Error ? error.message : 'Execution failed'
        const status =
            message.includes('Missing ownerUid') ||
            message.includes('Missing repoId') ||
            message.includes('Missing command')
                ? 400
                : message.includes('Docker is not available')
                  ? 503
                  : 500
                  
        return NextResponse.json({ error: message, output: message }, { status })
    } finally {
        if (containerForCleanup) {
            try {
                await (containerForCleanup as Docker.Container).remove({ force: true })
            } catch {
            }
        }

        if (tempRepoRoot) {
            try {
                await fs.rm(tempRepoRoot, { recursive: true, force: true })
            } catch {
            }
        }
    }
}