"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const EXTENSIONS = [
  { id: "ms-python", name: "Python Tools", publisher: "Microsoft", installs: "5.2M", rating: "4.8", tags: ["python", "lint", "debug"], description: "Language server, linting, debugging, and Jupyter support." },
  { id: "esbenp.prettier", name: "Prettier Formatter", publisher: "Prettier", installs: "12.4M", rating: "4.9", tags: ["format", "javascript", "typescript"], description: "Opinionated code formatter with workspace overrides." },
  { id: "dbaeumer.vscode-eslint", name: "ESLint", publisher: "Dirk Baeumer", installs: "15.1M", rating: "4.7", tags: ["lint", "javascript", "typescript"], description: "Inline diagnostics and auto-fix for JS/TS projects." },
  { id: "prisma.prisma", name: "Prisma", publisher: "Prisma", installs: "1.9M", rating: "4.8", tags: ["database", "schema", "lint"], description: "Schema autocompletion, formatting, and migrate helpers." },
  { id: "gitlens", name: "GitLens", publisher: "GitKraken", installs: "18.0M", rating: "4.9", tags: ["git", "blame", "history"], description: "Blame, line authorship, and commit insights in the editor." },
  { id: "tailwindcss", name: "Tailwind CSS IntelliSense", publisher: "Tailwind Labs", installs: "8.7M", rating: "4.9", tags: ["css", "design", "intellisense"], description: "Class name autocomplete, linting, and design tokens." },
  { id: "ms-vscode.vscode-typescript-next", name: "TypeScript Next", publisher: "Microsoft", installs: "2.1M", rating: "4.7", tags: ["typescript", "language", "intellisense"], description: "Bleeding-edge TS/JS language features and fixes." },
  { id: "ms-vscode.go", name: "Go", publisher: "Go Team at Google", installs: "5.6M", rating: "4.8", tags: ["go", "lint", "debug"], description: "Go tools, gopls language server, tests, and debugging." },
  { id: "ms-azuretools.vscode-docker", name: "Docker", publisher: "Microsoft", installs: "18.9M", rating: "4.8", tags: ["docker", "containers", "kubernetes"], description: "Build, run, and manage containers plus compose workflows." },
  { id: "redhat.vscode-yaml", name: "YAML", publisher: "Red Hat", installs: "12.0M", rating: "4.7", tags: ["yaml", "schemas", "kubernetes"], description: "Schema-aware YAML with validation and hover." },
  { id: "ms-toolsai.jupyter", name: "Jupyter", publisher: "Microsoft", installs: "52.3M", rating: "4.8", tags: ["python", "notebooks", "data"], description: "Run notebooks with rich outputs and kernel management." },
  { id: "vscodevim.vim", name: "Vim", publisher: "Vim", installs: "13.7M", rating: "4.7", tags: ["vim", "productivity", "keys"], description: "Vim keybindings and motions throughout the editor." },
  { id: "ms-vsliveshare.vsliveshare", name: "Live Share", publisher: "Microsoft", installs: "29.4M", rating: "4.7", tags: ["collaboration", "pairing", "sharing"], description: "Real-time co-editing, terminals, and servers." },
  { id: "ms-vscode.cpptools", name: "C/C++", publisher: "Microsoft", installs: "37.5M", rating: "4.6", tags: ["c", "cpp", "debug"], description: "IntelliSense, debugging, and CMake integration." },
  { id: "bierner.markdown-mermaid", name: "Markdown Mermaid", publisher: "Matt Bierner", installs: "2.2M", rating: "4.8", tags: ["markdown", "diagrams", "docs"], description: "Preview Mermaid diagrams inside Markdown." },
];

export default function ExtensionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [queryText, setQueryText] = useState("");
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  // ── AUTH
  useEffect(() => {
    if (!auth) { setAuthChecked(true); return; }
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
      if (!db || !user) { setInstalledIds([]); return; }
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "extensions"));
        setInstalledIds(snap.docs.map((d) => d.id));
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : "Unable to load extensions.");
      }
    };
    void load();
  }, [user]);

  // ── CURSOR
  useEffect(() => {
    if (!authChecked) return;
    let mx = 0, my = 0, rx = 0, ry = 0, raf: number;
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY;
      if (cursorRef.current) { cursorRef.current.style.left = mx - 4 + "px"; cursorRef.current.style.top = my - 4 + "px"; }
    };
    const loop = () => {
      rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12;
      if (ringRef.current) { ringRef.current.style.left = rx - 16 + "px"; ringRef.current.style.top = ry - 16 + "px"; }
      raf = requestAnimationFrame(loop);
    };
    document.addEventListener("mousemove", onMove); loop();
    return () => { document.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, [authChecked]);

  // ── CANVAS
  useEffect(() => {
    if (!authChecked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let W = 0, H = 0, mx = -999, my = -999, raf: number;
    let particles: { x: number; y: number; ox: number; oy: number; vx: number; vy: number; s: number }[] = [];
    const resize = () => {
      W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight;
      particles = [];
      for (let x = 0; x < W; x += 60)
        for (let y = 0; y < H; y += 60)
          particles.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, s: Math.random() * 0.8 + 0.2 });
    };
    const onMove = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.3, W * 0.4);
      g.addColorStop(0, "rgba(88,166,255,.04)"); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      particles.forEach((p) => {
        const dx = mx - p.x, dy = my - p.y, dist = Math.sqrt(dx * dx + dy * dy);
        const force = Math.max(0, 1 - dist / 100);
        p.vx += (p.ox - p.x) * 0.06 - dx * force * 0.07;
        p.vy += (p.oy - p.y) * 0.06 - dy * force * 0.07;
        p.vx *= 0.82; p.vy *= 0.82; p.x += p.vx; p.y += p.vy;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(88,166,255,${0.07 + force * 0.25})`; ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    resize(); window.addEventListener("resize", resize); document.addEventListener("mousemove", onMove); draw();
    return () => { window.removeEventListener("resize", resize); document.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, [authChecked]);

  const filtered = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    if (!needle) return EXTENSIONS;
    return EXTENSIONS.filter((ext) =>
      `${ext.name} ${ext.publisher} ${ext.tags.join(" ")}`.toLowerCase().includes(needle)
    );
  }, [queryText]);

  const installed = useMemo(
    () => EXTENSIONS.filter((ext) => installedIds.includes(ext.id)),
    [installedIds]
  );

  const toggleInstall = async (id: string) => {
    if (!db || !user) return;
    setIsSyncing(true);
    setErrorMessage(null);
    const extMeta = EXTENSIONS.find((e) => e.id === id);
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
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Unable to update extension.");
    }
    setIsSyncing(false);
  };

  if (!authChecked) return null;

  const displayName = user?.email?.split("@")[0] ?? "user";

  return (
    <main style={{
      minHeight: "100vh",
      background: "#03070f",
      color: "#e6edf3",
      fontFamily: "'JetBrains Mono', monospace",
      position: "relative",
      cursor: "none",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* CURSOR */}
      <div ref={cursorRef} style={{ position: "fixed", width: 8, height: 8, background: "#58a6ff", borderRadius: "50%", pointerEvents: "none", zIndex: 9999, mixBlendMode: "screen" }} />
      <div ref={ringRef} style={{ position: "fixed", width: 32, height: 32, border: "1px solid rgba(88,166,255,.4)", borderRadius: "50%", pointerEvents: "none", zIndex: 9998 }} />

      {/* CANVAS */}
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />

      {/* SCANLINES */}
      <div style={{ position: "fixed", inset: 0, zIndex: 2, pointerEvents: "none", background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.04) 2px,rgba(0,0,0,.04) 4px)" }} />


      {/* STATUS BAR */}
      <div style={{
        position: "relative", zIndex: 20,
        borderBottom: "1px solid #161b22",
        background: "rgba(3,7,15,.85)", backdropFilter: "blur(12px)",
        padding: "8px 40px",
        display: "flex", alignItems: "center", gap: 20,
        fontSize: 10, color: "#484f58",
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#3fb950", animation: "pulse 2s infinite" }} />
        <span style={{ color: "#3fb950" }}>synced</span>
        <span>extensions</span>
        <span>⎇ main</span>
        <span style={{ marginLeft: "auto" }}>
          <span style={{ color: "#58a6ff" }}>{displayName}</span>
          <span style={{ color: "#30363d" }}> · </span>
          {installed.length} installed · {filtered.length} shown
        </span>
      </div>

      {/* CONTENT */}
      <div style={{
        position: "relative", zIndex: 10,
        flex: 1, padding: "40px 8vw 80px",
        display: "flex", flexDirection: "column", gap: 32,
      }}>

        {/* PAGE HEADER */}
        <div style={{ animation: "fadein .5s both" }}>
          <div style={{
            fontSize: 10, letterSpacing: "0.3em", color: "#58a6ff",
            fontWeight: 700, marginBottom: 10,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ display: "block", width: 20, height: 1, background: "#58a6ff" }} />
            extensions
          </div>
          <div style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "clamp(22px,2.5vw,34px)",
            fontWeight: 800, letterSpacing: "-0.03em",
            lineHeight: 1.1, marginBottom: 6,
          }}>
            Extension <span style={{ color: "#58a6ff" }}>catalog</span>.
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 20 }}>
            Browse and install add-ons — persisted in Firestore per user.
          </div>

          {/* Search bar */}
          <div style={{ display: "flex", gap: 8, maxWidth: 520 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{
                position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                color: "#484f58", fontSize: 13, pointerEvents: "none",
              }}>⌕</span>
              <input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="search name, publisher, tags..."
                style={{
                  width: "100%",
                  background: "#0d1117", color: "#e6edf3",
                  border: "1px solid #21262d",
                  padding: "10px 14px 10px 34px",
                  fontSize: 12, borderRadius: 4, outline: "none",
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: "border-color .2s",
                }}
                onFocus={e => e.currentTarget.style.borderColor = "#58a6ff"}
                onBlur={e => e.currentTarget.style.borderColor = "#21262d"}
              />
            </div>
            <div style={{
              display: "inline-flex", alignItems: "center",
              padding: "0 12px", fontSize: 10, color: "#484f58",
              border: "1px solid #21262d", borderRadius: 4,
              background: "#0d1117", letterSpacing: "0.04em",
            }}>
              Enter
            </div>
          </div>
        </div>

        {/* PANELS */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 16,
          animation: "fadein .5s .15s both",
          alignItems: "start",
        }}>

          {/* CATALOG */}
          <div style={{
            background: "#0d1117",
            border: "1px solid #21262d",
            borderRadius: 6, overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 16px", background: "#161b22",
              borderBottom: "1px solid #21262d",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              fontSize: 11, color: "#8b949e",
            }}>
              <span>catalog</span>
              <span style={{ color: "#484f58", fontSize: 10 }}>
                {filtered.length} of {EXTENSIONS.length}
              </span>
            </div>

            {errorMessage && (
              <div style={{ padding: "12px 16px", fontSize: 11, color: "#f85149" }}>
                ✗ {errorMessage}
              </div>
            )}

            {filtered.map((ext, idx) => {
              const isInstalled = installedIds.includes(ext.id);
              return (
                <ExtRow
                  key={ext.id}
                  ext={ext}
                  isInstalled={isInstalled}
                  isSyncing={isSyncing}
                  isLast={idx === filtered.length - 1}
                  onToggle={() => toggleInstall(ext.id)}
                />
              );
            })}
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Installed */}
            <div style={{
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 6, overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 16px", background: "#161b22",
                borderBottom: "1px solid #21262d",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                fontSize: 11, color: "#8b949e",
              }}>
                <span>installed</span>
                {installed.length > 0 && (
                  <span style={{
                    background: "rgba(63,185,80,.12)", color: "#3fb950",
                    border: "1px solid rgba(63,185,80,.25)",
                    fontSize: 9, fontWeight: 700,
                    padding: "2px 7px", borderRadius: 2, letterSpacing: "0.08em",
                  }}>
                    {installed.length} active
                  </span>
                )}
              </div>

              {installed.length === 0 ? (
                <div style={{ padding: "14px 16px", fontSize: 11, color: "#484f58" }}>
                  no extensions installed yet.
                </div>
              ) : (
                installed.map((ext, idx) => (
                  <InstalledRow
                    key={ext.id}
                    ext={ext}
                    isSyncing={isSyncing}
                    isLast={idx === installed.length - 1}
                    onRemove={() => toggleInstall(ext.id)}
                  />
                ))
              )}
            </div>

            {/* Recommended packs */}
            <div style={{
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 6, overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 16px", background: "#161b22",
                borderBottom: "1px solid #21262d",
                fontSize: 11, color: "#8b949e",
              }}>
                recommended packs
              </div>
              {[
                { label: "Web stack", tags: ["prettier", "eslint", "tailwind"], color: "#58a6ff" },
                { label: "Data science", tags: ["python", "jupyter"], color: "#bc8cff" },
                { label: "DevOps", tags: ["docker", "yaml", "kubernetes"], color: "#3fb950" },
              ].map((pack) => (
                <div key={pack.label} style={{
                  padding: "11px 16px",
                  borderBottom: "1px solid #161b22",
                  display: "flex", flexDirection: "column", gap: 5,
                }}>
                  <div style={{ fontSize: 12, color: pack.color, fontWeight: 600 }}>{pack.label}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {pack.tags.map((t) => (
                      <span key={t} style={{
                        fontSize: 9, color: "#484f58",
                        border: "1px solid #21262d",
                        padding: "1px 6px", borderRadius: 2,
                        background: "#03070f",
                      }}>{t}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#484f58" }}>
                    available in a future release
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM BAR */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20,
        borderTop: "1px solid #161b22",
        background: "rgba(3,7,15,.9)", backdropFilter: "blur(12px)",
        padding: "8px 40px",
        display: "flex", alignItems: "center", gap: 24,
        fontSize: 10, color: "#484f58",
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#3fb950", animation: "pulse 2s infinite" }} />
        <span style={{ color: "#3fb950" }}>live</span>
        <span>extensions</span>
        <span>⎇ main</span>
        <span>✓ firestore synced</span>
        <span style={{ marginLeft: "auto" }}>iTECify v0.1.0-alpha · iTEC 2026</span>
      </div>

      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700;800&family=Syne:wght@700;800&display=swap");
        @keyframes fadein { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { box-shadow:0 0 0 0 rgba(63,185,80,.4); } 50% { box-shadow:0 0 0 6px rgba(63,185,80,0); } }
        * { box-sizing: border-box; }
        body { margin: 0; padding-bottom: 44px; }
        input::placeholder { color: #30363d; }
      `}</style>
    </main>
  );
}

// ── Catalog row
function ExtRow({ ext, isInstalled, isSyncing, isLast, onToggle }: {
  ext: typeof EXTENSIONS[0];
  isInstalled: boolean;
  isSyncing: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: isLast ? "none" : "1px solid #161b22",
        display: "flex", gap: 14, justifyContent: "space-between", alignItems: "flex-start",
        background: hovered ? "rgba(88,166,255,.03)" : "transparent",
        transition: "background .15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
        {/* Meta row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#484f58", letterSpacing: "0.04em" }}>{ext.publisher}</span>
          <span style={{ fontSize: 9.5, color: "#e3b341", border: "1px solid rgba(227,179,65,.2)", background: "rgba(227,179,65,.06)", padding: "1px 5px", borderRadius: 2 }}>
            ★ {ext.rating}
          </span>
          <span style={{ fontSize: 9.5, color: "#484f58", border: "1px solid #21262d", padding: "1px 5px", borderRadius: 2 }}>
            {ext.installs}
          </span>
        </div>
        {/* Name */}
        <div style={{ fontSize: 13, fontWeight: 600, color: hovered ? "#79c0ff" : "#e6edf3", transition: "color .15s" }}>
          {ext.name}
        </div>
        {/* Description */}
        <div style={{ fontSize: 11, color: "#6e7681", lineHeight: 1.6 }}>{ext.description}</div>
        {/* Tags */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
          {ext.tags.map((tag) => (
            <span key={tag} style={{
              fontSize: 9.5, color: "#58a6ff",
              border: "1px solid rgba(88,166,255,.2)",
              background: "rgba(88,166,255,.06)",
              padding: "1px 6px", borderRadius: 2,
            }}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Button */}
      <button
        type="button"
        onClick={onToggle}
        disabled={isSyncing}
        style={{
          minWidth: 88, padding: "7px 14px",
          borderRadius: 4, fontSize: 11, fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          cursor: "pointer", letterSpacing: "0.04em",
          opacity: isSyncing ? 0.5 : 1,
          transition: "all .2s",
          border: isInstalled ? "1px solid #21262d" : "none",
          background: isInstalled ? "transparent" : "#58a6ff",
          color: isInstalled ? "#f85149" : "#03070f",
          flexShrink: 0,
        }}
        onMouseEnter={e => {
          if (isInstalled) {
            e.currentTarget.style.borderColor = "#f85149";
            e.currentTarget.style.background = "rgba(248,81,73,.08)";
          }
        }}
        onMouseLeave={e => {
          if (isInstalled) {
            e.currentTarget.style.borderColor = "#21262d";
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        {isInstalled ? "uninstall" : "▶ install"}
      </button>
    </div>
  );
}

// ── Installed sidebar row
function InstalledRow({ ext, isSyncing, isLast, onRemove }: {
  ext: typeof EXTENSIONS[0];
  isSyncing: boolean;
  isLast: boolean;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{
      padding: "11px 16px",
      borderBottom: isLast ? "none" : "1px solid #161b22",
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
      background: hovered ? "rgba(88,166,255,.03)" : "transparent",
      transition: "background .15s",
    }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {ext.name}
        </div>
        <div style={{ fontSize: 9.5, color: "#484f58", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#3fb950" }}>● active</span>
          <span>·</span>
          <span>{ext.installs}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={isSyncing}
        style={{
          padding: "4px 10px", borderRadius: 3,
          border: "1px solid #21262d",
          background: "transparent", color: "#f85149",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          cursor: "pointer", opacity: isSyncing ? 0.5 : 1,
          flexShrink: 0, transition: "all .2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "#f85149"; e.currentTarget.style.background = "rgba(248,81,73,.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "#21262d"; e.currentTarget.style.background = "transparent"; }}
      >
        remove
      </button>
    </div>
  );
}
