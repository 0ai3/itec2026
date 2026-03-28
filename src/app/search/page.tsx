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

      <section className="relative mx-auto max-w-6xl px-6 pb-14 pt-10">
        <header className="mb-8 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.24em] text-[#7a8699]">
                Search
              </p>
              <h1 className="text-3xl font-semibold text-white">
                Command search & repo jump
              </h1>
              <p className="text-sm text-[#8b949e]">
                Filter repos, scan shortcuts, and move faster without leaving
                this screen.
              </p>
            </div>
            <div className="flex w-full max-w-xl items-center gap-3 rounded-2xl border border-[#1f2a38] bg-[#0f1622] px-4 py-3 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <span className="text-xs font-semibold text-[#58a6ff]">⌘K</span>
              <input
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="Search repos, IDs, actions..."
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#6e7681]"
              />
              <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                Enter
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[
              `Repos ${repos.length || 0}`,
              `Matches ${filteredRepos.length}`,
              `Status ${user ? "Signed in" : "Guest"}`,
              "Shortcuts 4x",
            ].map((label) => (
              <div
                key={label}
                className="rounded-xl border border-[#1f2a38] bg-[#0f1622] px-4 py-3 text-sm text-white shadow-[0_12px_35px_rgba(0,0,0,0.35)]"
              >
                <p className="text-[11px] uppercase tracking-wide text-[#7a8699]">
                  {label.split(" ")[0]}
                </p>
                <p className="text-lg font-semibold">
                  {label.split(" ").slice(1).join(" ")}
                </p>
              </div>
            ))}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Quick actions
              </h2>
              <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                Navigator
              </span>
            </div>
            <div className="grid gap-2 text-sm">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center justify-between rounded-lg border border-[#263346] bg-[#0b111b] px-4 py-3 text-white transition hover:-translate-y-px hover:border-[#58a6ff]"
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold">{action.label}</p>
                    <p className="text-[11px] text-[#7a8699]">Jump directly</p>
                  </div>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-[#8b949e]">
                    {action.hint}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Your repos</h2>
                <p className="text-sm text-[#8b949e]">
                  Sorted by newest; filtered live.
                </p>
              </div>
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
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                {filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex h-full flex-col justify-between rounded-lg border border-[#263346] bg-[#0b111b] px-4 py-4 transition hover:-translate-y-px hover:border-[#58a6ff]"
                  >
                    <div className="space-y-1">
                      <p className="text-white">{repo.name}</p>
                      <p className="text-[11px] text-[#8b949e]">
                        ID: {repo.id}
                      </p>
                    </div>
                    <Link
                      href={`/repo/${repo.id}`}
                      className="mt-3 inline-flex w-fit items-center gap-2 rounded-md border border-[#263346] px-3 py-1.5 text-xs font-semibold text-[#58a6ff] transition hover:border-[#58a6ff] hover:bg-[#0f1826] hover:text-[#79c0ff]"
                    >
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
