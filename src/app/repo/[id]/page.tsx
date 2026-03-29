"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import Editor, { type AiRange } from "@/components/editor";
import { auth, db } from "@/lib/firebase";
import SyncedTerminal from "@/components/synced-terminal";
import RepoChat from "@/components/repo-chat";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type InviteRecord = { email: string; status?: string };

type RepoFileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: RepoFileNode[];
};

type FileVersionSummary = {
  id: string;
  createdAt: number;
};

type ExplorerContextMenuState = {
  x: number;
  y: number;
  entryPath: string;
  entryType: "file" | "directory";
};

type ExplorerDragPayload = {
  entryPath: string;
  entryType: "file" | "directory";
};

const EXPLORER_DND_MIME = "application/x-itec-repo-entry";
const EXPLORER_DND_TEXT_PREFIX = "__ITEC_REPO_ENTRY__:";

const encodeExplorerDragPayload = (payload: ExplorerDragPayload) =>
  JSON.stringify(payload);

const decodeExplorerDragPayload = (raw: string): ExplorerDragPayload | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ExplorerDragPayload>;
    if (
      !parsed.entryPath ||
      (parsed.entryType !== "file" && parsed.entryType !== "directory")
    )
      return null;
    return { entryPath: parsed.entryPath, entryType: parsed.entryType };
  } catch {
    return null;
  }
};

const setExplorerDragPayload = (
  dataTransfer: DataTransfer,
  payload: ExplorerDragPayload,
) => {
  const encoded = encodeExplorerDragPayload(payload);
  dataTransfer.setData(EXPLORER_DND_MIME, encoded);
  dataTransfer.setData("text/plain", `${EXPLORER_DND_TEXT_PREFIX}${encoded}`);
};

const getExplorerDragPayload = (
  dataTransfer: DataTransfer,
): ExplorerDragPayload | null => {
  const fromMime = decodeExplorerDragPayload(
    dataTransfer.getData(EXPLORER_DND_MIME),
  );
  if (fromMime) return fromMime;
  const plain = dataTransfer.getData("text/plain");
  if (!plain.startsWith(EXPLORER_DND_TEXT_PREFIX)) return null;
  return decodeExplorerDragPayload(
    plain.slice(EXPLORER_DND_TEXT_PREFIX.length),
  );
};

const generateAiRangeId = () => Math.random().toString(36).slice(2, 10);

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const getFullRangeForCode = (code: string): AiRange => {
  const lines = code.split("\n");
  const endLineNumber = Math.max(1, lines.length);
  const lastLine = lines[endLineNumber - 1] ?? "";
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber,
    endColumn: lastLine.length + 1,
    id: generateAiRangeId(),
    originalText: code,
  };
};

const normalizeAiRange = (range: Partial<AiRange>, code: string): AiRange => {
  const startLineNumber = Math.max(1, Math.floor(range.startLineNumber ?? 1));
  const startColumn = Math.max(1, Math.floor(range.startColumn ?? 1));
  const endLineNumber = Math.max(
    startLineNumber,
    Math.floor(range.endLineNumber ?? startLineNumber),
  );
  const endColumn =
    endLineNumber === startLineNumber
      ? Math.max(startColumn, Math.floor(range.endColumn ?? startColumn))
      : Math.max(1, Math.floor(range.endColumn ?? 1));
  let originalText = range.originalText ?? "";
  if (!originalText) {
    const lines = code.split("\n");
    if (startLineNumber === endLineNumber) {
      originalText = (lines[startLineNumber - 1] ?? "").slice(
        startColumn - 1,
        endColumn - 1,
      );
    } else {
      const partial = [];
      for (let lineNo = startLineNumber; lineNo <= endLineNumber; lineNo++) {
        const line = lines[lineNo - 1] ?? "";
        if (lineNo === startLineNumber)
          partial.push(line.slice(startColumn - 1));
        else if (lineNo === endLineNumber)
          partial.push(line.slice(0, endColumn - 1));
        else partial.push(line);
      }
      originalText = partial.join("\n");
    }
  }
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
    id: range.id ?? generateAiRangeId(),
    originalText,
  };
};

const normalizeAiRanges = (
  ranges: Array<Partial<AiRange>> = [],
  code = "",
): AiRange[] => ranges.map((r) => normalizeAiRange(r, code));

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const getOwnerUidFromRepoPath = (path: string) => {
  const segments = path.split("/");
  return segments.length >= 2 ? segments[1] : null;
};

const getOwnerLabel = (
  ownerName?: string | null,
  ownerEmail?: string | null,
) => {
  if (ownerName?.trim()) return ownerName;
  if (ownerEmail?.includes("@")) return ownerEmail.split("@")[0];
  return "Unknown user";
};

const getLanguageFromFilePath = (filePath: string | null) => {
  if (!filePath) return "typescript";
  const p = filePath.toLowerCase();
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".js") || p.endsWith(".jsx")) return "javascript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".cpp")) return "cpp";
  if (p.endsWith(".c")) return "c";
  if (p.endsWith(".java")) return "java";
  if (p.endsWith(".rs")) return "rust";
  if (p.endsWith(".go")) return "go";
  if (p.endsWith(".php")) return "php";
  if (p.endsWith(".rb")) return "ruby";
  if (p.endsWith(".r")) return "r";
  if (p.endsWith(".lua")) return "lua";
  return "plaintext";
};

const getRuntimeConfigForFilePath = (filePath: string | null) => {
  if (!filePath)
    return { image: "python:3.11-alpine", command: "python main.py" };
  const p = filePath.toLowerCase();
  if (p.endsWith(".py"))
    return {
      image: "python:3.11-alpine",
      command: `python ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs"))
    return {
      image: "node:20-alpine",
      command: `node ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".ts"))
    return {
      image: "denoland/deno:alpine",
      command: `deno run --allow-read ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".tsx") || p.endsWith(".jsx"))
    return {
      image: "node:20-alpine",
      command: `echo ${JSON.stringify("JSX/TSX files require a project build step.")}`,
    };
  if (p.endsWith(".cpp") || p.endsWith(".cc") || p.endsWith(".cxx"))
    return {
      image: "gcc:latest",
      command: `g++ ${JSON.stringify(filePath)} -o out_bin && ./out_bin`,
    };
  if (p.endsWith(".c"))
    return {
      image: "gcc:latest",
      command: `gcc ${JSON.stringify(filePath)} -o out_bin && ./out_bin`,
    };
  if (p.endsWith(".java"))
    return {
      image: "openjdk:21-jdk",
      command: `java ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".rs"))
    return {
      image: "rust:latest",
      command: `rustc ${JSON.stringify(filePath)} -O -o out_bin && ./out_bin`,
    };
  if (p.endsWith(".go"))
    return {
      image: "golang:1.22",
      command: `go run ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".php"))
    return {
      image: "php:8.3-cli-alpine",
      command: `php ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".rb"))
    return {
      image: "ruby:3.3-alpine",
      command: `ruby ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".r"))
    return {
      image: "r-base:4.4.1",
      command: `Rscript ${JSON.stringify(filePath)}`,
    };
  if (p.endsWith(".lua"))
    return {
      image: "alpine:3.20",
      command: `apk add --no-cache lua5.4 >/dev/null && lua5.4 ${JSON.stringify(filePath)}`,
    };
  return { image: "alpine:3.20", command: `cat ${JSON.stringify(filePath)}` };
};

const findFirstFile = (nodes: RepoFileNode[]): string | null => {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    if (node.children?.length) {
      const n = findFirstFile(node.children);
      if (n) return n;
    }
  }
  return null;
};

const getParentFolderPath = (filePath: string) => {
  const parts = filePath.split("/").filter(Boolean);
  return parts.length <= 1 ? "" : parts.slice(0, -1).join("/");
};

const getBaseName = (entryPath: string) => {
  const parts = entryPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? entryPath;
};

const remapPathAfterMove = (
  currentPath: string,
  sourcePath: string,
  destinationPath: string,
) => {
  if (currentPath === sourcePath) return destinationPath;
  if (currentPath.startsWith(`${sourcePath}/`))
    return `${destinationPath}${currentPath.slice(sourcePath.length)}`;
  return currentPath;
};

/* ─── File icons ─────────────────────────────────────────────────────────── */

const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  ts: { icon: "TS", color: "#3178c6" },
  tsx: { icon: "TS", color: "#3178c6" },
  js: { icon: "JS", color: "#f7df1e" },
  jsx: { icon: "JS", color: "#f7df1e" },
  py: { icon: "PY", color: "#3572A5" },
  json: { icon: "{}", color: "#cbcb41" },
  css: { icon: "CS", color: "#563d7c" },
  html: { icon: "HT", color: "#e34c26" },
  md: { icon: "MD", color: "#6e7681" },
  cpp: { icon: "C+", color: "#f34b7d" },
  c: { icon: "C", color: "#555" },
  java: { icon: "JV", color: "#b07219" },
  rs: { icon: "RS", color: "#dea584" },
  go: { icon: "GO", color: "#00ADD8" },
  php: { icon: "PH", color: "#777BB4" },
  rb: { icon: "RB", color: "#cc342d" },
  r: { icon: "R", color: "#276DC3" },
  lua: { icon: "LU", color: "#2C2D72" },
};

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const info = FILE_ICONS[ext] ?? { icon: "·", color: "#484f58" };
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        color: info.color,
        minWidth: 18,
        textAlign: "center",
        fontFamily: "monospace",
        letterSpacing: "-0.5px",
        flexShrink: 0,
      }}
    >
      {info.icon}
    </span>
  );
}

/* ─── FileTree ───────────────────────────────────────────────────────────── */

function FileTree({
  nodes,
  selectedFilePath,
  selectedFolderPath,
  onSelectFile,
  onSelectFolder,
  onDropFilesToFolder,
  onDropEntryToFolder,
  onDragHoverFolder,
  isMoveAlreadyTriggered,
  getActiveDragEntry,
  onDragEntryStart,
  onDragEntryEnd,
  onOpenContextMenu,
  depth = 0,
}: {
  nodes: RepoFileNode[];
  selectedFilePath: string | null;
  selectedFolderPath: string;
  onSelectFile: (p: string) => void;
  onSelectFolder: (p: string) => void;
  onDropFilesToFolder: (folder: string, files: File[]) => void;
  onDropEntryToFolder: (
    entryPath: string,
    entryType: "file" | "directory",
    folderPath: string,
  ) => void;
  onDragHoverFolder: (folderPath: string) => void;
  isMoveAlreadyTriggered: () => boolean;
  getActiveDragEntry: () => ExplorerDragPayload | null;
  onDragEntryStart: (
    entryPath: string,
    entryType: "file" | "directory",
  ) => void;
  onDragEntryEnd: () => void;
  onOpenContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    entryPath: string,
    entryType: "file" | "directory",
  ) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const handleDrop = (e: DragEvent<HTMLElement>, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMoveAlreadyTriggered()) {
      onDragEntryEnd();
      return;
    }
    const payload =
      getActiveDragEntry() ?? getExplorerDragPayload(e.dataTransfer);
    if (payload) {
      onDragEntryEnd();
      onDropEntryToFolder(payload.entryPath, payload.entryType, folderPath);
      return;
    }
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onDropFilesToFolder(folderPath, files);
  };

  const handleDragStart = (
    event: DragEvent<HTMLElement>,
    entryPath: string,
    entryType: "file" | "directory",
  ) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    setExplorerDragPayload(event.dataTransfer, { entryPath, entryType });
    onDragEntryStart(entryPath, entryType);
  };

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {nodes.map((node) => {
        if (node.type === "directory") {
          const isOpen = !collapsed[node.path];
          return (
            <li key={node.path}>
              <div
                data-repo-drop-target="folder"
                data-repo-path={node.path}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDragHoverFolder(node.path);
                  const p =
                    getActiveDragEntry() ??
                    getExplorerDragPayload(e.dataTransfer);
                  e.dataTransfer.dropEffect = p ? "move" : "copy";
                }}
                onDrop={(e) => handleDrop(e, node.path)}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(e) =>
                    handleDragStart(e, node.path, "directory")
                  }
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDragHoverFolder(node.path);
                    const p =
                      getActiveDragEntry() ??
                      getExplorerDragPayload(e.dataTransfer);
                    e.dataTransfer.dropEffect = p ? "move" : "copy";
                  }}
                  onDrop={(e) => handleDrop(e, node.path)}
                  onClick={() => {
                    setCollapsed((prev) => ({ ...prev, [node.path]: isOpen }));
                    onSelectFolder(node.path);
                  }}
                  onContextMenu={(e) =>
                    onOpenContextMenu(e, node.path, "directory")
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    width: "100%",
                    background:
                      selectedFolderPath === node.path
                        ? "rgba(88,166,255,0.06)"
                        : "transparent",
                    border: "none",
                    color: "#8b949e",
                    cursor: "pointer",
                    padding: `3px 8px 3px ${8 + depth * 12}px`,
                    fontSize: 12,
                    textAlign: "left",
                    borderRadius: 3,
                    transition: "background 0.1s",
                  }}
                >
                  <span style={{ fontSize: 9, color: "#484f58", minWidth: 10 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <span
                    style={{ fontSize: 10, minWidth: 16, textAlign: "center" }}
                  >
                    📁
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {node.name}
                  </span>
                </button>
                {isOpen && node.children?.length ? (
                  <FileTree
                    nodes={node.children}
                    selectedFilePath={selectedFilePath}
                    selectedFolderPath={selectedFolderPath}
                    onSelectFile={onSelectFile}
                    onSelectFolder={onSelectFolder}
                    onDropFilesToFolder={onDropFilesToFolder}
                    onDropEntryToFolder={onDropEntryToFolder}
                    onDragHoverFolder={onDragHoverFolder}
                    isMoveAlreadyTriggered={isMoveAlreadyTriggered}
                    getActiveDragEntry={getActiveDragEntry}
                    onDragEntryStart={onDragEntryStart}
                    onDragEntryEnd={onDragEntryEnd}
                    onOpenContextMenu={onOpenContextMenu}
                    depth={depth + 1}
                  />
                ) : null}
              </div>
            </li>
          );
        }

        const isSelected = selectedFilePath === node.path;
        return (
          <li key={node.path}>
            <button
              type="button"
              draggable
              onDragStart={(e) => handleDragStart(e, node.path, "file")}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDragHoverFolder(getParentFolderPath(node.path));
                const p =
                  getActiveDragEntry() ??
                  getExplorerDragPayload(e.dataTransfer);
                e.dataTransfer.dropEffect = p ? "move" : "copy";
              }}
              onDrop={(e) => handleDrop(e, getParentFolderPath(node.path))}
              data-repo-drop-target="file"
              data-repo-path={node.path}
              onClick={() => onSelectFile(node.path)}
              onContextMenu={(e) => onOpenContextMenu(e, node.path, "file")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                background: isSelected
                  ? "rgba(88,166,255,0.08)"
                  : "transparent",
                border: "none",
                borderLeft: isSelected
                  ? "2px solid #388bfd"
                  : "2px solid transparent",
                color: isSelected ? "#e6edf3" : "#6e7681",
                cursor: "pointer",
                padding: `3px 8px 3px ${6 + depth * 12}px`,
                fontSize: 12,
                textAlign: "left",
                transition: "background 0.1s, color 0.1s",
              }}
            >
              <FileIcon name={node.name} />
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {node.name}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ─── Resize hook ────────────────────────────────────────────────────────── */

function useResize(
  initialPx: number,
  min: number,
  max: number,
  direction: "horizontal" | "vertical" = "horizontal",
) {
  const [size, setSize] = useState(initialPx);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(initialPx);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
      startSize.current = size;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta =
          direction === "horizontal"
            ? ev.clientX - startPos.current
            : startPos.current - ev.clientY;
        setSize(Math.min(max, Math.max(min, startSize.current + delta)));
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [size, min, max, direction],
  );

  return { size, onMouseDown };
}

/* ─── Main ───────────────────────────────────────────────────────────────── */

export default function RepoEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const repoId = params.id;

  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [repoName, setRepoName] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(Boolean(auth));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [collaborationRoomId, setCollaborationRoomId] =
    useState<string>(repoId);

  const [fileTree, setFileTree] = useState<RepoFileNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [loadedSelectedFilePath, setLoadedSelectedFilePath] = useState<
    string | null
  >(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState("");
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [editorReplaceToken, setEditorReplaceToken] = useState(0);
  const [editorReplaceContent, setEditorReplaceContent] = useState("");
  const [editorReplaceSource, setEditorReplaceSource] = useState<"ai" | "user">(
    "user",
  );
  const [selectedFileAiRanges, setSelectedFileAiRanges] = useState<AiRange[]>(
    [],
  );
  const [editorAiRangesToken, setEditorAiRangesToken] = useState(0);
  const [fileVersions, setFileVersions] = useState<FileVersionSummary[]>([]);
  const [selectedVersionIndex, setSelectedVersionIndex] = useState<
    number | null
  >(null);
  const [previewVersionContent, setPreviewVersionContent] = useState("");
  const [previewVersionAiRanges, setPreviewVersionAiRanges] = useState<
    AiRange[]
  >([]);
  const [isLoadingVersionHistory, setIsLoadingVersionHistory] = useState(false);
  const [isLoadingVersionPreview, setIsLoadingVersionPreview] = useState(false);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [editorSessionNonce, setEditorSessionNonce] = useState(0);
  const [timeTravelOpen, setTimeTravelOpen] = useState(false);

  // UI state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [explorerContextMenu, setExplorerContextMenu] =
    useState<ExplorerContextMenuState | null>(null);

  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const activeDragEntryRef = useRef<ExplorerDragPayload | null>(null);
  const dragHoverFolderRef = useRef<string>("");
  const dragMoveTriggeredRef = useRef(false);
  const moveInFlightRef = useRef(false);
  const selectedFilePathRef = useRef<string | null>(null);
  const selectedFileLoadRequestRef = useRef(0);
  const hasPendingLocalEditsRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const lastPersistedSnapshotRef = useRef<{
    path: string | null;
    content: string;
    aiRangesKey: string;
  }>({ path: null, content: "", aiRangesKey: "[]" });

  const sidebar = useResize(220, 140, 400, "horizontal");
  const terminal = useResize(220, 80, 500, "vertical");

  useEffect(() => {
    selectedFilePathRef.current = selectedFilePath;
  }, [selectedFilePath]);
  useEffect(() => {
    setLoadedSelectedFilePath(null);
    hasPendingLocalEditsRef.current = false;
  }, [selectedFilePath]);

  const handleEditorCodeChange = useCallback(
    (editorFilePath: string, code: string) => {
      if (selectedFilePathRef.current !== editorFilePath) return;
      if (loadedSelectedFilePath !== editorFilePath || isLoadingSelectedFile)
        return;
      const lastSnapshot = lastPersistedSnapshotRef.current;
      const isSuspiciousBlank =
        code.length === 0 &&
        lastSnapshot.path === editorFilePath &&
        lastSnapshot.content.length > 0 &&
        !hasPendingLocalEditsRef.current &&
        Date.now() - lastLoadedAtRef.current < 10_000;
      if (isSuspiciousBlank) return;
      hasPendingLocalEditsRef.current = true;
      setSelectedFileContent(code);
    },
    [loadedSelectedFilePath, isLoadingSelectedFile],
  );

  const handleEditorAiRangesChange = useCallback(
    (editorFilePath: string, ranges: AiRange[]) => {
      if (selectedFilePathRef.current !== editorFilePath) return;
      if (loadedSelectedFilePath !== editorFilePath || isLoadingSelectedFile)
        return;
      hasPendingLocalEditsRef.current = true;
      setSelectedFileAiRanges(ranges);
    },
    [loadedSelectedFilePath, isLoadingSelectedFile],
  );

  /* ── Auth ── */
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) router.replace("/login");
    });
  }, [router]);

  /* ── Access check ── */
  useEffect(() => {
    const checkAccess = async () => {
      if (!db || !user) {
        setOwnerUid(null);
        setOwnerName(null);
        setOwnerEmail(null);
        setIsOwner(false);
        setRepoName(null);
        setCollaborationRoomId(repoId);
        setIsCheckingAccess(false);
        return;
      }
      setIsCheckingAccess(true);
      setErrorMessage(null);
      try {
        const myRepoSnap = await getDoc(
          doc(db, "users", user.uid, "repos", repoId),
        );
        if (myRepoSnap.exists()) {
          const d = myRepoSnap.data() as {
            name?: string;
            role?: "owner" | "collaborator";
            ownerName?: string;
            ownerUid?: string;
            ownerEmail?: string;
          };
          const isLegacy = d.role === "collaborator" && !d.ownerUid;
          if (!isLegacy) {
            const effOwner =
              d.role === "collaborator" && d.ownerUid ? d.ownerUid : user.uid;
            const ownerView = effOwner === user.uid;
            setRepoName(d.name ?? repoId);
            setOwnerUid(effOwner);
            setOwnerName(d.ownerName ?? null);
            setOwnerEmail(d.ownerEmail ?? user.email ?? null);
            setIsOwner(ownerView);
            setCollaborationRoomId(`${effOwner}:${repoId}`);
            if (ownerView) {
              const s = await getDocs(
                collection(db, "users", effOwner, "repos", repoId, "invites"),
              );
              setInvites(
                s.docs.map((d2) => {
                  const id = d2.data() as InviteRecord;
                  return { email: id.email, status: id.status };
                }),
              );
            } else setInvites([]);
            setIsCheckingAccess(false);
            return;
          }
        }
        const repoResults = await getDocs(collectionGroup(db, "repos"));
        const matching = repoResults.docs.filter((d2) => d2.id === repoId);
        if (!matching.length) {
          setErrorMessage("Repo not found.");
          return;
        }
        const curEmail = normalizeEmail(user.email ?? "");
        let matched: {
          name: string;
          ownerId: string;
          ownerView: boolean;
          ownerName?: string;
          ownerEmail?: string;
        } | null = null;
        for (const repoDoc of matching) {
          const candOwner = getOwnerUidFromRepoPath(repoDoc.ref.path);
          if (!candOwner) continue;
          const data = repoDoc.data() as {
            name?: string;
            ownerName?: string;
            ownerEmail?: string;
          };
          if (candOwner === user.uid) {
            matched = {
              name: data.name ?? repoId,
              ownerId: candOwner,
              ownerView: true,
              ownerName: data.ownerName,
              ownerEmail: data.ownerEmail,
            };
            break;
          }
          if (!curEmail) continue;
          const invRef = doc(
            db,
            "users",
            candOwner,
            "repos",
            repoId,
            "invites",
            encodeURIComponent(curEmail),
          );
          const invDoc = await getDoc(invRef);
          if (!invDoc.exists()) continue;
          matched = {
            name: data.name ?? repoId,
            ownerId: candOwner,
            ownerView: false,
            ownerName: data.ownerName,
            ownerEmail: data.ownerEmail,
          };
          break;
        }
        if (!matched) {
          setErrorMessage("You do not have access to this repo.");
          setIsCheckingAccess(false);
          return;
        }
        setRepoName(matched.name);
        setOwnerUid(matched.ownerId);
        setOwnerName(matched.ownerName ?? null);
        setOwnerEmail(matched.ownerEmail ?? null);
        setIsOwner(matched.ownerView);
        setCollaborationRoomId(`${matched.ownerId}:${repoId}`);
        await setDoc(
          doc(db, "users", user.uid, "repos", repoId),
          {
            role: matched.ownerView ? "owner" : "collaborator",
            ownerUid: matched.ownerId,
            ownerName: matched.ownerName ?? null,
            ownerEmail: matched.ownerEmail ?? null,
          },
          { merge: true },
        );
        if (matched.ownerView) {
          const s = await getDocs(
            collection(
              db,
              "users",
              matched.ownerId,
              "repos",
              repoId,
              "invites",
            ),
          );
          setInvites(
            s.docs.map((d2) => {
              const id = d2.data() as InviteRecord;
              return { email: id.email, status: id.status };
            }),
          );
        } else setInvites([]);
      } catch (e) {
        setErrorMessage(
          e instanceof Error ? e.message : "Unable to load repo.",
        );
      }
      setIsCheckingAccess(false);
    };
    void checkAccess();
  }, [repoId, user]);

  /* ── File tree ── */
  const loadFileTree = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!ownerUid) return;
      if (!opts?.silent) setIsLoadingFiles(true);
      try {
        const res = await fetch(
          `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}`,
        );
        const data = (await res.json()) as {
          tree?: RepoFileNode[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Unable to load file tree");
        const tree = data.tree ?? [];
        setFileTree(tree);
        if (!selectedFilePath) {
          const f = findFirstFile(tree);
          if (f) setSelectedFilePath(f);
        }
      } catch (e) {
        if (e instanceof Error) setErrorMessage(e.message);
      }
      if (!opts?.silent) setIsLoadingFiles(false);
    },
    [ownerUid, repoId, selectedFilePath],
  );

  useEffect(() => {
    const init = async () => {
      if (!ownerUid) return;
      await fetch("/api/repo-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init", ownerUid, repoId }),
      });
      await loadFileTree();
    };
    void init();
  }, [ownerUid, repoId, loadFileTree]);

  useEffect(() => {
    if (!ownerUid) return;
    const interval = setInterval(
      () => void loadFileTree({ silent: true }),
      1500,
    );
    return () => clearInterval(interval);
  }, [ownerUid, loadFileTree]);

  const loadFileVersions = useCallback(async () => {
    if (!ownerUid || !selectedFilePath) {
      setFileVersions([]);
      setSelectedVersionIndex(null);
      setPreviewVersionContent("");
      setPreviewVersionAiRanges([]);
      return;
    }
    setIsLoadingVersionHistory(true);
    try {
      const res = await fetch(
        `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(selectedFilePath)}&history=1`,
      );
      const data = (await res.json()) as {
        versions?: FileVersionSummary[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Unable to load history");
      const versions = (data.versions ?? []).sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      setFileVersions(versions);
      setSelectedVersionIndex(versions.length ? versions.length - 1 : null);
      setPreviewVersionContent("");
      setPreviewVersionAiRanges([]);
    } catch (e) {
      if (e instanceof Error) setErrorMessage(e.message);
    }
    setIsLoadingVersionHistory(false);
  }, [ownerUid, repoId, selectedFilePath]);

  useEffect(() => {
    if (
      !ownerUid ||
      !selectedFilePath ||
      loadedSelectedFilePath !== selectedFilePath
    )
      return;
    const id = setInterval(() => {
      if (
        isLoadingSelectedFile ||
        isLoadingVersionPreview ||
        isRestoringVersion
      )
        return;
      const isOlder =
        selectedVersionIndex != null &&
        selectedVersionIndex >= 0 &&
        selectedVersionIndex < fileVersions.length - 1;
      if (isOlder) return;
      void loadFileVersions();
    }, 2_500);
    return () => clearInterval(id);
  }, [
    ownerUid,
    selectedFilePath,
    loadedSelectedFilePath,
    isLoadingSelectedFile,
    isLoadingVersionPreview,
    isRestoringVersion,
    selectedVersionIndex,
    fileVersions.length,
    loadFileVersions,
  ]);

  /* ── Load selected file ── */
  useEffect(() => {
    const load = async () => {
      if (!ownerUid || !selectedFilePath) return;
      const requestId = selectedFileLoadRequestRef.current + 1;
      selectedFileLoadRequestRef.current = requestId;
      const requestedPath = selectedFilePath;
      setIsLoadingSelectedFile(true);
      try {
        const res = await fetch(
          `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(selectedFilePath)}`,
        );
        const data = (await res.json()) as {
          content?: string;
          aiRanges?: AiRange[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Unable to load file");
        if (selectedFileLoadRequestRef.current !== requestId) return;
        const content = data.content ?? "";
        const normalizedRanges = normalizeAiRanges(
          data.aiRanges ?? [],
          content,
        );
        setSelectedFileContent(content);
        setSelectedFileAiRanges(normalizedRanges);
        setLoadedSelectedFilePath(requestedPath);
        lastLoadedAtRef.current = Date.now();
        hasPendingLocalEditsRef.current = false;
        lastPersistedSnapshotRef.current = {
          path: requestedPath,
          content,
          aiRangesKey: JSON.stringify(normalizedRanges),
        };
        setPreviewVersionContent("");
        setPreviewVersionAiRanges([]);
        setEditorReplaceContent(content);
        setEditorReplaceSource("user");
        setEditorReplaceToken((p) => p + 1);
        setEditorAiRangesToken((p) => p + 1);
        setFileMessage(null);
        await loadFileVersions();
      } catch (e) {
        if (e instanceof Error) setErrorMessage(e.message);
      }
      if (selectedFileLoadRequestRef.current === requestId)
        setIsLoadingSelectedFile(false);
    };
    void load();
  }, [ownerUid, repoId, selectedFilePath, loadFileVersions]);

  /* ── Auto-save ── */
  useEffect(() => {
    if (!ownerUid || !selectedFilePath) return;
    const id = setInterval(() => {
      if (
        !ownerUid ||
        !selectedFilePath ||
        isLoadingSelectedFile ||
        moveInFlightRef.current ||
        isSavingFile
      )
        return;
      if (loadedSelectedFilePath !== selectedFilePath) return;
      if (!hasPendingLocalEditsRef.current) return;
      const aiRangesKey = JSON.stringify(selectedFileAiRanges);
      const last = lastPersistedSnapshotRef.current;
      const hasChanges =
        last.path !== selectedFilePath ||
        last.content !== selectedFileContent ||
        last.aiRangesKey !== aiRangesKey;
      if (!hasChanges) {
        hasPendingLocalEditsRef.current = false;
        return;
      }
      const isLikelySwitchBlank =
        selectedFileContent.length === 0 &&
        last.path === selectedFilePath &&
        last.content.length > 0 &&
        Date.now() - lastLoadedAtRef.current < 10_000;
      if (isLikelySwitchBlank) return;
      void fetch("/api/repo-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          ownerUid,
          repoId,
          filePath: selectedFilePath,
          content: selectedFileContent,
          aiRanges: selectedFileAiRanges,
          createVersion: false,
        }),
      })
        .then(async (r) => {
          if (!r.ok) {
            const d = (await r.json()) as { error?: string };
            throw new Error(d.error || "Auto-save failed");
          }
          lastPersistedSnapshotRef.current = {
            path: selectedFilePath,
            content: selectedFileContent,
            aiRangesKey,
          };
          hasPendingLocalEditsRef.current = false;
        })
        .catch((e) => {
          if (e instanceof Error) setErrorMessage(e.message);
        });
    }, 2_000);
    return () => clearInterval(id);
  }, [
    ownerUid,
    repoId,
    selectedFilePath,
    loadedSelectedFilePath,
    selectedFileContent,
    selectedFileAiRanges,
    isLoadingSelectedFile,
    isSavingFile,
  ]);

  const handleInvite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!db || !user || !ownerUid || !isOwner) {
      setInviteError("Only the repo owner can invite.");
      return;
    }
    const em = normalizeEmail(inviteEmail);
    if (!em.includes("@")) {
      setInviteError("Enter a valid email.");
      return;
    }
    setInviteError(null);
    setInviteMessage(null);
    setIsInviting(true);
    try {
      await setDoc(
        doc(
          db,
          "users",
          ownerUid,
          "repos",
          repoId,
          "invites",
          encodeURIComponent(em),
        ),
        {
          email: em,
          status: "invited",
          invitedByUid: user.uid,
          invitedByEmail: user.email ?? null,
          invitedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setInvites((prev) => [
        ...prev.filter((i) => normalizeEmail(i.email) !== em),
        { email: em, status: "invited" },
      ]);
      setInviteEmail("");
      setInviteMessage(`Invited ${em}`);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Unable to invite.");
    }
    setIsInviting(false);
  };

  const handleSaveFile = async () => {
    if (
      !ownerUid ||
      !selectedFilePath ||
      loadedSelectedFilePath !== selectedFilePath ||
      isLoadingSelectedFile
    )
      return;
    setIsSavingFile(true);
    setFileMessage(null);
    try {
      const last = lastPersistedSnapshotRef.current;
      if (
        selectedFileContent.length === 0 &&
        last.path === selectedFilePath &&
        last.content.length > 0
      ) {
        if (!window.confirm("File is empty. Save anyway?")) return;
      }
      const res = await fetch("/api/repo-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          ownerUid,
          repoId,
          filePath: selectedFilePath,
          content: selectedFileContent,
          aiRanges: selectedFileAiRanges,
          createVersion: true,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Unable to save");
      lastPersistedSnapshotRef.current = {
        path: selectedFilePath,
        content: selectedFileContent,
        aiRangesKey: JSON.stringify(selectedFileAiRanges),
      };
      hasPendingLocalEditsRef.current = false;
      setFileMessage("Saved ✓");
      await loadFileVersions();
    } catch (e) {
      if (e instanceof Error) setErrorMessage(e.message);
    }
    setIsSavingFile(false);
  };

  const handleTimelinePreview = useCallback(
    async (index: number) => {
      if (!ownerUid || !selectedFilePath) return;
      const version = fileVersions[index];
      if (!version) return;
      setSelectedVersionIndex(index);
      setIsLoadingVersionPreview(true);
      try {
        const res = await fetch(
          `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(selectedFilePath)}&versionId=${encodeURIComponent(version.id)}`,
        );
        const data = (await res.json()) as {
          content?: string;
          aiRanges?: AiRange[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Unable to load version");
        const content = data.content ?? "";
        setPreviewVersionContent(content);
        setPreviewVersionAiRanges(
          normalizeAiRanges(data.aiRanges ?? [], content),
        );
      } catch (e) {
        if (e instanceof Error) setErrorMessage(e.message);
      }
      setIsLoadingVersionPreview(false);
    },
    [ownerUid, repoId, selectedFilePath, fileVersions],
  );

  const handleRestoreSelectedVersion = useCallback(async () => {
    if (!ownerUid || !selectedFilePath || selectedVersionIndex == null) return;
    setIsRestoringVersion(true);
    try {
      const res = await fetch("/api/repo-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          ownerUid,
          repoId,
          filePath: selectedFilePath,
          content: previewVersionContent,
          aiRanges: previewVersionAiRanges,
          createVersion: true,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Unable to restore");
      setSelectedFileContent(previewVersionContent);
      setSelectedFileAiRanges(previewVersionAiRanges);
      lastPersistedSnapshotRef.current = {
        path: selectedFilePath,
        content: previewVersionContent,
        aiRangesKey: JSON.stringify(previewVersionAiRanges),
      };
      hasPendingLocalEditsRef.current = false;
      setEditorReplaceContent(previewVersionContent);
      setEditorReplaceSource("user");
      setEditorReplaceToken((p) => p + 1);
      setEditorAiRangesToken((p) => p + 1);
      setEditorSessionNonce((p) => p + 1);
      setFileMessage("Version restored");
      await loadFileVersions();
    } catch (e) {
      if (e instanceof Error) setErrorMessage(e.message);
    }
    setIsRestoringVersion(false);
  }, [
    ownerUid,
    selectedFilePath,
    selectedVersionIndex,
    previewVersionContent,
    previewVersionAiRanges,
    repoId,
    loadFileVersions,
  ]);

  const handleCreateFile = async () => {
    if (!ownerUid) return;
    const inputPath = window
      .prompt(
        selectedFolderPath
          ? `File name (folder: ${selectedFolderPath}):`
          : "File path (e.g. src/main.py):",
      )
      ?.trim();
    if (!inputPath) return;
    const norm = inputPath.replaceAll("\\", "/").replace(/^\/+/, "");
    const filePath =
      selectedFolderPath && !norm.includes("/")
        ? `${selectedFolderPath}/${norm}`
        : norm;
    try {
      const res = await fetch("/api/repo-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-file",
          ownerUid,
          repoId,
          filePath,
          content: "",
        }),
      });
      const data = (await res.json()) as {
        tree?: RepoFileNode[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Unable to create file");
      setFileTree(data.tree ?? []);
      setSelectedFilePath(filePath);
      setSelectedFolderPath(getParentFolderPath(filePath));
      setSelectedFileContent("");
      setSelectedFileAiRanges([]);
      setEditorReplaceContent("");
      setEditorReplaceSource("user");
      setEditorReplaceToken((p) => p + 1);
      setEditorAiRangesToken((p) => p + 1);
    } catch (e) {
      if (e instanceof Error) setErrorMessage(e.message);
    }
  };

  const handleCreateFolder = async () => {
    if (!ownerUid) return;
    const folderPath = window.prompt("Folder path (e.g. src/utils):")?.trim();
    if (!folderPath) return;
    try {
      const res = await fetch("/api/repo-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-folder",
          ownerUid,
          repoId,
          folderPath,
        }),
      });
      const data = (await res.json()) as {
        tree?: RepoFileNode[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Unable to create folder");
      setFileTree(data.tree ?? []);
    } catch (e) {
      if (e instanceof Error) setErrorMessage(e.message);
    }
  };

  const handleRenameEntry = useCallback(
    async (entryPath: string, entryType: "file" | "directory") => {
      if (!ownerUid) return;
      const currentName = getBaseName(entryPath);
      const newName = window
        .prompt(`Rename ${entryType}:`, currentName)
        ?.trim();
      if (!newName || newName === currentName) return;
      try {
        const res = await fetch("/api/repo-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rename-entry",
            ownerUid,
            repoId,
            sourcePath: entryPath,
            newName,
          }),
        });
        const data = (await res.json()) as {
          tree?: RepoFileNode[];
          sourcePath?: string;
          destinationPath?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Unable to rename");
        setFileTree(data.tree ?? []);
        setSelectedFolderPath((prev) =>
          data.destinationPath
            ? remapPathAfterMove(prev, entryPath, data.destinationPath)
            : prev,
        );
        const cur = selectedFilePathRef.current;
        if (
          cur &&
          data.destinationPath &&
          (cur === entryPath || cur.startsWith(`${entryPath}/`))
        )
          setSelectedFilePath(
            remapPathAfterMove(cur, entryPath, data.destinationPath),
          );
        setFileMessage("Renamed");
      } catch (e) {
        if (e instanceof Error) setErrorMessage(e.message);
      }
    },
    [ownerUid, repoId],
  );

  const moveEntryToPath = useCallback(
    async (
      sourcePath: string,
      sourceType: "file" | "directory",
      destinationPath: string,
    ) => {
      if (!ownerUid) return;
      if (destinationPath === sourcePath) {
        setFileMessage("Same location.");
        return;
      }
      if (
        sourceType === "directory" &&
        destinationPath.startsWith(`${sourcePath}/`)
      ) {
        setFileMessage("Cannot move folder into itself.");
        return;
      }
      setFileMessage(`Moving…`);
      moveInFlightRef.current = true;
      try {
        const res = await fetch("/api/repo-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move-entry",
            ownerUid,
            repoId,
            sourcePath,
            destinationPath,
          }),
        });
        const data = (await res.json()) as {
          tree?: RepoFileNode[];
          sourcePath?: string;
          destinationPath?: string;
          error?: string;
        };
        if (!res.ok)
          throw new Error(data.error || `Unable to move ${sourceType}`);
        const movedTo = data.destinationPath ?? destinationPath;
        setFileTree(data.tree ?? []);
        setSelectedFolderPath((prev) =>
          remapPathAfterMove(prev, sourcePath, movedTo),
        );
        const cur = selectedFilePathRef.current;
        const selectedIsMoved =
          cur != null &&
          (cur === sourcePath || cur.startsWith(`${sourcePath}/`));
        if (selectedIsMoved && cur) {
          const nextSelected = remapPathAfterMove(cur, sourcePath, movedTo);
          setSelectedFilePath(nextSelected);
          const rr = await fetch(
            `/api/repo-files?ownerUid=${encodeURIComponent(ownerUid)}&repoId=${encodeURIComponent(repoId)}&filePath=${encodeURIComponent(nextSelected)}`,
          );
          const rd = (await rr.json()) as {
            content?: string;
            aiRanges?: AiRange[];
            error?: string;
          };
          if (rr.ok) {
            const cc = rd.content ?? "";
            const cr = normalizeAiRanges(rd.aiRanges ?? [], cc);
            lastPersistedSnapshotRef.current = {
              path: nextSelected,
              content: cc,
              aiRangesKey: JSON.stringify(cr),
            };
            setSelectedFileContent(cc);
            setSelectedFileAiRanges(cr);
            setEditorReplaceContent(cc);
            setEditorReplaceSource("user");
            setEditorReplaceToken((p) => p + 1);
            setEditorAiRangesToken((p) => p + 1);
          }
        }
        setFileMessage("Moved");
      } catch (e) {
        if (e instanceof Error) setFileMessage(`Move failed: ${e.message}`);
      } finally {
        moveInFlightRef.current = false;
      }
    },
    [ownerUid, repoId],
  );

  const handleMoveEntry = useCallback(
    (entryPath: string, entryType: "file" | "directory") => {
      const cur = getParentFolderPath(entryPath);
      const dest = window.prompt("Move to folder (empty for root):", cur);
      if (dest === null) return;
      const destFolder = dest
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const base = getBaseName(entryPath);
      void moveEntryToPath(
        entryPath,
        entryType,
        destFolder ? `${destFolder}/${base}` : base,
      );
    },
    [moveEntryToPath],
  );

  const handleDropEntryToFolder = useCallback(
    (
      entryPath: string,
      entryType: "file" | "directory",
      folderPath: string,
    ) => {
      dragMoveTriggeredRef.current = true;
      const base = getBaseName(entryPath);
      void moveEntryToPath(
        entryPath,
        entryType,
        folderPath ? `${folderPath}/${base}` : base,
      );
    },
    [moveEntryToPath],
  );

  const handleDragEntryStart = useCallback(
    (entryPath: string, entryType: "file" | "directory") => {
      activeDragEntryRef.current = { entryPath, entryType };
      dragHoverFolderRef.current = getParentFolderPath(entryPath);
      dragMoveTriggeredRef.current = false;
      setFileMessage(`Dragging ${entryPath}`);
    },
    [],
  );

  const handleDragEntryEnd = useCallback(() => {
    activeDragEntryRef.current = null;
    dragHoverFolderRef.current = "";
    dragMoveTriggeredRef.current = false;
    setFileMessage((prev) => (prev?.startsWith("Dragging ") ? null : prev));
  }, []);

  const handleDragHoverFolder = useCallback((folderPath: string) => {
    dragHoverFolderRef.current = folderPath;
  }, []);
  const isMoveAlreadyTriggered = useCallback(
    () => dragMoveTriggeredRef.current,
    [],
  );
  const getActiveDragEntry = useCallback(() => activeDragEntryRef.current, []);

  const handleDeleteEntry = useCallback(
    async (entryPath: string, entryType: "file" | "directory") => {
      if (!ownerUid) return;
      if (
        !window.confirm(
          entryType === "directory"
            ? `Delete folder "${entryPath}" and all contents?`
            : `Delete file "${entryPath}"?`,
        )
      )
        return;
      try {
        const res = await fetch("/api/repo-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: entryType === "directory" ? "delete-folder" : "delete-file",
            ownerUid,
            repoId,
            ...(entryType === "directory"
              ? { folderPath: entryPath }
              : { filePath: entryPath }),
          }),
        });
        const data = (await res.json()) as {
          tree?: RepoFileNode[];
          error?: string;
        };
        if (!res.ok)
          throw new Error(data.error || `Unable to delete ${entryType}`);
        const nextTree = data.tree ?? [];
        setFileTree(nextTree);
        if (
          selectedFilePath &&
          (selectedFilePath === entryPath ||
            selectedFilePath.startsWith(`${entryPath}/`))
        )
          setSelectedFilePath(findFirstFile(nextTree));
        if (
          selectedFolderPath === entryPath ||
          selectedFolderPath.startsWith(`${entryPath}/`)
        )
          setSelectedFolderPath("");
        setFileMessage("Deleted");
      } catch (e) {
        if (e instanceof Error) setErrorMessage(e.message);
      }
    },
    [ownerUid, repoId, selectedFilePath, selectedFolderPath],
  );

  const handleDropFilesToFolder = useCallback(
    async (folderPath: string, files: File[]) => {
      if (!ownerUid || !files.length) return;
      setFileMessage(
        `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`,
      );
      try {
        for (const file of files) {
          const content = await file.text();
          const target = folderPath ? `${folderPath}/${file.name}` : file.name;
          const res = await fetch("/api/repo-files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create-file",
              ownerUid,
              repoId,
              filePath: target,
              content,
            }),
          });
          const data = (await res.json()) as {
            tree?: RepoFileNode[];
            error?: string;
          };
          if (!res.ok)
            throw new Error(data.error || `Unable to upload ${file.name}`);
          setFileTree(data.tree ?? []);
        }
        setSelectedFolderPath(folderPath);
        setFileMessage(
          `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}.`,
        );
      } catch (e) {
        if (e instanceof Error) setErrorMessage(e.message);
        setFileMessage(null);
      }
    },
    [ownerUid, repoId],
  );

  const handleDropFilesAnywhere = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (dragMoveTriggeredRef.current) {
        handleDragEntryEnd();
        return;
      }
      const payload =
        activeDragEntryRef.current ?? getExplorerDragPayload(e.dataTransfer);
      if (payload) {
        const dest = dragHoverFolderRef.current;
        handleDropEntryToFolder(payload.entryPath, payload.entryType, dest);
        handleDragEntryEnd();
        return;
      }
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length)
        void handleDropFilesToFolder(selectedFolderPath || "", files);
    },
    [
      handleDragEntryEnd,
      handleDropEntryToFolder,
      handleDropFilesToFolder,
      selectedFolderPath,
    ],
  );

  const handleExplorerRootDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.target === event.currentTarget) dragHoverFolderRef.current = "";
      const payload =
        activeDragEntryRef.current ??
        getExplorerDragPayload(event.dataTransfer);
      event.dataTransfer.dropEffect = payload ? "move" : "copy";
    },
    [],
  );

  const handleExplorerRootDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (dragMoveTriggeredRef.current) {
        handleDragEntryEnd();
        return;
      }
      const payload =
        activeDragEntryRef.current ??
        getExplorerDragPayload(event.dataTransfer);
      if (payload) {
        event.stopPropagation();
        handleDragEntryEnd();
        handleDropEntryToFolder(payload.entryPath, payload.entryType, "");
        return;
      }
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length) void handleDropFilesToFolder("", files);
    },
    [handleDropEntryToFolder, handleDropFilesToFolder, handleDragEntryEnd],
  );

  const handleOpenContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLElement>,
      entryPath: string,
      entryType: "file" | "directory",
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setExplorerContextMenu({
        x: event.clientX,
        y: event.clientY,
        entryPath,
        entryType,
      });
    },
    [],
  );

  useEffect(() => {
    const close = () => setExplorerContextMenu(null);
    const onPointerDown = (e: MouseEvent) => {
      if (contextMenuRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", close);
    };
  }, []);

  useEffect(() => {
    const onDragOver = (e: Event) => {
      if (!activeDragEntryRef.current) return;
      const de = e as globalThis.DragEvent;
      de.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = "move";
    };
    const onDragEnd = () => {
      const p = activeDragEntryRef.current;
      if (!p) return;
      if (!dragMoveTriggeredRef.current) {
        const src = getParentFolderPath(p.entryPath);
        if (dragHoverFolderRef.current !== src)
          handleDropEntryToFolder(
            p.entryPath,
            p.entryType,
            dragHoverFolderRef.current,
          );
      }
      handleDragEntryEnd();
    };
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragend", onDragEnd, true);
    return () => {
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragend", onDragEnd, true);
    };
  }, [handleDropEntryToFolder, handleDragEntryEnd]);

  const handleImportCodeFromChat = (code: string) => {
    if (!selectedFilePath) {
      setErrorMessage("Select a file before importing.");
      return;
    }
    setErrorMessage(null);
    setSelectedFileContent(code);
    setSelectedFileAiRanges([getFullRangeForCode(code)]);
    setEditorAiRangesToken((p) => p + 1);
    setEditorReplaceContent(code);
    setEditorReplaceSource("ai");
    setEditorReplaceToken((p) => p + 1);
    setFileMessage("Imported code from AI.");
  };

  const editorLanguage = useMemo(
    () => getLanguageFromFilePath(selectedFilePath),
    [selectedFilePath],
  );
  const effectiveEditorRoom = `${collaborationRoomId}:${selectedFilePath ?? "root"}`;
  const effectiveEditorKey = `${effectiveEditorRoom}:${editorSessionNonce}`;
  const runtimeDefaults = useMemo(
    () => getRuntimeConfigForFilePath(selectedFilePath),
    [selectedFilePath],
  );
  const isHtmlPreviewFile = Boolean(
    selectedFilePath &&
    (selectedFilePath.toLowerCase().endsWith(".html") ||
      selectedFilePath.toLowerCase().endsWith(".htm")),
  );
  const selectedVersion =
    selectedVersionIndex != null && selectedVersionIndex >= 0
      ? (fileVersions[selectedVersionIndex] ?? null)
      : null;
  const selectedVersionTimeLabel = selectedVersion
    ? new Date(selectedVersion.createdAt).toLocaleString()
    : "—";
  const isViewingOldVersion =
    selectedVersionIndex != null &&
    selectedVersionIndex < fileVersions.length - 1;

  /* ── Loading / Error ── */
  if (isCheckingAccess)
    return (
      <main
        style={{
          height: "100vh",
          background: "#03070f",
          color: "#e6edf3",
          display: "grid",
          placeItems: "center",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 32,
              height: 32,
              border: "2px solid #161b22",
              borderTop: "2px solid #388bfd",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p style={{ color: "#484f58", fontSize: 12 }}>Loading repo…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </main>
    );

  if (errorMessage)
    return (
      <main
        style={{
          height: "100vh",
          background: "#03070f",
          color: "#e6edf3",
          display: "grid",
          placeItems: "center",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#f85149", fontSize: 13, marginBottom: 16 }}>
            {errorMessage}
          </p>
          <Link
            href="/workspace"
            style={{ color: "#388bfd", fontSize: 12, textDecoration: "none" }}
          >
            ← Back to repos
          </Link>
        </div>
      </main>
    );

  /* ── Design tokens ── */
  const C = {
    bg: "#03070f",
    surface: "#080d18",
    surface2: "#0c1220",
    border: "#0f1829",
    border2: "#162033",
    text: "#e6edf3",
    muted: "#484f58",
    accent: "#388bfd",
    green: "#3fb950",
    red: "#f85149",
    yellow: "#e3b341",
  };

  const timelineMax = Math.max(0, fileVersions.length - 1);
  const timelineValue = selectedVersionIndex ?? timelineMax;
  const timelineProgress =
    timelineMax > 0 ? (timelineValue / timelineMax) * 100 : 100;

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: C.bg,
        color: C.text,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={handleDropFilesAnywhere}
    >
      {/* Ambient glow — subtle, not interactive */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background:
            "radial-gradient(ellipse 60% 40% at 20% 10%, rgba(56,139,253,0.04) 0%, transparent 70%), radial-gradient(ellipse 40% 30% at 80% 80%, rgba(63,185,80,0.025) 0%, transparent 70%)",
        }}
      />

      {/* ── Top bar ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          borderBottom: `1px solid ${C.border}`,
          background: C.surface,
          flexShrink: 0,
          height: 38,
        }}
      >
        {/* Left: nav */}
        <Link
          href="/workspace"
          style={{
            color: C.muted,
            fontSize: 11,
            textDecoration: "none",
            letterSpacing: "0.02em",
          }}
        >
          ← repos
        </Link>
        <span style={{ color: C.border2 }}>/</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: C.text,
            letterSpacing: "-0.01em",
          }}
        >
          {repoName ?? repoId}
        </span>
        <span
          style={{
            padding: "1px 7px",
            borderRadius: 20,
            background: isOwner
              ? "rgba(56,139,253,0.12)"
              : "rgba(163,113,247,0.12)",
            color: isOwner ? C.accent : "#a371f7",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {isOwner ? "owner" : "collab"}
        </span>
        {!isOwner && (
          <span style={{ color: C.muted, fontSize: 10 }}>
            by {getOwnerLabel(ownerName, ownerEmail)}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Right: actions */}
        {fileMessage && (
          <span
            style={{
              fontSize: 10,
              color:
                fileMessage.includes("failed") || fileMessage.includes("Error")
                  ? C.red
                  : C.green,
              animation: "fadein .3s both",
            }}
          >
            {fileMessage}
          </span>
        )}

        <TopBtn
          onClick={handleSaveFile}
          disabled={!selectedFilePath || isSavingFile || isLoadingSelectedFile}
          accent
        >
          {isLoadingSelectedFile ? "loading…" : isSavingFile ? "saving…" : "⌘S"}
        </TopBtn>

        {/* Time travel toggle */}
        {selectedFilePath && fileVersions.length > 0 && (
          <TopBtn
            onClick={() => setTimeTravelOpen((o) => !o)}
            active={timeTravelOpen}
          >
            ⏱ {fileVersions.length}
          </TopBtn>
        )}

        <TopBtn onClick={() => setChatOpen((o) => !o)} active={chatOpen}>
          ✦ AI
        </TopBtn>

        {isOwner && (
          <div style={{ position: "relative" }}>
            <TopBtn
              onClick={() => setInviteOpen((o) => !o)}
              active={inviteOpen}
            >
              + Invite
            </TopBtn>
            {inviteOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: C.surface,
                  border: `1px solid ${C.border2}`,
                  borderRadius: 10,
                  padding: 14,
                  width: 300,
                  zIndex: 200,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
                }}
              >
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 10,
                    color: C.text,
                    letterSpacing: "0.05em",
                  }}
                >
                  INVITE COLLABORATORS
                </p>
                <form
                  onSubmit={handleInvite}
                  style={{ display: "flex", gap: 6 }}
                >
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@example.com"
                    style={{
                      flex: 1,
                      padding: "6px 9px",
                      borderRadius: 5,
                      border: `1px solid ${C.border2}`,
                      background: C.bg,
                      color: C.text,
                      fontSize: 11,
                      outline: "none",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isInviting}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 5,
                      border: "none",
                      background: "#238636",
                      color: "#fff",
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {isInviting ? "…" : "Send"}
                  </button>
                </form>
                {inviteError && (
                  <p style={{ fontSize: 10, color: C.red, marginTop: 5 }}>
                    {inviteError}
                  </p>
                )}
                {inviteMessage && (
                  <p style={{ fontSize: 10, color: C.green, marginTop: 5 }}>
                    {inviteMessage}
                  </p>
                )}
                {invites.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      borderTop: `1px solid ${C.border}`,
                      paddingTop: 8,
                    }}
                  >
                    {invites.map((inv) => (
                      <div
                        key={inv.email}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 10,
                          padding: "2px 0",
                          color: "#8b949e",
                        }}
                      >
                        <span>{inv.email}</span>
                        <span style={{ color: C.muted }}>{inv.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Time travel bar (collapsible) ── */}
      {timeTravelOpen && selectedFilePath && fileVersions.length > 0 && (
        <div
          style={{
            position: "relative",
            zIndex: 9,
            borderBottom: `1px solid ${C.border}`,
            background: C.surface2,
            padding: "10px 16px 12px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              border: `1px solid ${C.border2}`,
              borderRadius: 10,
              background:
                "linear-gradient(180deg, rgba(17,24,39,.72), rgba(9,14,24,.9))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)",
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: C.accent,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                }}
              >
                Time Travel
              </span>
              <span style={{ fontSize: 10, color: C.muted }}>
                {isLoadingVersionHistory
                  ? "loading…"
                  : `${fileVersions.length} checkpoints`}
              </span>
              {isViewingOldVersion && (
                <span
                  style={{
                    fontSize: 10,
                    color: C.yellow,
                    border: `1px solid rgba(227,179,65,.35)`,
                    background: "rgba(227,179,65,.08)",
                    borderRadius: 999,
                    padding: "2px 7px",
                  }}
                >
                  viewing {selectedVersionTimeLabel}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <button
                onClick={() => {
                  setSelectedVersionIndex(
                    fileVersions.length ? fileVersions.length - 1 : null,
                  );
                  setPreviewVersionContent("");
                  setPreviewVersionAiRanges([]);
                }}
                style={{
                  padding: "3px 9px",
                  borderRadius: 6,
                  border: `1px solid ${C.border2}`,
                  background: "transparent",
                  color: C.muted,
                  fontSize: 10,
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Live
              </button>
              <button
                onClick={() => void handleRestoreSelectedVersion()}
                disabled={
                  isRestoringVersion ||
                  selectedVersionIndex == null ||
                  !isViewingOldVersion
                }
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: isViewingOldVersion ? C.accent : C.border2,
                  color: isViewingOldVersion ? "#fff" : C.muted,
                  fontSize: 10,
                  cursor: isViewingOldVersion ? "pointer" : "default",
                  fontFamily: "'JetBrains Mono', monospace",
                  opacity: isRestoringVersion ? 0.6 : 1,
                }}
              >
                {isRestoringVersion ? "Restoring…" : "Restore"}
              </button>
            </div>

            <input
              type="range"
              min={0}
              max={timelineMax}
              step={1}
              value={timelineValue}
              onChange={(e) =>
                void handleTimelinePreview(Number(e.target.value))
              }
              style={{
                width: "100%",
                height: 4,
                borderRadius: 999,
                appearance: "none",
                background: `linear-gradient(90deg, ${C.accent} 0%, ${C.accent} ${timelineProgress}%, ${C.border2} ${timelineProgress}%, ${C.border2} 100%)`,
                outline: "none",
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 5,
                fontSize: 9,
                color: C.muted,
              }}
            >
              <span>oldest</span>
              <span>
                {timelineValue + 1} / {fileVersions.length}
              </span>
              <span>live</span>
            </div>

            {isLoadingVersionPreview && (
              <p style={{ fontSize: 10, color: C.muted, marginTop: 7 }}>
                Loading preview…
              </p>
            )}
            {previewVersionContent && !isLoadingVersionPreview && (
              <pre
                style={{
                  marginTop: 8,
                  maxHeight: 96,
                  overflow: "auto",
                  background: "rgba(3,7,15,.9)",
                  border: `1px solid ${C.border2}`,
                  borderRadius: 7,
                  padding: "7px 9px",
                  color: "#8b949e",
                  fontSize: 10,
                  lineHeight: 1.5,
                }}
              >
                {previewVersionContent.slice(0, 3000)}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* ── Workspace ── */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* ── Sidebar ── */}
        <div
          style={{
            width: sidebar.size,
            minWidth: sidebar.size,
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${C.border}`,
            background: C.surface,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px",
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: C.muted,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Explorer
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              {[
                { title: "New file", label: "+", onClick: handleCreateFile },
                {
                  title: "New folder",
                  label: "📁",
                  onClick: handleCreateFolder,
                },
                {
                  title: "Refresh",
                  label: "↻",
                  onClick: () => void loadFileTree(),
                },
              ].map((btn) => (
                <button
                  key={btn.title}
                  onClick={btn.onClick}
                  title={btn.title}
                  style={{
                    background: "none",
                    border: "none",
                    color: C.muted,
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "1px 4px",
                    lineHeight: 1,
                    borderRadius: 3,
                    transition: "color 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = C.text)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          <div
            style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}
            onDragOver={handleExplorerRootDragOver}
            onDrop={handleExplorerRootDrop}
          >
            {isLoadingFiles ? (
              <p style={{ fontSize: 11, color: C.muted, padding: "8px 12px" }}>
                Loading…
              </p>
            ) : fileTree.length === 0 ? (
              <p
                style={{
                  fontSize: 11,
                  color: C.muted,
                  padding: "8px 12px",
                  lineHeight: 1.6,
                }}
              >
                No files yet.
                <br />
                Drop files or click +
              </p>
            ) : (
              <FileTree
                nodes={fileTree}
                selectedFilePath={selectedFilePath}
                selectedFolderPath={selectedFolderPath}
                onSelectFile={(p) => {
                  setSelectedFilePath(p);
                  setSelectedFolderPath(getParentFolderPath(p));
                }}
                onSelectFolder={setSelectedFolderPath}
                onDropFilesToFolder={handleDropFilesToFolder}
                onDropEntryToFolder={handleDropEntryToFolder}
                onDragHoverFolder={handleDragHoverFolder}
                isMoveAlreadyTriggered={isMoveAlreadyTriggered}
                getActiveDragEntry={getActiveDragEntry}
                onDragEntryStart={handleDragEntryStart}
                onDragEntryEnd={handleDragEntryEnd}
                onOpenContextMenu={handleOpenContextMenu}
              />
            )}
          </div>
        </div>

        {/* Sidebar resize handle */}
        <div
          onMouseDown={sidebar.onMouseDown}
          style={{
            width: 3,
            cursor: "col-resize",
            background: "transparent",
            flexShrink: 0,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accent)}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        />

        {/* ── Editor + terminal ── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: `1px solid ${C.border}`,
              background: C.surface,
              flexShrink: 0,
              height: 34,
              paddingLeft: 4,
              overflowX: "auto",
            }}
          >
            {selectedFilePath ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "0 12px",
                  height: "100%",
                  borderRight: `1px solid ${C.border}`,
                  borderBottom: `2px solid ${C.accent}`,
                  background: C.bg,
                }}
              >
                <FileIcon name={selectedFilePath.split("/").pop() ?? ""} />
                <span
                  style={{ fontSize: 12, color: C.text, whiteSpace: "nowrap" }}
                >
                  {selectedFilePath.split("/").pop()}
                </span>
                <span style={{ fontSize: 10, color: C.muted, marginLeft: 2 }}>
                  {editorLanguage}
                </span>
                {isViewingOldVersion && (
                  <span style={{ fontSize: 9, color: C.yellow, marginLeft: 4 }}>
                    preview
                  </span>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 11, color: C.muted, padding: "0 12px" }}>
                No file open
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setTerminalOpen((o) => !o)}
              style={{
                height: "100%",
                padding: "0 12px",
                background: "transparent",
                border: "none",
                borderLeft: `1px solid ${C.border}`,
                color: terminalOpen ? C.text : C.muted,
                fontSize: 11,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "'JetBrains Mono', monospace",
                transition: "color 0.15s",
              }}
            >
              ⊟ terminal
            </button>
          </div>

          {/* Editor */}
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              minHeight: 0,
              display: "flex",
            }}
          >
            <div
              style={{
                flex: isHtmlPreviewFile ? "0 0 55%" : 1,
                minWidth: 0,
                borderRight: isHtmlPreviewFile
                  ? `1px solid ${C.border}`
                  : "none",
              }}
            >
              {selectedFilePath ? (
                isLoadingSelectedFile ||
                loadedSelectedFilePath !== selectedFilePath ? (
                  <div
                    style={{
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <p style={{ color: C.muted, fontSize: 12 }}>
                      Loading file…
                    </p>
                  </div>
                ) : (
                  <Editor
                    key={effectiveEditorKey}
                    roomId={effectiveEditorRoom}
                    filePath={selectedFilePath}
                    userId={user?.uid ?? null}
                    userName={user?.displayName ?? user?.email ?? null}
                    language={editorLanguage}
                    initialCode={selectedFileContent}
                    onCodeChange={(code) =>
                      handleEditorCodeChange(selectedFilePath, code)
                    }
                    replaceContentToken={editorReplaceToken}
                    replaceContentValue={editorReplaceContent}
                    replaceContentSource={editorReplaceSource}
                    initialAiRanges={selectedFileAiRanges}
                    aiRangesToken={editorAiRangesToken}
                    onAiRangesChange={(r) =>
                      handleEditorAiRangesChange(selectedFilePath, r)
                    }
                    embedded
                  />
                )
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <p
                      style={{ color: C.muted, fontSize: 13, marginBottom: 6 }}
                    >
                      No file selected
                    </p>
                    <p style={{ color: "#2d333b", fontSize: 11 }}>
                      Pick a file or drop anywhere
                    </p>
                  </div>
                </div>
              )}
            </div>

            {isHtmlPreviewFile && (
              <div
                style={{
                  flex: "0 0 45%",
                  minWidth: 280,
                  display: "flex",
                  flexDirection: "column",
                  background: C.bg,
                }}
              >
                <div
                  style={{
                    height: 30,
                    borderBottom: `1px solid ${C.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 10px",
                    fontSize: 10,
                    color: C.muted,
                    background: C.surface,
                  }}
                >
                  <span
                    style={{
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    Live Preview
                  </span>
                  <span>{selectedFilePath}</span>
                </div>
                <iframe
                  title="Live HTML Preview"
                  srcDoc={selectedFileContent}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                  style={{
                    flex: 1,
                    width: "100%",
                    border: "none",
                    background: "#fff",
                  }}
                />
              </div>
            )}
          </div>

          {/* Terminal */}
          {terminalOpen && (
            <>
              <div
                onMouseDown={terminal.onMouseDown}
                style={{
                  height: 3,
                  cursor: "row-resize",
                  background: "transparent",
                  flexShrink: 0,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = C.accent)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              />
              <div
                style={{
                  height: terminal.size,
                  minHeight: terminal.size,
                  borderTop: `1px solid ${C.border}`,
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                <SyncedTerminal
                  roomId={collaborationRoomId}
                  ownerUid={ownerUid}
                  repoId={repoId}
                  defaultImage={runtimeDefaults.image}
                  defaultCommand={runtimeDefaults.command}
                />
              </div>
            </>
          )}
        </div>

        {/* ── AI panel ── */}
        <div
          style={{
            width: chatOpen ? 340 : 0,
            minWidth: chatOpen ? 280 : 0,
            maxWidth: chatOpen ? 420 : 0,
            borderLeft: chatOpen ? `1px solid ${C.border}` : "none",
            background: C.surface2,
            overflow: "hidden",
            transition:
              "width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {chatOpen && (
            <>
              <div
                style={{
                  height: 34,
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 10px",
                  background: C.surface,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: C.accent,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                  }}
                >
                  ✦ AI Panel
                </span>
                <button
                  onClick={() => setChatOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: C.muted,
                    fontSize: 14,
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                <RepoChat
                  language={editorLanguage}
                  filePath={selectedFilePath}
                  codeContext={selectedFileContent}
                  onImportCode={handleImportCodeFromChat}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          borderTop: `1px solid ${C.border}`,
          background: C.surface,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 20,
          height: 24,
          fontSize: 10,
          color: C.muted,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: C.green,
            animation: "pulse 2s infinite",
          }}
        />
        <span style={{ color: C.green }}>connected</span>
        <span>{repoName ?? repoId}</span>
        {selectedFilePath && <span>{selectedFilePath}</span>}
        {selectedFilePath && <span>{editorLanguage}</span>}
        {isViewingOldVersion && (
          <span style={{ color: C.yellow }}>● time travel mode</span>
        )}
        <div style={{ flex: 1 }} />
        <span>iTECify · iTEC 2026</span>
      </div>

      {/* Context menu */}
      {explorerContextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: "fixed",
            left: explorerContextMenu.x,
            top: explorerContextMenu.y,
            minWidth: 140,
            background: C.surface,
            border: `1px solid ${C.border2}`,
            borderRadius: 7,
            boxShadow: "0 8px 28px rgba(0,0,0,0.7)",
            zIndex: 400,
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            {
              label: "Rename",
              color: C.text,
              action: () => {
                void handleRenameEntry(
                  explorerContextMenu.entryPath,
                  explorerContextMenu.entryType,
                );
                setExplorerContextMenu(null);
              },
            },
            {
              label: "Move",
              color: C.text,
              action: () => {
                void handleMoveEntry(
                  explorerContextMenu.entryPath,
                  explorerContextMenu.entryType,
                );
                setExplorerContextMenu(null);
              },
            },
            {
              label: "Delete",
              color: C.red,
              action: () => {
                void handleDeleteEntry(
                  explorerContextMenu.entryPath,
                  explorerContextMenu.entryType,
                );
                setExplorerContextMenu(null);
              },
            },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              style={{
                width: "100%",
                padding: "7px 10px",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: item.color,
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(255,255,255,0.04)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700;800&family=Syne:wght@700;800&display=swap');
        @keyframes fadein { from { opacity:0 } to { opacity:1 } }
        @keyframes pulse { 0%,100% { box-shadow:0 0 0 0 rgba(63,185,80,.4) } 50% { box-shadow:0 0 0 4px rgba(63,185,80,0) } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #161b22; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #21262d; }
      `}</style>
    </main>
  );
}

/* ─── TopBtn helper ──────────────────────────────────────────────────────── */

function TopBtn({
  children,
  onClick,
  disabled,
  accent,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  accent?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "3px 10px",
        borderRadius: 5,
        border: "1px solid",
        borderColor: accent
          ? "#238636"
          : active
            ? "rgba(56,139,253,0.4)"
            : "#0f1829",
        background: accent
          ? "#238636"
          : active
            ? "rgba(56,139,253,0.1)"
            : "transparent",
        color: accent ? "#fff" : active ? "#388bfd" : "#6e7681",
        fontSize: 11,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "'JetBrains Mono', monospace",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !accent) e.currentTarget.style.color = "#e6edf3";
      }}
      onMouseLeave={(e) => {
        if (!disabled && !accent)
          e.currentTarget.style.color = active ? "#388bfd" : "#6e7681";
      }}
    >
      {children}
    </button>
  );
}
