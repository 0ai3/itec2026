"use client";

import Link from "next/link";
import {
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { collection, getDocs } from "firebase/firestore";
import { onAuthStateChanged, updateProfile, type User } from "firebase/auth";
import Navbar from "@/components/Navbar";
import { auth, db } from "@/lib/firebase";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);

  const [displayName, setDisplayName] = useState(
    auth?.currentUser?.displayName ?? "",
  );

  const [photoURL, setPhotoURL] = useState(auth?.currentUser?.photoURL ?? "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repoCount, setRepoCount] = useState<number | null>(null);
  const [commitCount, setCommitCount] = useState<number | null>(null);
  const [starCount, setStarCount] = useState<number | null>(null);
  const [pipelineCount, setPipelineCount] = useState<number | null>(null);
  const [metaMessage, setMetaMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setDisplayName(u?.displayName ?? "");
      setPhotoURL(u?.photoURL ?? "");

      if (!u || !db) {
        setRepoCount(null);
        setCommitCount(null);
        setStarCount(null);
        setPipelineCount(null);
        setMetaMessage(null);
        return;
      }

      try {
        const snap = await getDocs(collection(db, "users", u.uid, "repos"));
        setRepoCount(snap.size);
        let commits = 0;
        let stars = 0;
        let pipelines = 0;

        snap.forEach((doc) => {
          const data = doc.data() as {
            commits?: number;
            stars?: number;
            pipelines?: number;
          };
          if (typeof data.commits === "number") commits += data.commits;
          if (typeof data.stars === "number") stars += data.stars;
          if (typeof data.pipelines === "number") pipelines += data.pipelines;
        });

        setCommitCount(snap.size ? commits : null);
        setStarCount(snap.size ? stars : null);
        setPipelineCount(snap.size ? pipelines : null);
        setMetaMessage(snap.size === 0 ? "Niciun repo găsit încă" : null);
      } catch (err) {
        setRepoCount(null);
        setCommitCount(null);
        setStarCount(null);
        setPipelineCount(null);
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

          {/* stats */}
          <div
            style={{
              padding: 12,
              display: "grid",
              gap: 8,
            }}
          >
            <Stat label="Repos" value={repoCount ?? "—"} />
            <Stat label="Commits" value={commitCount ?? "—"} />
            <Stat label="Stars" value={starCount ?? "—"} />
            <Stat label="Pipelines" value={pipelineCount ?? "—"} />
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
            overflow: "hidden",
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

          {/* form */}
          <form
            onSubmit={handleUpdateProfile}
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              maxWidth: 600,
            }}
          >
            <Label>Display name</Label>

            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />

            <Label>Avatar URL</Label>

            <Input
              value={photoURL}
              onChange={(e) => setPhotoURL(e.target.value)}
            />

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
                marginTop: 8,
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #30363d",
                background: "#238636",
                color: "#fff",
                fontSize: 12,
                cursor: "pointer",
                width: 140,
              }}
            >
              {isSubmitting ? "Saving..." : "Save profile"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

/* components */

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        border: "1px solid #30363d",
        background: "#161b22",
        padding: 8,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#8b949e",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 14,
          color: "#e6edf3",
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  );
}

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
