import Docker from 'dockerode'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { NextResponse } from 'next/server'
import { ensureRepoInitialized, listRepoEntries, upsertRepoFile } from '@/lib/repo-db-storage'
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
    useWorkdir?: boolean
}

const getRequired = (value: string | undefined, name: string) => {
    if (!value || !value.trim()) throw new Error(`Missing ${name}`)
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
        // Imaginea nu există, o descărcăm
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
    if (lower.startsWith('golang:') || lower.includes('/golang:')) {
        return `export PATH=/usr/local/go/bin:$PATH; ${command}`
    }
    return command
}

// ─── Workdir persistent per repo ────────────────────────────────────────────
//
// În loc să folosim /tmp (care e șters după fiecare run), păstrăm un director
// stabil per repo: <os.tmpdir()>/itec-workdirs/<ownerUid>/<repoId>/
// Astfel npm install scrie node_modules acolo și persistă între rulări.
//
const getRepoWorkdir = (ownerUid: string, repoId: string) =>
    path.join(os.tmpdir(), 'itec-workdirs', ownerUid, repoId)

// Sincronizează fișierele din DB în workdir-ul persistent.
// Suprascrie doar fișierele de cod, NU atinge node_modules / .venv / target etc.
const SKIP_SYNC_DIRS = new Set([
    'node_modules',
    '.venv',
    'venv',
    '__pycache__',
    'target',      // Rust
    '.gradle',
    'dist',
    'build',
    '.next',
])

const syncDbToWorkdir = async (ownerUid: string, repoId: string, workdir: string) => {
    await ensureRepoInitialized(ownerUid, repoId)
    const entries = await listRepoEntries(ownerUid, repoId)

    await fs.mkdir(workdir, { recursive: true })

    for (const entry of entries) {
        // Sare peste directoarele generate (node_modules etc.)
        const topLevel = entry.path.split('/')[0]
        if (topLevel && SKIP_SYNC_DIRS.has(topLevel)) continue

        const targetPath = path.join(workdir, entry.path)

        if (entry.type === 'directory') {
            await fs.mkdir(targetPath, { recursive: true })
            continue
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.writeFile(targetPath, entry.content ?? '', 'utf8')
    }
}

// După rularea unor comenzi care modifică fișierele (npm install generează
// package-lock.json, pip freeze etc.), sincronizăm înapoi în DB fișierele
// relevante (excludem node_modules).
const SYNC_BACK_EXTENSIONS = new Set([
    '.json',        // package.json, package-lock.json, tsconfig etc.
    '.lock',        // yarn.lock, Cargo.lock, Pipfile.lock
    '.toml',        // Cargo.toml, pyproject.toml
    '.txt',         // requirements.txt
    '.mod',         // go.mod
    '.sum',         // go.sum
    '.yaml', '.yml',
])

const shouldSyncBackFile = (filePath: string): boolean => {
    const topLevel = filePath.split('/')[0]
    if (topLevel && SKIP_SYNC_DIRS.has(topLevel)) return false
    const ext = path.extname(filePath).toLowerCase()
    return SYNC_BACK_EXTENSIONS.has(ext)
}

const syncWorkdirToDb = async (ownerUid: string, repoId: string, workdir: string) => {
    const walk = async (dir: string, base: string): Promise<void> => {
        let entries: string[]
        try {
            entries = await fs.readdir(dir)
        } catch {
            return
        }

        for (const name of entries) {
            if (SKIP_SYNC_DIRS.has(name)) continue

            const fullPath = path.join(dir, name)
            const relPath = path.relative(base, fullPath)

            let stat: Awaited<ReturnType<typeof fs.stat>>
            try {
                stat = await fs.stat(fullPath)
            } catch {
                continue
            }

            if (stat.isDirectory()) {
                await walk(fullPath, base)
            } else if (shouldSyncBackFile(relPath)) {
                try {
                    const content = await fs.readFile(fullPath, 'utf8')
                    await upsertRepoFile(ownerUid, repoId, relPath, content, [], {
                        createVersion: false,
                    })
                } catch {
                    // Ignorăm fișierele binare sau cele inaccesibile
                }
            }
        }
    }

    await walk(workdir, workdir)
}

// ─── Comenzi care modifică starea repo-ului (necesită sync-back) ────────────
const isStateChangingCommand = (command: string) =>
    /^(npm|npx|pnpm|yarn)\s+(install|i|add|remove|uninstall|update|init)\b/.test(command) ||
    /^(pip|pip3)\s+(install|uninstall|freeze)\b/.test(command) ||
    /^(cargo)\s+(add|install|build|fetch)\b/.test(command) ||
    /^(go)\s+(get|mod|tidy|download)\b/.test(command)

// ─── SAST ────────────────────────────────────────────────────────────────────
async function scanJavaScriptCode(code: string) {
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            plugins: { security: pluginSecurity },
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            rules: {
                'no-eval': 'error',
                'no-implied-eval': 'error',
                'security/detect-eval-with-expression': 'error',
                'security/detect-child-process': 'error',
                'security/detect-non-literal-fs-filename': 'error',
                'no-restricted-imports': ['error', 'child_process', 'node:child_process', 'fs', 'node:fs'],
            },
        }],
    })

    const results = await eslint.lintText(code)
    const errors = results[0]?.messages.filter(msg => msg.severity === 2) ?? []

    if (errors.length > 0) {
        const errorMessages = errors.map(e => `Linia ${e.line}: ${e.message}`).join('\n')
        return errorMessages
    }

    return null
}

// ─── Handler principal ───────────────────────────────────────────────────────
export async function POST(req: Request) {
    let containerForCleanup: Docker.Container | null = null
    let timeoutId: NodeJS.Timeout | undefined

    try {
        const body = (await req.json()) as ExecuteBody
        const ownerUid = getRequired(body.ownerUid, 'ownerUid')
        const repoId = getRequired(body.repoId, 'repoId')
        const command = getRequired(body.command, 'command')
        const image = body.image?.trim() || 'python:3.11-alpine'
        const stdin = typeof body.stdin === 'string' ? body.stdin : ''

        await ensureDockerAvailable()
        await pullImageIfMissing(image)

        // ── Pregătim workdir-ul persistent ──────────────────────────────────
        const workdir = getRepoWorkdir(ownerUid, repoId)
        await syncDbToWorkdir(ownerUid, repoId, workdir)

        // ── Scanare de securitate SAST ────────────────────────────────────────
        if (image.includes('node') || image.includes('deno')) {
            const filePathMatch = command.match(/["']?([^"']+\.(?:js|ts|jsx|tsx))["']?$/i)

            if (filePathMatch) {
                const fullPath = path.join(workdir, filePathMatch[1])
                try {
                    const codeToScan = await fs.readFile(fullPath, 'utf8')
                    const securityAlerts = await scanJavaScriptCode(codeToScan)

                    if (securityAlerts) {
                        return NextResponse.json({
                            error: 'Executie blocata din motive de securitate!',
                            output: `🛡️ Alerta de securitate:\n\n${securityAlerts}`,
                        }, { status: 403 })
                    }
                } catch {
                    // Nu am putut citi fișierul pentru scanare, continuăm
                }
            }
        }

        // ── Rulăm în Docker ───────────────────────────────────────────────────
        let outputData = ''
        const outputStream = new Writable({
            write(chunk, _encoding, next) {
                outputData += chunk.toString()
                next()
            },
        })

        const wrappedCommand = withRuntimePath(image, buildShellCommand(command, stdin))
        const needsExtendedTimeout =
            /\b(apt-get|apk\s+add)\b/i.test(command) ||
            isStateChangingCommand(command)
        const TIMEOUT_MS = needsExtendedTimeout ? 120_000 : 30_000

        const runPromise = async () => {
            containerForCleanup = await docker.createContainer({
                Image: image,
                Cmd: ['sh', '-lc', wrappedCommand],
                WorkingDir: '/workspace',
                HostConfig: {
                    AutoRemove: false,
                    // ── CHEIA: montăm workdir-ul persistent, nu un folder temporar ──
                    Binds: [`${workdir}:/workspace`],
                    Memory: 256 * 1024 * 1024,
                    NanoCpus: 2_000_000_000,
                },
            })

            const stream = await containerForCleanup.attach({
                stream: true,
                stdout: true,
                stderr: true,
            })
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

        if (timeoutId) clearTimeout(timeoutId)

        const statusCode = result?.StatusCode ?? 0

        // ── Dacă comanda a modificat starea repo-ului, salvăm înapoi în DB ──
        // (ex: package-lock.json generat de npm install)
        if (isStateChangingCommand(command)) {
            try {
                await syncWorkdirToDb(ownerUid, repoId, workdir)
            } catch {
                // Sync-back eșuat — nu blocăm răspunsul
            }
        }

        return NextResponse.json({
            output: outputData.trim(),
            exitCode: statusCode,
        })
    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId)

        if (error instanceof Error && error.message.includes('Timeout') && containerForCleanup) {
            try {
                await (containerForCleanup as Docker.Container).kill()
            } catch {
                // Ignorăm
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
        // Curățăm containerul dar NU workdir-ul — acesta persistă între rulări
        if (containerForCleanup) {
            try {
                await (containerForCleanup as Docker.Container).remove({ force: true })
            } catch {
                // Ignorăm
            }
        }
    }
}