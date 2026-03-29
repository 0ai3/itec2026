import { WebSocketServer } from "ws";
import pty from "node-pty";
import path from "path";
import fs from "fs";
import os from "os";

const PORT = process.env.TERMINAL_WS_PORT || 3001;
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const ownerUid = url.searchParams.get("ownerUid");
  const repoId = url.searchParams.get("repoId");
  const getRepoWorkdirRoot = () =>
    process.env.ITEC_LOCAL_REPO_ROOT || process.env.ITEC_WORKDIR_ROOT || path.join(os.homedir(), "itec-workdirs")

  const getRepoWorkdir = (ownerUid, repoId) => {
    const explicit = process.env.ITEC_LOCAL_REPO_PATH
    if (explicit && explicit.trim()) {
      return path.resolve(explicit.trim())
    }

    const root = path.resolve(getRepoWorkdirRoot())
    if (path.basename(root).toLowerCase() === repoId?.toLowerCase()) {
      return root
    }

    const rootOwnerRepo = path.join(root, ownerUid, repoId)
    const rootRepo = path.join(root, repoId)

    if (fs.existsSync(rootOwnerRepo)) return rootOwnerRepo
    if (fs.existsSync(rootRepo)) return rootRepo

    return rootOwnerRepo
  }

  let workdir;

  if (ownerUid && repoId) {
    workdir = getRepoWorkdir(ownerUid, repoId);
  } else {
    workdir = url.searchParams.get("workdir") || process.cwd();
  }

  // Asigură directorul de lucru existent (izolare, fallback)
  try {
    fs.mkdirSync(workdir, { recursive: true });
  } catch (err) {
    console.error("Unable to create terminal workdir", err);
  }

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