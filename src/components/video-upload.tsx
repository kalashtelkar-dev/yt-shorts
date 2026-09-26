"use client";

import { CheckCircle2, FileVideo, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { startUploadAction } from "@/app/(user)/actions";
import { cn } from "@/lib/utils";

// Uploads go straight from the browser to Engine X storage with a presigned PUT; our server never
// carries the bytes. The parent gets the storage key once the upload has finished.

export type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; size: number; progress: number }
  | { kind: "done"; key: string; name: string; size: number }
  | { kind: "error"; message: string };

const EXTENSIONS = ["mp4", "mov", "mkv", "webm"];

const formatSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

export function VideoUpload({ id, maxUploadMb, state, onChange, describedBy }: { id: string; maxUploadMb: number; state: UploadState; onChange: (s: UploadState) => void; describedBy?: string }) {
  const xhr = useRef<XMLHttpRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function start(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!EXTENSIONS.includes(ext)) return onChange({ kind: "error", message: "Upload an MP4, MOV, MKV or WebM video file." });
    if (file.size > maxUploadMb * 1024 * 1024) return onChange({ kind: "error", message: `That file is over ${formatSize(maxUploadMb * 1024 * 1024)}. Trim it or paste a YouTube link instead.` });

    onChange({ kind: "uploading", name: file.name, size: file.size, progress: 0 });
    const r = await startUploadAction({ name: file.name, size: file.size, type: file.type });
    if (!r.ok) return onChange({ kind: "error", message: r.error.message });

    const req = new XMLHttpRequest();
    xhr.current = req;
    req.open("PUT", r.data.url);
    if (file.type) req.setRequestHeader("Content-Type", file.type);
    req.upload.onprogress = (e) => e.lengthComputable && onChange({ kind: "uploading", name: file.name, size: file.size, progress: e.loaded / e.total });
    req.onload = () =>
      req.status >= 200 && req.status < 300
        ? onChange({ kind: "done", key: r.data.key, name: file.name, size: file.size })
        : onChange({ kind: "error", message: "The upload didn't go through. Try again." });
    req.onerror = () => onChange({ kind: "error", message: "The upload stopped. Check your connection and try again." });
    req.onabort = () => onChange({ kind: "idle" });
    req.send(file);
  }

  function reset() {
    xhr.current?.abort();
    xhr.current = null;
    if (input.current) input.current.value = "";
    onChange({ kind: "idle" });
  }

  if (state.kind === "uploading" || state.kind === "done") {
    const pct = state.kind === "done" ? 100 : Math.round(state.progress * 100);
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-input bg-panel-raised p-3" aria-live="polite">
        <div className="flex items-center gap-3">
          {state.kind === "done" ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden /> : <FileVideo className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{state.name}</span>
            <span className="font-mono text-xs text-muted-foreground tabular">
              {formatSize(state.size)} · {state.kind === "done" ? "uploaded" : `${pct}%`}
            </span>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:size-9"
            aria-label={state.kind === "done" ? "Remove this file" : "Cancel the upload"}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden>
          <div className={cn("h-full origin-left transition-transform duration-300", state.kind === "done" ? "bg-success" : "bg-danger")} style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        {state.kind === "uploading" && <p className="text-xs text-muted-foreground">Keep this tab open until the upload finishes.</p>}
      </div>
    );
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) start(file);
      }}
      className={cn(
        "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-panel-raised p-4 text-center transition-colors hover:border-muted-foreground has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        dragging && "border-danger bg-danger/5",
      )}
    >
      <Upload className="size-5 text-muted-foreground" aria-hidden />
      <span className="text-sm">
        <span className="font-medium">Choose a video</span> <span className="text-muted-foreground max-sm:hidden">or drop it here</span>
      </span>
      <span className="text-xs text-muted-foreground">MP4, MOV, MKV or WebM · up to {formatSize(maxUploadMb * 1024 * 1024)}</span>
      <input
        ref={input}
        id={id}
        type="file"
        accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm"
        className="sr-only"
        aria-describedby={describedBy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) start(file);
        }}
      />
    </label>
  );
}
