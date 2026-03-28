"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";

const LINES = [
  { t: "prompt", text: "$ git clone https://itecify.dev/sandbox-api" },
  { t: "success", text: "Cloning into 'sandbox-api'... done." },
  { t: "prompt", text: "$ itecify session start --collab --ai" },
  { t: "info", text: "↗ Session #f3a9 created" },
  { t: "info", text: "↗ Ana joined (cursor #1)" },
  { t: "info", text: "↗ Radu joined (cursor #2)" },
  { t: "ai", text: "✦ AI Agent connected · model: gpt-4o" },
  { t: "dim", text: "" },
  { t: "prompt", text: "$ docker build --lang python:3.11" },
  { t: "warn", text: "⚠ Scanning for vulnerabilities..." },
  { t: "success", text: "✓ No critical CVEs found" },
  { t: "success", text: "✓ Container spawned in 1.4s · 128mb" },
  { t: "dim", text: "" },
  { t: "ai", text: "✦ AI generated 14 lines in routes.py" },
  { t: "info", text: "  → Ana typed '14141414'" },
  { t: "warn", text: "  → Radu rejected block #2 (hallucination)" },
  { t: "success", text: "✓ Tests passed · exit 0 · 2.3s" },
  { t: "dim", text: "" },
  { t: "caret", text: "$ " },
] as const;

const COLOR_MAP: Record<string, string> = {
  prompt: "#8b949e",
  success: "#3fb950",
  info: "#58a6ff",
  warn: "#e3b341",
  ai: "#bc8cff",
  dim: "#2d333b",
  err: "#f85149",
};

export default function CharacterLandingPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const s1Ref = useRef<HTMLDivElement>(null);
  const s2Ref = useRef<HTMLDivElement>(null);
  const s3Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!auth) {
      setAuthChecked(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.replace("/workspace");
        return;
      }
      setAuthChecked(true);
    });

    return unsubscribe;
  }, [router]);

  // ── TERMINAL LINES
  const LINES = [
    { t: "prompt", text: "$ git clone https://itecify.dev/sandbox-api" },
    { t: "success", text: "Cloning into 'sandbox-api'... done." },
    { t: "prompt", text: "$ itecify session start --collab --ai" },
    { t: "info", text: "↗ Session #f3a9 created" },
    { t: "info", text: "↗ Ana joined (cursor #1)" },
    { t: "info", text: "↗ Radu joined (cursor #2)" },
    { t: "ai", text: "✦ AI Agent connected · model: gpt-4o" },
    { t: "dim", text: "" },
    { t: "prompt", text: "$ docker build --lang python:3.11" },
    { t: "warn", text: "⚠ Scanning for vulnerabilities..." },
    { t: "success", text: "✓ No critical CVEs found" },
    { t: "success", text: "✓ Container spawned in 1.4s · 128mb" },
    { t: "dim", text: "" },
    { t: "ai", text: "✦ AI generated 14 lines in routes.py" },
    { t: "info", text: "  → Ana typed '14141414'" },
    { t: "warn", text: "  → Radu rejected block #2 (hallucination)" },
    { t: "success", text: "✓ Tests passed · exit 0 · 2.3s" },
    { t: "dim", text: "" },
    { t: "caret", text: "$ " },
  ];

  const COLOR_MAP: Record<string, string> = {
    prompt: "#8b949e",
    success: "#3fb950",
    info: "#58a6ff",
    warn: "#e3b341",
    ai: "#bc8cff",
    dim: "#2d333b",
    err: "#f85149",
  };

  // ── CUSTOM CURSOR
  useEffect(() => {
    if (!authChecked) return;

    let mx = 0,
      my = 0,
      rx = 0,
      ry = 0;
    let raf: number;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
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
  }, [authChecked]);

  // ── CANVAS PARTICLE GRID
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0,
      H = 0;
    let particles: {
      x: number;
      y: number;
      ox: number;
      oy: number;
      vx: number;
      vy: number;
      s: number;
    }[] = [];
    let mx = 0,
      my = 0;
    let raf: number;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      particles = [];
      for (let x = 0; x < W; x += 48)
        for (let y = 0; y < H; y += 48)
          particles.push({
            x,
            y,
            ox: x,
            oy: y,
            vx: 0,
            vy: 0,
            s: Math.random() * 1 + 0.3,
          });
    };

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // ambient glow
      const g1 = ctx.createRadialGradient(
        W * 0.15,
        H * 0.3,
        0,
        W * 0.15,
        H * 0.3,
        W * 0.3,
      );
      g1.addColorStop(0, "rgba(88,166,255,.07)");
      g1.addColorStop(1, "transparent");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, W, H);

      const g2 = ctx.createRadialGradient(
        W * 0.85,
        H * 0.6,
        0,
        W * 0.85,
        H * 0.6,
        W * 0.25,
      );
      g2.addColorStop(0, "rgba(63,185,80,.05)");
      g2.addColorStop(1, "transparent");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);

      // interactive dots
      particles.forEach((p) => {
        const dx = mx - p.x,
          dy = my - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = Math.max(0, 1 - dist / 120);
        p.vx += (p.ox - p.x) * 0.06 - dx * force * 0.08;
        p.vy += (p.oy - p.y) * 0.06 - dy * force * 0.08;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(88,166,255,${0.12 + force * 0.3})`;
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

  // ── TERMINAL TYPEWRITER
  useEffect(() => {
    if (!authChecked) return;

    const body = termRef.current;
    if (!body) return;
    let li = 0;
    let timeout: ReturnType<typeof setTimeout>;

    const addLine = () => {
      if (li >= LINES.length || !body) return;
      const l = LINES[li++];
      const div = document.createElement("div");
      div.style.cssText =
        "opacity:0;white-space:nowrap;line-height:2;font-size:12px;transition:opacity .1s;";
      if (l.t === "caret") {
        div.innerHTML = `<span style="color:#8b949e">${l.text}</span><span style="display:inline-block;width:8px;height:14px;background:#58a6ff;vertical-align:middle;margin-left:2px;animation:blink .9s infinite;"></span>`;
      } else {
        div.innerHTML = `<span style="color:${COLOR_MAP[l.t] ?? "#e6edf3"}">${l.text}</span>`;
      }
      body.appendChild(div);
      requestAnimationFrame(() => {
        div.style.opacity = "1";
      });
      body.scrollTop = body.scrollHeight;
      if (li < LINES.length)
        timeout = setTimeout(
          addLine,
          l.t === "dim" ? 200 : Math.random() * 300 + 120,
        );
    };

    timeout = setTimeout(addLine, 900);
    return () => clearTimeout(timeout);
  }, [authChecked]);

  // ── STATS COUNTER
  useEffect(() => {
    if (!authChecked) return;

    const count = (el: HTMLDivElement | null, target: number) => {
      if (!el) return;
      let v = 0;
      const step = target / 60;
      const iv = setInterval(() => {
        v = Math.min(v + step, target);
        el.textContent = Math.floor(v).toLocaleString();
        if (v >= target) clearInterval(iv);
      }, 16);
    };
    const t = setTimeout(() => {
      count(s1Ref.current, 312);
      count(s2Ref.current, 18400);
      count(s3Ref.current, 9200);
    }, 1200);
    return () => clearTimeout(t);
  }, [authChecked]);

  return authChecked ? (
    <main
      style={{
        height: "100vh",
        width: "100%",
        background: "#03070f",
        color: "#e6edf3",
        fontFamily: "'JetBrains Mono', monospace",
        overflow: "hidden",
        position: "relative",
        cursor: "none",
      }}
    >
      {/* ── CUSTOM CURSOR */}
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

      {/* ── CANVAS */}
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, zIndex: 0 }}
      />

      {/* ── SCANLINES */}
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

      {/* ── MAIN GRID */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          height: "100vh",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          alignItems: "center",
          padding: "0 8vw",
          gap: "4vw",
        }}
      >
        {/* ── LEFT */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.3em",
              color: "#58a6ff",
              fontWeight: 700,
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 10,
              animation: "fadein .6s .2s both",
            }}
          >
            <span
              style={{
                display: "block",
                width: 24,
                height: 1,
                background: "#58a6ff",
              }}
            />
            iTEC 2026 · Cloud IDE
          </div>

          <h1
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "clamp(36px,5vw,68px)",
              fontWeight: 800,
              lineHeight: 1.0,
              letterSpacing: "-0.03em",
              marginBottom: 28,
              animation: "slidein .7s .4s both",
            }}
          >
            Code Beyond
            <br />
            <span
              style={{
                color: "transparent",
                WebkitTextStroke: "1px rgba(88,166,255,.7)",
              }}
            >
              The Horizon.
            </span>
            <br />
            <span style={{ color: "#58a6ff", fontSize: "0.65em" }}>
              iTECify.
            </span>
          </h1>

          <p
            style={{
              fontSize: 13,
              color: "#8b949e",
              lineHeight: 1.8,
              maxWidth: 380,
              marginBottom: 40,
              fontWeight: 300,
              animation: "fadein .6s .7s both",
            }}
          >
            Multi-human · multi-agent collaboration in one editor.
            <br />
            Docker sandboxing. AI blocks you can accept or reject.
            <br />
            No merge conflicts. No chaos.
          </p>

          <div
            style={{
              display: "flex",
              gap: 12,
              animation: "fadein .6s .9s both",
            }}
          >
            <Link
              href="/workspace"
              style={{
                background: "#58a6ff",
                color: "#03070f",
                padding: "13px 28px",
                borderRadius: 3,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textDecoration: "none",
                textTransform: "uppercase",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                transition: "all .2s",
              }}
            >
              <span>▶</span> Start Session
            </Link>
            <Link
              href="/login"
              style={{
                border: "1px solid #21262d",
                color: "#8b949e",
                padding: "13px 28px",
                borderRadius: 3,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textDecoration: "none",
                textTransform: "uppercase",
                transition: "all .2s",
              }}
            >
              Log in →
            </Link>
          </div>

          {/* stats */}
          <div
            style={{
              display: "flex",
              gap: 32,
              marginTop: 48,
              paddingTop: 32,
              borderTop: "1px solid #21262d",
              animation: "fadein .6s 1.1s both",
            }}
          >
            {[
              { ref: s1Ref, label: "ACTIVE SESSIONS" },
              { ref: s2Ref, label: "CONTAINERS RUN" },
              { ref: s3Ref, label: "AI BLOCKS ACCEPTED" },
            ].map(({ ref, label }) => (
              <div key={label}>
                <div
                  ref={ref}
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#e6edf3",
                  }}
                >
                  0
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#8b949e",
                    letterSpacing: "0.1em",
                    marginTop: 2,
                  }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT */}
        <div style={{ position: "relative" }}>
          {/* badge top-left */}
          <div
            style={{
              position: "absolute",
              top: -20,
              left: -30,
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 4,
              padding: "8px 12px",
              fontSize: 10,
              lineHeight: 1.6,
              zIndex: 5,
              boxShadow: "0 20px 40px rgba(0,0,0,.6)",
              animation: "badge-pop .5s 1.9s both",
            }}
          >
            <div
              style={{
                color: "#8b949e",
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              participants
            </div>
            <div style={{ color: "#e6edf3", fontWeight: 700, fontSize: 13 }}>
              <span style={{ color: "#58a6ff" }}>●</span> Ana &nbsp;
              <span style={{ color: "#bc8cff" }}>●</span> Radu &nbsp;
              <span style={{ color: "#e3b341" }}>●</span> AI
            </div>
          </div>

          {/* terminal */}
          <div
            style={{
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 6,
              overflow: "hidden",
              boxShadow:
                "0 40px 80px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.04)",
              animation: "terminal-in .8s .5s both",
            }}
          >
            {/* titlebar */}
            <div
              style={{
                background: "#161b22",
                padding: "10px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: "1px solid #21262d",
              }}
            >
              {[["#f85149"], ["#e3b341"], ["#3fb950"]].map(([c], i) => (
                <div
                  key={i}
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: c,
                  }}
                />
              ))}
              <span
                style={{
                  marginLeft: "auto",
                  marginRight: "auto",
                  fontSize: 11,
                  color: "#8b949e",
                  letterSpacing: "0.05em",
                }}
              >
                sandbox-api · bash · session #f3a9
              </span>
            </div>

            {/* body */}
            <div
              ref={termRef}
              style={{
                padding: "16px 20px",
                height: 340,
                overflow: "hidden",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
          </div>

          {/* badge bottom-right */}
          <div
            style={{
              position: "absolute",
              bottom: -20,
              right: -30,
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 4,
              padding: "8px 12px",
              fontSize: 10,
              lineHeight: 1.6,
              zIndex: 5,
              boxShadow: "0 20px 40px rgba(0,0,0,.6)",
              animation: "badge-pop .5s 1.6s both",
            }}
          >
            <div
              style={{
                color: "#8b949e",
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              container
            </div>
            <div style={{ color: "#3fb950", fontWeight: 700, fontSize: 13 }}>
              ● running
            </div>
            <div style={{ fontSize: 9, color: "#484f58", marginTop: 2 }}>
              python:3.11 · 128mb · 0.3cpu
            </div>
          </div>
        </div>
      </div>

      {/* ── BOTTOM BAR */}
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
        <span style={{ color: "#3fb950" }}>3 online</span>
        <span>sandbox-api</span>
        <span>⎇ main</span>
        <span>✓ 0 errors</span>
        <span style={{ marginLeft: "auto" }}>
          iTECify v0.1.0-alpha · iTEC 2026
        </span>
      </div>

      {/* ── GLOBAL STYLES */}
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700;800&family=Syne:wght@700;800&display=swap");

        @keyframes fadein {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes slidein {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes blink {
          0%,
          49% {
            opacity: 1;
          }
          50%,
          100% {
            opacity: 0;
          }
        }
        @keyframes terminal-in {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes badge-pop {
          from {
            opacity: 0;
            transform: scale(0.8) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
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
      `}</style>
    </main>
  ) : null;
}
