"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  getDocs,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import Navbar from "@/components/Navbar";
import { auth, db } from "@/lib/firebase";

type RepoRecord = {
  id: string;
  name: string;
  createdAt?: Timestamp;
};

export default function SearchPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [queryText, setQueryText] = useState("");
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(auth));
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
    const loadRepos = async () => {
      if (!db || !user) {
        setRepos([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const repoCollection = collection(db, "users", user.uid, "repos");
        const repoQuery = query(repoCollection, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(repoQuery);
        setRepos(
          snapshot.docs.map((repoDoc) => {
            const data = repoDoc.data() as {
              name?: string;
              createdAt?: Timestamp;
            };
            return {
              id: repoDoc.id,
              name: data.name ?? "Untitled Repo",
              createdAt: data.createdAt,
            };
          }),
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load repos.",
        );
      }

      setIsLoading(false);
    };

    void loadRepos();
  }, [user]);

  const quickActions = useMemo(
    () => [
      { label: "Open workspace", href: "/workspace", hint: "⌘K" },
      { label: "View profile", href: "/profile", hint: "P" },
      { label: "Settings", href: "/settings", hint: "," },
      { label: "Pipelines", href: "/dockertest", hint: "⇧B" },
    ],
    [],
  );

  const filteredRepos = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(needle) ||
        repo.id.toLowerCase().includes(needle),
    );
  }, [queryText, repos]);

  return (
    <main className="ml-12 min-h-screen bg-[#0a0f16] text-[#c9d1d9]">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(88,166,255,0.12),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(63,185,80,0.12),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(248,81,73,0.12),transparent_30%)]"
        aria-hidden
      />

      <Navbar />

      <section className="relative mx-auto max-w-6xl px-6 pb-12 pt-8">
        <header className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-[#8b949e]">
              Search
            </p>
            <h1 className="text-2xl font-semibold text-white">
              Find repos, people, and actions
            </h1>
            <p className="text-sm text-[#8b949e]">
              Use quick actions or filter your repos to jump in faster.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[#1f2a38] bg-[#0f1622] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
            <input
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Search repos, IDs, commands..."
              className="w-64 bg-transparent text-sm text-white outline-none placeholder:text-[#6e7681]"
            />
            <span className="text-[11px] text-[#8b949e]">Enter</span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Quick actions
              </h2>
              <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                Navigator
              </span>
            </div>
            <div className="space-y-2 text-sm">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-white transition hover:-translate-y-px hover:border-[#58a6ff]"
                >
                  <span>{action.label}</span>
                  <span className="text-[11px] text-[#8b949e]">
                    {action.hint}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Your repos</h2>
              <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                {filteredRepos.length} match
                {filteredRepos.length === 1 ? "" : "es"}
              </span>
            </div>

            {errorMessage ? (
              <p className="text-sm text-red-400">{errorMessage}</p>
            ) : isLoading ? (
              <p className="text-sm text-[#8b949e]">Loading repos...</p>
            ) : filteredRepos.length === 0 ? (
              <p className="text-sm text-[#8b949e]">
                No repos found. Try another term.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                {filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#0a0f16] px-4 py-3 transition hover:-translate-y-px hover:border-[#58a6ff]"
                  >
                    <div>
                      <p className="text-white">{repo.name}</p>
                      <p className="text-[11px] text-[#8b949e]">
                        ID: {repo.id}
                      </p>
                    </div>
                    <Link
                      href={`/repo/${repo.id}`}
                      className="text-xs font-semibold text-[#58a6ff] hover:text-[#79c0ff]"
                    >
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Global shortcuts
            </h2>
            <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
              Productivity
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 text-sm">
            {[
              "⌘K Command Palette",
              "⇧⌘P Actions",
              "⌘B Toggle sidebar",
              "⌘J Toggle terminal",
            ].map((shortcut) => (
              <div
                key={shortcut}
                className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-white"
              >
                <span>{shortcut}</span>
                <span className="text-[11px] text-[#8b949e]">Guide</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
