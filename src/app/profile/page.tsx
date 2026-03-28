"use client";

import Link from "next/link";
import {
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type CSSProperties,
  useEffect,
  useMemo,
  useState,
} from "react";
import { collection, getDocs } from "firebase/firestore";
import { onAuthStateChanged, updateProfile, type User } from "firebase/auth";
import Navbar from "@/components/Navbar";
import { auth, db } from "@/lib/firebase";

type ParticipatingRepo = {
  id: string;
  name: string;
  role?: "owner" | "collaborator";
  ownerName?: string;
  ownerEmail?: string;
  ownerPhotoURL?: string;
};

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);

  const [displayName, setDisplayName] = useState(
    auth?.currentUser?.displayName ?? "",
  );

  const [photoURL, setPhotoURL] = useState(auth?.currentUser?.photoURL ?? "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [participatingRepos, setParticipatingRepos] = useState<
    ParticipatingRepo[]
  >([]);
  const [metaMessage, setMetaMessage] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoRoleFilter, setRepoRoleFilter] = useState<
    "all" | "owner" | "collaborator"
  >("all");
  const [repoSort, setRepoSort] = useState<"name" | "owner">("name");
  const [copiedRepoId, setCopiedRepoId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setDisplayName(u?.displayName ?? "");
      setPhotoURL(u?.photoURL ?? "");

      if (!u || !db) {
        setParticipatingRepos([]);
        setMetaMessage(null);
        return;
      }

      try {
        const snap = await getDocs(collection(db, "users", u.uid, "repos"));
        const repos = snap.docs.map((repoDoc) => {
          const data = repoDoc.data() as {
            name?: string;
            role?: "owner" | "collaborator";
            ownerName?: string;
            ownerEmail?: string;
            ownerPhotoURL?: string;
          };
          return {
            id: repoDoc.id,
            name: data.name?.trim() || repoDoc.id,
            role: data.role,
            ownerName: data.ownerName,
            ownerEmail: data.ownerEmail,
            ownerPhotoURL: data.ownerPhotoURL,
          } satisfies ParticipatingRepo;
        });
        setParticipatingRepos(repos);
        setMetaMessage(snap.size === 0 ? "Niciun repo găsit încă" : null);
      } catch {
        setParticipatingRepos([]);
        setMetaMessage("Nu am putut încărca repo-urile");
      }
    });

    return unsub;
  }, []);

  const handleUpdateProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await updateProfile(user, {
        displayName: displayName.trim() || null,
        photoURL: photoURL.trim() || null,
      });

      setMessage("Saved");
    } catch {
      setErrorMessage("Failed to update profile");
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewPhotoURL = useMemo(() => photoURL.trim(), [photoURL]);

  const getOwnerUsername = (repo: ParticipatingRepo) => {
    if (repo.role === "owner") {
      const meName = user?.displayName?.trim();
      if (meName) return meName;
      const meEmail = user?.email?.trim() ?? "";
      if (meEmail.includes("@")) return meEmail.split("@")[0];
      return "you";
    }

    if (repo.ownerName?.trim()) return repo.ownerName.trim();
    if (repo.ownerEmail?.includes("@")) return repo.ownerEmail.split("@")[0];
    return "owner";
  };

  const getOwnerAvatar = (repo: ParticipatingRepo) => {
    if (repo.role === "owner" && previewPhotoURL) {
      return previewPhotoURL;
    }
    if (repo.ownerPhotoURL?.trim()) {
      return repo.ownerPhotoURL.trim();
    }
    const username = getOwnerUsername(repo);
    return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}`;
  };

  const ownerRepoCount = useMemo(
    () => participatingRepos.filter((repo) => repo.role === "owner").length,
    [participatingRepos],
  );

  const collaboratorRepoCount = useMemo(
    () =>
      participatingRepos.filter((repo) => repo.role === "collaborator").length,
    [participatingRepos],
  );

  const visibleRepos = useMemo(() => {
    const query = repoSearch.trim().toLowerCase();
    const filtered = participatingRepos.filter((repo) => {
      if (
        repoRoleFilter !== "all" &&
        (repo.role ?? "collaborator") !== repoRoleFilter
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const owner = getOwnerUsername(repo).toLowerCase();
      return (
        repo.name.toLowerCase().includes(query) ||
        owner.includes(query) ||
        repo.id.toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      if (repoSort === "owner") {
        return getOwnerUsername(a).localeCompare(getOwnerUsername(b));
      }
      return a.name.localeCompare(b.name);
    });
  }, [participatingRepos, repoRoleFilter, repoSearch, repoSort]);

  const handleCopyRepoId = async (repoId: string) => {
    try {
      await navigator.clipboard.writeText(repoId);
      setCopiedRepoId(repoId);
      setTimeout(() => {
        setCopiedRepoId((current) => (current === repoId ? null : current));
      }, 1200);
    } catch {
      setErrorMessage("Could not copy repo id");
    }
  };

  const handleCopyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedText(label);
      setTimeout(() => {
        setCopiedText((current) => (current === label ? null : current));
      }, 1200);
    } catch {
      setErrorMessage("Could not copy value");
    }
  };

  const recentRepos = useMemo(() => visibleRepos.slice(0, 5), [visibleRepos]);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d1117",
        color: "#e6edf3",
        overflow: "hidden",
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
      }}
    >
      <Navbar />

      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 16px",
          borderBottom: "1px solid #21262d",
          background: "#161b22",
          flexShrink: 0,
          minHeight: 42,
        }}
      >
        <Link
          href="/workspace"
          style={{
            color: "#8b949e",
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          ← workspace
        </Link>

        <span style={{ color: "#21262d" }}>/</span>

        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#e6edf3",
          }}
        >
          profile
        </span>

        <div style={{ flex: 1 }} />

        {message && (
          <span
            style={{
              fontSize: 11,
              color: "#3fb950",
            }}
          >
            {message}
          </span>
        )}
      </div>

      {/* content */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          overflow: "hidden",
        }}
      >
        {/* sidebar */}
        <div
          style={{
            borderRight: "1px solid #21262d",
            background: "#0d1117",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* header */}
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #21262d",
              fontSize: 11,
              fontWeight: 700,
              color: "#8b949e",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Profile
          </div>

          {/* avatar */}
          <div
            style={{
              padding: 16,
              borderBottom: "1px solid #21262d",
            }}
          >
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 6,
                overflow: "hidden",
                border: "1px solid #30363d",
                background: "#161b22",
              }}
            >
              {previewPhotoURL ? (
                <img
                  src={previewPhotoURL}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    display: "grid",
                    placeItems: "center",
                    height: "100%",
                    color: "#fff",
                  }}
                >
                  {(user?.email ?? "U")[0]}
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: 10,
                fontSize: 13,
                color: "#e6edf3",
              }}
            >
              {displayName || "Developer"}
            </div>

            <div
              style={{
                fontSize: 11,
                color: "#8b949e",
              }}
            >
              {user?.email}
            </div>
          </div>

          {/* participating repos */}
          <div
            style={{
              padding: 12,
              display: "grid",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#8b949e",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Participating repos ({participatingRepos.length})
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <RepoStatPill label="Owner" value={ownerRepoCount} />
              <RepoStatPill
                label="Collaborator"
                value={collaboratorRepoCount}
              />
            </div>

            <input
              value={repoSearch}
              onChange={(event) => setRepoSearch(event.target.value)}
              placeholder="Search owner/repo or id"
              style={{
                width: "100%",
                background: "#0d1117",
                border: "1px solid #30363d",
                color: "#e6edf3",
                fontSize: 12,
                borderRadius: 6,
                padding: "6px 8px",
                outline: "none",
              }}
            />

            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={repoRoleFilter}
                onChange={(event) =>
                  setRepoRoleFilter(
                    event.target.value as "all" | "owner" | "collaborator",
                  )
                }
                style={{
                  flex: 1,
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  color: "#e6edf3",
                  fontSize: 12,
                  borderRadius: 6,
                  padding: "6px 8px",
                  outline: "none",
                }}
              >
                <option value="all">All roles</option>
                <option value="owner">Owner</option>
                <option value="collaborator">Collaborator</option>
              </select>

              <select
                value={repoSort}
                onChange={(event) =>
                  setRepoSort(event.target.value as "name" | "owner")
                }
                style={{
                  flex: 1,
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  color: "#e6edf3",
                  fontSize: 12,
                  borderRadius: 6,
                  padding: "6px 8px",
                  outline: "none",
                }}
              >
                <option value="name">Sort: Project</option>
                <option value="owner">Sort: Owner</option>
              </select>
            </div>

            {visibleRepos.map((repo) => (
              <div
                key={repo.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Link
                  href={`/repo/${repo.id}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "6px 2px",
                    textDecoration: "none",
                    color: "#e6edf3",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <img
                    src={getOwnerAvatar(repo)}
                    alt={`${getOwnerUsername(repo)} avatar`}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      border: "1px solid #30363d",
                      objectFit: "cover",
                      flexShrink: 0,
                      background: "#161b22",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#c9d1d9",
                        fontWeight: 600,
                      }}
                    >
                      {getOwnerUsername(repo)}
                    </span>
                    <span style={{ fontSize: 12, color: "#8b949e" }}>/</span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "#e6edf3",
                        textDecoration: "underline",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {repo.name}
                    </span>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => void handleCopyRepoId(repo.id)}
                  style={{
                    border: "1px solid #30363d",
                    background:
                      copiedRepoId === repo.id ? "#1f6feb" : "#161b22",
                    color: copiedRepoId === repo.id ? "#fff" : "#8b949e",
                    fontSize: 10,
                    borderRadius: 6,
                    padding: "4px 7px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {copiedRepoId === repo.id ? "Copied" : "Copy ID"}
                </button>
              </div>
            ))}

            {participatingRepos.length > 0 && visibleRepos.length === 0 ? (
              <div style={{ fontSize: 11, color: "#8b949e", paddingTop: 2 }}>
                No repositories match the current filters.
              </div>
            ) : null}

            {metaMessage ? (
              <div
                style={{
                  fontSize: 11,
                  color: "#8b949e",
                  paddingTop: 2,
                }}
              >
                {metaMessage}
              </div>
            ) : null}
          </div>
        </div>

        {/* main */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
          }}
        >
          {/* header */}
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid #21262d",
              background: "#161b22",
              fontSize: 12,
              color: "#8b949e",
            }}
          >
            Edit profile
          </div>

          <div
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              maxWidth: 980,
              width: "100%",
              margin: "0 auto",
            }}
          >
            <div
              style={{
                display: "grid",
                marginTop: 125,
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                alignItems: "start",
              }}
            >
              <div
                style={{
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  background: "#161b22",
                  padding: 12,
                  minHeight: 200,
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                <div
                  style={{ fontSize: 12, color: "#8b949e", marginBottom: 10 }}
                >
                  Account info
                </div>
                <InfoRow label="User ID" value={user?.uid ?? "unknown"} />
                <InfoRow label="Email" value={user?.email ?? "not available"} />
                <InfoRow
                  label="Role mix"
                  value={`${ownerRepoCount} owner · ${collaboratorRepoCount} collaborator`}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => void handleCopyText(user?.uid ?? "", "uid")}
                    disabled={!user?.uid}
                    style={smallButtonStyle}
                  >
                    {copiedText === "uid" ? "Copied UID" : "Copy UID"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyText(user?.email ?? "", "email")
                    }
                    disabled={!user?.email}
                    style={smallButtonStyle}
                  >
                    {copiedText === "email" ? "Copied Email" : "Copy Email"}
                  </button>
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  background: "#161b22",
                  padding: 12,
                  minHeight: 200,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{ fontSize: 12, color: "#8b949e", marginBottom: 10 }}
                >
                  Recent repositories
                </div>
                {recentRepos.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#8b949e" }}>
                    No repositories to show.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8, marginTop: 2 }}>
                    {recentRepos.map((repo) => (
                      <Link
                        key={`recent-${repo.id}`}
                        href={`/repo/${repo.id}`}
                        style={{
                          textDecoration: "none",
                          color: "#e6edf3",
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          border: "1px solid #30363d",
                          borderRadius: 6,
                          padding: "7px 9px",
                          background: "#0d1117",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {getOwnerUsername(repo)}/{repo.name}
                        </span>
                        <span style={{ color: "#8b949e", fontSize: 11 }}>
                          {repo.role ?? "member"}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* form */}
            <form
              onSubmit={handleUpdateProfile}
              style={{
                padding: 12,
                display: "grid",
                gap: 12,
                width: "100%",
                border: "1px solid #30363d",
                borderRadius: 8,
                background: "#161b22",
              }}
            >
              <div style={{ fontSize: 12, color: "#8b949e" }}>Edit profile</div>
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                }}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <Label>Display name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <Label>Avatar URL</Label>
                  <Input
                    value={photoURL}
                    onChange={(e) => setPhotoURL(e.target.value)}
                  />
                </div>
              </div>

              {errorMessage && (
                <div
                  style={{
                    color: "#f85149",
                    fontSize: 12,
                  }}
                >
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: "#238636",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                  width: 140,
                  justifySelf: "start",
                }}
              >
                {isSubmitting ? "Saving..." : "Save profile"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

/* components */

function Label({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "#8b949e",
      }}
    >
      {children}
    </div>
  );
}

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        background: "#0d1117",
        border: "1px solid #30363d",
        padding: "6px 10px",
        borderRadius: 6,
        color: "#e6edf3",
        fontSize: 12,
        outline: "none",
      }}
    />
  );
}

function RepoStatPill({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid #30363d",
        background: "#161b22",
        borderRadius: 999,
        padding: "4px 9px",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ fontSize: 10, color: "#8b949e" }}>{label}</span>
      <span style={{ fontSize: 11, color: "#e6edf3", fontWeight: 700 }}>
        {value}
      </span>
    </div>
  );
}

function ActionCard({
  title,
  description,
  href,
  tone,
}: {
  title: string;
  description: string;
  href: string;
  tone: string;
}) {
  return (
    <Link
      href={href}
      style={{
        border: "1px solid #30363d",
        borderRadius: 8,
        background: "#161b22",
        padding: "10px 12px",
        textDecoration: "none",
        display: "grid",
        gap: 5,
        minHeight: 84,
        alignContent: "start",
      }}
    >
      <span style={{ color: tone, fontSize: 12, fontWeight: 700 }}>
        {title}
      </span>
      <span style={{ color: "#8b949e", fontSize: 11 }}>{description}</span>
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 3, marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: "#8b949e" }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          color: "#e6edf3",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

const smallButtonStyle: CSSProperties = {
  border: "1px solid #30363d",
  background: "#0d1117",
  color: "#8b949e",
  fontSize: 11,
  borderRadius: 6,
  padding: "5px 8px",
  cursor: "pointer",
};
