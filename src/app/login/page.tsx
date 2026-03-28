"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth, firebaseConfigError } from "@/lib/firebase";

const googleProvider = new GoogleAuthProvider();

export default function LoginPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/workspace");
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0,
      H = 0,
      mx = 0,
      my = 0,
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
      for (let x = 0; x < W; x += 52)
        for (let y = 0; y < H; y += 52)
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

      const g1 = ctx.createRadialGradient(
        W * 0.8,
        H * 0.2,
        0,
        W * 0.8,
        H * 0.2,
        W * 0.35,
      );
      g1.addColorStop(0, "rgba(88,166,255,.06)");
      g1.addColorStop(1, "transparent");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, W, H);

      const g2 = ctx.createRadialGradient(
        W * 0.2,
        H * 0.75,
        0,
        W * 0.2,
        H * 0.75,
        W * 0.28,
      );
      g2.addColorStop(0, "rgba(88,166,255,.05)");
      g2.addColorStop(1, "transparent");
      ctx.fillStyle = g2;
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
        ctx.fillStyle = `rgba(88,166,255,${0.1 + force * 0.25})`;
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

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth) {
      setErrorMessage("Firebase is not configured yet.");
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace("/workspace");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Unable to sign in.",
      );
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
  };

  const handleGoogleLogin = async () => {
    if (!auth) {
      setErrorMessage("Firebase is not configured yet.");
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await signInWithPopup(auth, googleProvider);
      router.replace("/workspace");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Unable to continue with Google.",
      );
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
  };

  if (firebaseConfigError) {
    return (
      <main style={{ flex: 1, padding: 32, maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
          Firebase Setup Required
        </h1>
        <p style={{ color: "#f85149", fontSize: 14 }}>{firebaseConfigError}</p>
      </main>
    );
  }

  const inputStyle = (field: string): React.CSSProperties => ({
    width: "100%",
    background: "#0d1117",
    border: `1px solid ${focusedField === field ? "#58a6ff" : "#21262d"}`,
    borderRadius: 4,
    padding: "11px 14px",
    fontSize: 13,
    color: "#e6edf3",
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
    transition: "border-color .2s, box-shadow .2s",
    boxShadow:
      focusedField === field ? "0 0 0 3px rgba(88,166,255,.12)" : "none",
    cursor: "none",
  });

  return (
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
        display: "grid",
        placeItems: "center",
      }}
    >
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

      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, zIndex: 0 }}
      />

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

      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: 420,
          padding: "0 20px",
          animation: "card-in .6s .1s both",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 24,
            animation: "fadein .5s .3s both",
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
          <span
            style={{
              fontSize: 10,
              color: "#58a6ff",
              letterSpacing: "0.3em",
              fontWeight: 700,
            }}
          >
            SIGN IN
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: "#484f58",
              letterSpacing: "0.1em",
            }}
          >
            iTECify · v0.1.0
          </span>
        </div>

        <div
          style={{
            background: "#161b22",
            border: "1px solid #21262d",
            borderRadius: "6px 6px 0 0",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {["#f85149", "#e3b341", "#58a6ff"].map((c, i) => (
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
            }}
          >
            auth · login · existing session
          </span>
        </div>

        <div
          style={{
            background: "#0d1117",
            border: "1px solid #21262d",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
            padding: "28px 28px 24px",
            boxShadow: "0 40px 80px rgba(0,0,0,.7)",
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 10,
                color: "#8b949e",
                marginBottom: 6,
                fontFamily: "'JetBrains Mono',monospace",
              }}
            >
              <span style={{ color: "#58a6ff" }}>✦</span> itecify auth --login
            </div>
            <h1
              style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                color: "#e6edf3",
                lineHeight: 1.1,
              }}
            >
              Access your
              <br />
              <span style={{ color: "#58a6ff" }}>workspace.</span>
            </h1>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  color: "#8b949e",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                placeholder="you@domain.com"
                style={inputStyle("email")}
                autoComplete="email"
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  color: "#8b949e",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="your password"
                  style={{ ...inputStyle("password"), paddingRight: 40 }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "#484f58",
                    fontSize: 12,
                    cursor: "none",
                    padding: 0,
                    transition: "color .15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#8b949e")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "#484f58")
                  }
                >
                  {showPass ? "hide" : "show"}
                </button>
              </div>
            </div>

            {errorMessage && (
              <div
                style={{
                  background: "rgba(248,81,73,.1)",
                  border: "1px solid rgba(248,81,73,.3)",
                  borderRadius: 4,
                  padding: "8px 12px",
                  fontSize: 11,
                  color: "#f85149",
                  marginBottom: 16,
                  lineHeight: 1.6,
                }}
              >
                ✗ {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: "100%",
                background: isSubmitting ? "#21262d" : "#58a6ff",
                color: isSubmitting ? "#8b949e" : "#03070f",
                border: "none",
                borderRadius: 3,
                padding: "12px 24px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "none",
                transition: "all .2s",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {isSubmitting ? (
                <>
                  <span
                    style={{
                      animation: "spin 1s linear infinite",
                      display: "inline-block",
                    }}
                  >
                    ◌
                  </span>
                  Signing in...
                </>
              ) : (
                <>✦ &nbsp;Sign in</>
              )}
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                margin: "14px 0",
                color: "#30363d",
                fontSize: 11,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "#21262d" }} />
              <span>or</span>
              <div style={{ flex: 1, height: 1, background: "#21262d" }} />
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleGoogleLogin}
              style={{
                width: "100%",
                background: "transparent",
                color: "#8b949e",
                border: "1px solid #21262d",
                borderRadius: 3,
                padding: "12px 24px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "none",
                transition: "all .2s",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#30363d";
                e.currentTarget.style.color = "#e6edf3";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#21262d";
                e.currentTarget.style.color = "#8b949e";
              }}
            >
              <span style={{ fontWeight: 800 }}>
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg></span> Continue with Google
            </button>

            <p
              style={{
                textAlign: "center",
                fontSize: 11,
                color: "#8b949e",
                lineHeight: 1.8,
              }}
            >
              New to iTECify?{" "}
              <Link
                href="/register"
                style={{
                  color: "#58a6ff",
                  textDecoration: "none",
                  borderBottom: "1px dotted rgba(88,166,255,.5)",
                }}
              >
                Create account
              </Link>
            </p>
          </form>
        </div>
      </div>

      <style>{`
        @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700;800&family=Syne:wght@700;800&display=swap");

        @keyframes fadein {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes card-in {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </main>
  );
}
