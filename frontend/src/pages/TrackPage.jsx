import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiAnalyze,
  apiGetAnalysis,
  apiGetRender,
  apiGetTrack,
  apiRender,
} from "../api";
import { poll } from "../poll";

// Convert pace like "8:00" min/mile into seconds per mile
function parsePace(paceStr) {
  const m = paceStr.trim().match(/^(\d+):([0-5]\d)$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  return min * 60 + sec;
}

export default function TrackPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);

  // Generate form state
  const [mode, setMode] = useState("cadence"); // cadence | pace
  const [cadence, setCadence] = useState(176); // steps/min
  const [pace, setPace] = useState("8:00"); // mm:ss per mile
  const [beatMode, setBeatMode] = useState("step"); // step | stride
  const [renderStatus, setRenderStatus] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState(null);

  // Audio blob state (JWT-friendly)
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioErr, setAudioErr] = useState("");

  async function refresh() {
    setErr("");
    setBusy(true);
    try {
      const d = await apiGetTrack(id);
      setData(d);
    } catch (e) {
      setErr(e.message || "Failed to load track");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---- Audio helpers + effects MUST be above early returns ----
  const apiBase = import.meta.env.VITE_API_BASE_URL;

  async function fetchRenderBlobUrl(renderId) {
    const token = localStorage.getItem("token");
    const res = await fetch(`${apiBase}/api/render-files/${renderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch audio (${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  // When latest render becomes done, fetch the MP3 as a blob (with JWT)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setAudioErr("");

      // Clear old audio whenever render changes
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
      }

      const r = data?.latest_render;
      if (!r || r.status !== "done" || !r.id) return;

      try {
        const url = await fetchRenderBlobUrl(r.id);
        if (!cancelled) setAudioUrl(url);
      } catch (e) {
        if (!cancelled) setAudioErr(e.message || "Could not load audio");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.latest_render?.id, data?.latest_render?.status]);

  // Cleanup blob URL on unmount / change
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);
  // ------------------------------------------------------------

  const detectedBpm = data?.analysis?.bpm ?? null;

  const targetBpm = useMemo(() => {
    if (mode === "cadence") {
      return beatMode === "step" ? cadence : cadence / 2;
    }

    const paceSec = parsePace(pace);
    if (!paceSec) return null;

    const minPerMile = paceSec / 60;
    let est = 160 + Math.max(0, (10 - minPerMile) * 6);
    est = Math.min(200, Math.max(140, est));
    return beatMode === "step" ? est : est / 2;
  }, [mode, cadence, pace, beatMode]);

  async function doAnalyze() {
    setErr("");
    setAnalysisStatus("starting...");
    try {
      await apiAnalyze(id);
      const result = await poll(() => apiGetAnalysis(id), {
        intervalMs: 2000,
        timeoutMs: 60000,
      });
      setAnalysisStatus(result.status);
      await refresh();
    } catch (e) {
      setErr(e.message || "Analyze failed");
      setAnalysisStatus("failed");
    }
  }

  async function doGenerate() {
    setErr("");
    if (!targetBpm) {
      setErr("Enter a valid cadence or pace.");
      return;
    }
    setRenderStatus("starting...");
    try {
      const res = await apiRender(id, {
        target_bpm: Number(targetBpm),
        preserve_pitch: true,
      });
      const renderId = res.render_id;
      const result = await poll(() => apiGetRender(renderId), {
        intervalMs: 2000,
        timeoutMs: 90000,
      });
      setRenderStatus(result.status);
      await refresh();
    } catch (e) {
      setErr(e.message || "Generate failed");
      setRenderStatus("failed");
    }
  }

  // Early returns AFTER hooks
  if (busy) return <p>Loading...</p>;
  if (err) return <p style={{ color: "crimson" }}>{err}</p>;
  if (!data) return <p>No data</p>;

  const track = data.track;
  const analysis = data.analysis;
  const latestRender = data.latest_render;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 6 }}>
          {track.title || track.source_filename}
        </h2>
        <p style={{ margin: 0, color: "#667" }}>
          mime: {track.mime_type} • object_key: {track.original_object_key}
        </p>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Analysis</h3>
        {analysis ? (
          <div>
            <p style={{ margin: "6px 0" }}>
              Status: <b>{analysis.status}</b>
            </p>
            <p style={{ margin: "6px 0" }}>
              BPM: <b>{analysis.bpm ?? "—"}</b>{" "}
              <span style={{ color: "#667" }}>
                (confidence: {analysis.confidence ?? "—"})
              </span>
            </p>
            {analysis.error && (
              <p style={{ color: "crimson" }}>{analysis.error}</p>
            )}
          </div>
        ) : (
          <p style={{ color: "#667" }}>Not analyzed yet.</p>
        )}

        <button onClick={doAnalyze}>Analyze</button>
        {analysisStatus && (
          <span style={{ marginLeft: 10, color: "#666" }}>{analysisStatus}</span>
        )}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Generate run-synced version</h3>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <label>
            <input
              type="radio"
              checked={mode === "cadence"}
              onChange={() => setMode("cadence")}
            />{" "}
            Cadence
          </label>
          <label>
            <input
              type="radio"
              checked={mode === "pace"}
              onChange={() => setMode("pace")}
            />{" "}
            Pace
          </label>

          <label>
            Beat maps to:{" "}
            <select
              value={beatMode}
              onChange={(e) => setBeatMode(e.target.value)}
            >
              <option value="step">Step (L or R)</option>
              <option value="stride">Stride (L+R)</option>
            </select>
          </label>
        </div>

        {mode === "cadence" ? (
          <div style={{ marginTop: 10 }}>
            <label>
              Steps per minute:{" "}
              <input
                type="number"
                value={cadence}
                onChange={(e) => setCadence(Number(e.target.value))}
                min={120}
                max={220}
              />
            </label>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <label>
              Pace (min:sec per mile):{" "}
              <input
                value={pace}
                onChange={(e) => setPace(e.target.value)}
                placeholder="8:00"
              />
            </label>
            <p style={{ margin: "6px 0 0", color: "#666" }}>
              MVP note: pace → cadence estimation is crude; cadence mode is more
              accurate.
            </p>
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>
            Detected BPM: <b>{detectedBpm ?? "—"}</b>
          </p>
          <p style={{ margin: 0 }}>
            Target BPM: <b>{targetBpm ? Number(targetBpm).toFixed(1) : "—"}</b>
          </p>
        </div>

        <button style={{ marginTop: 10 }} onClick={doGenerate}>
          Generate
        </button>
        {renderStatus && (
          <span style={{ marginLeft: 10, color: "#666" }}>{renderStatus}</span>
        )}

        <div style={{ marginTop: 12, color: "#666" }}>
          <p style={{ margin: 0 }}>
            Latest render status: <b>{latestRender?.status ?? "—"}</b>
          </p>
          <p style={{ margin: 0 }}>
            Output key: {latestRender?.output_object_key ?? "—"}
          </p>
        </div>
      </div>

      {latestRender?.status === "done" && latestRender?.id && (
        <div style={{ marginTop: 12 }}>
          <h4>Output</h4>

          {audioErr && <p style={{ color: "crimson" }}>{audioErr}</p>}

          {audioUrl ? (
            <>
              <audio controls src={audioUrl} />
              <div style={{ marginTop: 8 }}>
                <a href={audioUrl} download="run-version.mp3">
                  Download MP3
                </a>
              </div>
            </>
          ) : (
            <p style={{ color: "#666" }}>Loading audio...</p>
          )}
        </div>
      )}
    </div>
  );
}
