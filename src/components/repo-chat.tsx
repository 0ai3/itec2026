"use client";

import { FormEvent, useMemo, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  importCode?: string;
};

type RepoChatProps = {
  language: string;
  filePath: string | null;
  codeContext: string;
  onImportCode: (code: string) => void;
};

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export default function RepoChat({
  language,
  filePath,
  codeContext,
  onImportCode,
}: RepoChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const importEnabled = Boolean(filePath);
  const hasMessages = messages.length > 0;
  const messagePayload = useMemo(
    () =>
      messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [messages],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const userPrompt = prompt.trim();
    if (!userPrompt) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: userPrompt,
    };

    setPrompt("");
    setChatError(null);
    setIsSending(true);
    setMessages((prev) => [...prev, nextUserMessage]);

    try {
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          filePath,
          codeContext,
          messages: [...messagePayload, { role: "user", content: userPrompt }],
        }),
      });

      const data = (await response.json()) as {
        reply?: string;
        importCode?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Unable to get AI response");
      }

      const nextAssistantMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: data.reply?.trim() || "No response received.",
        importCode: data.importCode?.trim() || undefined,
      };

      setMessages((prev) => [...prev, nextAssistantMessage]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to get AI response";
      setChatError(message);
    }

    setIsSending(false);
  };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "#0f141b",
        color: "#c9d1d9",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderBottom: "1px solid #21262d",
          background: "#111826",
        }}
      >
        <span
          style={{ fontSize: 12, color: "#8b949e", letterSpacing: "0.04em" }}
        >
          CONTEXT
        </span>
        <span
          title={filePath || ""}
          style={{
            fontSize: 11,
            color: "#8b949e",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 210,
          }}
        >
          {filePath ? `File: ${filePath}` : "Select a file to import code"}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "#0d1117",
        }}
      >
        {!hasMessages ? (
          <div
            style={{
              border: "1px solid #21262d",
              borderRadius: 8,
              background: "#161b22",
              padding: "12px 10px",
              fontSize: 12,
              color: "#8b949e",
              lineHeight: 1.5,
            }}
          >
            Ask for refactors, bug fixes, or fresh code for the active file.
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <article
                key={message.id}
                style={{
                  alignSelf: isUser ? "flex-end" : "stretch",
                  maxWidth: isUser ? "92%" : "100%",
                  border: "1px solid #21262d",
                  borderRadius: 8,
                  background: isUser ? "#182236" : "#161b22",
                  padding: "10px 10px 8px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: isUser ? "#58a6ff" : "#8b949e",
                    marginBottom: 6,
                    textTransform: "uppercase",
                  }}
                >
                  {isUser ? "You" : "Assistant"}
                </div>
                <p
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "#c9d1d9",
                  }}
                >
                  {message.content}
                </p>
                {message.role === "assistant" && message.importCode ? (
                  <button
                    type="button"
                    onClick={() => onImportCode(message.importCode ?? "")}
                    disabled={!importEnabled}
                    title={
                      importEnabled
                        ? "Replace current file with this code"
                        : "Select a file first"
                    }
                    style={{
                      marginTop: 9,
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: "1px solid #30363d",
                      background: importEnabled
                        ? "rgba(88,166,255,0.12)"
                        : "transparent",
                      color: importEnabled ? "#58a6ff" : "#6e7681",
                      fontSize: 11,
                      cursor: importEnabled ? "pointer" : "not-allowed",
                    }}
                  >
                    Import code
                  </button>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 8,
          padding: 10,
          borderTop: "1px solid #21262d",
          background: "#0f141b",
        }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask AI about this repo..."
          style={{
            flex: 1,
            border: "1px solid #30363d",
            borderRadius: 6,
            padding: "9px 10px",
            fontSize: 12,
            background: "#0d1117",
            color: "#e6edf3",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isSending || !prompt.trim()}
          style={{
            padding: "9px 12px",
            borderRadius: 6,
            border: "1px solid #30363d",
            background: isSending || !prompt.trim() ? "#161b22" : "#1f6feb",
            color: "#ffffff",
            fontSize: 12,
            cursor: isSending || !prompt.trim() ? "not-allowed" : "pointer",
            opacity: isSending || !prompt.trim() ? 0.75 : 1,
          }}
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </form>

      {chatError ? (
        <p
          style={{
            margin: 0,
            padding: "8px 10px 10px",
            fontSize: 11,
            color: "#f85149",
            borderTop: "1px solid #21262d",
            background: "#0f141b",
          }}
        >
          {chatError}
        </p>
      ) : null}
    </section>
  );
}
