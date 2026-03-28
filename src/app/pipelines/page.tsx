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
  success: '#238636',
  error: '#da3633',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
};

export default function PipelinePage() {
  const [activeStep, setActiveStep] = useState("Build");

  const steps = [
    { name: "Setup", status: "success", time: "12s" },
    { name: "Build", status: "success", time: "1m 4s" },
    { name: "Test", status: "running", time: "24s" },
    { name: "Deploy", status: "pending", time: "-" },
  ];

  return (
    <main style={{ 
      display: 'flex', flexDirection: 'column', height: '100vh', 
      background: THEME.bg, color: THEME.textMain, 
      fontFamily: THEME.fontFamily, overflow: 'hidden' 
    }}>
      <Navbar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* Top Bar - Status General */}
        <div style={{ 
          padding: '12px 24px', borderBottom: `1px solid ${THEME.border}`, 
          background: THEME.bgSecondary, display: 'flex', alignItems: 'center', gap: 16 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ height: 10, width: 10, borderRadius: '50%', background: '#d29922', boxShadow: '0 0 8px #d29922' }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Workflow: Production Deploy</span>
          </div>
          <span style={{ fontSize: 12, color: THEME.textSecondary }}>#42 pushed by user_dev</span>
          <div style={{ flex: 1 }} />
          <button style={{ background: THEME.error, color: 'white', border: 'none', padding: '4px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
            Cancel Run
          </button>
        </div>

        {/* Pipeline Visualization */}
        <div style={{ padding: '40px', display: 'flex', gap: '20px', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${THEME.border}` }}>
          {steps.map((step, index) => (
            <div key={step.name} style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ 
                padding: '12px 20px', borderRadius: 6, border: `1px solid ${THEME.border}`,
                background: step.status === 'running' ? 'rgba(88,166,255,0.1)' : THEME.bgSecondary,
                minWidth: '140px', textAlign: 'center'
              }}>
                <div style={{ fontSize: 11, color: THEME.textSecondary, marginBottom: 4 }}>{step.time}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{step.name}</div>
              </div>
              {index < steps.length - 1 && <div style={{ width: 40, height: 2, background: THEME.border }} />}
            </div>
          ))}
        </div>

        {/* Terminal Logs Area */}
        <div style={{ flex: 1, background: '#050505', margin: '20px', borderRadius: 8, border: `1px solid ${THEME.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: THEME.bgSecondary, padding: '8px 16px', fontSize: 12, color: THEME.textSecondary, borderBottom: `1px solid ${THEME.border}` }}>
            Console Output
          </div>
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', fontSize: 12, lineHeight: '1.6' }}>
            <div style={{ color: THEME.textSecondary }}>[14:02:11] Initializing pipeline...</div>
            <div style={{ color: THEME.textSecondary }}>[14:02:15] Running: npm install</div>
            <div style={{ color: THEME.success }}>[14:03:19] Build completed successfully.</div>
            <div style={{ color: THEME.textMain }}>[14:03:20] Running unit tests...</div>
            <div style={{ color: THEME.accent }}>→ PASS  src/components/Editor.test.tsx</div>
            <div style={{ color: THEME.accent }}>→ PASS  src/lib/firebase.test.ts</div>
            <div style={{ color: THEME.textMain, marginTop: 10 }}>[14:03:25] Executing deployment to Firebase Hosting... <span style={{ color: '#d29922' }}>[IN PROGRESS]</span></div>
            <div style={{ display: 'inline-block', width: 8, height: 14, background: THEME.accent, marginLeft: 4, verticalAlign: 'middle' }} />
          </div>
        </div>
      </div>
    </main>
  );
}