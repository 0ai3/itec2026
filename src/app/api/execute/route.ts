import Docker from 'dockerode'
import { NextResponse } from 'next/server'
import { Writable } from 'stream';

const docker = new Docker();

export async function POST(req: Request) {
    try {
        const { code } = await req.json();

        let outputData = '';
        const outputStream = new Writable({
            write(chunk, enc, next) {
                outputData += chunk.toString();
                next();
            }
        });

        const [result, container] = await docker.run(
            'python:3.9-alpine',
            ['python', '-c', code],
            outputStream,{
            HostConfig: {
                AutoRemove: true,
                Memory:  50 * 1024 * 1024,
                NanoCpus: 1000000000,
            }
        }
        );

        const logs = await container.logs({stdout:true, stderr: true});

        return NextResponse.json({
            output: outputData.trim()
        });
    }
    catch (error: any) {
        console.error(error);
        return NextResponse.json({error: 'a crapat executia'}, {status: 500});
    }
} 