"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";

const THEME = {
  bg: '#0d1117',
  bgSecondary: '#161b22',
  border: '#21262d',
  textMain: '#e6edf3',
  textSecondary: '#8b949e',
  accent: '#58a6ff',
  added: '#2ea043',
  removed: '#f85149',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
};

export default function SourceControlPage() {
  const [commitMessage, setCommitMessage] = useState("");

  const changedFiles = [
    { name: "src/app/page.tsx", status: "M", color: "#e3b341" },
    { name: "src/components/Navbar.tsx", status: "M", color: "#e3b341" },
    { name: "public/assets/logo.svg", status: "A", color: "#3fb950" },
    { name: "package.json", status: "D", color: "#f85149" },
  ];

  return (
    <main style={{ 
      display: 'flex', flexDirection: 'column', height: '100vh', 
      background: THEME.bg, color: THEME.textMain, 
      fontFamily: THEME.fontFamily, overflow: 'hidden' 
    }}>
      <Navbar />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* ── SIDEBAR: SOURCE CONTROL ── */}
        <aside style={{ 
          width: 300, minWidth: 300, borderRight: `1px solid ${THEME.border}`, 
          background: THEME.bg, display: 'flex', flexDirection: 'column' 
        }}>
          <div style={{ 
            padding: '8px 12px', borderBottom: `1px solid ${THEME.border}`, 
            fontSize: 11, fontWeight: 700, color: THEME.textSecondary, 
            textTransform: 'uppercase', letterSpacing: '0.08em' 
          }}>
            Source Control: Git
          </div>

          {/* Commit Input Area */}
          <div style={{ padding: '16px', borderBottom: `1px solid ${THEME.border}` }}>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message (Cmd+Enter to commit)"
              style={{
                width: '100%', height: '80px', background: THEME.bgSecondary,
                border: `1px solid ${THEME.border}`, borderRadius: 4,
                padding: '8px', color: THEME.textMain, fontSize: 13,
                fontFamily: THEME.fontFamily, outline: 'none', resize: 'none'
              }}
            />
            <button style={{
              width: '100%', marginTop: '8px', padding: '6px',
              background: THEME.accent, color: '#0d1117', border: 'none',
              borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: 'pointer'
            }}>
              Commit & Push
            </button>
          </div>

          {/* Changes List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
            <div style={{ padding: '4px 12px', fontSize: 11, color: THEME.textSecondary, fontWeight: 600 }}>CHANGES</div>
            {changedFiles.map((file) => (
              <div 
                key={file.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px',
                  fontSize: 12, cursor: 'pointer', transition: '0.1s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: THEME.textSecondary }}>📄</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name.split('/').pop()}</span>
                <span style={{ color: file.color, fontWeight: 700, fontSize: 10 }}>{file.status}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── MAIN AREA: DIFF VIEWER ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ 
            padding: '8px 16px', background: THEME.bgSecondary, 
            borderBottom: `1px solid ${THEME.border}`, fontSize: 12, color: THEME.textSecondary 
          }}>
            Working Tree: <span style={{ color: THEME.textMain }}>src/app/page.tsx</span>
          </div>

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left Side (Old Code) */}
            <div style={{ flex: 1, borderRight: `1px solid ${THEME.border}`, background: '#1a1111', padding: '16px', fontSize: 13, overflow: 'auto' }}>
              <div style={{ color: THEME.textSecondary, marginBottom: 8 }}>- Original</div>
              <pre style={{ margin: 0, opacity: 0.8 }}>
                {`1  export default function Home() {\n2    return (\n3      <div>\n4        <h1>Hello World</h1>\n5      </div>\n6    );\n7  }`}
              </pre>
            </div>

            {/* Right Side (New Code) */}
            <div style={{ flex: 1, background: '#111a11', padding: '16px', fontSize: 13, overflow: 'auto' }}>
              <div style={{ color: THEME.added, marginBottom: 8 }}>+ Modified</div>
              <pre style={{ margin: 0 }}>
                {`1  export default function Home() {\n2    return (\n3      <main className="bg-dark">\n4        <h1>Hello Gemini</h1>\n5        <p>Source control ready.</p>\n6      </main>\n7    );\n8  }`}
              </pre>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}