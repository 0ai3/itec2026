"use client";
import { useState } from "react";

export default function ExplorerSyncBtn({ ownerUid, repoId }: { ownerUid: string, repoId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const handleSync = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/sync-files-from-disk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUid, repoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setInfo(`Sync OK: ${data.scannedFiles} files, ${data.scannedDirectories} directories from ${data.repoDiskPath}`);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message || "Sync failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={handleSync}
        disabled={loading}
        style={{
          background: "#161b22",
          color: success ? "#3fb950" : error ? "#f85149" : "#8b949e",
          border: "1px solid #30363d",
          borderRadius: 5,
          padding: "4px 10px",
          margin: "10px 0",
          fontSize: 12,
          cursor: loading ? "not-allowed" : "pointer",
          width: "90%",
        }}
        title="Sync files from disk to explorer"
      >
        {loading ? "Syncing..." : success ? "Synced!" : error ? error : "Sync from Disk"}
      </button>
      {info && !loading && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#8b949e", wordBreak: "break-all" }}>{info}</div>
      )}
    </>
  );
}
