"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [displayName, setDisplayName] = useState(
    auth?.currentUser?.displayName ?? "",
  );
  const [theme, setTheme] = useState("Dark");
  const [autosave, setAutosave] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [notifications, setNotifications] = useState({
    deploys: true,
    pullRequests: true,
    mentions: true,
    outages: false,
  });
  const [twoFA, setTwoFA] = useState(false);

  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setDisplayName(nextUser?.displayName ?? "");
    });

    return () => unsubscribe();
  }, []);

  const initials = useMemo(() => {
    if (displayName.trim()) return displayName.trim()[0]?.toUpperCase();
    if (user?.email) return user.email[0]?.toUpperCase();
    return "U";
  }, [displayName, user?.email]);

  return (
    <main className="ml-12 min-h-screen bg-[#0a0f16] text-[#c9d1d9]">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(88,166,255,0.12),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(63,185,80,0.12),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(248,81,73,0.12),transparent_30%)]"
        aria-hidden
      />

      <Navbar />

      <section className="relative mx-auto max-w-6xl px-6 pb-12 pt-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-xl border border-[#30363d] bg-[#0f1622] text-lg font-semibold text-white">
              {initials}
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-[#8b949e]">
                Settings
              </p>
              <h1 className="text-2xl font-semibold text-white">Workspace controls</h1>
              <p className="text-xs text-[#8b949e]">
                {user?.email ?? "Signed out"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <button className="rounded-md border border-[#30363d] bg-[#0f1622] px-4 py-2 font-semibold text-white transition hover:-translate-y-px hover:border-[#58a6ff] hover:text-[#58a6ff]">
              Export config
            </button>
            <button className="rounded-md bg-[#58a6ff] px-4 py-2 font-semibold text-black shadow-[0_10px_25px_rgba(88,166,255,0.35)] transition hover:-translate-y-px hover:bg-[#79c0ff]">
              Save changes
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8b949e]">Account</p>
                  <h2 className="text-lg font-semibold text-white">Profile & identity</h2>
                </div>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Connected to GitHub
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-[#c9d1d9]">Display name</span>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-white outline-none placeholder:text-[#6e7681] focus:border-[#58a6ff]"
                    placeholder="Contributor handle"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[#c9d1d9]">Email</span>
                  <input
                    value={user?.email ?? ""}
                    disabled
                    className="w-full cursor-not-allowed rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-[#8b949e]"
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
                <div className="rounded-lg border border-[#30363d] bg-[#0a0f16] p-3">
                  <p className="text-[11px] uppercase tracking-wide text-[#8b949e]">Org role</p>
                  <p className="text-white">Maintainer</p>
                </div>
                <div className="rounded-lg border border-[#30363d] bg-[#0a0f16] p-3">
                  <p className="text-[11px] uppercase tracking-wide text-[#8b949e]">Access</p>
                  <p className="text-white">Contributor</p>
                </div>
                <div className="rounded-lg border border-[#30363d] bg-[#0a0f16] p-3">
                  <p className="text-[11px] uppercase tracking-wide text-[#8b949e]">Region</p>
                  <p className="text-white">EU-West</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8b949e]">Workspace</p>
                  <h2 className="text-lg font-semibold text-white">Editor defaults</h2>
                </div>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Applied on launch
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 text-sm">
                <div className="space-y-2">
                  <p className="text-[#c9d1d9]">Theme</p>
                  <div className="flex gap-2">
                    {["Dark", "Light", "High contrast"].map((option) => (
                      <button
                        key={option}
                        onClick={() => setTheme(option)}
                        className={`rounded-md border px-3 py-2 transition ${
                          theme === option
                            ? "border-[#58a6ff] bg-[#0a0f16] text-white"
                            : "border-[#30363d] bg-[#0f1622] text-[#8b949e] hover:border-[#58a6ff]"
                        }`}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[#c9d1d9]">Code intelligence</p>
                  <div className="rounded-md border border-[#30363d] bg-[#0a0f16] p-3 text-xs text-[#c9d1d9]">
                    Inline suggestions, symbol index, and multi-repo search are enabled.
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                    <span>Autosave</span>
                    <input
                      type="checkbox"
                      checked={autosave}
                      onChange={(e) => setAutosave(e.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                    <span>Word wrap</span>
                    <input
                      type="checkbox"
                      checked={wrap}
                      onChange={(e) => setWrap(e.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <p className="text-[#c9d1d9]">Terminal</p>
                  <div className="grid gap-2 text-xs">
                    <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                      <span>Shell</span>
                      <span className="text-white">bash</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                      <span>Font</span>
                      <span className="text-white">JetBrains Mono</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8b949e]">Notifications</p>
                  <h2 className="text-lg font-semibold text-white">Signals</h2>
                </div>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Email & in-app
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2 text-sm">
                {["deploys", "pullRequests", "mentions", "outages"].map((key) => (
                  <label
                    key={key}
                    className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2"
                  >
                    <span className="capitalize text-white">{key.replace(/([A-Z])/g, " $1")}</span>
                    <input
                      type="checkbox"
                      checked={notifications[key as keyof typeof notifications]}
                      onChange={(e) =>
                        setNotifications((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="h-4 w-4"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8b949e]">Security</p>
                  <h3 className="text-lg font-semibold text-white">Access control</h3>
                </div>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Identity
                </span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                  <div>
                    <p className="text-white">Two-factor auth</p>
                    <p className="text-xs text-[#8b949e]">Protect workspace access</p>
                  </div>
                  <button
                    onClick={() => setTwoFA((prev) => !prev)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                      twoFA
                        ? "bg-[#3fb950] text-black"
                        : "bg-[#0f1622] text-white border border-[#30363d]"
                    }`}
                  >
                    {twoFA ? "Enabled" : "Enable"}
                  </button>
                </div>
                <div className="rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-3 text-xs text-[#c9d1d9]">
                  Active sessions: 3 · Last sign-in: 2h ago · SSO enforced for org members.
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8b949e]">Pipelines</p>
                  <h3 className="text-lg font-semibold text-white">CI defaults</h3>
                </div>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  GH Actions
                </span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                  <span className="text-white">Default branch</span>
                  <span className="rounded-md bg-[#0f1622] px-3 py-1 text-[#8b949e]">main</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                  <span className="text-white">Concurrency</span>
                  <span className="rounded-md bg-[#0f1622] px-3 py-1 text-[#8b949e]">4 runners</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                  <span className="text-white">Secrets</span>
                  <span className="rounded-md bg-[#0f1622] px-3 py-1 text-[#8b949e]">Vault managed</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8b949e]">Integrations</p>
                  <h3 className="text-lg font-semibold text-white">Connected apps</h3>
                </div>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Syncing
                </span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                  <span className="text-white">GitHub</span>
                  <span className="rounded-md bg-[#0f1622] px-3 py-1 text-[#8b949e]">Connected</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                  <span className="text-white">Slack</span>
                  <span className="rounded-md bg-[#0f1622] px-3 py-1 text-[#8b949e]">Optional</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2">
                  <span className="text-white">Linear</span>
                  <span className="rounded-md bg-[#0f1622] px-3 py-1 text-[#8b949e]">Connected</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8b949e]">Danger zone</p>
                  <h3 className="text-lg font-semibold text-white">Risky actions</h3>
                </div>
                <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                  Handle carefully
                </span>
              </div>
              <div className="space-y-3 text-sm">
                <button className="w-full rounded-md border border-[#f85149] bg-[#0a0f16] px-3 py-2 text-left font-semibold text-[#f85149] transition hover:-translate-y-px hover:bg-[#151b29]">
                  Rotate tokens
                </button>
                <button className="w-full rounded-md border border-[#30363d] bg-[#0a0f16] px-3 py-2 text-left font-semibold text-[#c9d1d9] transition hover:-translate-y-px hover:border-[#f85149] hover:text-[#f85149]">
                  Disable workspace access
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
