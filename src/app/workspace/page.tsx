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
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { auth, db } from "@/lib/firebase";

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

const getOwnerLabel = (ownerName?: string, ownerEmail?: string) => {
  if (ownerName && ownerName.trim()) {
    return ownerName;
  }
  if (ownerEmail && ownerEmail.includes("@")) {
    return ownerEmail.split("@")[0];
  }
  return "Unknown user";
};

const parseRepoPath = (path: string) => {
  const parts = path.split("/");
  if (parts.length < 4) {
    return null;
  }

  return {
    ownerUid: parts[1],
    repoId: parts[3],
  };
};

export default function WorkspacePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [repoName, setRepoName] = useState("");
  const [isLoadingRepos, setIsLoadingRepos] = useState(Boolean(auth));
  const [isLoadingInvites, setIsLoadingInvites] = useState(Boolean(auth));
  const [isCreating, setIsCreating] = useState(false);
  const [isJoiningRepoKey, setIsJoiningRepoKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invitedRepos, setInvitedRepos] = useState<InvitedRepoRecord[]>([]);

  const userInitials = useMemo(() => {
    const source = user?.displayName || user?.email || "";
    if (!source.trim()) return "WS";

    return source
      .trim()
      .split(/\s+|@/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user]);

  useEffect(() => {
    if (!auth) {
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        router.replace("/login");
      }
    });

    return () => {
      unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    const loadWorkspaceData = async () => {
      if (!db || !user) {
        setRepos([]);
        setInvitedRepos([]);
        setIsLoadingRepos(false);
        setIsLoadingInvites(false);
        return;
      }

      setIsLoadingRepos(true);
      setIsLoadingInvites(true);
      setErrorMessage(null);

      try {
        const repoCollection = collection(db, "users", user.uid, "repos");
        const repoQuery = query(repoCollection, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(repoQuery);
        const nextRepos = snapshot.docs.map((repoDoc) => {
          const data = repoDoc.data() as {
            name?: string;
            createdAt?: Timestamp;
            role?: "owner" | "collaborator";
            ownerName?: string;
            ownerUid?: string;
            ownerEmail?: string;
          };
          return {
            id: repoDoc.id,
            name: data.name ?? "Untitled Repo",
            createdAt: data.createdAt,
            role: data.role,
            ownerName: data.ownerName,
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
          };
        });

        const currentEmail = normalizeEmail(user.email ?? "");
        const hydratedRepos = await Promise.all(
          nextRepos.map(async (repo) => {
            if (
              repo.role !== "collaborator" ||
              !repo.ownerUid ||
              (repo.ownerName && repo.ownerName.trim()) ||
              (repo.ownerEmail && repo.ownerEmail.trim())
            ) {
              return repo;
            }

            if (!db) {
              return repo;
            }

            let resolvedOwnerName: string | undefined;
            let resolvedOwnerEmail: string | undefined;

            const ownerRepoDoc = await getDoc(
              doc(db, "users", repo.ownerUid, "repos", repo.id),
            );
            if (ownerRepoDoc.exists()) {
              const ownerRepoData = ownerRepoDoc.data() as {
                ownerName?: string;
                ownerEmail?: string;
              };
              resolvedOwnerName = ownerRepoData.ownerName;
              resolvedOwnerEmail = ownerRepoData.ownerEmail;
            }

            if (!resolvedOwnerEmail && currentEmail) {
              const inviteDoc = await getDoc(
                doc(
                  db,
                  "users",
                  repo.ownerUid,
                  "repos",
                  repo.id,
                  "invites",
                  encodeURIComponent(currentEmail),
                ),
              );
              if (inviteDoc.exists()) {
                const inviteData = inviteDoc.data() as {
                  invitedByEmail?: string;
                };
                resolvedOwnerEmail = inviteData.invitedByEmail;
              }
            }

            if (resolvedOwnerName || resolvedOwnerEmail) {
              await setDoc(
                doc(db, "users", user.uid, "repos", repo.id),
                {
                  ownerName: resolvedOwnerName ?? null,
                  ownerEmail: resolvedOwnerEmail ?? null,
                },
                { merge: true },
              );
            }

            return {
              ...repo,
              ownerName: resolvedOwnerName,
              ownerEmail: resolvedOwnerEmail,
            };
          }),
        );
        setRepos(hydratedRepos);

        const joinedRepoKeys = new Set(
          hydratedRepos
            .map((repo) => {
              if (!repo.ownerUid) {
                return null;
              }
              return `${repo.ownerUid}:${repo.id}`;
            })
            .filter((value): value is string => Boolean(value)),
        );

        if (currentEmail) {
          const allReposSnapshot = await getDocs(collectionGroup(db, "repos"));

          const invitedRecords: InvitedRepoRecord[] = [];
          for (const repoDoc of allReposSnapshot.docs) {
            const parsed = parseRepoPath(repoDoc.ref.path);
            if (!parsed) {
              continue;
            }

            if (parsed.ownerUid === user.uid) {
              continue;
            }

            const alreadyJoinedKey = `${parsed.ownerUid}:${parsed.repoId}`;
            if (joinedRepoKeys.has(alreadyJoinedKey)) {
              continue;
            }

            const inviteDoc = await getDoc(
              doc(
                db,
                "users",
                parsed.ownerUid,
                "repos",
                parsed.repoId,
                "invites",
                encodeURIComponent(currentEmail),
              ),
            );

            if (!inviteDoc.exists()) {
              continue;
            }

            const inviteData = inviteDoc.data() as { invitedByEmail?: string };
            const repoData = repoDoc.data() as {
              name?: string;
              ownerName?: string;
              ownerEmail?: string;
            };
            const alreadyIncluded = invitedRecords.some(
              (entry) =>
                entry.ownerUid === parsed.ownerUid &&
                entry.id === parsed.repoId,
            );
            if (alreadyIncluded) {
              continue;
            }

            invitedRecords.push({
              id: parsed.repoId,
              name: repoData.name ?? parsed.repoId,
              ownerName: repoData.ownerName,
              ownerUid: parsed.ownerUid,
              ownerEmail: repoData.ownerEmail ?? inviteData.invitedByEmail,
            });
          }

          setInvitedRepos(invitedRecords);
        } else {
          setInvitedRepos([]);
        }
      } catch (error) {
        if (error instanceof Error) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Unable to load repos.");
        }
      }

      setIsLoadingRepos(false);
      setIsLoadingInvites(false);
    };

    void loadWorkspaceData();
  }, [user]);

  const handleCreateRepo = async () => {
    if (!db || !user) {
      setErrorMessage("You must be logged in to create a repo.");
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);

    const trimmedName = repoName.trim();
    const repoId = `repo-${crypto.randomUUID().slice(0, 8)}`;

    try {
      await setDoc(doc(db, "users", user.uid, "repos", repoId), {
        name: trimmedName || "Untitled Repo",
        role: "owner",
        ownerName: user.displayName ?? null,
        ownerUid: user.uid,
        ownerEmail: normalizeEmail(user.email ?? ""),
        createdAt: serverTimestamp(),
      });

      await fetch("/api/repo-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          ownerUid: user.uid,
          repoId,
        }),
      });

      setRepoName("");
      const reloadedRepos = await getDocs(
        query(
          collection(db, "users", user.uid, "repos"),
          orderBy("createdAt", "desc"),
        ),
      );
      setRepos(
        reloadedRepos.docs.map((repoDoc) => {
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
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Unable to create repo.");
      }
    }

    setIsCreating(false);
  };

  const handleJoinRepo = async (repo: InvitedRepoRecord) => {
    if (!db || !user) {
      setErrorMessage("You must be logged in to join a repo.");
      return;
    }

    const repoKey = `${repo.ownerUid}:${repo.id}`;
    setIsJoiningRepoKey(repoKey);
    setErrorMessage(null);

    try {
      await setDoc(
        doc(db, "users", user.uid, "repos", repo.id),
        {
          name: repo.name,
          role: "collaborator",
          ownerName: repo.ownerName ?? null,
          ownerUid: repo.ownerUid,
          ownerEmail: repo.ownerEmail ?? null,
          createdAt: serverTimestamp(),
          joinedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setRepos((prevRepos) => [
        {
          id: repo.id,
          name: repo.name,
          role: "collaborator",
          ownerName: repo.ownerName,
          ownerUid: repo.ownerUid,
          ownerEmail: repo.ownerEmail,
        },
        ...prevRepos.filter(
          (entry) =>
            !(entry.id === repo.id && entry.ownerUid === repo.ownerUid),
        ),
      ]);
      setInvitedRepos((prevInvited) =>
        prevInvited.filter(
          (entry) =>
            !(entry.id === repo.id && entry.ownerUid === repo.ownerUid),
        ),
      );
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Unable to join repo.");
      }
    }

    setIsJoiningRepoKey(null);
  };

  return (
    <main className="ml-12 min-h-screen bg-[#070c14] text-[#c9d1d9]">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(88,166,255,0.10),transparent_35%),radial-gradient(circle_at_82%_8%,rgba(63,185,80,0.08),transparent_32%),radial-gradient(circle_at_40%_78%,rgba(240,165,0,0.07),transparent_30%)]"
        aria-hidden
      />

      <Navbar />

      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 pb-14 pt-10">
        <header className="flex flex-col gap-4 rounded-2xl border border-[#132033] bg-[#0b111b]/80 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-[#7a8699]">
                Workspace
              </p>
              <h1 className="text-3xl font-semibold text-white">
                Repo control room
              </h1>
              <p className="text-sm text-[#8b949e] max-w-2xl">
                Organize repositories, respond to invites, and jump into the
                editor. Built for focus, not profile flair.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-3 rounded-full border border-[#1f2a38] bg-[#0f1622] px-4 py-2 text-xs text-[#8b949e]">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-sm font-semibold text-white">
                {userInitials}
              </span>
              <div>
                <p className="font-semibold text-white text-sm">
                  {user?.displayName || "Workspace user"}
                </p>
                <p className="text-[11px] text-[#7a8699]">
                  {user?.email ?? "Not signed in"}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#1f2a38] bg-[#0f1622] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#7a8699]">
                Repos
              </p>
              <p className="text-2xl font-semibold text-white">
                {repos.length || "0"}
              </p>
              <p className="text-[11px] text-[#8b949e]">Active in workspace</p>
            </div>
            <div className="rounded-xl border border-[#1f2a38] bg-[#0f1622] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#7a8699]">
                Invites
              </p>
              <p className="text-2xl font-semibold text-white">
                {invitedRepos.length || "0"}
              </p>
              <p className="text-[11px] text-[#8b949e]">Awaiting response</p>
            </div>
            <div className="rounded-xl border border-[#1f2a38] bg-[#0f1622] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#7a8699]">
                Status
              </p>
              <p className="text-2xl font-semibold text-[#3fb950]">Ready</p>
              <p className="text-[11px] text-[#8b949e]">Editor one-click</p>
            </div>
            <div className="rounded-xl border border-[#1f2a38] bg-[#0f1622] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#7a8699]">
                Account
              </p>
              <p className="text-2xl font-semibold text-white">
                {user ? "Signed in" : "Guest"}
              </p>
              <p className="text-[11px] text-[#8b949e]">
                {user?.email ?? "auth required"}
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#132033] bg-[#0b111b]/90 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Create repository
                </h2>
                <p className="text-sm text-[#8b949e]">
                  Spin a new space; rename anytime.
                </p>
              </div>
              <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                Action
              </span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="repo-name"
                type="text"
                value={repoName}
                onChange={(event) => setRepoName(event.target.value)}
                placeholder="My collaborative repo"
                className="flex-1 rounded-md border border-[#1f2a38] bg-[#070c14] px-3 py-2 text-white outline-none placeholder:text-[#6e7681] focus:border-[#58a6ff]"
              />
              <button
                type="button"
                onClick={handleCreateRepo}
                disabled={isCreating || !user}
                className="inline-flex items-center justify-center rounded-md bg-[#58a6ff] px-4 py-2 text-sm font-semibold text-black shadow-[0_10px_25px_rgba(88,166,255,0.35)] transition hover:-translate-y-px hover:bg-[#79c0ff] disabled:opacity-60"
              >
                {isCreating ? "Creating..." : "Create repo"}
              </button>
            </div>
            {errorMessage ? (
              <p className="mt-3 text-sm text-[#f85149]">{errorMessage}</p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[#132033] bg-[#0b111b]/90 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Invitations</h2>
              <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                Inbox
              </span>
            </div>
            {isLoadingInvites ? (
              <p className="text-sm text-[#8b949e]">Loading invitations...</p>
            ) : invitedRepos.length === 0 ? (
              <p className="text-sm text-[#8b949e]">No invitations yet.</p>
            ) : (
              <ul className="space-y-3">
                {invitedRepos.map((repo) => (
                  <li
                    key={`${repo.ownerUid}-${repo.id}`}
                    className="flex items-start justify-between gap-3 rounded-lg border border-[#1f2a38] bg-[#070c14] px-4 py-3 text-sm"
                  >
                    <div className="space-y-1">
                      <p className="font-semibold text-white">{repo.name}</p>
                      <p className="text-xs text-[#8b949e]">ID: {repo.id}</p>
                      <p className="text-xs text-[#8b949e]">
                        Owner: {getOwnerLabel(repo.ownerName, repo.ownerEmail)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleJoinRepo(repo)}
                      disabled={
                        isJoiningRepoKey === `${repo.ownerUid}:${repo.id}`
                      }
                      className="rounded-md border border-[#1f2a38] px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-px hover:border-[#58a6ff] disabled:opacity-60"
                    >
                      {isJoiningRepoKey === `${repo.ownerUid}:${repo.id}`
                        ? "Joining..."
                        : "Join"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-[#132033] bg-[#0b111b]/90 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Repositories</h2>
              <p className="text-sm text-[#8b949e]">
                Your spaces, ordered by newest.
              </p>
            </div>
            <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
              {repos.length || 0} total
            </span>
          </div>
          {isLoadingRepos ? (
            <p className="text-sm text-[#8b949e]">Loading repos...</p>
          ) : repos.length === 0 ? (
            <p className="text-sm text-[#8b949e]">
              No repos yet. Create your first repo above.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {repos.map((repo) => (
                <li
                  key={repo.id}
                  className="rounded-lg border border-[#1f2a38] bg-[#070c14] px-4 py-4 text-sm text-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-base font-semibold">{repo.name}</p>
                      <p className="text-xs text-[#8b949e]">ID: {repo.id}</p>
                      {repo.role === "collaborator" ? (
                        <p className="text-xs text-[#8b949e]">
                          Collaborator · Owner:{" "}
                          {getOwnerLabel(repo.ownerName, repo.ownerEmail)}
                        </p>
                      ) : null}
                      <p className="text-xs text-[#8b949e]">
                        Created:{" "}
                        {repo.createdAt
                          ? repo.createdAt.toDate().toLocaleString()
                          : "just now"}
                      </p>
                    </div>
                    <Link
                      href={`/repo/${repo.id}`}
                      className="rounded-md border border-[#1f2a38] px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-px hover:border-[#58a6ff]"
                    >
                      Open editor
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
