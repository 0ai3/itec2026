"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import Navbar from "@/components/Navbar";
import { auth, db } from "@/lib/firebase";

const EXTENSIONS = [
  {
    id: "ms-python",
    name: "Python Tools",
    publisher: "Microsoft",
    installs: "5.2M",
    rating: "4.8",
    tags: ["python", "lint", "debug"],
    description: "Language server, linting, debugging, and Jupyter support.",
  },
  {
    id: "esbenp.prettier",
    name: "Prettier Formatter",
    publisher: "Prettier",
    installs: "12.4M",
    rating: "4.9",
    tags: ["format", "javascript", "typescript"],
    description: "Opinionated code formatter with workspace overrides.",
  },
  {
    id: "dbaeumer.vscode-eslint",
    name: "ESLint",
    publisher: "Dirk Baeumer",
    installs: "15.1M",
    rating: "4.7",
    tags: ["lint", "javascript", "typescript"],
    description: "Inline diagnostics and auto-fix for JS/TS projects.",
  },
  {
    id: "prisma.prisma",
    name: "Prisma",
    publisher: "Prisma",
    installs: "1.9M",
    rating: "4.8",
    tags: ["database", "schema", "lint"],
    description: "Schema autocompletion, formatting, and migrate helpers.",
  },
  {
    id: "gitlens",
    name: "GitLens",
    publisher: "GitKraken",
    installs: "18.0M",
    rating: "4.9",
    tags: ["git", "blame", "history"],
    description: "Blame, line authorship, and commit insights in the editor.",
  },
  {
    id: "tailwindcss",
    name: "Tailwind CSS IntelliSense",
    publisher: "Tailwind Labs",
    installs: "8.7M",
    rating: "4.9",
    tags: ["css", "design", "intellisense"],
    description: "Class name autocomplete, linting, and design tokens.",
  },
  {
    id: "ms-vscode.vscode-typescript-next",
    name: "TypeScript Next",
    publisher: "Microsoft",
    installs: "2.1M",
    rating: "4.7",
    tags: ["typescript", "language", "intellisense"],
    description: "Bleeding-edge TS/JS language features and fixes.",
  },
  {
    id: "ms-vscode.go",
    name: "Go",
    publisher: "Go Team at Google",
    installs: "5.6M",
    rating: "4.8",
    tags: ["go", "lint", "debug"],
    description: "Go tools, gopls language server, tests, and debugging.",
  },
  {
    id: "ms-azuretools.vscode-docker",
    name: "Docker",
    publisher: "Microsoft",
    installs: "18.9M",
    rating: "4.8",
    tags: ["docker", "containers", "kubernetes"],
    description: "Build, run, and manage containers plus compose workflows.",
  },
  {
    id: "redhat.vscode-yaml",
    name: "YAML",
    publisher: "Red Hat",
    installs: "12.0M",
    rating: "4.7",
    tags: ["yaml", "schemas", "kubernetes"],
    description: "Schema-aware YAML with validation and hover.",
  },
  {
    id: "ms-toolsai.jupyter",
    name: "Jupyter",
    publisher: "Microsoft",
    installs: "52.3M",
    rating: "4.8",
    tags: ["python", "notebooks", "data"],
    description: "Run notebooks with rich outputs and kernel management.",
  },
  {
    id: "vscodevim.vim",
    name: "Vim",
    publisher: "Vim",
    installs: "13.7M",
    rating: "4.7",
    tags: ["vim", "productivity", "keys"],
    description: "Vim keybindings and motions throughout the editor.",
  },
  {
    id: "ms-vsliveshare.vsliveshare",
    name: "Live Share",
    publisher: "Microsoft",
    installs: "29.4M",
    rating: "4.7",
    tags: ["collaboration", "pairing", "sharing"],
    description: "Real-time co-editing, terminals, and servers.",
  },
  {
    id: "ms-vscode.cpptools",
    name: "C/C++",
    publisher: "Microsoft",
    installs: "37.5M",
    rating: "4.6",
    tags: ["c", "cpp", "debug"],
    description: "IntelliSense, debugging, and CMake integration.",
  },
  {
    id: "bierner.markdown-mermaid",
    name: "Markdown Mermaid",
    publisher: "Matt Bierner",
    installs: "2.2M",
    rating: "4.8",
    tags: ["markdown", "diagrams", "docs"],
    description: "Preview Mermaid diagrams inside Markdown.",
  },
];

export default function ExtensionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [query, setQuery] = useState("");
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        router.replace("/login");
      }
    });

    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    const loadInstalled = async () => {
      if (!db || !user) {
        setInstalledIds([]);
        return;
      }
      try {
        const snapshot = await getDocs(
          collection(db, "users", user.uid, "extensions"),
        );
        setInstalledIds(snapshot.docs.map((docRef) => docRef.id));
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load installed extensions.",
        );
      }
    };

    void loadInstalled();
  }, [user]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return EXTENSIONS;
    return EXTENSIONS.filter((ext) =>
      `${ext.name} ${ext.publisher} ${ext.tags.join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  const installed = useMemo(
    () => EXTENSIONS.filter((ext) => installedIds.includes(ext.id)),
    [installedIds],
  );

  const toggleInstall = async (id: string) => {
    if (!db || !user) return;
    setIsSyncing(true);
    setErrorMessage(null);

    const extMeta = EXTENSIONS.find((ext) => ext.id === id);

    try {
      if (installedIds.includes(id)) {
        await deleteDoc(doc(db, "users", user.uid, "extensions", id));
        setInstalledIds((prev) => prev.filter((item) => item !== id));
      } else {
        await setDoc(doc(db, "users", user.uid, "extensions", id), {
          name: extMeta?.name ?? id,
          publisher: extMeta?.publisher ?? "",
          installedAt: new Date().toISOString(),
        });
        setInstalledIds((prev) => [...prev, id]);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to update extension state.",
      );
    }

    setIsSyncing(false);
  };

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#0d1117",
        color: "#e6edf3",
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
      }}
    >
      <Navbar />

      {/* top bar */}
      <div
        style={{
          height: 42,
          borderBottom: "1px solid #21262d",
          background: "#161b22",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          fontSize: 12,
          color: "#8b949e",
        }}
      >
        extensions
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* sidebar */}
        <div
          style={{
            borderRight: "1px solid #21262d",
            background: "#0d1117",
          }}
        >
          <SidebarItem title="Workspace" href="/workspace" />
          <SidebarItem title="Profile" href="/profile" />
          <SidebarItem title="Dashboard" href="/" />
        </div>

        {/* content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* header */}
          <div style={{ padding: 20, borderBottom: "1px solid #21262d" }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              Extensions catalog
            </div>
            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
              Browse and install add-ons; installs persist in Firestore.
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <div style={{ flex: 1, display: "flex", gap: 8, maxWidth: 520 }}>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search extensions, publishers, tags..."
                  style={{
                    flex: 1,
                    background: "#0d1117",
                    color: "#e6edf3",
                    border: "1px solid #30363d",
                    padding: "8px 10px",
                    fontSize: 12,
                    borderRadius: 6,
                    outline: "none",
                  }}
                />
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 10px",
                    fontSize: 11,
                    color: "#8b949e",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    background: "#161b22",
                  }}
                >
                  Enter
                </div>
              </div>
            </div>
          </div>

          {/* panels */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              gap: 16,
              padding: 16,
              overflow: "auto",
            }}
          >
            <Panel title="Catalog">
              {errorMessage ? (
                <div style={{ padding: 12, fontSize: 12, color: "#f85149" }}>
                  {errorMessage}
                </div>
              ) : null}

              {filtered.map((ext, idx) => {
                const isInstalled = installedIds.includes(ext.id);
                return (
                  <div
                    key={ext.id}
                    style={{
                      padding: 12,
                      borderBottom:
                        idx === filtered.length - 1
                          ? "none"
                          : "1px solid #30363d",
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            color: "#8b949e",
                            textTransform: "uppercase",
                          }}
                        >
                          {ext.publisher}
                        </div>
                        <Badge>{ext.rating}★</Badge>
                        <Badge>{ext.installs} installs</Badge>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {ext.name}
                      </div>
                      <div style={{ fontSize: 12, color: "#8b949e" }}>
                        {ext.description}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          marginTop: 4,
                        }}
                      >
                        {ext.tags.map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleInstall(ext.id)}
                      disabled={isSyncing}
                      style={{
                        minWidth: 96,
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: isInstalled ? "1px solid #30363d" : "none",
                        background: isInstalled ? "#0d1117" : "#58a6ff",
                        color: isInstalled ? "#8b949e" : "#0d1117",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
                        opacity: isSyncing ? 0.6 : 1,
                      }}
                    >
                      {isInstalled ? "Uninstall" : "Install"}
                    </button>
                  </div>
                );
              })}
            </Panel>

            <div style={{ display: "grid", gap: 16 }}>
              <Panel title={`Installed (${installed.length})`}>
                {installed.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: "#8b949e" }}>
                    No extensions installed yet.
                  </div>
                ) : (
                  installed.map((ext, idx) => (
                    <div
                      key={ext.id}
                      style={{
                        padding: 12,
                        borderBottom:
                          idx === installed.length - 1
                            ? "none"
                            : "1px solid #30363d",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {ext.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#8b949e" }}>
                          {ext.publisher}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#8b949e",
                            marginTop: 4,
                          }}
                        >
                          {ext.installs} installs
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleInstall(ext.id)}
                        disabled={isSyncing}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid #30363d",
                          background: "#0d1117",
                          color: "#f85149",
                          fontSize: 11,
                          cursor: "pointer",
                          opacity: isSyncing ? 0.6 : 1,
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </Panel>

              <Panel title="Recommended packs">
                <div style={{ padding: 12, fontSize: 12, color: "#8b949e" }}>
                  Curated bundles for web, data, and infra will be available in
                  a future release.
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function SidebarItem({ title, href }: { title: string; href: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "10px 14px",
        fontSize: 12,
        color: "#8b949e",
        borderBottom: "1px solid #161b22",
        textDecoration: "none",
      }}
    >
      {title}
    </Link>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid #30363d",
        background: "#161b22",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #30363d",
          fontSize: 12,
          color: "#8b949e",
        }}
      >
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        fontSize: 11,
        color: "#8b949e",
        border: "1px solid #30363d",
        borderRadius: 20,
        background: "#0d1117",
        gap: 4,
      }}
    >
      {children}
    </span>
  );
}
