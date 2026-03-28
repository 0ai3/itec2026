"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { collection, getDocs } from "firebase/firestore";
import {
  onAuthStateChanged,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type ParticipatingRepo = {
  id: string;
  name: string;
  role?: "owner" | "collaborator";
  ownerName?: string;
  ownerEmail?: string;
  ownerPhotoURL?: string;
};

type PetSkin = "blob" | "bot" | "fox";
type PetMood = "sad" | "neutral" | "angry" | "happy";

const PET_ENABLED_KEY = "pet.enabled";
const PET_SKIN_KEY = "pet.skin";
const PET_MOOD_KEY = "pet.mood";

const PET_SKINS: { id: PetSkin; name: string; description: string }[] = [
  { id: "blob", name: "Nova Blob", description: "Round, playful, soft motion" },
  { id: "bot", name: "Pixel Bot", description: "Techy, compact, robotic vibe" },
  { id: "fox", name: "Tiny Fox", description: "Cute ears, agile explorer look" },
];

const PET_MOODS: { id: PetMood; name: string; description: string; color: string }[] = [
  { id: "sad", name: "Trist", description: "mov", color: "#8b6cd9" },
  { id: "neutral", name: "Neutru", description: "albastru", color: "#58a6ff" },
  { id: "angry", name: "Furios", description: "rosu", color: "#f85149" },
  { id: "happy", name: "Vesel", description: "galben", color: "#e3b341" },
];

/* ─── Main ───────────────────────────────────────────────────────────────── */

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [displayName, setDisplayName] = useState(auth?.currentUser?.displayName ?? "");
  const [photoURL, setPhotoURL] = useState(auth?.currentUser?.photoURL ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [participatingRepos, setParticipatingRepos] = useState<ParticipatingRepo[]>([]);
  const [metaMessage, setMetaMessage] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoRoleFilter, setRepoRoleFilter] = useState<"all" | "owner" | "collaborator">("all");
  const [repoSort, setRepoSort] = useState<"name" | "owner">("name");
  const [copiedRepoId, setCopiedRepoId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [petSettingsReady, setPetSettingsReady] = useState(false);
  const [petEnabled, setPetEnabled] = useState(true);
  const [petSkin, setPetSkin] = useState<PetSkin>("blob");
  const [petMood, setPetMood] = useState<PetMood>("neutral");
  const [activeTab, setActiveTab] = useState<"account" | "repos" | "pet">("account");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  /* ── Canvas particle grid (same as landing) ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0;
    let particles: { x: number; y: number; ox: number; oy: number; vx: number; vy: number; s: number }[] = [];
    let mx = 0, my = 0;
    let raf: number;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      particles = [];
      for (let x = 0; x < W; x += 48)
        for (let y = 0; y < H; y += 48)
          particles.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, s: Math.random() * 1 + 0.3 });
    };

    const onMove = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      const g1 = ctx.createRadialGradient(W * 0.2, H * 0.2, 0, W * 0.2, H * 0.2, W * 0.35);
      g1.addColorStop(0, "rgba(88,166,255,.06)");
      g1.addColorStop(1, "transparent");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, W, H);

      const g2 = ctx.createRadialGradient(W * 0.8, H * 0.7, 0, W * 0.8, H * 0.7, W * 0.25);
      g2.addColorStop(0, "rgba(188,140,255,.04)");
      g2.addColorStop(1, "transparent");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);

      particles.forEach((p) => {
        const dx = mx - p.x, dy = my - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = Math.max(0, 1 - dist / 120);
        p.vx += (p.ox - p.x) * 0.06 - dx * force * 0.08;
        p.vy += (p.oy - p.y) * 0.06 - dy * force * 0.08;
        p.vx *= 0.82; p.vy *= 0.82;
        p.x += p.vx; p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(88,166,255,${0.1 + force * 0.28})`;
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
  }, []);

  /* ── Custom cursor ── */
  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0;
    let raf: number;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY;
      if (cursorRef.current) {
        cursorRef.current.style.left = mx - 4 + "px";
        cursorRef.current.style.top = my - 4 + "px";
      }
    };

    const animRing = () => {
      rx += (mx - rx) * 0.12;
      ry += (my - ry) * 0.12;
      if (ringRef.current) {
        ringRef.current.style.left = rx - 16 + "px";
        ringRef.current.style.top = ry - 16 + "px";
      }
      raf = requestAnimationFrame(animRing);
    };

    document.addEventListener("mousemove", onMove);
    animRing();
    return () => {
      document.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* ── Pet settings ── */
  useEffect(() => {
    const rawEnabled = window.localStorage.getItem(PET_ENABLED_KEY);
    const rawSkin = window.localStorage.getItem(PET_SKIN_KEY);
    const rawMood = window.localStorage.getItem(PET_MOOD_KEY);
    setPetEnabled(rawEnabled !== "false");
    setPetSkin(rawSkin === "bot" || rawSkin === "fox" ? rawSkin : "blob");
    setPetMood(rawMood === "sad" || rawMood === "angry" || rawMood === "happy" ? rawMood : "neutral");
    setPetSettingsReady(true);
  }, []);

  /* ── Auth + repos ── */
  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setDisplayName(u?.displayName ?? "");
      setPhotoURL(u?.photoURL ?? "");
      if (!u || !db) { setParticipatingRepos([]); setMetaMessage(null); return; }
      try {
        const snap = await getDocs(collection(db, "users", u.uid, "repos"));
        const repos = snap.docs.map((d) => {
          const data = d.data() as { name?: string; role?: "owner" | "collaborator"; ownerName?: string; ownerEmail?: string; ownerPhotoURL?: string };
          return { id: d.id, name: data.name?.trim() || d.id, role: data.role, ownerName: data.ownerName, ownerEmail: data.ownerEmail, ownerPhotoURL: data.ownerPhotoURL } satisfies ParticipatingRepo;
        });
        setParticipatingRepos(repos);
        setMetaMessage(snap.size === 0 ? "No repos yet" : null);
      } catch { setParticipatingRepos([]); setMetaMessage("Could not load repos"); }
    });
    return unsub;
  }, []);

  /* ── Helpers ── */
  const previewPhotoURL = useMemo(() => photoURL.trim(), [photoURL]);

  const getOwnerUsername = (repo: ParticipatingRepo) => {
    if (repo.role === "owner") {
      const name = user?.displayName?.trim();
      if (name) return name;
      const email = user?.email?.trim() ?? "";
      return email.includes("@") ? email.split("@")[0] : "you";
    }
    if (repo.ownerName?.trim()) return repo.ownerName.trim();
    if (repo.ownerEmail?.includes("@")) return repo.ownerEmail.split("@")[0];
    return "owner";
  };

  const getOwnerAvatar = (repo: ParticipatingRepo) => {
    if (repo.role === "owner" && previewPhotoURL) return previewPhotoURL;
    if (repo.ownerPhotoURL?.trim()) return repo.ownerPhotoURL.trim();
    return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(getOwnerUsername(repo))}`;
  };

  const ownerCount = useMemo(() => participatingRepos.filter(r => r.role === "owner").length, [participatingRepos]);
  const collabCount = useMemo(() => participatingRepos.filter(r => r.role === "collaborator").length, [participatingRepos]);

  const visibleRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    return participatingRepos
      .filter(r => {
        if (repoRoleFilter !== "all" && (r.role ?? "collaborator") !== repoRoleFilter) return false;
        if (!q) return true;
        const owner = getOwnerUsername(r).toLowerCase();
        return r.name.toLowerCase().includes(q) || owner.includes(q) || r.id.toLowerCase().includes(q);
      })
      .sort((a, b) => repoSort === "owner" ? getOwnerUsername(a).localeCompare(getOwnerUsername(b)) : a.name.localeCompare(b.name));
  }, [participatingRepos, repoRoleFilter, repoSearch, repoSort]);

  /* ── Actions ── */
  const handleUpdateProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setIsSubmitting(true); setMessage(null); setErrorMessage(null);
    try {
      await updateProfile(user, { displayName: displayName.trim() || null, photoURL: photoURL.trim() || null });
      setMessage("Profile saved");
    } catch { setErrorMessage("Failed to update profile"); }
    setIsSubmitting(false);
  };

  const handleCopyRepoId = async (repoId: string) => {
    try {
      await navigator.clipboard.writeText(repoId);
      setCopiedRepoId(repoId);
      setTimeout(() => setCopiedRepoId(c => c === repoId ? null : c), 1200);
    } catch { setErrorMessage("Could not copy"); }
  };

  const handleCopyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedText(label);
      setTimeout(() => setCopiedText(c => c === label ? null : c), 1200);
    } catch { setErrorMessage("Could not copy"); }
  };

  const emitPetSettingsChanged = () => window.dispatchEvent(new CustomEvent("pet-settings-changed"));

  const handlePetEnabledChange = (v: boolean) => { setPetEnabled(v); window.localStorage.setItem(PET_ENABLED_KEY, String(v)); emitPetSettingsChanged(); };
  const handlePetSkinChange = (v: PetSkin) => { setPetSkin(v); window.localStorage.setItem(PET_SKIN_KEY, v); emitPetSettingsChanged(); };
  const handlePetMoodChange = (v: PetMood) => { setPetMood(v); window.localStorage.setItem(PET_MOOD_KEY, v); emitPetSettingsChanged(); };

  const handleSignOut = async () => {
    if (!auth) return;
    try { await signOut(auth); router.replace("/login"); } catch { setErrorMessage("Could not sign out."); }
  };

  const avatarLetter = (user?.displayName ?? user?.email ?? "U")[0].toUpperCase();

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <main style={{ height: "100vh", width: "100%", background: "#03070f", color: "#e6edf3", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", position: "relative", cursor: "none" }}>

      {/* Custom cursor */}
      <div ref={cursorRef} style={{ position: "fixed", width: 8, height: 8, background: "#58a6ff", borderRadius: "50%", pointerEvents: "none", zIndex: 9999, mixBlendMode: "screen" }} />
      <div ref={ringRef} style={{ position: "fixed", width: 32, height: 32, border: "1px solid rgba(88,166,255,.4)", borderRadius: "50%", pointerEvents: "none", zIndex: 9998 }} />

      {/* Canvas */}
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />

      {/* Scanlines */}
      <div style={{ position: "fixed", inset: 0, zIndex: 2, pointerEvents: "none", background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.04) 2px,rgba(0,0,0,.04) 4px)" }} />

      {/* Navbar */}
 

      {/* Content */}
      <div style={{ position: "relative", zIndex: 10, height: "calc(100vh - 56px)", display: "grid", gridTemplateColumns: "300px 1fr", overflow: "hidden" }}>

        {/* ── Left sidebar ── */}
        <div style={{ borderRight: "1px solid #161b22", display: "flex", flexDirection: "column", overflow: "hidden", background: "rgba(3,7,15,0.7)", backdropFilter: "blur(12px)" }}>

          {/* Avatar section */}
          <div style={{ padding: "32px 24px 24px", borderBottom: "1px solid #161b22", animation: "fadein .6s .2s both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, letterSpacing: "0.25em", color: "#58a6ff", fontWeight: 700, marginBottom: 20, textTransform: "uppercase" }}>
              <span style={{ display: "block", width: 16, height: 1, background: "#58a6ff" }} />
              profile
            </div>

            {/* Avatar */}
            <div style={{ position: "relative", width: 72, height: 72, marginBottom: 16 }}>
              <div style={{ width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: "1px solid #21262d", background: "#0d1117", display: "grid", placeItems: "center" }}>
                {previewPhotoURL ? (
                  <img src={previewPhotoURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="avatar" />
                ) : (
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: "#58a6ff" }}>{avatarLetter}</span>
                )}
              </div>
              {/* online indicator */}
              <div style={{ position: "absolute", bottom: 2, right: 2, width: 10, height: 10, borderRadius: "50%", background: "#3fb950", border: "2px solid #03070f", animation: "pulse 2s infinite" }} />
            </div>

            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "#e6edf3", letterSpacing: "-0.02em" }}>
              {displayName || "Developer"}
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{user?.email}</div>

            {/* stat pills */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <StatPill label="owned" value={ownerCount} color="#58a6ff" />
              <StatPill label="collab" value={collabCount} color="#bc8cff" />
              <StatPill label="total" value={participatingRepos.length} color="#3fb950" />
            </div>
          </div>

          {/* Tab nav */}
          <div style={{ display: "flex", borderBottom: "1px solid #161b22" }}>
            {(["account", "repos", "pet"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === tab ? "2px solid #58a6ff" : "2px solid transparent",
                  color: activeTab === tab ? "#e6edf3" : "#8b949e",
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "color .15s",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px" }}>

            {/* ── Account tab ── */}
            {activeTab === "account" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, animation: "fadein .3s both" }}>
                <GlassRow label="User ID" value={user?.uid ?? "–"} onCopy={() => void handleCopyText(user?.uid ?? "", "uid")} copied={copiedText === "uid"} />
                <GlassRow label="Email" value={user?.email ?? "–"} onCopy={() => void handleCopyText(user?.email ?? "", "email")} copied={copiedText === "email"} />
                <GlassRow label="Role mix" value={`${ownerCount} owner · ${collabCount} collab`} />

                <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid #161b22" }}>
                  <button
                    onClick={() => void handleSignOut()}
                    style={{ width: "100%", padding: "9px", borderRadius: 6, border: "1px solid rgba(248,81,73,.4)", background: "rgba(248,81,73,.1)", color: "#f85149", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", letterSpacing: "0.05em" }}
                  >
                    ↗ sign out
                  </button>
                </div>
              </div>
            )}

            {/* ── Repos tab ── */}
            {activeTab === "repos" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, animation: "fadein .3s both" }}>
                <input
                  value={repoSearch}
                  onChange={e => setRepoSearch(e.target.value)}
                  placeholder="Search repos..."
                  style={{ width: "100%", background: "rgba(255,255,255,.03)", border: "1px solid #21262d", color: "#e6edf3", fontSize: 12, borderRadius: 6, padding: "7px 10px", outline: "none", fontFamily: "'JetBrains Mono', monospace", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <GlassSelect value={repoRoleFilter} onChange={v => setRepoRoleFilter(v as typeof repoRoleFilter)} options={[["all", "All"], ["owner", "Owner"], ["collaborator", "Collab"]]} />
                  <GlassSelect value={repoSort} onChange={v => setRepoSort(v as typeof repoSort)} options={[["name", "By name"], ["owner", "By owner"]]} />
                </div>
                {visibleRepos.map(repo => (
                  <div key={repo.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 6, border: "1px solid #161b22", background: "rgba(255,255,255,.02)", transition: "border-color .15s" }}>
                    <img src={getOwnerAvatar(repo)} alt="" style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid #21262d", flexShrink: 0 }} />
                    <Link href={`/repo/${repo.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none" }}>
                      <div style={{ fontSize: 11, color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ color: "#c9d1d9" }}>{getOwnerUsername(repo)}</span>/{repo.name}
                      </div>
                    </Link>
                    <button
                      onClick={() => void handleCopyRepoId(repo.id)}
                      style={{ background: copiedRepoId === repo.id ? "#1f6feb" : "transparent", border: "1px solid #30363d", color: copiedRepoId === repo.id ? "#fff" : "#8b949e", fontSize: 9, borderRadius: 4, padding: "3px 6px", cursor: "pointer", flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {copiedRepoId === repo.id ? "✓" : "ID"}
                    </button>
                  </div>
                ))}
                {metaMessage && <div style={{ fontSize: 11, color: "#8b949e", padding: "4px 2px" }}>{metaMessage}</div>}
              </div>
            )}

            {/* ── Pet tab ── */}
            {activeTab === "pet" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, animation: "fadein .3s both" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#c9d1d9", cursor: "pointer" }}>
                  <input type="checkbox" checked={petEnabled} disabled={!petSettingsReady} onChange={e => handlePetEnabledChange(e.target.checked)} />
                  Enable pet globally
                </label>

                <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 4 }}>Skin</div>
                {PET_SKINS.map(skin => (
                  <button key={skin.id} onClick={() => handlePetSkinChange(skin.id)} disabled={!petSettingsReady}
                    style={{ border: petSkin === skin.id ? "1px solid #58a6ff" : "1px solid #21262d", background: petSkin === skin.id ? "rgba(88,166,255,.08)" : "rgba(255,255,255,.02)", borderRadius: 8, padding: "8px 10px", textAlign: "left", cursor: "pointer", color: "#e6edf3", display: "flex", alignItems: "center", gap: 10, transition: "all .15s" }}>
                    <PetPreview skin={skin.id} mood={petMood} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{skin.name}</div>
                      <div style={{ fontSize: 10, color: "#8b949e" }}>{skin.description}</div>
                    </div>
                  </button>
                ))}

                <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 4 }}>Mood</div>
                {PET_MOODS.map(mood => (
                  <button key={mood.id} onClick={() => handlePetMoodChange(mood.id)} disabled={!petSettingsReady}
                    style={{ border: petMood === mood.id ? `1px solid ${mood.color}` : "1px solid #21262d", background: petMood === mood.id ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.02)", borderRadius: 8, padding: "7px 10px", color: "#e6edf3", fontSize: 12, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", transition: "all .15s" }}>
                    <span>{mood.name} · {mood.description}</span>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: mood.color, flexShrink: 0, display: "block" }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: main edit area ── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "auto", background: "rgba(3,7,15,0.5)", backdropFilter: "blur(8px)" }}>

          {/* Top accent bar */}
          <div style={{ padding: "0 40px", borderBottom: "1px solid #161b22", display: "flex", alignItems: "center", gap: 8, height: 44, flexShrink: 0 }}>
            <Link href="/workspace" style={{ color: "#8b949e", fontSize: 11, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>← workspace</Link>
            <span style={{ color: "#21262d" }}>/</span>
            <span style={{ fontSize: 11, color: "#e6edf3", fontWeight: 700 }}>profile</span>
            <div style={{ flex: 1 }} />
            {message && <span style={{ fontSize: 11, color: "#3fb950", animation: "fadein .3s both" }}>✓ {message}</span>}
          </div>

          {/* Hero area */}
          <div style={{ padding: "48px 40px 40px", borderBottom: "1px solid #161b22" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.3em", color: "#58a6ff", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 10, animation: "fadein .6s .1s both" }}>
              <span style={{ display: "block", width: 24, height: 1, background: "#58a6ff" }} />
              Edit Profile
            </div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.03em", margin: 0, animation: "slidein .7s .2s both" }}>
              {displayName || "Developer"}
              <br />
              <span style={{ color: "transparent", WebkitTextStroke: "1px rgba(88,166,255,.5)", fontSize: "0.65em" }}>
                {user?.email ?? ""}
              </span>
            </h1>
          </div>

          {/* Edit form */}
          <div style={{ padding: "32px 40px", flex: 1 }}>
            <form onSubmit={handleUpdateProfile} style={{ maxWidth: 560 }}>

              <div style={{ display: "grid", gap: 20, marginBottom: 28 }}>
                <div>
                  <FieldLabel>Display name</FieldLabel>
                  <GlassInput value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />
                </div>
                <div>
                  <FieldLabel>Avatar URL</FieldLabel>
                  <GlassInput value={photoURL} onChange={e => setPhotoURL(e.target.value)} placeholder="https://..." />
                  {previewPhotoURL && (
                    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                      <img src={previewPhotoURL} alt="preview" style={{ width: 40, height: 40, borderRadius: 6, border: "1px solid #21262d", objectFit: "cover" }} />
                      <span style={{ fontSize: 11, color: "#8b949e" }}>preview</span>
                    </div>
                  )}
                </div>
              </div>

              {errorMessage && (
                <div style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(248,81,73,.3)", background: "rgba(248,81,73,.08)", color: "#f85149", fontSize: 12, marginBottom: 16 }}>
                  {errorMessage}
                </div>
              )}

              <button type="submit" disabled={isSubmitting}
                style={{ padding: "11px 24px", borderRadius: 4, border: "none", background: "#58a6ff", color: "#03070f", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, opacity: isSubmitting ? 0.7 : 1, transition: "opacity .2s" }}>
                {isSubmitting ? "Saving…" : <><span>▶</span> Save Profile</>}
              </button>
            </form>

            {/* Quick stats cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 40, maxWidth: 560 }}>
              {[
                { label: "OWNED REPOS", value: ownerCount, color: "#58a6ff" },
                { label: "COLLABORATING", value: collabCount, color: "#bc8cff" },
                { label: "TOTAL REPOS", value: participatingRepos.length, color: "#3fb950" },
              ].map(stat => (
                <div key={stat.label} style={{ padding: "16px", border: "1px solid #161b22", borderRadius: 8, background: "rgba(255,255,255,.02)", animation: "fadein .6s both" }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.12em", marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20, borderTop: "1px solid #161b22", background: "rgba(3,7,15,.9)", backdropFilter: "blur(12px)", padding: "7px 40px", display: "flex", alignItems: "center", gap: 24, fontSize: 10, color: "#484f58", fontFamily: "'JetBrains Mono', monospace" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#3fb950", animation: "pulse 2s infinite" }} />
        <span style={{ color: "#3fb950" }}>connected</span>
        <span>profile</span>
        <span>{participatingRepos.length} repos</span>
        <span style={{ marginLeft: "auto" }}>iTECify v0.1.0-alpha · iTEC 2026</span>
      </div>

      {/* Global styles */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700;800&family=Syne:wght@700;800&display=swap');
        @keyframes fadein { from { opacity:0 } to { opacity:1 } }
        @keyframes slidein { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pulse { 0%,100% { box-shadow:0 0 0 0 rgba(63,185,80,.4) } 50% { box-shadow:0 0 0 6px rgba(63,185,80,0) } }
      `}</style>
    </main>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${color}22`, background: `${color}11`, display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 13, fontFamily: "'Syne', sans-serif", fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.08em" }}>{label}</span>
    </div>
  );
}

function GlassRow({ label, value, onCopy, copied }: { label: string; value: string; onCopy?: () => void; copied?: boolean }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #161b22", background: "rgba(255,255,255,.02)", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 11, color: "#e6edf3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }} title={value}>{value}</div>
      </div>
      {onCopy && (
        <button onClick={onCopy} style={{ background: copied ? "#1f6feb" : "transparent", border: "1px solid #30363d", color: copied ? "#fff" : "#8b949e", fontSize: 9, borderRadius: 4, padding: "3px 7px", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, transition: "all .15s" }}>
          {copied ? "✓" : "copy"}
        </button>
      )}
    </div>
  );
}

function GlassSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ flex: 1, background: "rgba(255,255,255,.03)", border: "1px solid #21262d", color: "#e6edf3", fontSize: 11, borderRadius: 6, padding: "6px 8px", outline: "none", fontFamily: "'JetBrains Mono', monospace" }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>{children}</div>;
}

function GlassInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{ width: "100%", background: "rgba(255,255,255,.03)", border: "1px solid #21262d", padding: "10px 14px", borderRadius: 6, color: "#e6edf3", fontSize: 13, outline: "none", fontFamily: "'JetBrains Mono', monospace", boxSizing: "border-box", transition: "border-color .15s" }}
      onFocus={e => (e.target.style.borderColor = "#58a6ff")}
      onBlur={e => (e.target.style.borderColor = "#21262d")}
    />
  );
}

function PetPreview({ skin, mood }: { skin: PetSkin; mood: PetMood }) {
  const c = { sad: { light: "#b7a6ff", base: "#8b6cd9", dark: "#6447ad" }, neutral: { light: "#9fd2ff", base: "#58a6ff", dark: "#2f81f7" }, angry: { light: "#ff9b9b", base: "#f85149", dark: "#c93c37" }, happy: { light: "#ffe89a", base: "#e3b341", dark: "#bf8e2f" } }[mood];
  return (
    <div style={{ width: 26, height: 26, borderRadius: skin === "bot" ? 6 : "50%", background: skin === "blob" ? `radial-gradient(circle at 35% 30%, ${c.light} 0%, ${c.base} 55%, ${c.dark} 100%)` : skin === "bot" ? `linear-gradient(145deg, ${c.light} 0%, ${c.base} 50%, ${c.dark} 100%)` : `radial-gradient(circle at 40% 30%, ${c.light} 0%, ${c.base} 50%, ${c.dark} 100%)`, position: "relative", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 8, left: 6, width: 3, height: 3, borderRadius: "50%", background: "#0d1117" }} />
      <div style={{ position: "absolute", top: 8, right: 6, width: 3, height: 3, borderRadius: "50%", background: "#0d1117" }} />
      {skin === "fox" && <>
        <div style={{ position: "absolute", top: -4, left: 4, width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "2px solid transparent", borderBottom: "6px solid #0d1117" }} />
        <div style={{ position: "absolute", top: -4, right: 4, width: 0, height: 0, borderRight: "4px solid transparent", borderLeft: "2px solid transparent", borderBottom: "6px solid #0d1117" }} />
      </>}
    </div>
  );
}
