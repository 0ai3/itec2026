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
        docker.pull(image, (error: any, stream: any) => {
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
    let containerForCleanup: any = null; // Salvăm referința containerului pentru a-l putea opri în caz de timeout

    try {
        const body = (await req.json()) as ExecuteBody
        const ownerUid = getRequired(body.ownerUid, 'ownerUid')
        const repoId = getRequired(body.repoId, 'repoId')
        const command = getRequired(body.command, 'command')
        const image = body.image?.trim() || 'python:3.11-alpine'

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

        // Definim limita de timp: 10 secunde
        const TIMEOUT_MS = 10000;
        let isTimeout = false;

        // 1. Definim execuția propriu-zisă
        const runPromise = async () => {
            // Folosim docker.createContainer în loc de docker.run direct 
            // pentru a avea referința containerului și a-l putea "omorî"
            containerForCleanup = await docker.createContainer({
                Image: image,
                Cmd: ['sh', '-lc', command],
                WorkingDir: '/workspace',
                HostConfig: {
                    AutoRemove: true,
                    Binds: [`${repoRoot}:/workspace`],
                    Memory: 256 * 1024 * 1024, // Limită RAM
                    NanoCpus: 2_000_000_000,   // Limită CPU
                },
            });

            // Atașăm stream-ul nostru
            const stream = await containerForCleanup.attach({ stream: true, stdout: true, stderr: true });
            containerForCleanup.modem.demuxStream(stream, outputStream, outputStream);

            // Pornim și așteptăm să termine
            await containerForCleanup.start();
            const result = await containerForCleanup.wait();
            return result;
        };

        // 2. Definim cronometrul (Timeout)
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                isTimeout = true;
                reject(new Error(`Timeout: Execuția a durat mai mult de ${TIMEOUT_MS / 1000} secunde și a fost oprită.`));
            }, TIMEOUT_MS);
        });

        // 3. Cursa: Care se termină prima?
        const result: any = await Promise.race([runPromise(), timeoutPromise]);

        const statusCode = result?.StatusCode ?? 0;

        return NextResponse.json({
            output: outputData.trim(),
            exitCode: statusCode,
        })
    } catch (error) {
        // Dacă eroarea vine din Timeout, trebuie să forțăm oprirea containerului
        if (error instanceof Error && error.message.includes('Timeout') && containerForCleanup) {
             try {
                 await containerForCleanup.kill(); // Omorâm procesul blocat
             } catch (killError) {
                 console.error("Nu am putut omorî containerul blocat:", killError);
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
        return NextResponse.json({ error: message, output: message }, { status }) // Am adăugat output: message pentru ca UI-ul să afișeze eroarea clar
    }
}