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
        const snapshot = await getDocs(collection(db, "users", user.uid, "extensions"));
        setInstalledIds(snapshot.docs.map((docRef) => docRef.id));
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load installed extensions.",
        );
      }
    };

    void loadInstalled();
  }, [user]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return EXTENSIONS;
    return EXTENSIONS.filter((ext) =>
      `${ext.name} ${ext.publisher} ${ext.tags.join(" ")}`.toLowerCase().includes(needle),
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
        error instanceof Error ? error.message : "Unable to update extension state.",
      );
    }

    setIsSyncing(false);
  };

  return (
    <main className="ml-12 min-h-screen bg-[#0a0f16] text-[#c9d1d9]">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(88,166,255,0.12),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(63,185,80,0.12),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(248,81,73,0.12),transparent_30%)]"
        aria-hidden
      />

      <Navbar />

      <section className="relative mx-auto max-w-6xl px-6 pb-12 pt-8">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-[#8b949e]">Extensions</p>
            <h1 className="text-2xl font-semibold text-white">Install add-ons for your workspace</h1>
            <p className="text-sm text-[#8b949e]">
              Browse popular extensions and add them to your cloud workspace. Installs persist to your account.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[#1f2a38] bg-[#0f1622] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search extensions, publishers, tags..."
              className="w-72 bg-transparent text-sm text-white outline-none placeholder:text-[#6e7681]"
            />
            <span className="text-[11px] text-[#8b949e]">Enter</span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            {errorMessage ? (
              <p className="text-sm text-red-400">{errorMessage}</p>
            ) : null}
            {filtered.map((ext) => {
              const isInstalled = installedIds.includes(ext.id);
              return (
                <div
                  key={ext.id}
                  className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.45)] transition hover:-translate-y-px hover:border-[#58a6ff]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm uppercase tracking-wide text-[#8b949e]">{ext.publisher}</p>
                      <h2 className="text-lg font-semibold text-white">{ext.name}</h2>
                      <p className="text-sm text-[#8b949e]">{ext.description}</p>
                      <div className="flex flex-wrap gap-2 text-[11px] text-[#8b949e]">
                        <span className="rounded-full bg-[#0a0f16] px-2 py-1">{ext.installs} installs</span>
                        <span className="rounded-full bg-[#0a0f16] px-2 py-1">★ {ext.rating}</span>
                        {ext.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-[#30363d] bg-[#0a0f16] px-2 py-1"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleInstall(ext.id)}
                      disabled={isSyncing}
                      className={`rounded-md px-4 py-2 text-sm font-semibold transition shadow-[0_10px_25px_rgba(0,0,0,0.35)] disabled:opacity-60 ${
                        isInstalled
                          ? "bg-[#0a0f16] text-[#8b949e] border border-[#30363d] hover:border-[#f85149] hover:text-[#f85149]"
                          : "bg-[#58a6ff] text-black hover:bg-[#79c0ff]"
                      }`}
                    >
                      {isInstalled ? "Uninstall" : "Install"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Installed</h3>
                <span className="rounded-full bg-[#0a0f16] px-2 py-1 text-[11px] text-[#8b949e]">{installed.length}</span>
              </div>
              {installed.length === 0 ? (
                <p className="text-sm text-[#8b949e]">No extensions installed yet.</p>
              ) : (
                <div className="space-y-3 text-sm">
                  {installed.map((ext) => (
                    <div
                      key={ext.id}
                      className="rounded-lg border border-[#30363d] bg-[#0a0f16] px-3 py-2"
                    >
                      <p className="font-semibold text-white">{ext.name}</p>
                      <p className="text-[11px] text-[#8b949e]">{ext.publisher}</p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-[#8b949e]">
                        <span>{ext.installs} installs</span>
                        <button
                          type="button"
                          onClick={() => toggleInstall(ext.id)}
                          className="text-[#f85149] hover:text-[#ff6b6b]"
                          disabled={isSyncing}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Recommended packs</h3>
                <span className="rounded-full bg-[#0a0f16] px-2 py-1 text-[11px] text-[#8b949e]">Coming soon</span>
              </div>
              <p className="text-sm text-[#8b949e]">
                Curated bundles for web, data, and infra will be available in a future release.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
