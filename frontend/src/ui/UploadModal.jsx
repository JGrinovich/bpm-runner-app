import { useState } from "react";
import { apiCreateTrack } from "../api";

export default function UploadModal({ onClose, onCreated }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleCreate() {
    if (!file) return;
    setErr("");
    setBusy(true);
    setProgress(0);

    // Simulate upload progress for Phase 2 UX
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = Math.min(95, Math.floor((elapsed / 1200) * 100));
      setProgress(p);
    }, 80);

    try {
      // Phase 2: fake storage location; Phase 3 will replace this with real upload
      const payload = {
        title: file.name,
        source_filename: file.name,
        mime_type: file.type || "application/octet-stream",
        original_object_key: `local://uploads/${file.name}`,
      };

      await apiCreateTrack(payload);
      setProgress(100);
      onCreated();
    } catch (e) {
      setErr(e.message || "Failed to create track");
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: "white", padding: 16, width: "min(520px, 100%)", borderRadius: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Upload (Phase 2 UI)</h3>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}>X</button>
        </div>

        <p style={{ color: "#666" }}>
          Phase 2 creates a track record and simulates upload progress. Phase 3 will implement real
          file upload.
        </p>

        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />

        {file && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 10, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "#333" }} />
            </div>
            <p style={{ margin: "6px 0 0", color: "#666" }}>{progress}%</p>
          </div>
        )}

        {err && <p style={{ color: "crimson" }}>{err}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={handleCreate} disabled={!file || busy}>
            {busy ? "Working..." : "Create Track"}
          </button>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
