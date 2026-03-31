import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Music, RefreshCw, UploadCloud } from "lucide-react";

import { apiListTracks } from "@/api";
import UploadModal from "@/ui/UploadModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LibraryPage() {
  const [tracks, setTracks] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  async function refresh() {
    setErr("");
    setBusy(true);
    try {
      const res = await apiListTracks();
      const list = Array.isArray(res) ? res : res?.tracks ?? [];
      setTracks(list);
    } catch (e) {
      setErr(e.message || "Failed to load tracks");
      setTracks([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground bg-gradient-to-r from-blue-900 via-blue-700 to-sky-600 bg-clip-text text-transparent">
            Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your tracks, tuned for the pace you want to run.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={busy}
            className="border-primary/30 bg-card/80"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-gradient-to-r from-blue-600 to-sky-500 shadow-md shadow-blue-500/25 hover:from-blue-700 hover:to-sky-600"
            onClick={() => setShowUpload(true)}
          >
            <UploadCloud className="h-4 w-4" />
            Upload
          </Button>
        </div>
      </div>

      {err && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </p>
      )}

      <Card className="overflow-hidden border-blue-200/80 bg-card/90 shadow-lg shadow-blue-900/5 backdrop-blur-sm">
        <CardHeader className="border-b border-border/80 bg-gradient-to-r from-blue-50/90 to-sky-50/50 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Music className="h-5 w-5 text-primary" />
            Tracks
          </CardTitle>
          <CardDescription>
            {busy ? "Loading your library…" : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {busy ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : !tracks.length ? (
            <p className="p-6 text-sm text-muted-foreground">
              No tracks yet. Upload an audio file to get started.
            </p>
          ) : (
            <ul className="divide-y divide-border/80">
              {tracks.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/tracks/${t.id}`}
                    className="group flex items-center justify-between gap-3 px-6 py-4 transition-colors hover:bg-primary/5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground group-hover:text-primary">
                        {t.title || t.source_filename}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{t.mime_type}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onCreated={() => {
          setShowUpload(false);
          refresh();
        }}
      />
    </div>
  );
}
