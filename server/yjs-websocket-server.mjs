import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import * as websocketUtils from 'y-websocket-legacy/bin/utils'

const setupWSConnection =
	websocketUtils.setupWSConnection ?? websocketUtils.default?.setupWSConnection

if (!setupWSConnection) {
	throw new Error('Could not load setupWSConnection from y-websocket-legacy/bin/utils')
}

const host = process.env.YJS_HOST ?? '0.0.0.0'
const port = Number(process.env.YJS_PORT ?? 1234)

const server = createServer((_, response) => {
	response.writeHead(200, { 'Content-Type': 'application/json' })
	response.end(JSON.stringify({ ok: true, service: 'yjs-websocket-server' }))
})

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws, request) => {
	setupWSConnection(ws, request)
})

server.on('upgrade', (request, socket, head) => {
	wss.handleUpgrade(request, socket, head, (ws) => {
		wss.emit('connection', ws, request)
	})
})

server.listen(port, host, () => {
	console.log(`Yjs WebSocket server running at ws://${host}:${port}`)
})
