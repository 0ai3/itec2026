"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [authChecked, setAuthChecked] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── AUTH
  useEffect(() => {
    if (!auth) {
      setAuthChecked(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) router.replace("/login");
      else setAuthChecked(true);
    });
    return () => unsub();
  }, [router]);

  // ── DATA
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
        const snap = await getDocs(
          query(
            collection(db, "users", user.uid, "repos"),
            orderBy("createdAt", "desc"),
          ),
        );
        setRepos(
          snap.docs.map((d) => {
            const data = d.data() as { name?: string; createdAt?: Timestamp };
            return {
              id: d.id,
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

  // ── CANVAS
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

  // ── focus input on / or ⌘K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle),
    );
  }, [queryText, repos]);

  const displayName = user?.email?.split("@")[0] ?? "user";

  if (!authChecked) return null;

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

    

      {/* STATUS BAR */}
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
        <span>search</span>
        <span>⎇ main</span>
        <span style={{ marginLeft: "auto" }}>
          <span style={{ color: "#58a6ff" }}>{displayName}</span>
          <span style={{ color: "#30363d" }}> · </span>
          {repos.length} repos · {filteredRepos.length} matches
        </span>
      </div>

      {/* CONTENT */}
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
        {/* PAGE HEADER + SEARCH INPUT */}
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
            search
          </div>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "clamp(22px,2.5vw,34px)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              marginBottom: 6,
            }}
          >
            Find anything, <span style={{ color: "#58a6ff" }}>fast</span>.
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 20 }}>
            Search repos by name or ID. Press{" "}
            <kbd
              style={{
                background: "#161b22",
                border: "1px solid #21262d",
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: 10,
                color: "#8b949e",
              }}
            >
              ⌘K
            </kbd>{" "}
            to focus.
          </div>

          {/* Search bar */}
          <div style={{ display: "flex", gap: 8, maxWidth: 520 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#484f58",
                  fontSize: 13,
                  pointerEvents: "none",
                }}
              >
                ⌕
              </span>
              <input
                ref={inputRef}
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="search repos or IDs..."
                style={{
                  width: "100%",
                  background: "#0d1117",
                  color: "#e6edf3",
                  border: "1px solid #21262d",
                  padding: "10px 14px 10px 34px",
                  fontSize: 12,
                  borderRadius: 4,
                  outline: "none",
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: "border-color .2s",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#58a6ff")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#21262d")}
              />
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0 12px",
                fontSize: 10,
                color: "#484f58",
                border: "1px solid #21262d",
                borderRadius: 4,
                background: "#0d1117",
                letterSpacing: "0.04em",
              }}
            >
              ⌘K
            </div>
          </div>
        </div>

        {/* PANELS GRID */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: 16,
            animation: "fadein .5s .15s both",
          }}
        >
          {/* LEFT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Quick actions */}
            <div
              style={{
                background: "#0d1117",
                border: "1px solid #21262d",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 16px",
                  background: "#161b22",
                  borderBottom: "1px solid #21262d",
                  fontSize: 11,
                  color: "#8b949e",
                }}
              >
                quick actions
              </div>
              {quickActions.map((action, idx) => (
                <QuickActionRow
                  key={action.href}
                  action={action}
                  isLast={idx === quickActions.length - 1}
                />
              ))}
            </div>

            {/* Stats */}
            <div
              style={{
                background: "#0d1117",
                border: "1px solid #21262d",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 16px",
                  background: "#161b22",
                  borderBottom: "1px solid #21262d",
                  fontSize: 11,
                  color: "#8b949e",
                }}
              >
                stats
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {[
                  {
                    label: "total repos",
                    value: repos.length,
                    color: "#58a6ff",
                  },
                  {
                    label: "matches",
                    value: filteredRepos.length,
                    color: "#3fb950",
                  },
                ].map(({ label, value, color }, idx) => (
                  <div
                    key={label}
                    style={{
                      padding: "16px",
                      borderRight: idx === 0 ? "1px solid #161b22" : "none",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Syne', sans-serif",
                        fontSize: 26,
                        fontWeight: 800,
                        color,
                        lineHeight: 1,
                      }}
                    >
                      {value}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#484f58",
                        letterSpacing: "0.12em",
                        marginTop: 5,
                        textTransform: "uppercase",
                      }}
                    >
                      {label}
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  padding: "10px 16px",
                  borderTop: "1px solid #161b22",
                  fontSize: 10,
                  color: "#484f58",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: user ? "#3fb950" : "#f85149",
                    display: "inline-block",
                  }}
                />
                {user ? `signed in as ${displayName}` : "guest"}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN — Results */}
          <div
            style={{
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
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
              <span>results</span>
              {queryText && (
                <span style={{ color: "#484f58", fontSize: 10 }}>
                  "{queryText}" · {filteredRepos.length} found
                </span>
              )}
            </div>

            {errorMessage ? (
              <div style={{ padding: "16px", fontSize: 11, color: "#f85149" }}>
                ✗ {errorMessage}
              </div>
            ) : isLoading ? (
              <div style={{ padding: "16px", fontSize: 11, color: "#484f58" }}>
                loading repos...
              </div>
            ) : filteredRepos.length === 0 ? (
              <div style={{ padding: "16px", fontSize: 11, color: "#484f58" }}>
                {queryText
                  ? `no results for "${queryText}".`
                  : "no repositories yet."}
              </div>
            ) : (
              filteredRepos.map((repo, idx) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  needle={queryText}
                  isLast={idx === filteredRepos.length - 1}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM BAR */}
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
        <span>search</span>
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

// ── Quick action row
function QuickActionRow({
  action,
  isLast,
}: {
  action: { label: string; href: string; hint: string };
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={action.href}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "11px 16px",
        borderBottom: isLast ? "none" : "1px solid #161b22",
        textDecoration: "none",
        background: hovered ? "rgba(88,166,255,.04)" : "transparent",
        transition: "background .15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          fontSize: 12,
          color: hovered ? "#79c0ff" : "#e6edf3",
          transition: "color .15s",
        }}
      >
        {action.label}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#484f58",
          border: "1px solid #21262d",
          padding: "3px 7px",
          borderRadius: 3,
          background: "#0d1117",
          letterSpacing: "0.04em",
        }}
      >
        {action.hint}
      </div>
    </Link>
  );
}

// ── Repo result row with highlight
function RepoRow({
  repo,
  needle,
  isLast,
}: {
  repo: RepoRecord;
  needle: string;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const highlight = (text: string) => {
    if (!needle.trim()) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) return <span>{text}</span>;
    return (
      <span>
        {text.slice(0, idx)}
        <span
          style={{
            color: "#58a6ff",
            background: "rgba(88,166,255,.12)",
            borderRadius: 2,
            padding: "0 1px",
          }}
        >
          {text.slice(idx, idx + needle.length)}
        </span>
        {text.slice(idx + needle.length)}
      </span>
    );
  };

  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: isLast ? "none" : "1px solid #161b22",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: hovered ? "rgba(88,166,255,.04)" : "transparent",
        transition: "background .15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: hovered ? "#79c0ff" : "#e6edf3",
            transition: "color .15s",
          }}
        >
          {highlight(repo.name)}
        </div>
        <div style={{ fontSize: 10, color: "#484f58", marginTop: 2 }}>
          {highlight(repo.id)}
        </div>
      </div>
      <Link
        href={`/repo/${repo.id}`}
        style={{
          fontSize: 10,
          color: "#58a6ff",
          opacity: hovered ? 1 : 0.4,
          transition: "opacity .15s",
          textDecoration: "none",
        }}
      >
        open →
      </Link>
    </div>
  );
}
