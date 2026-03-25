import { useState } from "react";
import { clearToken, getToken } from "../api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export default function UploadModal({ onClose, onCreated }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleUpload() {
    if (!file) return;
    setErr("");
    setBusy(true);
    setProgress(0);

    try {
      const token = getToken();
      if (!token) throw new Error("Missing auth token");

      const form = new FormData();
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/tracks/upload`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        } else {
          // fallback
          setProgress((p) => Math.min(95, p + 1));
        }
      };

      await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            let parsed = null;
            try {
              parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
            } catch {
              parsed = null;
            }
            const msg =
              (parsed && (parsed.message || parsed.error)) ||
              xhr.responseText ||
              `Upload failed (${xhr.status})`;
            if (xhr.status === 401) {
              clearToken();
              reject(new Error("Session expired. Please log in again."));
              return;
            }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () =>
          reject(
            new Error(
              `Network error during upload. Check backend at ${API_BASE} and CORS settings.`
            )
          );
        xhr.ontimeout = () => reject(new Error("Upload timed out"));
        xhr.timeout = 30000;
        xhr.send(form);
      });

      setProgress(100);
      // Optionally parse response:
      // const data = JSON.parse(result);
      onCreated();
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
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
          <h3 style={{ margin: 0 }}>Upload</h3>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} disabled={busy}>X</button>
        </div>

        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          disabled={busy}
        />

        {file && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 10, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "#333" }} />
            </div>
            <p style={{ margin: "6px 0 0", color: "#667" }}>{progress}%</p>
          </div>
        )}

        {err && <p style={{ color: "crimson" }}>{err}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={handleUpload} disabled={!file || busy}>
            {busy ? "Uploading..." : "Upload"}
          </button>
          <button onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
