"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import Navbar from "@/components/Navbar";

/* ─── Configurare Design (Consistent cu Repo Editor) ────────────────────── */
const THEME = {
  bg: "#0d1117",
  bgSecondary: "#161b22",
  border: "#21262d",
  textMain: "#e6edf3",
  textSecondary: "#8b949e",
  accent: "#58a6ff",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

type RepoRecord = {
  id: string;
  name: string;
  createdAt?: Timestamp;
  role?: "owner" | "collaborator";
  ownerName?: string;
  ownerUid?: string;
  ownerEmail?: string;
};

type InvitedRepoRecord = {
  id: string;
  name: string;
  ownerName?: string;
  ownerUid: string;
  ownerEmail?: string;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export default function WorkspacePage() {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [invitedRepos, setInvitedRepos] = useState<InvitedRepoRecord[]>([]);
  const [repoName, setRepoName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoiningRepoKey, setIsJoiningRepoKey] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) router.replace("/login");
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    const load = async () => {
      if (!db || !user) return;
      try {
        const repoQuery = query(
          collection(db, "users", user.uid, "repos"),
          orderBy("createdAt", "desc"),
        );
        const snapshot = await getDocs(repoQuery);
        setRepos(
          snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })),
        );

        const email = normalizeEmail(user.email || "");
        const allRepos = await getDocs(collectionGroup(db, "repos"));
        const invites: InvitedRepoRecord[] = [];

        for (const repoDoc of allRepos.docs) {
          const parts = repoDoc.ref.path.split("/");
          const ownerUid = parts[1];
          const repoId = parts[3];
          if (ownerUid === user.uid) continue;

          const inviteDoc = await getDoc(
            doc(
              db,
              "users",
              ownerUid,
              "repos",
              repoId,
              "invites",
              encodeURIComponent(email),
            ),
          );
          if (inviteDoc.exists()) {
            const data = repoDoc.data();
            invites.push({
              id: repoId,
              name: data.name,
              ownerUid,
              ownerName: data.ownerName,
              ownerEmail: data.ownerEmail,
            });
          }
        }
        setInvitedRepos(invites);
      } catch (e) {
        console.error("Error loading workspace:", e);
      }
    };
    load();
  }, [user]);

  const handleCreateRepo = async () => {
    if (!db || !user || !repoName.trim()) return;
    setIsCreating(true);
    const repoId = `repo-${crypto.randomUUID().slice(0, 8)}`;
    await setDoc(doc(db, "users", user.uid, "repos", repoId), {
      name: repoName,
      role: "owner",
      ownerUid: user.uid,
      ownerEmail: user.email,
      createdAt: serverTimestamp(),
    });
    setRepos((r) => [{ id: repoId, name: repoName }, ...r]);
    setRepoName("");
    setIsCreating(false);
  };

  const handleJoinRepo = async (repo: InvitedRepoRecord) => {
    if (!db || !user) return;
    setIsJoiningRepoKey(repo.id);
    await setDoc(doc(db, "users", user.uid, "repos", repo.id), {
      name: repo.name,
      role: "collaborator",
      ownerUid: repo.ownerUid,
      createdAt: serverTimestamp(),
    });
    setRepos((r) => [{ id: repo.id, name: repo.name }, ...r]);
    setInvitedRepos((i) => i.filter((x) => x.id !== repo.id));
    setIsJoiningRepoKey(null);
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
        workspace
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
          <SidebarItem title="Profile" href="/profile" />
          <SidebarItem title="Pipelines" href="/dockertest" />
          <SidebarItem title="Dashboard" href="/" />
          <SidebarItem title="Extensions" href="/extensions" />

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
            <div style={{ fontSize: 18, fontWeight: 600 }}>Workspace</div>
            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
              Manage repos and invites; Firestore-backed.
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="New repository name..."
                  style={{
                    background: "#0d1117",
                    color: "#e6edf3",
                    border: "1px solid #30363d",
                    padding: "8px 10px",
                    fontSize: 12,
                    borderRadius: 6,
                    outline: "none",
                    minWidth: 240,
                  }}
                />
                <button
                  onClick={handleCreateRepo}
                  disabled={isCreating || !repoName.trim()}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: "#58a6ff",
                    color: "#0d1117",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: isCreating || !repoName.trim() ? 0.6 : 1,
                  }}
                >
                  {isCreating ? "..." : "+ Create"}
                </button>
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
            <Panel title={`Invites (${invitedRepos.length})`}>
              {invitedRepos.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "#8b949e" }}>
                  No pending invites.
                </div>
              ) : (
                invitedRepos.map((repo, idx) => (
                  <div
                    key={repo.id}
                    style={{
                      padding: 12,
                      borderBottom:
                        idx === invitedRepos.length - 1
                          ? "none"
                          : "1px solid #30363d",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {repo.name}
                      </div>
                      <div style={{ fontSize: 11, color: "#8b949e" }}>
                        Invited by {repo.ownerName || repo.ownerEmail}
                      </div>
                    </div>
                    <button
                      onClick={() => handleJoinRepo(repo)}
                      disabled={isJoiningRepoKey === repo.id}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid #30363d",
                        background: "#0d1117",
                        color: "#e6edf3",
                        fontSize: 12,
                        cursor: "pointer",
                        opacity: isJoiningRepoKey === repo.id ? 0.6 : 1,
                      }}
                    >
                      {isJoiningRepoKey === repo.id ? "Joining..." : "Join"}
                    </button>
                  </div>
                ))
              )}
            </Panel>

            <Panel title={`Your repositories (${repos.length})`}>
              {repos.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "#8b949e" }}>
                  No repositories yet. Create one above.
                </div>
              ) : (
                repos.map((repo, idx) => (
                  <Link
                    key={repo.id}
                    href={`/repo/${repo.id}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: 12,
                      borderBottom:
                        idx === repos.length - 1 ? "none" : "1px solid #30363d",
                      textDecoration: "none",
                      color: "#e6edf3",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13 }}>{repo.name}</div>
                      <div style={{ fontSize: 11, color: "#8b949e" }}>
                        ID: {repo.id}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: "#58a6ff" }}>open</span>
                  </Link>
                ))
              )}
            </Panel>
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
