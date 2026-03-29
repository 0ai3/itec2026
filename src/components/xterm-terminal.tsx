"use client";
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

const TERMINAL_WS_URL = "ws://localhost:3001";

type XTermTerminalProps = {
  ownerUid?: string | null;
  repoId?: string;
};

export default function XTermTerminal({ ownerUid, repoId }: XTermTerminalProps) {
  const xtermRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!xtermRef.current) return;
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      fontSize: 14,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
      },
      cursorBlink: true,
      cols: 80,
      rows: 24,
      convertEol: true,
      scrollback: 1000,
    });
    termRef.current = term;
    term.open(xtermRef.current);
    term.focus();

    // Funcție sigură de resize
    let disposed = false
    let startupResizeTimeout: number | null = null
    let lateResizeTimeout: number | null = null

    const resizeTerminal = () => {
      if (disposed) return
      if (xtermRef.current && term) {
        const width = xtermRef.current.offsetWidth;
        const height = xtermRef.current.offsetHeight;
        if (
          width > 0 &&
          height > 0 &&
          term.element &&
          term.element.offsetParent !== null // e vizibil
        ) {
          try {
            const cols = Math.max(20, Math.floor(width / 9));
            const rows = Math.max(5, Math.floor(height / 18));
            term.resize(cols, rows);
          } catch (e) {
            // Ignoră erorile de resize (ex. component deja disposed)
          }
        }
      }
    };
    const resizeObserver = new window.ResizeObserver(resizeTerminal);
    resizeObserver.observe(xtermRef.current);

    // Trigger resize la montare (dar doar dacă are dimensiuni nenule)
    startupResizeTimeout = window.setTimeout(resizeTerminal, 0);

    // WebSocket
    let wsUrl = TERMINAL_WS_URL;
    if (ownerUid && repoId) {
      wsUrl = `${TERMINAL_WS_URL}?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}`;
    }
    console.log("XTermTerminal connecting to", wsUrl);
    const ws = new window.WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("[Terminal conectat la server]");
    };
    ws.onclose = () => {
      term.writeln("\r\n[Deconectat de la server]");
    };
    ws.onerror = () => {
      term.writeln("\r\n[Eroare conexiune la server]");
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" && typeof msg.data === "string") {
          term.write(msg.data);
        } else if (msg.type === "output") {
          // Output invalid, loghează și ignoră
          term.writeln("\r\n[Output invalid primit de la server]\r\n");
          console.error("xterm.js: Output invalid:", msg);
        }
        if (msg.type === "exit") {
          term.writeln(`\r\n[Proces terminat cu cod: ${msg.code}]\r\n`);
        }
      } catch (err) {
        term.writeln("\r\n[Eroare parsing output terminal]\r\n");
        console.error("xterm.js: Parsing error: ", err, event.data);
      }
    };

    // Trimite inputul tastaturii la server
    term.onData((data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ input: data }));
      }
    });

    // Trigger resize la montare (pentru a evita bugul inițial)
    lateResizeTimeout = window.setTimeout(() => {
      if (disposed || !xtermRef.current) return
      const width = xtermRef.current.offsetWidth;
      const height = xtermRef.current.offsetHeight;
      const cols = Math.max(20, Math.floor(width / 9));
      const rows = Math.max(5, Math.floor(height / 18));
      try {
        term.resize(cols, rows);
      } catch (e) {
        // ignore
      }
    }, 0);

    return () => {
      disposed = true
      if (startupResizeTimeout !== null) window.clearTimeout(startupResizeTimeout)
      if (lateResizeTimeout !== null) window.clearTimeout(lateResizeTimeout)
      ws.close();
      try {
        term.dispose();
      } catch (e) {
        // ignore
      }
      resizeObserver.disconnect();
    };
  }, [ownerUid, repoId]);

  return (
    <div style={{ width: "100%", height: "100%", background: "#0d1117" }}>
      <div ref={xtermRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
