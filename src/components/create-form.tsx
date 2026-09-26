"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { createJobAction } from "@/app/(user)/actions";
import { Frame, KillRow } from "@/components/job/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import dynamic from "next/dynamic";
import type { UploadState } from "@/components/video-upload";
import { formatCredits } from "@/lib/format";
import type { CatalogOption } from "@/lib/jobs";
import { cn } from "@/lib/utils";

// Loaded only when someone picks "Upload a file", so the link flow stays light.
const VideoUpload = dynamic(() => import("@/components/video-upload").then((m) => m.VideoUpload), {
  loading: () => <div className="min-h-32 animate-pulse rounded-lg border border-dashed border-input bg-panel-raised motion-reduce:animate-none" />,
});

export function CreateForm({ items, balance, intro, maxUploadMb }: { items: CatalogOption[]; balance: number; intro: React.ReactNode; maxUploadMb: number }) {
  const [slug, setSlug] = useState(items[0].slug);
  const item = items.find((i) => i.slug === slug) ?? items[0];
  const [url, setUrl] = useState("");
  const [sourceChoice, setSource] = useState<"url" | "upload">("url");
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [durationSec, setDurationSec] = useState(item.durations.includes(60) ? 60 : item.durations[0]);
  const [state, formAction, pending] = useActionState(createJobAction, { error: null });
  const error = state.error;
  const uid = useId();

  const source = item.uploads ? sourceChoice : "url";
  const uploadBusy = source === "upload" && upload.kind !== "done";
  const price = item.prices[String(durationSec)] ?? 0;
  const short = price - balance;
  const playerName = fields.playerName?.trim();
  const visibleFields = item.fields.filter((f) => !f.advanced && f.type !== "range");

  const errorFor = (name: string) => (error?.field === name ? error.message : null);
  const general = error && !["url", "upload", "durationSec", ...item.fields.map((f) => f.name)].includes(error.field ?? "") ? error.message : null;
  const uploadError = upload.kind === "error" ? upload.message : errorFor("upload");

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start xl:gap-16">
      <div className="flex max-w-lg flex-col gap-8 sm:gap-10">
      {intro}
      <form action={formAction} noValidate className="flex flex-col gap-6">
        {items.length === 1 && <input type="hidden" name="style" value={item.slug} />}
        {items.length > 1 && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Style</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((i) => (
                <label
                  key={i.slug}
                  className="cursor-pointer rounded-xl border bg-panel p-4 transition-colors has-checked:border-danger has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                >
                  <input type="radio" name="style" value={i.slug} checked={slug === i.slug} onChange={() => setSlug(i.slug)} className="sr-only" />
                  <span className="flex items-center gap-2 font-medium">
                    {i.title}
                    {i.beta && <span className="rounded border border-warning/40 px-1.5 py-0.5 text-[11px] font-normal text-warning">Beta</span>}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{i.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <input type="hidden" name="source" value={source} />
        {item.uploads && (
          <div className="grid grid-cols-2 gap-1 rounded-xl border bg-panel p-1" role="radiogroup" aria-label="Where's your match?">
            {(["url", "upload"] as const).map((s) => (
              <label
                key={s}
                className="flex h-11 cursor-pointer items-center justify-center rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground has-checked:bg-panel-raised has-checked:text-foreground has-checked:shadow-[inset_0_0_0_1px_var(--input)] has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:h-10"
              >
                <input type="radio" name="sourceChoice" value={s} checked={source === s} onChange={() => setSource(s)} className="sr-only" />
                {s === "url" ? "YouTube link" : "Upload a file"}
              </label>
            ))}
          </div>
        )}

        {source === "url" ? (
          <Field id={`${uid}-url`} label="YouTube link" error={errorFor("url")} help="Your full match recording, public or unlisted">
            <Input
              id={`${uid}-url`}
              name="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://youtube.com/watch?v=…"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={!!errorFor("url")}
              aria-describedby={`${uid}-url-help`}
            />
          </Field>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-file`}>Match recording</Label>
            <VideoUpload id={`${uid}-file`} maxUploadMb={maxUploadMb} state={upload} onChange={setUpload} describedBy={`${uid}-file-help`} />
            <p id={`${uid}-file-help`} className={cn("text-sm", uploadError ? "text-danger" : "text-muted-foreground")} role={uploadError ? "alert" : undefined}>
              {uploadError ?? "Faster than a link: we skip the download and start editing straight away."}
            </p>
            {upload.kind === "done" && (
              <>
                <input type="hidden" name="uploadKey" value={upload.key} />
                <input type="hidden" name="uploadName" value={upload.name} />
              </>
            )}
          </div>
        )}

        {visibleFields.map((f) => (
          <Field key={f.name} id={`${uid}-${f.name}`} label={f.label} error={errorFor(f.name)} help={f.help}>
            <Input
              id={`${uid}-${f.name}`}
              name={`field:${f.name}`}
              type={f.type === "url" ? "url" : "text"}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={f.name === "playerName" ? "e.g. AquaPlaid" : undefined}
              required={f.required}
              maxLength={f.max}
              value={fields[f.name] ?? ""}
              onChange={(e) => setFields((prev) => ({ ...prev, [f.name]: e.target.value }))}
              aria-invalid={!!errorFor(f.name)}
              aria-describedby={`${uid}-${f.name}-help`}
            />
          </Field>
        ))}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Length</legend>
          <div className="grid grid-cols-3 gap-1 rounded-xl border bg-panel p-1">
            {item.durations.map((d) => (
              <label
                key={d}
                className="flex h-11 cursor-pointer items-center justify-center rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground has-checked:bg-panel-raised has-checked:text-foreground has-checked:shadow-[inset_0_0_0_1px_var(--input)] has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:h-10"
              >
                <input type="radio" name="duration" value={d} checked={durationSec === d} onChange={() => setDurationSec(d)} className="sr-only" />
                <span className="font-mono tabular">{d} s</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          {general && (
            <p role="alert" className="text-sm text-danger">
              {general}
            </p>
          )}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Costs <span className="font-mono text-foreground tabular">{formatCredits(price)}</span> credits · you have{" "}
            <span className="font-mono text-foreground tabular">{formatCredits(balance)}</span>
            {short > 0 && <span className="text-danger"> · you need {formatCredits(short)} more</span>}
          </p>
          <Button type="submit" size="lg" disabled={pending || short > 0 || uploadBusy} className="w-full sm:w-auto sm:self-start">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? "Starting…" : upload.kind === "uploading" && source === "upload" ? "Uploading…" : "Make my montage"}
          </Button>
        </div>
      </form>
      </div>

      <aside className="hidden lg:block" aria-label="How it works">
        <Frame>
          <div className="absolute top-4 right-4 flex flex-col items-end gap-1.5">
            <KillRow killer={playerName || "YourName"} victim="Reyna_Main" you />
            <KillRow killer="teammate" victim="sova.exe" you={false} />
            <KillRow killer={playerName || "YourName"} victim="ghostpeek" you />
          </div>
          <p className="absolute inset-x-6 bottom-6 text-sm text-balance text-muted-foreground">
            We look for <span className={cn("font-medium", playerName ? "text-foreground" : "text-danger")}>{playerName || "your name"}</span> in the kill feed and
            cut every one of your kills into a single vertical edit.
          </p>
        </Frame>
      </aside>
    </div>
  );
}

function Field({ id, label, help, error, children }: { id: string; label: string; help?: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p id={`${id}-help`} className={cn("text-sm", error ? "text-danger" : "text-muted-foreground")} role={error ? "alert" : undefined}>
        {error ?? help}
      </p>
    </div>
  );
}
