"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, updateProfile, type User } from "firebase/auth";
import Navbar from "@/components/Navbar";
import { auth } from "@/lib/firebase";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [displayName, setDisplayName] = useState(
    auth?.currentUser?.displayName ?? "",
  );
  const [photoURL, setPhotoURL] = useState(auth?.currentUser?.photoURL ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setDisplayName(nextUser?.displayName ?? "");
      setPhotoURL(nextUser?.photoURL ?? "");
    });

    return () => unsubscribe();
  }, []);

  const handleUpdateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await updateProfile(user, {
        displayName: displayName.trim() || null,
        photoURL: photoURL.trim() || null,
      });

      setMessage("Profile updated.");
    } catch (error) {
      setErrorMessage("Failed to update profile.");
    }

    setIsSubmitting(false);
  };

  const previewPhotoURL = useMemo(() => photoURL.trim(), [photoURL]);

  const stats = [
    { label: "Repos", value: "12", color: "#58a6ff" },
    { label: "Commits", value: "142", color: "#3fb950" },
    { label: "Stars", value: "38", color: "#d29922" },
    { label: "Pipelines", value: "5", color: "#f85149" },
  ];

  const activity = [
    {
      title: "Pushed to workspace/main",
      time: "2m ago",
      tone: "#58a6ff",
    },
    {
      title: "Created repository \"ai-editor\"",
      time: "1h ago",
      tone: "#3fb950",
    },
    {
      title: "Updated README.md",
      time: "3h ago",
      tone: "#d29922",
    },
    {
      title: "Opened pull request",
      time: "Today",
      tone: "#f85149",
    },
  ];

  const repos = [
    { name: "ai-editor", desc: "VS Code style editor", status: "Deploying" },
    { name: "realtime-collab", desc: "Live coding environment", status: "Passing" },
    { name: "ai-assistant", desc: "Coding AI helper", status: "Queued" },
    { name: "components-ui", desc: "Shared UI library", status: "Synced" },
  ];

  return (
    <main className="ml-12 min-h-screen bg-[#0a0f16] text-[#c9d1d9]">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(88,166,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(63,185,80,0.12),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(248,81,73,0.12),transparent_30%)]"
        aria-hidden
      />

      <Navbar />

      <section className="relative mx-auto max-w-6xl px-6 pb-12 pt-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 overflow-hidden rounded-xl border border-[#30363d] bg-[#0f1622]">
              {previewPhotoURL ? (
                <img
                  src={previewPhotoURL}
                  alt="Profile avatar"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-lg font-semibold text-white">
                  {(user?.email ?? "U")[0]}
                </div>
              )}
              <span className="absolute bottom-1 right-1 rounded-full bg-[#3fb950] px-2 text-[10px] font-semibold text-black">
                Active
              </span>
            </div>

            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-[#8b949e]">
                Profile
              </p>
              <h1 className="text-2xl font-semibold text-white">
                {displayName || "Developer"}
              </h1>
              <p className="text-xs text-[#8b949e]">{user?.email}</p>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#30363d] bg-[#0f1622] px-3 py-1 text-[11px] font-semibold text-[#c9d1d9]">
                <span className="h-2 w-2 rounded-full bg-[#58a6ff]" />
                Contributor access
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/workspace"
              className="inline-flex h-10 items-center rounded-md bg-[#58a6ff] px-4 text-sm font-semibold text-black shadow-[0_10px_25px_rgba(88,166,255,0.35)] transition hover:-translate-y-px hover:bg-[#79c0ff]"
            >
              Open workspace
            </Link>
            <Link
              href="/settings"
              className="inline-flex h-10 items-center rounded-md border border-[#30363d] bg-[#0f1622] px-4 text-sm font-semibold text-white transition hover:-translate-y-px hover:border-[#58a6ff] hover:text-[#58a6ff]"
            >
              Open settings
            </Link>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-12 gap-6">
          <aside className="col-span-12 space-y-5 lg:col-span-4">
            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8b949e]">
                Snapshot
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-[#30363d] bg-[#0a0f16] px-3 py-3"
                  >
                    <p className="text-[11px] uppercase tracking-wide text-[#8b949e]">
                      {stat.label}
                    </p>
                    <p
                      className="text-lg font-semibold"
                      style={{ color: stat.color }}
                    >
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Quick links</p>
                <span className="rounded-full bg-[#0a0f16] px-2 py-0.5 text-[11px] text-[#8b949e]">
                  Shortcuts
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <Link
                  href="/workspace"
                  className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-white transition hover:-translate-y-px hover:border-[#58a6ff]"
                >
                  Open workspace
                  <span className="text-[11px] text-[#8b949e]">→</span>
                </Link>
                <Link
                  href="/dockertest"
                  className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-white transition hover:-translate-y-px hover:border-[#3fb950]"
                >
                  Pipelines
                  <span className="text-[11px] text-[#8b949e]">→</span>
                </Link>
              </div>
            </div>
          </aside>

          <div className="col-span-12 space-y-6 lg:col-span-8">
            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Live activity
                </h2>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Stream
                </span>
              </div>

              <div className="relative space-y-3 text-sm text-[#8b949e]">
                <div
                  className="absolute left-2 top-1 bottom-1 w-px bg-[#30363d]"
                  aria-hidden
                />
                {activity.map((item) => (
                  <div
                    key={item.title}
                    className="relative ml-4 rounded-lg border border-[#30363d] bg-[#0a0f16] px-4 py-3 transition hover:bg-[#0d1624]"
                  >
                    <span
                      className="absolute -left-4 top-4 h-2.5 w-2.5 rounded-full ring-4 ring-[#0f1622]"
                      style={{ backgroundColor: item.tone }}
                    />
                    <p className="text-white/90">{item.title}</p>
                    <p className="text-[11px] text-[#8b949e]">{item.time}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Repositories</h2>
                <Link
                  href="/workspace"
                  className="text-xs font-semibold text-[#58a6ff] hover:text-[#79c0ff]"
                >
                  View all
                </Link>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {repos.map((repo) => (
                  <div
                    key={repo.name}
                    className="rounded-lg border border-[#30363d] bg-[#0a0f16] p-4 transition hover:-translate-y-px hover:border-[#58a6ff]"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-semibold text-white">{repo.name}</p>
                      <span className="rounded-full bg-[#0f1622] px-3 py-1 text-[11px] text-[#8b949e]">
                        {repo.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#8b949e]">{repo.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div
              id="settings"
              className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Profile settings
                </h2>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Identity
                </span>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-[#c9d1d9]">
                      Display name
                    </label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-sm text-white placeholder:text-[#6e7681] outline-none focus:border-[#58a6ff]"
                      placeholder="Contributor handle"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#c9d1d9]">
                      Avatar URL
                    </label>
                    <input
                      value={photoURL}
                      onChange={(e) => setPhotoURL(e.target.value)}
                      className="w-full rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-sm text-white placeholder:text-[#6e7681] outline-none focus:border-[#58a6ff]"
                      placeholder="https://..."
                    />
                  </div>
                </div>

                {previewPhotoURL ? (
                  <div className="flex items-center gap-3 rounded-lg border border-[#30363d] bg-[#0a0f16] px-4 py-3">
                    <img
                      src={previewPhotoURL}
                      alt="Avatar preview"
                      referrerPolicy="no-referrer"
                      className="h-14 w-14 rounded-full object-cover"
                    />
                    <div>
                      <p className="text-sm text-white">Preview</p>
                      <p className="text-xs text-[#8b949e]">
                        Actual avatar shown in the app
                      </p>
                    </div>
                  </div>
                ) : null}

                {message && (
                  <p className="text-sm font-semibold text-[#3fb950]">{message}</p>
                )}

                {errorMessage && (
                  <p className="text-sm text-red-400">{errorMessage}</p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-md bg-[#58a6ff] px-4 py-2 text-sm font-semibold text-black shadow-[0_8px_20px_rgba(88,166,255,0.35)] transition hover:-translate-y-px hover:bg-[#79c0ff] disabled:opacity-60"
                >
                  {isSubmitting ? "Saving..." : "Save profile"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}