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
      if (!nextUser) router.replace("/login");
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
      { label: "Pipelines", href: "/dockertest", hint: "⇧B" },
      { label: "Dashboard", href: "/", hint: "D" },
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
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#0d1117",
        color: "#e6edf3",
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
        overflow: "hidden",
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
        search
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
          <SidebarItem title="Pipelines" href="/pipelines" />
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
              Search repositories
            </div>
            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
              Date live din Firestore, același layout/culori ca dashboard.
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <div style={{ flex: 1, display: "flex", gap: 8 }}>
                <input
                  value={queryText}
                  onChange={(event) => setQueryText(event.target.value)}
                  placeholder="Search repos or IDs"
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
                  ⌘K
                </div>
              </div>
            </div>
          </div>

          {/* panels */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              padding: 16,
              overflow: "auto",
            }}
          >
            <Panel title="Quick actions">
              {quickActions.map((action) => (
                <div
                  key={action.href}
                  style={{
                    padding: 12,
                    borderBottom: "1px solid #30363d",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13 }}>{action.label}</div>
                    <div style={{ fontSize: 11, color: "#8b949e" }}>
                      Jump directly
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#8b949e",
                      border: "1px solid #30363d",
                      padding: "4px 8px",
                      borderRadius: 6,
                    }}
                  >
                    {action.hint}
                  </div>
                </div>
              ))}
            </Panel>

            <Panel title="Stats">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                  borderBottom: "1px solid #30363d",
                }}
              >
                {[
                  { label: "Repos", value: repos.length },
                  { label: "Matches", value: filteredRepos.length },
                ].map((item, idx) => (
                  <div
                    key={item.label}
                    style={{
                      padding: 12,
                      borderRight: idx === 0 ? "1px solid #30363d" : undefined,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#8b949e" }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding: 12, fontSize: 12, color: "#8b949e" }}>
                Status: {user ? "Signed in" : "Guest"}
              </div>
            </Panel>

            <Panel title="Results">
              {errorMessage ? (
                <div style={{ padding: 12, fontSize: 12, color: "#f85149" }}>
                  {errorMessage}
                </div>
              ) : isLoading ? (
                <div style={{ padding: 12, fontSize: 12, color: "#8b949e" }}>
                  Loading repos...
                </div>
              ) : filteredRepos.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "#8b949e" }}>
                  No repos found. Try another term.
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    style={{
                      padding: 12,
                      borderBottom: "1px solid #30363d",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13 }}>{repo.name}</div>
                      <div style={{ fontSize: 11, color: "#8b949e" }}>
                        ID: {repo.id}
                      </div>
                    </div>
                    <Link
                      href={`/repo/${repo.id}`}
                      style={{ fontSize: 11, color: "#58a6ff" }}
                    >
                      open
                    </Link>
                  </div>
                ))
              )}
            </Panel>

            <div />
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
