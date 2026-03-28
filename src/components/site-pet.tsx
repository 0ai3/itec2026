"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type PetStage = {
  key: "hatchling" | "explorer" | "builder" | "coder";
  level: 1 | 2 | 3 | 4;
  label: string;
  size: number;
  minSpeed: number;
  maxSpeed: number;
  colors: {
    light: string;
    base: string;
    dark: string;
    glow: string;
  };
  emotes: string[];
};

type PetSkin = "blob" | "bot" | "fox";
type PetMood = "sad" | "neutral" | "angry" | "happy";

const PET_ENABLED_KEY = "pet.enabled";
const PET_SKIN_KEY = "pet.skin";
const PET_MOOD_KEY = "pet.mood";

const MOOD_COLORS: Record<
  PetMood,
  {
    light: string;
    base: string;
    dark: string;
    glow: string;
    accentLabel: string;
  }
> = {
  sad: {
    light: "#b7a6ff",
    base: "#8b6cd9",
    dark: "#6447ad",
    glow: "rgba(139,108,217,.42)",
    accentLabel: "mov",
  },
  neutral: {
    light: "#9fd2ff",
    base: "#58a6ff",
    dark: "#2f81f7",
    glow: "rgba(88,166,255,.4)",
    accentLabel: "albastru",
  },
  angry: {
    light: "#ff9b9b",
    base: "#f85149",
    dark: "#c93c37",
    glow: "rgba(248,81,73,.4)",
    accentLabel: "rosu",
  },
  happy: {
    light: "#ffe89a",
    base: "#e3b341",
    dark: "#bf8e2f",
    glow: "rgba(227,179,65,.45)",
    accentLabel: "galben",
  },
};

const STAGES: Record<PetStage["key"], PetStage> = {
  hatchling: {
    key: "hatchling",
    level: 1,
    label: "Mainpage",
    size: 34,
    minSpeed: 50,
    maxSpeed: 110,
    colors: {
      light: "#9fd2ff",
      base: "#58a6ff",
      dark: "#2f81f7",
      glow: "rgba(88,166,255,.28)",
    },
    emotes: ["hi", "o_o", ":)"],
  },
  explorer: {
    key: "explorer",
    level: 2,
    label: "Login/Signup",
    size: 40,
    minSpeed: 65,
    maxSpeed: 150,
    colors: {
      light: "#93ccff",
      base: "#58a6ff",
      dark: "#2f81f7",
      glow: "rgba(88,166,255,.34)",
    },
    emotes: ["go!", "*", "<3"],
  },
  builder: {
    key: "builder",
    level: 3,
    label: "Workspace",
    size: 46,
    minSpeed: 78,
    maxSpeed: 175,
    colors: {
      light: "#87c6ff",
      base: "#58a6ff",
      dark: "#1f6feb",
      glow: "rgba(88,166,255,.42)",
    },
    emotes: ["build", "++", "ship"],
  },
  coder: {
    key: "coder",
    level: 4,
    label: "Coding",
    size: 52,
    minSpeed: 90,
    maxSpeed: 195,
    colors: {
      light: "#78beff",
      base: "#58a6ff",
      dark: "#1a5fd0",
      glow: "rgba(88,166,255,.52)",
    },
    emotes: ["{ }", "commit", "focus"],
  },
};

function getStageFromPath(pathname: string): PetStage {
  if (pathname === "/") return STAGES.hatchling;
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/signup"
  )
    return STAGES.explorer;
  if (pathname.startsWith("/repo/") || pathname === "/editor")
    return STAGES.coder;
  return STAGES.builder;
}

export default function SitePet() {
  const pathname = usePathname();
  const stage = getStageFromPath(pathname);

  const petRef = useRef<HTMLDivElement>(null);
  const emoteRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PetStage>(stage);
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [skin, setSkin] = useState<PetSkin>("blob");
  const [mood, setMood] = useState<PetMood>("neutral");

  useEffect(() => {
    const readSettings = () => {
      const rawEnabled = window.localStorage.getItem(PET_ENABLED_KEY);
      const rawSkin = window.localStorage.getItem(PET_SKIN_KEY);
      const rawMood = window.localStorage.getItem(PET_MOOD_KEY);
      setEnabled(rawEnabled !== "false");
      setSkin(rawSkin === "bot" || rawSkin === "fox" ? rawSkin : "blob");
      setMood(
        rawMood === "sad" || rawMood === "angry" || rawMood === "happy"
          ? rawMood
          : "neutral",
      );
      setReady(true);
    };

    const onStorage = () => readSettings();
    const onSettingsChanged = () => readSettings();

    readSettings();
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      "pet-settings-changed",
      onSettingsChanged as EventListener,
    );

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "pet-settings-changed",
        onSettingsChanged as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    stageRef.current = stage;
    const emote = emoteRef.current;
    if (!emote) return;
    emote.textContent = `LV${stage.level} ${stage.label}`;
    emote.style.opacity = "1";
    const t = window.setTimeout(() => {
      emote.style.opacity = "0";
    }, 1300);
    return () => window.clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    if (!ready || !enabled) return;

    const pet = petRef.current;
    const emote = emoteRef.current;
    if (!pet || !emote) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let size = stageRef.current.size;
    let x = Math.min(window.innerWidth - size, 120);
    let y = Math.min(window.innerHeight - size, 120);
    let vx = 110;
    let vy = 80;
    let directionTimer = 0;
    let nextTurnAfter = 2.4;
    let emoteTimer = 0;
    let emoteVisibleFor = 0;
    let paused = false;
    let mouseX = -9999;
    let mouseY = -9999;
    let last = performance.now();
    let frame = 0;

    const clampToViewport = () => {
      size = stageRef.current.size;
      x = Math.min(Math.max(0, x), window.innerWidth - size);
      y = Math.min(Math.max(0, y), window.innerHeight - size);
    };

    const showEmote = (text: string, forSeconds: number) => {
      emote.textContent = text;
      emote.style.opacity = "1";
      emoteVisibleFor = forSeconds;
    };

    const hideEmote = () => {
      emote.style.opacity = "0";
    };

    const render = (now: number) => {
      const facing = vx < 0 ? -1 : 1;
      const bob = Math.sin(now * 0.008) * 1.8;
      pet.style.transform = `translate3d(${x}px, ${y + bob}px, 0) scaleX(${facing})`;
    };

    const randomTurn = () => {
      const speed = Math.sqrt(vx * vx + vy * vy) || 120;
      const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * 0.8;
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
      nextTurnAfter = 2 + Math.random() * 1.8;
    };

    const steerTowardMouse = () => {
      const dx = mouseX - (x + size / 2);
      const dy = mouseY - (y + size / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 50 && dist < 220) {
        const n = 1 / dist;
        vx += dx * n * 16;
        vy += dy * n * 12;
      }
    };

    const capSpeed = () => {
      const { minSpeed: min, maxSpeed: max } = stageRef.current;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < min && speed > 0) {
        const n = min / speed;
        vx *= n;
        vy *= n;
      }
      if (speed > max) {
        const n = max / speed;
        vx *= n;
        vy *= n;
      }
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.04);
      last = now;

      if (paused) {
        render(now);
        frame = requestAnimationFrame(tick);
        return;
      }

      directionTimer += dt;
      emoteTimer += dt;
      size = stageRef.current.size;

      if (emoteVisibleFor > 0) {
        emoteVisibleFor -= dt;
        if (emoteVisibleFor <= 0) hideEmote();
      }

      if (emoteTimer > 5.2 + Math.random() * 1.8) {
        emoteTimer = 0;
        const choices = stageRef.current.emotes;
        showEmote(choices[Math.floor(Math.random() * choices.length)], 1.2);
      }

      if (directionTimer > nextTurnAfter) {
        directionTimer = 0;
        randomTurn();
      }

      steerTowardMouse();
      capSpeed();

      x += vx * dt;
      y += vy * dt;

      const maxX = window.innerWidth - size;
      const maxY = window.innerHeight - size;

      if (x <= 0) {
        x = 0;
        vx = Math.abs(vx);
        showEmote("boop", 0.6);
      } else if (x >= maxX) {
        x = maxX;
        vx = -Math.abs(vx);
        showEmote("boop", 0.6);
      }

      if (y <= 0) {
        y = 0;
        vy = Math.abs(vy);
        showEmote("boop", 0.6);
      } else if (y >= maxY) {
        y = maxY;
        vy = -Math.abs(vy);
        showEmote("boop", 0.6);
      }

      render(now);
      frame = requestAnimationFrame(tick);
    };

    const onResize = () => {
      clampToViewport();
      render(performance.now());
    };

    const onVisibility = () => {
      paused = document.hidden;
      if (!paused) {
        last = performance.now();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    if (reduceMotion) {
      x = Math.max(12, window.innerWidth - size - 16);
      y = Math.max(12, window.innerHeight - size - 16);
      pet.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      emote.textContent = "rest";
      emote.style.opacity = "0.75";
      return;
    }

    render(performance.now());
    hideEmote();
    frame = requestAnimationFrame(tick);
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
    };
  }, [enabled, ready]);

  if (!ready || !enabled) {
    return null;
  }

  const moodColors = MOOD_COLORS[mood];

  const petBorderRadius =
    skin === "blob"
      ? "45% 55% 50% 50%"
      : skin === "bot"
        ? "12px"
        : "50% 50% 45% 45%";

  const petBackground =
    skin === "blob"
      ? `radial-gradient(circle at 35% 30%, ${moodColors.light} 0%, ${moodColors.base} 55%, ${moodColors.dark} 100%)`
      : skin === "bot"
        ? `linear-gradient(145deg, ${moodColors.light} 0%, ${moodColors.base} 50%, ${moodColors.dark} 100%)`
        : `radial-gradient(circle at 40% 30%, ${moodColors.light} 0%, ${moodColors.base} 50%, ${moodColors.dark} 100%)`;

  return (
    <div
      ref={petRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: stage.size,
        height: stage.size,
        borderRadius: petBorderRadius,
        background: petBackground,
        boxShadow: `0 10px 24px ${moodColors.glow}`,
        pointerEvents: "none",
        zIndex: 70,
        willChange: "transform",
        transition: "width .2s ease, height .2s ease, box-shadow .2s ease",
      }}
    >
      <div
        ref={emoteRef}
        style={{
          position: "absolute",
          top: -18,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 10,
          fontWeight: 700,
          color: "#e6edf3",
          textShadow: `0 2px 10px ${moodColors.glow}`,
          opacity: 0,
          transition: "opacity .2s ease",
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      />

      {skin === "blob" ? (
        <>
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 11,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 11,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
              width: 12,
              height: 6,
              borderBottom: "2px solid #0d1117",
              borderRadius: "0 0 10px 10px",
            }}
          />
        </>
      ) : null}

      {skin === "bot" ? (
        <>
          <div
            style={{
              position: "absolute",
              top: -6,
              left: "50%",
              transform: "translateX(-50%)",
              width: 2,
              height: 8,
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: -9,
              left: "50%",
              transform: "translateX(-50%)",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 10,
              width: 6,
              height: 6,
              borderRadius: 2,
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 10,
              width: 6,
              height: 6,
              borderRadius: 2,
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 11,
              left: "50%",
              transform: "translateX(-50%)",
              width: 14,
              height: 2,
              borderRadius: 2,
              background: "#0d1117",
            }}
          />
        </>
      ) : null}

      {skin === "fox" ? (
        <>
          <div
            style={{
              position: "absolute",
              top: -7,
              left: 7,
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "3px solid transparent",
              borderBottom: "10px solid #0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: -7,
              right: 7,
              width: 0,
              height: 0,
              borderRight: "6px solid transparent",
              borderLeft: "3px solid transparent",
              borderBottom: "10px solid #0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 10,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 10,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#0d1117",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 9,
              left: "50%",
              transform: "translateX(-50%)",
              width: 10,
              height: 7,
              background: "#0d1117",
              clipPath: "polygon(50% 100%, 0 0, 100% 0)",
            }}
          />
        </>
      ) : null}

      {stage.level >= 3 ? (
        <div
          style={{
            position: "absolute",
            top: -8,
            left: 8,
            width: 12,
            height: 8,
            borderRadius: 8,
            background: "#0d1117",
            opacity: 0.9,
          }}
        />
      ) : null}
      {stage.level >= 4 ? (
        <div
          style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 22,
            height: 8,
            borderRadius: 6,
            background: "#161b22",
            border: "1px solid #30363d",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          right: -7,
          top: 18,
          width: 9,
          height: 9,
          borderTop: `2px solid ${moodColors.dark}`,
          borderRight: `2px solid ${moodColors.dark}`,
          borderRadius: "4px",
          transform: "rotate(22deg)",
          animation:
            skin === "bot" ? "none" : "pet-tail 0.5s ease-in-out infinite",
          opacity: skin === "bot" ? 0.2 : 1,
          transformOrigin: "left center",
        }}
      />
      <style>{`
        @keyframes pet-tail {
          0% { transform: rotate(16deg); }
          50% { transform: rotate(34deg); }
          100% { transform: rotate(16deg); }
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          bottom: -18,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 9,
          color: "#8b949e",
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      >
        {moodColors.accentLabel} · {mood}
      </div>
    </div>
  );
}
