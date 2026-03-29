"use client";

import { useEffect, useMemo, useState } from "react";

type Toast = {
  id: number;
  title: string;
  description: string;
};

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export default function EasterEggs() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [rainbow, setRainbow] = useState(false);
  const [party, setParty] = useState(false);

  const confetti = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        left: 5 + i * 5,
        delay: (i % 6) * 0.12,
        dur: 1.6 + (i % 5) * 0.18,
        hue: (i * 31) % 360,
      })),
    [],
  );

  useEffect(() => {
    let konamiIndex = 0;
    let idCounter = 1;

    const pushToast = (title: string, description: string) => {
      const id = idCounter++;
      setToasts((prev) => [...prev, { id, title, description }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3200);
    };

    const activateRainbow = () => {
      setRainbow(true);
      document.body.classList.add("easter-rainbow");
      pushToast("Konami unlocked", "Rainbow mode enabled for 10 seconds.");
      window.setTimeout(() => {
        setRainbow(false);
        document.body.classList.remove("easter-rainbow");
      }, 10000);
    };

    const activateParty = () => {
      setParty(true);
      pushToast("Logo secret", "Sidebar party mode activated.");
      window.setTimeout(() => setParty(false), 2200);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (event.ctrlKey && event.shiftKey && key.toLowerCase() === "k") {
        pushToast("Dev shortcut", "You found Ctrl+Shift+K easter egg.");
      }

      if (key === KONAMI[konamiIndex]) {
        konamiIndex += 1;
        if (konamiIndex === KONAMI.length) {
          konamiIndex = 0;
          activateRainbow();
        }
      } else {
        konamiIndex = key === KONAMI[0] ? 1 : 0;
      }
    };

    const onLogoSecret = () => activateParty();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(
      "easter-logo-secret",
      onLogoSecret as EventListener,
    );

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(
        "easter-logo-secret",
        onLogoSecret as EventListener,
      );
      document.body.classList.remove("easter-rainbow");
    };
  }, []);

  return (
    <>
      {party ? (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 90,
            overflow: "hidden",
          }}
        >
          {confetti.map((piece) => (
            <span
              key={piece.id}
              style={{
                position: "absolute",
                top: -20,
                left: `${piece.left}%`,
                width: 8,
                height: 14,
                borderRadius: 2,
                background: `hsl(${piece.hue} 90% 60%)`,
                animation: `egg-fall ${piece.dur}s linear ${piece.delay}s forwards`,
              }}
            />
          ))}
        </div>
      ) : null}

      <div
        style={{
          position: "fixed",
          right: 14,
          bottom: 14,
          zIndex: 95,
          display: "grid",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              minWidth: 230,
              border: "1px solid #30363d",
              background: "rgba(13,17,23,.92)",
              borderRadius: 8,
              padding: "9px 11px",
              boxShadow: "0 12px 28px rgba(0,0,0,.35)",
              color: "#c9d1d9",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
            }}
          >
            <div style={{ color: "#58a6ff", fontWeight: 700, marginBottom: 3 }}>
              {toast.title}
            </div>
            <div style={{ color: "#8b949e" }}>{toast.description}</div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes egg-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(420deg); opacity: .9; }
        }
      `}</style>
    </>
  );
}
