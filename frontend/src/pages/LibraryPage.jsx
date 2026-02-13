import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiListTracks } from "../api";
import UploadModal from "../ui/UploadModal";

export default function LibraryPage() {
  const [tracks, setTracks] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  async function refresh() {
    setErr("");
    setBusy(true);
    try {
      const list = await apiListTracks();
      setTracks(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e.message || "Failed to load tracks");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Library</h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowUpload(true)}>Upload</button>
        <button onClick={refresh} disabled={busy}>
          Refresh
        </button>
      </div>

      {err && <p style={{ color: "crimson" }}>{err}</p>}
      {busy && <p>Loading...</p>}

      {!busy && tracks.length === 0 && (
        <p style={{ color: "#666" }}>No tracks yet. Click Upload.</p>
      )}

      <ul style={{ paddingLeft: 16 }}>
        {tracks.map((t) => (
          <li key={t.id} style={{ marginBottom: 6 }}>
            <Link to={`/tracks/${t.id}`}>
              {t.title || t.source_filename}{" "}
              <span style={{ color: "#666" }}>({t.mime_type})</span>
            </Link>
          </li>
        ))}
      </ul>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onCreated={() => {
            setShowUpload(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
