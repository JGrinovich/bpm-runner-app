import { useState } from "react";
import { Upload } from "lucide-react";

import { clearToken, getToken } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export default function UploadModal({ open, onClose, onCreated }) {
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
      setFile(null);
      onCreated();
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setErr("");
          setFile(null);
          setProgress(0);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md border-blue-200/70 bg-card/95 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Upload className="h-4 w-4" />
            </span>
            Upload track
          </DialogTitle>
          <DialogDescription>
            Add an audio file (MP3, WAV, M4A). Max 50&nbsp;MB.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 pt-1">
          <input
            type="file"
            accept="audio/*"
            disabled={busy}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />

          {file && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">{progress}%</p>
            </div>
          )}

          {err && (
            <p className="text-sm text-destructive" role="alert">
              {err}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setErr("");
                onClose();
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleUpload} disabled={!file || busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
