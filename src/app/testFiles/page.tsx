'use client';
import { useState } from 'react';

export default function dockerTest() {
    const [code, setCode] = useState('print("salut boss din docker")');
    const [output, setOutput] = useState('');
    const [loading, setLoading] = useState(false);

    const runCode = async () => {
        setLoading(true);
        setOutput('se ruleaza in container boss');

        const res = await fetch('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json'},
            body: JSON.stringify({ code })
        });
        
        const data = await res.json();
        setOutput(data.output || data.error);
        setLoading(false);
    };

    return(<div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#1e1e1e', color: 'white', minHeight: '100vh' }}>
      <h1>iTECify - Docker Sandbox Test</h1>
      
      <textarea 
        value={code}
        onChange={(e) => setCode(e.target.value)}
        style={{ width: '100%', height: '150px', backgroundColor: '#2d2d2d', color: '#00ff00', padding: '10px', fontFamily: 'monospace' }}
      />
      
      <button onClick={runCode} disabled={loading} style={{ padding: '10px 20px', marginTop: '10px', cursor: 'pointer', backgroundColor: '#007acc', color: 'white', border: 'none' }}>
        {loading ? 'Se execută...' : 'Run Code'}
      </button>

      <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#000', border: '1px solid #333' }}>
        <h3>Terminal Output:</h3>
        <pre>{output}</pre>
      </div>
    </div>);
}