import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function Page() {
  const repos = [
    { name: "ai-editor", branch: "main", commits: 18, status: "Deploying" },
    { name: "collab/realtime", branch: "develop", commits: 9, status: "Passing" },
    { name: "design-system", branch: "main", commits: 24, status: "Queued" },
  ];

  const activity = [
    { title: "Deploy ai-editor", meta: "2m ago", color: "#3fb950" },
    { title: "Tests collab/realtime", meta: "14m ago", color: "#58a6ff" },
    { title: "Review design-system", meta: "29m ago", color: "#d29922" },
  ];

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d1117",
        color: "#e6edf3",
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
      }}
    >
      <Navbar />

      {/* top bar */}
      <div
        style={{
          height: 42,
          borderBottom: "1px solid #21262d",
          background: "#161b22",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          fontSize: 12,
          color: "#8b949e",
        }}
      >
        dashboard
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* sidebar */}
        <div
          style={{
            borderRight: "1px solid #21262d",
            background: "#0d1117",
          }}
        >
          <SidebarItem title="Workspace" href="/workspace" />
          <SidebarItem title="Profile" href="/profile" />
          <SidebarItem title="Pipelines" href="/dockertest" />
          <SidebarItem title="Extensions" href="/extensions" />

        </div>

        {/* content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* welcome */}
          <div
            style={{
              padding: 20,
              borderBottom: "1px solid #21262d",
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              Welcome back
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#8b949e",
                marginTop: 4,
              }}
            >
              Open a workspace or continue working on a repository
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                marginTop: 14,
              }}
            >
              <Button href="/workspace">Open workspace</Button>
              <Button href="/profile" secondary>
                Profile
              </Button>
            </div>
          </div>

          {/* panels */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              padding: 16,
            }}
          >
            {/* repos */}
            <Panel title="Repositories">
              {repos.map((repo) => (
                <RepoRow key={repo.name} repo={repo} />
              ))}
            </Panel>

            {/* activity */}
            <Panel title="Activity">
              {activity.map((a) => (
                <ActivityRow key={a.title} item={a} />
              ))}
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}

/* components */

function SidebarItem({
  title,
  href,
}: {
  title: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "10px 14px",
        fontSize: 12,
        color: "#8b949e",
        borderBottom: "1px solid #161b22",
        textDecoration: "none",
      }}
    >
      {title}
    </Link>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid #30363d",
        background: "#161b22",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #30363d",
          fontSize: 12,
          color: "#8b949e",
        }}
      >
        {title}
      </div>

      <div>{children}</div>
    </div>
  );
}

function RepoRow({ repo }: any) {
  return (
    <div
      style={{
        padding: 12,
        borderBottom: "1px solid #30363d",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 13 }}>{repo.name}</div>

        <div
          style={{
            fontSize: 11,
            color: "#8b949e",
          }}
        >
          {repo.branch} • {repo.commits} commits
        </div>
      </div>

      <Link
        href="/workspace"
        style={{
          fontSize: 11,
          color: "#58a6ff",
        }}
      >
        open
      </Link>
    </div>
  );
}

function ActivityRow({ item }: any) {
  return (
    <div
      style={{
        padding: 12,
        borderBottom: "1px solid #30363d",
        display: "flex",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: item.color,
        }}
      />

      <div>
        <div style={{ fontSize: 12 }}>{item.title}</div>

        <div
          style={{
            fontSize: 10,
            color: "#8b949e",
          }}
        >
          {item.meta}
        </div>
      </div>
    </div>
  );
}

function Button({
  children,
  href,
  secondary,
}: any) {
  return (
    <Link
      href={href}
      style={{
        padding: "6px 12px",
        fontSize: 12,
        borderRadius: 6,
        border: "1px solid #30363d",
        background: secondary ? "#0d1117" : "#238636",
        color: "white",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}