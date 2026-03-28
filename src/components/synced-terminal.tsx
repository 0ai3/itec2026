"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveYjsWsUrl } from "@/lib/yjs-ws-url";

type Yjs = typeof import("yjs");
type YWebsocket = typeof import("y-websocket");

type SyncedTerminalProps = {
  roomId: string;
  ownerUid: string | null;
  repoId: string;
  defaultImage: string;
  defaultCommand: string;
};

const setYTextValue = (yText: import("yjs").Text, value: string) => {
  yText.delete(0, yText.length);
  if (value) {
    yText.insert(0, value);
  }
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
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && !inSingle) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    }
  }

  let fixed = value;
  if (inSingle) {
    fixed += "'";
  }
  if (inDouble) {
    fixed += '"';
  }

  return fixed;
};

const isValidDockerImageRef = (value: string) =>
  /^[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*)*(?::[A-Za-z0-9_.-]+)?$/.test(
    value,
  );

const normalizeImageRef = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  if (isValidDockerImageRef(trimmed)) {
    return trimmed;
  }

  if (trimmed.length % 2 === 0) {
    const half = trimmed.length / 2;
    const left = trimmed.slice(0, half);
    const right = trimmed.slice(half);
    if (left === right && isValidDockerImageRef(left)) {
      return left;
    }
  }

  return "";
};

const resolveExecutionImage = (
  imageValue: string,
  commandValue: string,
  defaultImageValue: string,
) => {
  const trimmedImage = normalizeImageRef(imageValue);
  const normalizedDefaultImage = normalizeImageRef(defaultImageValue);
  const trimmedCommand = commandValue.trim();

  if (trimmedImage && trimmedImage !== normalizedDefaultImage) {
    return trimmedImage;
  }

  if (isNodeCommand(trimmedCommand)) {
    return "node:20-alpine";
  }

  if (isPythonCommand(trimmedCommand)) {
    return "python:3.11-alpine";
  }

  if (isRustCommand(trimmedCommand)) {
    return "rust:latest";
  }

  return trimmedImage || normalizedDefaultImage || "alpine:3.20";
};

export default function SyncedTerminal({
  roomId,
  ownerUid,
  repoId,
  defaultImage,
  defaultCommand,
}: SyncedTerminalProps) {
  const transportRoomId = useMemo(
    () => encodeURIComponent(`${roomId}:terminal`),
    [roomId],
  );
  const defaultImageRef = useRef(defaultImage);
  const defaultCommandRef = useRef(defaultCommand);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [image, setImage] = useState(defaultImage);
  const [command, setCommand] = useState(defaultCommand);
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [pendingInputCommand, setPendingInputCommand] = useState<string | null>(
    null,
  );
  const [pendingInputBuffer, setPendingInputBuffer] = useState("");
  const commandHistoryRef = useRef<string[]>([]);
  const lastRunCommandRef = useRef("");
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const isCommandInputFocusedRef = useRef(false);

  const ydocRef = useRef<import("yjs").Doc | null>(null);
  const providerRef = useRef<import("y-websocket").WebsocketProvider | null>(
    null,
  );
  const yImageRef = useRef<import("yjs").Text | null>(null);
  const yCommandRef = useRef<import("yjs").Text | null>(null);
  const yOutputRef = useRef<import("yjs").Text | null>(null);
  const suppressSyncRef = useRef(false);

  useEffect(() => {
    defaultImageRef.current = defaultImage;
  }, [defaultImage]);

  useEffect(() => {
    defaultCommandRef.current = defaultCommand;
  }, [defaultCommand]);

  useEffect(() => {
    setImage(defaultImage);
    const yImage = yImageRef.current;
    if (!yImage) {
      return;
    }

    suppressSyncRef.current = true;
    setYTextValue(yImage, defaultImage);
    suppressSyncRef.current = false;
  }, [defaultImage]);

  useEffect(() => {
    setCommand(defaultCommand);
    const yCommand = yCommandRef.current;
    if (!yCommand) {
      return;
    }

    suppressSyncRef.current = true;
    setYTextValue(yCommand, defaultCommand);
    suppressSyncRef.current = false;
  }, [defaultCommand]);

  useEffect(() => {
    let disposed = false;
    let removeStatusListener: (() => void) | null = null;
    let removeSyncListener: (() => void) | null = null;
    let removeImageObserver: (() => void) | null = null;
    let removeCommandObserver: (() => void) | null = null;
    let removeOutputObserver: (() => void) | null = null;
    let initialSeedApplied = false;

    const setup = async () => {
      const Y: Yjs = await import("yjs");
      const { WebsocketProvider }: YWebsocket = await import("y-websocket");

      if (disposed) {
        return;
      }

      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      const wsUrl = resolveYjsWsUrl(process.env.NEXT_PUBLIC_YJS_WS_URL);
      const provider = new WebsocketProvider(wsUrl, transportRoomId, ydoc);
      providerRef.current = provider;

      setConnectionStatus(
        provider.wsconnected
          ? "connected"
          : provider.wsconnecting
            ? "connecting"
            : "disconnected",
      );

      const updateStatus = (event: { status: string }) => {
        setConnectionStatus(event.status);
      };
      provider.on("status", updateStatus);
      removeStatusListener = () => {
        provider.off("status", updateStatus);
      };

      const yImage = ydoc.getText("terminal-image");
      const yCommand = ydoc.getText("terminal-command");
      const yOutput = ydoc.getText("terminal-output");

      yImageRef.current = yImage;
      yCommandRef.current = yCommand;
      yOutputRef.current = yOutput;

      setImage(yImage.toString() || defaultImageRef.current);
      setCommand(yCommand.toString() || defaultCommandRef.current);
      setOutput(yOutput.toString());

      const imageObserver = () => {
        if (suppressSyncRef.current) {
          return;
        }
        setImage(yImage.toString());
      };
      yImage.observe(imageObserver);
      removeImageObserver = () => {
        yImage.unobserve(imageObserver);
      };

      const commandObserver = () => {
        if (suppressSyncRef.current) {
          return;
        }
        if (isCommandInputFocusedRef.current) {
          return;
        }
        setCommand(yCommand.toString());
      };
      yCommand.observe(commandObserver);
      removeCommandObserver = () => {
        yCommand.unobserve(commandObserver);
      };

      const outputObserver = () => {
        if (suppressSyncRef.current) {
          return;
        }
        setOutput(yOutput.toString());
      };
      yOutput.observe(outputObserver);
      removeOutputObserver = () => {
        yOutput.unobserve(outputObserver);
      };

      const updateSync = (isSynced: boolean) => {
        if (isSynced) {
          setConnectionStatus("connected");

          if (!initialSeedApplied) {
            if (yImage.length === 0 && defaultImageRef.current) {
              setYTextValue(yImage, defaultImageRef.current);
            }
            if (yCommand.length === 0 && defaultCommandRef.current) {
              setYTextValue(yCommand, defaultCommandRef.current);
            }
            initialSeedApplied = true;
          }
        }
      };
      provider.on("sync", updateSync);
      removeSyncListener = () => {
        provider.off("sync", updateSync);
      };
    };

    void setup();

    return () => {
      disposed = true;
      removeStatusListener?.();
      removeSyncListener?.();
      removeImageObserver?.();
      removeCommandObserver?.();
      removeOutputObserver?.();
      providerRef.current?.destroy();
      providerRef.current = null;
      ydocRef.current?.destroy();
      ydocRef.current = null;
      yImageRef.current = null;
      yCommandRef.current = null;
      yOutputRef.current = null;
    };
  }, [transportRoomId]);

  const handleImageChange = (nextValue: string) => {
    setImage(nextValue);
    const yImage = yImageRef.current;
    if (!yImage) {
      return;
    }
    suppressSyncRef.current = true;
    setYTextValue(yImage, nextValue);
    suppressSyncRef.current = false;
  };

  const handleCommandChange = (nextValue: string) => {
    setCommand(nextValue);
  };

  const syncCommandToShared = (nextValue: string) => {
    const yCommand = yCommandRef.current;
    if (!yCommand) {
      return;
    }
    suppressSyncRef.current = true;
    setYTextValue(yCommand, nextValue);
    suppressSyncRef.current = false;
  };

  const appendOutput = useCallback((message: string) => {
    const yOutput = yOutputRef.current;
    if (!yOutput) {
      setOutput((prev) => (prev ? `${prev}\n\n${message}` : message));
      return;
    }

    const current = yOutput.toString();
    const next = current ? `${current}\n\n${message}` : message;

    suppressSyncRef.current = true;
    setYTextValue(yOutput, next);
    suppressSyncRef.current = false;
    setOutput(next);
  }, []);

  const handleClearOutput = useCallback(() => {
    const yOutput = yOutputRef.current;
    if (!yOutput) {
      setOutput("");
      return;
    }

    suppressSyncRef.current = true;
    setYTextValue(yOutput, "");
    suppressSyncRef.current = false;
    setOutput("");
  }, []);

  const rememberCommand = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const next = commandHistoryRef.current.filter(
      (entry) => entry !== normalized,
    );
    next.push(normalized);
    commandHistoryRef.current = next.slice(-100);
  }, []);

  const commandNeedsInput = (text: string) => inputRequestPattern.test(text);

  const runCommand = useCallback(
    async (commandValue: string, stdinValue: string) => {
      const resolvedImage = resolveExecutionImage(
        image,
        commandValue,
        defaultImageRef.current,
      );
      if (resolvedImage !== image) {
        handleImageChange(resolvedImage);
      }

      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerUid,
          repoId,
          image: resolvedImage,
          command: commandValue,
          stdin: stdinValue,
        }),
      });

      const data = (await response.json()) as {
        output?: string;
        error?: string;
        exitCode?: number;
      };
      if (!response.ok) {
        throw new Error(data.error || "Execution failed");
      }

      const outputText = data.output?.trim() || "(no output)";
      const stdinSummary = stdinValue ? "\n[stdin provided]" : "";
      appendOutput(
        `$ ${commandValue}\n[image: ${resolvedImage}]${stdinSummary}\nexit code: ${data.exitCode ?? 0}\n${outputText}`,
      );

      if (commandNeedsInput(outputText)) {
        setPendingInputCommand(commandValue);
        setPendingInputBuffer(stdinValue);
        appendOutput(
          "↳ Program is waiting for input. Type a value and press Enter. Use /cancel to stop.",
        );
      } else {
        setPendingInputCommand(null);
        setPendingInputBuffer("");
      }
    },
    [appendOutput, image, ownerUid, repoId],
  );

  const handleRunCode = useCallback(async () => {
    if (!ownerUid) {
      setTerminalError("Owner information missing for this repo.");
      return;
    }

    const typedCommand = command.trim();
    const enteredValue = typedCommand || lastRunCommandRef.current;
    if (!enteredValue) {
      setTerminalError("Command is required");
      return;
    }

    handleClearOutput();

    if (pendingInputCommand) {
      if (enteredValue === "/cancel") {
        setPendingInputCommand(null);
        setPendingInputBuffer("");
        handleCommandChange("");
        syncCommandToShared("");
        setTerminalError(null);
        appendOutput("↳ Input cancelled.");
        return;
      }

      const mergedInput = pendingInputBuffer
        ? `${pendingInputBuffer}\n${enteredValue}`
        : enteredValue;
      setTerminalError(null);
      setHistoryIndex(null);
      appendOutput(`> ${enteredValue}`);
      handleCommandChange("");
      syncCommandToShared("");
      setIsRunning(true);

      try {
        await runCommand(pendingInputCommand, mergedInput);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Execution failed";
        setTerminalError(message);
        appendOutput(`$ ${pendingInputCommand}\nERROR: ${message}`);
      } finally {
        setIsRunning(false);
        commandInputRef.current?.focus();
      }
      return;
    }

    setPendingInputCommand(null);
    setPendingInputBuffer("");
    setTerminalError(null);
    setIsRunning(true);
    setHistoryIndex(null);

    const commandValue = closeUnterminatedQuotes(enteredValue);
    if (commandValue !== enteredValue) {
      handleCommandChange(commandValue);
      syncCommandToShared(commandValue);
      appendOutput("↳ Auto-fixed unterminated quote in command.");
    }

    rememberCommand(commandValue);
    lastRunCommandRef.current = commandValue;
    syncCommandToShared(commandValue);

    try {
      await runCommand(commandValue, "");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Execution failed";
      setTerminalError(message);
      appendOutput(`$ ${commandValue}\nERROR: ${message}`);
    } finally {
      setIsRunning(false);
      commandInputRef.current?.focus();
    }
  }, [
    appendOutput,
    command,
    handleClearOutput,
    ownerUid,
    pendingInputBuffer,
    pendingInputCommand,
    rememberCommand,
    runCommand,
  ]);

  const handleCommandKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void handleRunCode();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void handleRunCode();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      const history = commandHistoryRef.current;
      if (history.length === 0) {
        return;
      }

      if (historyIndex === null) {
        const nextIndex = history.length - 1;
        setHistoryIndex(nextIndex);
        handleCommandChange(history[nextIndex]);
        syncCommandToShared(history[nextIndex]);
        return;
      }

      const nextIndex = Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      handleCommandChange(history[nextIndex]);
      syncCommandToShared(history[nextIndex]);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      const history = commandHistoryRef.current;
      if (history.length === 0 || historyIndex === null) {
        return;
      }

      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(null);
        handleCommandChange("");
        syncCommandToShared("");
        return;
      }

      setHistoryIndex(nextIndex);
      handleCommandChange(history[nextIndex]);
      syncCommandToShared(history[nextIndex]);
    }
  };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "#0d1117",
        color: "#c9d1d9",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 10px",
          borderBottom: "1px solid #21262d",
          background: "#111826",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{ fontSize: 11, color: "#8b949e", letterSpacing: "0.04em" }}
          >
            TERMINAL
          </span>
          <span
            style={{
              fontSize: 11,
              padding: "2px 7px",
              borderRadius: 999,
              border: "1px solid #30363d",
              color: connectionStatus === "connected" ? "#3fb950" : "#f0b72f",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            {connectionStatus}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "#8b949e",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
            title={normalizeImageRef(image) || "auto"}
          >
            Image: {normalizeImageRef(image) || "auto"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleRunCode}
            disabled={
              isRunning ||
              !ownerUid ||
              (!command.trim() && !lastRunCommandRef.current)
            }
            style={{
              padding: "6px 11px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background:
                isRunning ||
                !ownerUid ||
                (!command.trim() && !lastRunCommandRef.current)
                  ? "#161b22"
                  : "#1f6feb",
              color: "#ffffff",
              fontSize: 12,
              cursor:
                isRunning ||
                !ownerUid ||
                (!command.trim() && !lastRunCommandRef.current)
                  ? "not-allowed"
                  : "pointer",
              opacity:
                isRunning ||
                !ownerUid ||
                (!command.trim() && !lastRunCommandRef.current)
                  ? 0.75
                  : 1,
            }}
          >
            {isRunning ? "Running..." : "Run"}
          </button>
          <button
            type="button"
            onClick={handleClearOutput}
            style={{
              padding: "6px 11px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "transparent",
              color: "#8b949e",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {terminalError ? (
        <p
          style={{
            margin: 0,
            padding: "7px 10px",
            fontSize: 11,
            color: "#f85149",
            borderBottom: "1px solid #21262d",
            background: "#0f141b",
          }}
        >
          {terminalError}
        </p>
      ) : null}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <pre
          style={{
            margin: 0,
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            padding: "12px 10px",
            fontSize: 12,
            lineHeight: 1.5,
            background: "#0a0f14",
            borderBottom: "1px solid #21262d",
            color: "#c9d1d9",
          }}
        >
          {output || "Shared terminal output will appear here."}
        </pre>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 10px",
            borderBottom: "1px solid #21262d",
            background: "#0d1117",
          }}
        >
          <span style={{ color: "#3fb950", fontSize: 12 }}>$</span>
          <input
            ref={commandInputRef}
            value={command}
            onChange={(event) => {
              setHistoryIndex(null);
              handleCommandChange(event.target.value);
            }}
            onFocus={() => {
              isCommandInputFocusedRef.current = true;
            }}
            onBlur={() => {
              isCommandInputFocusedRef.current = false;
            }}
            onKeyDown={handleCommandKeyDown}
            placeholder={
              pendingInputCommand
                ? "Program input mode: type value and press Enter (/cancel to stop)"
                : "Type any command in /workspace and press Enter"
            }
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: "#e6edf3",
              fontSize: 12,
              outline: "none",
            }}
          />
        </div>

        <p
          style={{
            margin: 0,
            padding: "7px 10px",
            fontSize: 11,
            color: "#8b949e",
            background: "#0f141b",
          }}
        >
          {pendingInputCommand
            ? "Input mode: Enter sends input to the running program. Type /cancel to exit input mode."
            : "Press Enter to run. Use ↑/↓ for command history."}
        </p>
      </div>
    </section>
  );
}
