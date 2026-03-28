"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

const normalizeEmail = (e: string) => e.trim().toLowerCase();

export default function WorkspacePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [invitedRepos, setInvitedRepos] = useState<InvitedRepoRecord[]>([]);
  const [repoName, setRepoName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoiningRepoKey, setIsJoiningRepoKey] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  // ── AUTH
  useEffect(() => {
    if (!auth) {
      setAuthChecked(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) router.replace("/login");
      else setAuthChecked(true);
    });
    return () => unsub();
  }, [router]);

  // ── DATA
  useEffect(() => {
    const load = async () => {
      if (!db || !user) return;
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", user.uid, "repos"),
            orderBy("createdAt", "desc"),
          ),
        );
        setRepos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        const email = normalizeEmail(user.email || "");
        const allRepos = await getDocs(collectionGroup(db, "repos"));
        const invites: InvitedRepoRecord[] = [];
        for (const rd of allRepos.docs) {
          const parts = rd.ref.path.split("/");
          const ownerUid = parts[1],
            repoId = parts[3];
          if (ownerUid === user.uid) continue;
          const inv = await getDoc(
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
          if (inv.exists()) {
            const data = rd.data();
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
        console.error(e);
      }
    };
    load();
  }, [user]);

  // ── CURSOR
  useEffect(() => {
    if (!authChecked) return;
    let mx = 0,
      my = 0,
      rx = 0,
      ry = 0,
      raf: number;
    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (cursorRef.current) {
        cursorRef.current.style.left = mx - 4 + "px";
        cursorRef.current.style.top = my - 4 + "px";
      }
    };
    const loop = () => {
      rx += (mx - rx) * 0.12;
      ry += (my - ry) * 0.12;
      if (ringRef.current) {
        ringRef.current.style.left = rx - 16 + "px";
        ringRef.current.style.top = ry - 16 + "px";
      }
      raf = requestAnimationFrame(loop);
    };
    document.addEventListener("mousemove", onMove);
    loop();
    return () => {
      document.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [authChecked]);

  // ── CANVAS PARTICLES (lighter density — workspace context)
  useEffect(() => {
    if (!authChecked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let W = 0,
      H = 0,
      mx = -999,
      my = -999,
      raf: number;
    let particles: {
      x: number;
      y: number;
      ox: number;
      oy: number;
      vx: number;
      vy: number;
      s: number;
    }[] = [];
    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      particles = [];
      for (let x = 0; x < W; x += 60)
        for (let y = 0; y < H; y += 60)
          particles.push({
            x,
            y,
            ox: x,
            oy: y,
            vx: 0,
            vy: 0,
            s: Math.random() * 0.8 + 0.2,
          });
    };
    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const g = ctx.createRadialGradient(
        W * 0.5,
        H * 0.3,
        0,
        W * 0.5,
        H * 0.3,
        W * 0.4,
      );
      g.addColorStop(0, "rgba(88,166,255,.04)");
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      particles.forEach((p) => {
        const dx = mx - p.x,
          dy = my - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = Math.max(0, 1 - dist / 100);
        p.vx += (p.ox - p.x) * 0.06 - dx * force * 0.07;
        p.vy += (p.oy - p.y) * 0.06 - dy * force * 0.07;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(88,166,255,${0.07 + force * 0.25})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("mousemove", onMove);
    draw();
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [authChecked]);

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

  if (!authChecked) return null;

  const displayName = user?.email?.split("@")[0] ?? "user";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#03070f",
        color: "#e6edf3",
        fontFamily: "'JetBrains Mono', monospace",
        position: "relative",
        cursor: "none",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* CURSOR */}
      <div
        ref={cursorRef}
        style={{
          position: "fixed",
          width: 8,
          height: 8,
          background: "#58a6ff",
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 9999,
          mixBlendMode: "screen",
        }}
      />
      <div
        ref={ringRef}
        style={{
          position: "fixed",
          width: 32,
          height: 32,
          border: "1px solid rgba(88,166,255,.4)",
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 9998,
        }}
      />

      {/* CANVAS */}
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, zIndex: 0 }}
      />

      {/* SCANLINES */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2,
          pointerEvents: "none",
          background:
            "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.04) 2px,rgba(0,0,0,.04) 4px)",
        }}
      />


      {/* BREADCRUMB BAR — same style as landing bottom bar */}
      <div
        style={{
          position: "relative",
          zIndex: 20,
          borderBottom: "1px solid #161b22",
          background: "rgba(3,7,15,.85)",
          backdropFilter: "blur(12px)",
          padding: "8px 40px",
          display: "flex",
          alignItems: "center",
          gap: 20,
          fontSize: 10,
          color: "#484f58",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#3fb950",
            animation: "pulse 2s infinite",
          }}
        />
        <span style={{ color: "#3fb950" }}>synced</span>
        <span>workspace</span>
        <span>⎇ main</span>
        <span style={{ marginLeft: "auto" }}>
          <span style={{ color: "#58a6ff" }}>{displayName}</span>
          <span style={{ color: "#30363d" }}> · </span>
          {repos.length} repos · {invitedRepos.length} invites
        </span>
      </div>

      {/* PAGE CONTENT */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          padding: "40px 8vw 80px",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        {/* PAGE HEADER */}
        <div style={{ animation: "fadein .5s both" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.3em",
              color: "#58a6ff",
              fontWeight: 700,
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                display: "block",
                width: 20,
                height: 1,
                background: "#58a6ff",
              }}
            />
            workspace
          </div>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "clamp(22px,2.5vw,34px)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "#e6edf3",
              lineHeight: 1.1,
            }}
          >
            Hello, <span style={{ color: "#58a6ff" }}>{displayName}</span>.
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 6 }}>
            Manage your repositories and team invites.
          </div>
        </div>

        {/* CREATE REPO ROW */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation: "fadein .5s .1s both",
          }}
        >
          <input
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateRepo()}
            placeholder="new-repository-name..."
            style={{
              background: "#0d1117",
              color: "#e6edf3",
              border: "1px solid #21262d",
              padding: "10px 14px",
              fontSize: 12,
              borderRadius: 4,
              outline: "none",
              fontFamily: "'JetBrains Mono', monospace",
              width: 280,
              transition: "border-color .2s",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#58a6ff")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#21262d")}
          />
          <button
            onClick={handleCreateRepo}
            disabled={isCreating || !repoName.trim()}
            style={{
              padding: "10px 20px",
              borderRadius: 4,
              border: "none",
              background: "#58a6ff",
              color: "#03070f",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.06em",
              cursor: "pointer",
              opacity: isCreating || !repoName.trim() ? 0.5 : 1,
              transition: "opacity .2s",
            }}
          >
            {isCreating ? "..." : "▶ create repo"}
          </button>
        </div>

        {/* TWO PANELS */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: 16,
            animation: "fadein .5s .2s both",
          }}
        >
          {/* INVITES PANEL */}
          <div
            style={{
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {/* panel header */}
            <div
              style={{
                padding: "10px 16px",
                background: "#161b22",
                borderBottom: "1px solid #21262d",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#8b949e",
              }}
            >
              <span>invites</span>
              {invitedRepos.length > 0 && (
                <span
                  style={{
                    background: "rgba(227,179,65,.15)",
                    color: "#e3b341",
                    border: "1px solid rgba(227,179,65,.25)",
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 2,
                    letterSpacing: "0.08em",
                  }}
                >
                  {invitedRepos.length} PENDING
                </span>
              )}
            </div>

            {invitedRepos.length === 0 ? (
              <div style={{ padding: "16px", fontSize: 11, color: "#484f58" }}>
                no pending invites.
              </div>
            ) : (
              invitedRepos.map((repo, idx) => (
                <div
                  key={repo.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom:
                      idx < invitedRepos.length - 1
                        ? "1px solid #161b22"
                        : "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {repo.name}
                    </div>
                    <div
                      style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}
                    >
                      <span style={{ color: "#e3b341" }}>↗</span>{" "}
                      {repo.ownerName || repo.ownerEmail}
                    </div>
                  </div>
                  <button
                    onClick={() => handleJoinRepo(repo)}
                    disabled={isJoiningRepoKey === repo.id}
                    style={{
                      padding: "6px 0",
                      borderRadius: 3,
                      border: "1px solid #21262d",
                      background: "transparent",
                      color: "#58a6ff",
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: "pointer",
                      opacity: isJoiningRepoKey === repo.id ? 0.5 : 1,
                      transition: "border-color .2s, background .2s",
                      width: "100%",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(88,166,255,.08)";
                      e.currentTarget.style.borderColor = "#58a6ff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "#21262d";
                    }}
                  >
                    {isJoiningRepoKey === repo.id ? "joining..." : "join →"}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* REPOS PANEL */}
          <div
            style={{
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {/* panel header */}
            <div
              style={{
                padding: "10px 16px",
                background: "#161b22",
                borderBottom: "1px solid #21262d",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#8b949e",
              }}
            >
              <span>repositories</span>
              <span style={{ color: "#484f58" }}>{repos.length} total</span>
            </div>

            {repos.length === 0 ? (
              <div style={{ padding: "16px", fontSize: 11, color: "#484f58" }}>
                no repositories yet. create one above.
              </div>
            ) : (
              repos.map((repo, idx) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  isLast={idx === repos.length - 1}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM BAR — identical to landing */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          borderTop: "1px solid #161b22",
          background: "rgba(3,7,15,.9)",
          backdropFilter: "blur(12px)",
          padding: "8px 40px",
          display: "flex",
          alignItems: "center",
          gap: 24,
          fontSize: 10,
          color: "#484f58",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#3fb950",
            animation: "pulse 2s infinite",
          }}
        />
        <span style={{ color: "#3fb950" }}>live</span>
        <span>workspace</span>
        <span>⎇ main</span>
        <span>✓ firestore synced</span>
        <span style={{ marginLeft: "auto" }}>
          iTECify v0.1.0-alpha · iTEC 2026
        </span>
      </div>

      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700;800&family=Syne:wght@700;800&display=swap");

        @keyframes fadein {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.4);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(63, 185, 80, 0);
          }
        }

        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding-bottom: 44px;
        }
        input::placeholder {
          color: #30363d;
        }
      `}</style>
    </main>
  );
}

function RepoRow({ repo, isLast }: { repo: RepoRecord; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const isCollab = repo.role === "collaborator";
  return (
    <Link
      href={`/repo/${repo.id}`}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: isLast ? "none" : "1px solid #161b22",
        textDecoration: "none",
        color: "#e6edf3",
        background: hovered ? "rgba(88,166,255,.04)" : "transparent",
        transition: "background .15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div>
        <div
          style={{
            fontSize: 13,
            color: hovered ? "#79c0ff" : "#e6edf3",
            transition: "color .15s",
          }}
        >
          {repo.name}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 2,
          }}
        >
          <span style={{ fontSize: 10, color: "#484f58" }}>{repo.id}</span>
          <span
            style={{ fontSize: 10, color: isCollab ? "#bc8cff" : "#3fb950" }}
          >
            {isCollab ? "● collaborator" : "● owner"}
          </span>
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: "#58a6ff",
          opacity: hovered ? 1 : 0.4,
          transition: "opacity .15s",
        }}
      >
        open →
      </span>
    </Link>
  );
}
