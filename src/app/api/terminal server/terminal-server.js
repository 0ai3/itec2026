import { WebSocketServer } from "ws";
import pty from "node-pty";
import path from "path";

const PORT = process.env.TERMINAL_WS_PORT || 3001;
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  // Extrage repoId/workdir din query params
  const url = new URL(req.url, "http://localhost");
  const workdir = url.searchParams.get("workdir") || process.cwd();

  // Alege shell-ul în funcție de platformă
  const shellCmd = process.platform === "win32" ? "powershell.exe" : "bash";
  const shellArgs = process.platform === "win32" ? ["-NoLogo"] : [];
  const shell = pty.spawn(shellCmd, shellArgs, {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: path.resolve(workdir),
    env: { ...process.env, TERM: "xterm-256color" },
  });

  shell.on("data", (data) => {
    ws.send(JSON.stringify({ type: "output", data }));
  });

  shell.on("exit", (code) => {
    ws.send(JSON.stringify({ type: "exit", code }));
    ws.close();
  });

  ws.on("message", (msg) => {
    try {
      const { input } = JSON.parse(msg.toString());
      if (input) shell.write(input); // trimite input direct la pty
    } catch {}
  });

  ws.on("close", () => shell.kill());
});

console.log(`Terminal WS server running on ws://localhost:${PORT}`);