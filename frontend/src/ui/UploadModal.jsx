import { useState } from "react";
import { getToken, apiGetSignedUploadUrl, apiCreateTrack } from "../api";

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

      // Step 1: ask backend for signed url + object key
      const { object_key, signed_put_url } = await apiGetSignedUploadUrl({
        filename: file.name,
        mime_type: file.type,
      });

      if (!object_key || !signed_put_url) {
        throw new Error("Signed upload response missing object_key or signed_put_url");
      }

      // Step 2: upload directly to R2 with PUT (XHR for progress)
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed_put_url);

        // Must match the Content-Type used when presigning
        xhr.setRequestHeader("Content-Type", file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          } else {
            setProgress((p) => Math.min(95, p + 1));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(xhr.responseText || `PUT failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Network error during PUT upload"));

        xhr.send(file);
      });

      setProgress(100);

      // Step 3: create track row (store key in DB)
      await apiCreateTrack({
        title: "", // optional
        source_filename: file.name,
        mime_type: file.type,
        original_object_key: object_key,
      });

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
