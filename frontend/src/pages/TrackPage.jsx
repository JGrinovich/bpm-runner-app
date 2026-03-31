import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Activity, Gauge, Sparkles } from "lucide-react";

import {
  apiAnalyze,
  apiGetAnalysis,
  apiGetRender,
  apiGetTrack,
  apiRender,
  getToken,
} from "@/api";
import { poll } from "@/poll";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

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

  const [mode, setMode] = useState("cadence");
  const [cadence, setCadence] = useState(176);
  const [pace, setPace] = useState("8:00");
  const [beatMode, setBeatMode] = useState("step");
  const [renderStatus, setRenderStatus] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");

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

  useEffect(() => {
    let objectUrl = null;

    async function loadAudio() {
      if (!data?.latest_render?.id || data?.latest_render?.status !== "done") {
        setAudioUrl("");
        return;
      }

      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/render-files/${data.latest_render.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) throw new Error("Failed to fetch rendered audio");

        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
      } catch {
        setAudioUrl("");
      }
    }

    loadAudio();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data?.latest_render?.id, data?.latest_render?.status]);

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
      const res = await apiRender(id, { target_bpm: Number(targetBpm), preserve_pitch: true });
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

  if (busy) {
    return <p className="text-sm text-muted-foreground">Loading track…</p>;
  }
  if (!data) {
    return (
      <div className="space-y-3">
        {err ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {err}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No data</p>
        )}
      </div>
    );
  }

  const track = data.track;
  const analysis = data.analysis;
  const latestRender = data.latest_render;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-900 via-blue-700 to-sky-600 bg-clip-text text-transparent">
          {track.title || track.source_filename}
        </h1>
        <p className="text-sm text-muted-foreground">
          {track.mime_type}
          <span className="mx-2 text-border">·</span>
          <span className="font-mono text-xs">{track.original_object_key}</span>
        </p>
      </div>

      {err && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </p>
      )}

      <Card className="border-blue-200/80 bg-card/90 shadow-md shadow-blue-900/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-primary" />
            Analysis
          </CardTitle>
          <CardDescription>BPM detection for this track</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {analysis ? (
            <div className="space-y-2 text-sm">
              <p>
                Status:{" "}
                <span className="font-semibold text-foreground">{analysis.status}</span>
              </p>
              <p>
                BPM:{" "}
                <span className="font-semibold text-foreground">{analysis.bpm ?? "—"}</span>{" "}
                <span className="text-muted-foreground">
                  (confidence: {analysis.confidence ?? "—"})
                </span>
              </p>
              {analysis.error && (
                <p className="text-destructive">{analysis.error}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not analyzed yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={doAnalyze}
              className="bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600"
            >
              Analyze
            </Button>
            {analysisStatus && (
              <span className="text-xs text-muted-foreground">{analysisStatus}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-sky-200/80 bg-card/90 shadow-md shadow-sky-900/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gauge className="h-5 w-5 text-sky-600" />
            Run-synced render
          </CardTitle>
          <CardDescription>Match tempo to your cadence or pace</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                className="accent-primary"
                checked={mode === "cadence"}
                onChange={() => setMode("cadence")}
              />
              Cadence
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                className="accent-primary"
                checked={mode === "pace"}
                onChange={() => setMode("pace")}
              />
              Pace
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <span className="text-muted-foreground">Beat maps to:</span>
              <select
                value={beatMode}
                onChange={(e) => setBeatMode(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="step">Step (L or R)</option>
                <option value="stride">Stride (L+R)</option>
              </select>
            </label>
          </div>

          <Separator />

          {mode === "cadence" ? (
            <div className="grid gap-2 max-w-xs">
              <Label htmlFor="cadence">Steps per minute</Label>
              <Input
                id="cadence"
                type="number"
                min={120}
                max={220}
                value={cadence}
                onChange={(e) => setCadence(Number(e.target.value))}
              />
            </div>
          ) : (
            <div className="grid gap-2 max-w-xs">
              <Label htmlFor="pace">Pace (min:sec per mile)</Label>
              <Input
                id="pace"
                value={pace}
                onChange={(e) => setPace(e.target.value)}
                placeholder="8:00"
              />
              <p className="text-xs text-muted-foreground">
                Pace → cadence is a rough MVP estimate; cadence mode is more accurate.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-blue-50/80 to-sky-50/50 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-sky-600" />
              Targets
            </p>
            <p className="mt-2 text-muted-foreground">
              Detected BPM:{" "}
              <span className="font-semibold text-foreground">{detectedBpm ?? "—"}</span>
            </p>
            <p className="text-muted-foreground">
              Target BPM:{" "}
              <span className="font-semibold text-primary">
                {targetBpm ? Number(targetBpm).toFixed(1) : "—"}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={doGenerate}
              variant="secondary"
              className="border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
            >
              Generate
            </Button>
            {renderStatus && (
              <span className="text-xs text-muted-foreground">{renderStatus}</span>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            <p>
              Latest render:{" "}
              <span className="font-medium text-foreground">{latestRender?.status ?? "—"}</span>
            </p>
            <p className="truncate font-mono text-xs">{latestRender?.output_object_key ?? "—"}</p>

            {latestRender?.status === "done" && audioUrl && (
              <div className="mt-4 space-y-2">
                <audio controls src={audioUrl} className="w-full max-w-md" />
                <div>
                  <a
                    href={audioUrl}
                    download="run-synced-track.mp3"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Download MP3
                  </a>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
