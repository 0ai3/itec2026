import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function Page() {
  const repos = [
    { name: "ai-editor", branch: "main", commits: 18, status: "Deploying" },
    { name: "collab/realtime", branch: "develop", commits: 9, status: "Passing" },
    { name: "design-system", branch: "main", commits: 24, status: "Queued" },
  ];

  const highlights = [
    {
      label: "Editor",
      title: "VS Code-grade canvas",
      desc: "Command palette, minimap, and IntelliSense tuned for teams.",
    },
    {
      label: "Repos",
      title: "GitHub native",
      desc: "Branch insights, PR-ready previews, and contributor profiles.",
    },
    {
      label: "Pipelines",
      title: "CI without context switch",
      desc: "Docker builds, test matrices, and deploy gates in one view.",
    },
  ];

  const activity = [
    {
      title: "Deploy · ai-editor",
      meta: "prod · 2m ago",
      tone: "#58a6ff",
      detail: "Ship ready — artifacts promoted",
    },
    {
      title: "Checks · collab/realtime",
      meta: "staging · 14m ago",
      tone: "#3fb950",
      detail: "All tests passing",
    },
    {
      title: "Review · design-system",
      meta: "main · 29m ago",
      tone: "#d29922",
      detail: "Awaiting approval",
    },
  ];

  return (
    <main className="ml-12 min-h-screen bg-[#0a0f16] text-[#c9d1d9]">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(88,166,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(63,185,80,0.12),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(139,28,44,0.12),transparent_30%)]"
        aria-hidden
      />

      <Navbar />

      <section className="mx-auto flex max-w-6xl flex-col gap-10 px-6 pb-12 pt-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-[#8b949e]">
              <span className="rounded-full border border-[#30363d] bg-[#0f1622] px-3 py-1 font-semibold text-white shadow-[0_6px_20px_rgba(0,0,0,0.35)]">
                Unified GitHub × VS Code
              </span>
              <span className="rounded-full border border-[#30363d] bg-[#0f1622] px-3 py-1 font-semibold text-[#58a6ff]">
                Cloud workspaces
              </span>
              <span className="rounded-full border border-[#30363d] bg-[#0f1622] px-3 py-1 font-semibold text-[#3fb950]">
                Live CI/CD
              </span>
            </div>

            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Ship from one surface: code, repos, and pipelines in a Visual
              Studio-grade flow.
            </h1>
            <p className="max-w-2xl text-base text-[#8b949e]">
              Launch a workspace, review PRs, and release to prod without
              tab-hopping. iTECify blends GitHub-native repos with a VS Code
              editor and deploy dashboards.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/workspace"
                className="inline-flex h-11 items-center gap-2 rounded-md bg-[#58a6ff] px-4 text-sm font-semibold text-black shadow-[0_12px_30px_rgba(88,166,255,0.35)] transition hover:-translate-y-px hover:bg-[#79c0ff]"
              >
                Open workspace
                <span className="text-[11px] font-bold text-black/70">⌘K</span>
              </Link>
              <Link
                href="/profile"
                className="inline-flex h-11 items-center rounded-md border border-[#30363d] bg-[#0f1622] px-4 text-sm font-semibold text-white transition hover:-translate-y-px hover:border-[#58a6ff] hover:text-[#58a6ff]"
              >
                View profile
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-[#8b949e]">
              <span className="rounded-md border border-[#30363d] bg-[#0f1622] px-3 py-2 font-semibold text-white">
                Code · PRs · Deploy
              </span>
              <span className="rounded-md border border-[#30363d] bg-[#0f1622] px-3 py-2 font-semibold text-[#58a6ff]">
                Ephemeral dev envs
              </span>
              <span className="rounded-md border border-[#30363d] bg-[#0f1622] px-3 py-2 font-semibold text-[#3fb950]">
                Safe rollbacks
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-4 rounded-2xl border border-[#1f2a38] bg-[#0c1220] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
            <div className="flex items-center justify-between text-xs text-[#8b949e]">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#30363d] bg-[#0f1622] px-3 py-1.5 text-[11px] font-semibold text-white">
                <span className="h-2 w-2 rounded-full bg-[#3fb950]" />
                Active workspace
              </div>
              <Link
                href="/dockertest"
                className="text-[#58a6ff] hover:text-[#79c0ff]"
              >
                Pipelines
              </Link>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#0f1622] p-4">
              <div className="flex items-center gap-3 border-b border-[#1f2935] pb-3">
                <div className="flex gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f85149]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f0a500]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#3fb950]" />
                </div>
                <p className="text-xs text-[#8b949e]">editor/Monaco.tsx</p>
              </div>
              <div className="mt-3 space-y-2 font-mono text-[12px] text-[#c9d1d9]">
                <div className="flex items-center gap-3">
                  <span className="text-[#30363d]">12</span>
                  <span className="text-[#58a6ff]">export</span>
                  <span>const EditorShell = () =&gt; &#123;</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#30363d]">13</span>
                  <span className="pl-5 text-[#8b949e]">return &lt;Layout chrome="github"&gt;</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#30363d]">14</span>
                  <span className="pl-5">&lt;Panel title="Pipelines" status="passing" /&gt;</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#30363d]">15</span>
                  <span className="pl-5">&lt;Panel title="Repos" status="synced" /&gt;</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#30363d]">16</span>
                  <span className="pl-5">&lt;Panel title="Editor" status="live" /&gt;</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#30363d]">17</span>
                  <span className="pl-5 text-[#8b949e]">&lt;/Layout&gt;</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#30363d]">18</span>
                  <span>&#125;</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-[#30363d] bg-[#0f1622] p-3">
                <p className="text-xs uppercase tracking-wide text-[#8b949e]">
                  Pipelines
                </p>
                <p className="text-lg font-semibold text-white">Live deploy</p>
                <p className="text-xs text-[#8b949e]">GH Actions · 7m</p>
              </div>
              <div className="rounded-lg border border-[#30363d] bg-[#0f1622] p-3">
                <p className="text-xs uppercase tracking-wide text-[#8b949e]">
                  Repos
                </p>
                <p className="text-lg font-semibold text-white">Synced</p>
                <p className="text-xs text-[#8b949e]">Branch main · 12 commits</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {highlights.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-[#1f2a38] bg-[#0f1622] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[#58a6ff]">
                {item.label}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                {item.title}
              </h3>
              <p className="mt-2 text-sm text-[#8b949e]">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Live activity</h2>
              <span className="rounded-full bg-[#0a0f16] px-3 py-1 text-[11px] text-[#8b949e]">
                Stream
              </span>
            </div>
            <div className="space-y-3">
              {activity.map((item) => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-lg border border-[#30363d] bg-[#0a0f16] px-4 py-3"
                >
                  <span
                    className="mt-1 h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.tone }}
                  />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">
                      {item.title}
                    </p>
                    <p className="text-xs text-[#8b949e]">{item.meta}</p>
                    <p className="text-xs text-[#c9d1d9]">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#1f2a38] bg-[#0f1622] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Repos</h2>
              <Link
                href="/workspace"
                className="text-xs font-semibold text-[#58a6ff] hover:text-[#79c0ff]"
              >
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {repos.map((repo) => (
                <div
                  key={repo.name}
                  className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#0a0f16] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-md bg-[#0d1117] text-xs font-semibold text-white ring-1 ring-[#30363d]">
                      GH
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {repo.name}
                      </p>
                      <p className="text-xs text-[#8b949e]">
                        Branch {repo.branch} · {repo.commits} commits
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="rounded-full bg-[#0f1622] px-3 py-1 text-[#8b949e]">
                      {repo.status}
                    </span>
                    <Link
                      href="/workspace"
                      className="font-semibold text-[#58a6ff] hover:text-[#79c0ff]"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
