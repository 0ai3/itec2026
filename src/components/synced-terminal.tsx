"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
// Import dinamic pentru xterm-terminal (doar client-side)
const XTermTerminal = dynamic(() => import("./xterm-terminal"), { ssr: false });
// WebSocket terminal comun
const TERMINAL_WS_URL = "ws://localhost:3001";
import { resolveYjsWsUrl } from "@/lib/yjs-ws-url";

type Yjs = typeof import("yjs");
type YWebsocket = typeof import("y-websocket");

type SyncedTerminalProps = {
  roomId: string;
  ownerUid: string | null;
  repoId: string;
  runFileCommand?: string;
  runFileImage?: string;
};

const setYTextValue = (yText: import("yjs").Text, value: string) => {
  yText.delete(0, yText.length);
  if (value) yText.insert(0, value);
};

const isNodeCommand = (command: string) =>
  /^(npm|npx|pnpm|yarn|node)\b/.test(command);
const isPythonCommand = (command: string) =>
  /^(python|python3|pip|pip3)\b/.test(command);
const isRustCommand = (command: string) => /^(rustc|cargo)\b/.test(command);

const inputRequestPattern = /(EOFError|EOF when reading a line|No line found)/i;

const closeUnterminatedQuotes = (value: string) => {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && !inSingle) { escaped = true; continue; }
    if (char === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (char === '"' && !inSingle) { inDouble = !inDouble; }
  }
  let fixed = value;
  if (inSingle) fixed += "'";
  if (inDouble) fixed += '"';
  return fixed;
};

const isValidDockerImageRef = (value: string) =>
  /^[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*)*(?::[A-Za-z0-9_.-]+)?$/.test(value);

const normalizeImageRef = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (isValidDockerImageRef(trimmed)) return trimmed;
  if (trimmed.length % 2 === 0) {
    const half = trimmed.length / 2;
    const left = trimmed.slice(0, half);
    const right = trimmed.slice(half);
    if (left === right && isValidDockerImageRef(left)) return left;
  }
  return "";
};

const resolveExecutionImage = (imageOverride: string, commandValue: string) => {
  const trimmed = normalizeImageRef(imageOverride);
  if (trimmed) return trimmed;
  if (isNodeCommand(commandValue)) return "node:20-alpine";
  if (isPythonCommand(commandValue)) return "python:3.11-alpine";
  if (isRustCommand(commandValue)) return "rust:latest";
  return "alpine:3.20";
};

export default function SyncedTerminal({
  roomId,
  ownerUid,
  repoId,
  runFileCommand,
  runFileImage,
}: SyncedTerminalProps) {
  // WebSocket terminal comun
  const [wsConnected, setWsConnected] = useState(false);
  // Output terminal comun (real-time)
  const [realtimeOutput, setRealtimeOutput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  // Conectare la WebSocket terminal comun
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ws = new window.WebSocket(TERMINAL_WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          setRealtimeOutput((prev) => prev + msg.data);
        }
        if (msg.type === "exit") {
          setRealtimeOutput((prev) => prev + `\n[Proces terminat cu cod: ${msg.code}]\n`);
        }
      } catch {}
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);
  // WebSocket terminal comun (acum corect, ca hook)

  const transportRoomId = useMemo(
    () => encodeURIComponent(`${roomId}:terminal`),
    [roomId],
  );

  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isRunningFile, setIsRunningFile] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [pendingInputCommand, setPendingInputCommand] = useState<string | null>(null);
  const [pendingInputBuffer, setPendingInputBuffer] = useState("");

  const commandHistoryRef = useRef<string[]>([]);
  const lastRunCommandRef = useRef("");
  const commandInputRef = useRef<HTMLInputElement | null>(null);

  const ydocRef = useRef<import("yjs").Doc | null>(null);
  const providerRef = useRef<import("y-websocket").WebsocketProvider | null>(null);
  const yCommandRef = useRef<import("yjs").Text | null>(null);
  const yOutputRef = useRef<import("yjs").Text | null>(null);

  // Flag setat DOAR când noi scriem în Yjs — observer-ul îl verifică
  // și dacă e true, sare peste setCommand (ca să nu reseteze cursorul)
  const localCommandWriteRef = useRef(false);
  const localOutputWriteRef = useRef(false);

  // ── Yjs setup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let removeStatusListener: (() => void) | null = null;
    let removeSyncListener: (() => void) | null = null;
    let removeCommandObserver: (() => void) | null = null;
    let removeOutputObserver: (() => void) | null = null;

    const setup = async () => {
      const Y: Yjs = await import("yjs");
      const { WebsocketProvider }: YWebsocket = await import("y-websocket");
      if (disposed) return;

      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      const wsUrl = resolveYjsWsUrl(process.env.NEXT_PUBLIC_YJS_WS_URL);
      const provider = new WebsocketProvider(wsUrl, transportRoomId, ydoc);
      providerRef.current = provider;

      setConnectionStatus(
        provider.wsconnected ? "connected" : provider.wsconnecting ? "connecting" : "disconnected",
      );

      const updateStatus = (event: { status: string }) => setConnectionStatus(event.status);
      provider.on("status", updateStatus);
      removeStatusListener = () => provider.off("status", updateStatus);

      const yCommand = ydoc.getText("terminal-command");
      const yOutput = ydoc.getText("terminal-output");
      yCommandRef.current = yCommand;
      yOutputRef.current = yOutput;

      // Restaurăm starea din sesiunea anterioară
      const savedCommand = yCommand.toString();
      const savedOutput = yOutput.toString();
      if (savedCommand) setCommand(savedCommand);
      if (savedOutput) setOutput(savedOutput);

      // Observer comandă — actualizăm state DOAR dacă update-ul vine de la altcineva
      const commandObserver = () => {
        if (localCommandWriteRef.current) return;
        setCommand(yCommand.toString());
      };
      yCommand.observe(commandObserver);
      removeCommandObserver = () => yCommand.unobserve(commandObserver);

      // Observer output — la fel
      const outputObserver = () => {
        if (localOutputWriteRef.current) return;
        setOutput(yOutput.toString());
      };
      yOutput.observe(outputObserver);
      removeOutputObserver = () => yOutput.unobserve(outputObserver);

      const updateSync = (isSynced: boolean) => {
        if (isSynced) setConnectionStatus("connected");
      };
      provider.on("sync", updateSync);
      removeSyncListener = () => provider.off("sync", updateSync);
    };

    void setup();

    return () => {
      disposed = true;
      removeStatusListener?.();
      removeSyncListener?.();
      removeCommandObserver?.();
      removeOutputObserver?.();
      providerRef.current?.destroy();
      providerRef.current = null;
      ydocRef.current?.destroy();
      ydocRef.current = null;
      yCommandRef.current = null;
      yOutputRef.current = null;
    };
  }, [transportRoomId]);

  // Scrie în Yjs fără să triggeze re-render local (flag previne observer-ul)
  const writeCommandToYjs = useCallback((value: string) => {
    const yCommand = yCommandRef.current;
    if (!yCommand) return;
    localCommandWriteRef.current = true;
    setYTextValue(yCommand, value);
    // Reset flag după ce Yjs procesează sync-ul (microtask)
    queueMicrotask(() => { localCommandWriteRef.current = false; });
  }, []);

  const writeOutputToYjs = useCallback((value: string) => {
    const yOutput = yOutputRef.current;
    if (!yOutput) return;
    localOutputWriteRef.current = true;
    setYTextValue(yOutput, value);
    queueMicrotask(() => { localOutputWriteRef.current = false; });
  }, []);

  // La fiecare keystroke: update state local + sync Yjs
  const handleCommandChange = useCallback((val: string) => {
    setCommand(val);           // update local imediat (nu blochează typing)
    writeCommandToYjs(val);    // sync colaboratori
  }, [writeCommandToYjs]);

  const appendOutput = useCallback((message: string) => {
    setOutput((prev) => {
      const next = prev ? `${prev}\n\n${message}` : message;
      writeOutputToYjs(next);
      return next;
    });
  }, [writeOutputToYjs]);

  const handleClearOutput = useCallback(() => {
    setOutput("");
    writeOutputToYjs("");
  }, [writeOutputToYjs]);

  const rememberCommand = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const next = commandHistoryRef.current.filter((e) => e !== normalized);
    next.push(normalized);
    commandHistoryRef.current = next.slice(-100);
  }, []);

  // ── Core execute ───────────────────────────────────────────────────────────
  const executeCommand = useCallback(
    async (cmd: string, stdin: string, imageHint = "") => {
      const resolvedImage = resolveExecutionImage(imageHint, cmd);

      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUid, repoId, image: resolvedImage, command: cmd, stdin }),
      });

      const data = (await response.json()) as {
        output?: string;
        error?: string;
        exitCode?: number;
      };
      if (!response.ok) throw new Error(data.error || "Execution failed");

      const outputText = data.output?.trim() || "(no output)";
      appendOutput(
        `$ ${cmd}\n[image: ${resolvedImage}]${stdin ? "\n[stdin provided]" : ""}\nexit code: ${data.exitCode ?? 0}\n${outputText}`,
      );

      if (inputRequestPattern.test(outputText)) {
        setPendingInputCommand(cmd);
        setPendingInputBuffer(stdin);
        appendOutput("↳ Program waiting for input. Type value + Enter. /cancel to stop.");
      } else {
        setPendingInputCommand(null);
        setPendingInputBuffer("");
      }
    },
    [appendOutput, ownerUid, repoId],
  );

  // ── Run File ───────────────────────────────────────────────────────────────
  const handleRunFile = useCallback(async () => {
    if (!ownerUid || !runFileCommand) return;
    setIsRunningFile(true);
    setTerminalError(null);
    handleClearOutput();
    try {
      await executeCommand(runFileCommand, "", runFileImage ?? "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed";
      setTerminalError(message);
      appendOutput(`ERROR: ${message}`);
    } finally {
      setIsRunningFile(false);
      commandInputRef.current?.focus();
    }
  }, [ownerUid, runFileCommand, runFileImage, executeCommand, appendOutput, handleClearOutput]);

  // ── Run Command ────────────────────────────────────────────────────────────
  // Înlocuim execuția cu trimitere la WebSocket terminal comun
  const handleRunCommand = useCallback(() => {
    const enteredValue = command.trim() || lastRunCommandRef.current;
    if (!enteredValue) { setTerminalError("Scrie o comandă mai întâi."); return; }
    if (!wsRef.current || wsRef.current.readyState !== 1) {
      setTerminalError("Terminalul nu este conectat la server.");
      return;
    }
    try {
      wsRef.current.send(JSON.stringify({ input: enteredValue + "\n" }));
      rememberCommand(enteredValue);
      lastRunCommandRef.current = enteredValue;
      handleCommandChange("");
      setTerminalError(null);
    } catch (e) {
      setTerminalError("Eroare la trimiterea comenzii.");
    }
  }, [command, handleCommandChange, rememberCommand]);

  const handleCommandKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || ((event.ctrlKey || event.metaKey) && event.key === "Enter")) {
      event.preventDefault();
      void handleRunCommand();
      return;
    }
    const history = commandHistoryRef.current;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.length) return;
      const idx = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(idx);
      handleCommandChange(history[idx]);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!history.length || historyIndex === null) return;
      const idx = historyIndex + 1;
      if (idx >= history.length) { setHistoryIndex(null); handleCommandChange(""); return; }
      setHistoryIndex(idx);
      handleCommandChange(history[idx]);
    }
  };

  const isAnyRunning = isRunning || isRunningFile;

  return (
    <section style={{
      display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
      background: "#0d1117", color: "#c9d1d9",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
        borderBottom: "1px solid #21262d", background: "#111826",
        flexShrink: 0, flexWrap: "wrap", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#484f58", letterSpacing: "0.08em", fontWeight: 700 }}>TERMINAL</span>
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 999, border: "1px solid #30363d",
            color: connectionStatus === "connected" ? "#3fb950" : "#f0b72f",
          }}>
            {connectionStatus}
          </span>
          <span style={{ fontSize: 10, color: "#484f58", padding: "1px 6px", border: "1px solid #21262d", borderRadius: 4 }}>
            📁 {repoId.slice(0, 10)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {runFileCommand && (
            <button
              type="button"
              onClick={handleRunFile}
              disabled={isAnyRunning || !ownerUid}
              title={`Rulează: ${runFileCommand}`}
              style={{
                padding: "4px 11px", borderRadius: 5,
                border: "1px solid #238636",
                background: isAnyRunning ? "#0d1117" : "#1a4d2e",
                color: isAnyRunning ? "#3fb95066" : "#3fb950",
                fontSize: 11, cursor: isAnyRunning ? "not-allowed" : "pointer",
                opacity: isAnyRunning ? 0.5 : 1,
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <span>▶</span>
              <span>{isRunningFile ? "Running…" : "Run File"}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleRunCommand}
            disabled={isAnyRunning || !ownerUid || (!command.trim() && !lastRunCommandRef.current)}
            style={{
              padding: "4px 11px", borderRadius: 5, border: "1px solid #30363d",
              background: isAnyRunning || (!command.trim() && !lastRunCommandRef.current) ? "#0d1117" : "#1f6feb",
              color: "#fff", fontSize: 11,
              cursor: isAnyRunning || (!command.trim() && !lastRunCommandRef.current) ? "not-allowed" : "pointer",
              opacity: isAnyRunning || (!command.trim() && !lastRunCommandRef.current) ? 0.5 : 1,
            }}
          >
            {isRunning ? "Running…" : "Run"}
          </button>

          <button
            type="button"
            onClick={handleClearOutput}
            style={{
              padding: "4px 11px", borderRadius: 5,
              border: "1px solid #30363d", background: "transparent",
              color: "#8b949e", fontSize: 11, cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Run File hint */}
      {runFileCommand && (
        <div style={{
          padding: "3px 10px", borderBottom: "1px solid #21262d",
          background: "#0c1220", fontSize: 10,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ color: "#238636" }}>▶</span>
          <span style={{ color: "#484f58" }}>Run File:</span>
          <code style={{ color: "#6e7681" }}>{runFileCommand}</code>
        </div>
      )}

      {terminalError && (
        <p style={{
          margin: 0, padding: "6px 10px", fontSize: 11,
          color: "#f85149", borderBottom: "1px solid #21262d", background: "#0f141b",
        }}>
          {terminalError}
        </p>
      )}

      {/* ── Output: xterm.js terminal ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <XTermTerminal ownerUid={ownerUid} repoId={repoId} />

        {/* ── Input ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", borderBottom: "1px solid #21262d",
          background: "#0d1117",
        }}>
          <span style={{ color: pendingInputCommand ? "#f0b72f" : "#3fb950", fontSize: 12, flexShrink: 0 }}>
            {pendingInputCommand ? ">" : "$"}
          </span>
          <input
            ref={commandInputRef}
            value={command}
            onChange={(e) => {
              setHistoryIndex(null);
              handleCommandChange(e.target.value);
            }}
            onKeyDown={handleCommandKeyDown}
            placeholder={
              pendingInputCommand
                ? "Trimite input… (/cancel pentru a opri)"
                : "Scrie orice comandă…"
            }
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{
              width: "100%", background: "transparent", border: "none",
              color: "#e6edf3", fontSize: 12, outline: "none",
            }}
          />
        </div>

        <p style={{
          margin: 0, padding: "5px 10px", fontSize: 10,
          color: "#30363d", background: "#0c1220",
        }}>
          {pendingInputCommand
            ? "Input mode · /cancel pentru a ieși"
            : "Enter = execută · ↑/↓ = istoric · ▶ Run File = rulează fișierul deschis"}
        </p>
      </div>
    </section>
  );
}