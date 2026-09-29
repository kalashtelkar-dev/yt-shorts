"use client";

import { Crosshair, Info, Link2, Loader2, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useActionState, useId, useRef, useState } from "react";
import { createJobAction } from "@/app/(user)/actions";
import { Frame, KillRow } from "@/components/job/feed";
import { buttonVariants } from "@/components/ui/button";
import type { UploadState } from "@/components/video-upload";
import { formatCredits } from "@/lib/format";
import type { CatalogOption } from "@/lib/jobs";
import { cn } from "@/lib/utils";

// Loaded only when someone picks "Upload a file", so the link flow stays light.
const VideoUpload = dynamic(() => import("@/components/video-upload").then((m) => m.VideoUpload), {
  loading: () => <div className="min-h-32 animate-pulse rounded-lg border border-dashed border-input bg-panel-raised motion-reduce:animate-none" />,
});

// What the preview frame hints at for each style. Unknown styles show the kill feed only.
const PREVIEW: Record<string, { lyric?: boolean; slow?: boolean }> = {
  "lyrical-kill-montage": { lyric: true },
  "ultra-edit": { lyric: true, slow: true },
};

const pill = "has-focus-visible:ring-3 has-focus-visible:ring-ring/50 cursor-pointer transition-colors";

export function CreateForm({
  items,
  available,
  intro,
  maxUploadMb,
  needsAccount = false,
  starterCredits = 0,
  canBuy = false,
}: {
  items: CatalogOption[];
  /** Credits a new job can count on: balance minus what running jobs hold. */
  available: number;
  intro: React.ReactNode;
  maxUploadMb: number;
  /** AUTH_MODE=full and nobody is signed in: the form shows the price, and the button goes to sign-up. */
  needsAccount?: boolean;
  /** Free credits a new account gets, shown to visitors who need to sign up. */
  starterCredits?: number;
  /** Buying credits is open: a short balance links to the account page. */
  canBuy?: boolean;
}) {
  const [slug, setSlug] = useState(items[0].slug);
  const item = items.find((i) => i.slug === slug) ?? items[0];
  const [url, setUrl] = useState("");
  const [sourceChoice, setSource] = useState<"url" | "upload">("url");
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [durationChoice, setDurationSec] = useState(60);
  const [state, formAction, pending] = useActionState(createJobAction, { error: null });
  const error = state.error;
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const confirmed = useRef(false);

  // Uploads need a user to own the file, so visitors without an account see the link flow only.
  const canUpload = item.uploads && !needsAccount;
  const source = canUpload ? sourceChoice : "url";
  const uploadBusy = source === "upload" && upload.kind !== "done";
  // Styles can offer different lengths; keep the pick when it exists, else the nearest one.
  const durationSec = item.durations.includes(durationChoice) ? durationChoice : item.durations.reduce((a, b) => (Math.abs(b - durationChoice) < Math.abs(a - durationChoice) ? b : a));
  const range = item.creditRanges[String(durationSec)] ?? { min: 0, max: 0 };
  // To start, the top of the range must be free; the montage then uses only the time it takes.
  const short = needsAccount ? 0 : range.max - available;
  const playerName = fields.playerName?.trim();
  const visibleFields = item.fields.filter((f) => !f.advanced && f.type !== "range");
  const hint = PREVIEW[item.slug] ?? {};

  const errorFor = (name: string) => (error?.field === name ? error.message : null);
  const general = error && !["url", "upload", "durationSec", ...item.fields.map((f) => f.name)].includes(error.field ?? "") ? error.message : null;
  const uploadError = upload.kind === "error" ? upload.message : errorFor("upload");
  const fieldError = errorFor("url") ?? (source === "upload" ? uploadError : null) ?? visibleFields.map((f) => errorFor(f.name)).find(Boolean) ?? null;

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start lg:gap-14">
      {/* The one memorable element: a 9:16 frame hinting at what this style makes. On phones only its top 3/4
          shows, fading into a blur at the bottom, so the form starts higher up. */}
      <div className="relative mx-auto w-full max-w-[min(16rem,calc(52dvh*9/16))] lg:sticky lg:top-8 lg:mx-0 lg:max-w-[340px]">
      <div className="aspect-[9/12] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_82%,transparent)] lg:aspect-auto lg:overflow-visible lg:[mask-image:none]">
      <Frame>
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 lg:top-4 lg:right-4">
          <KillRow killer={playerName || "you"} victim="Reyna" you />
          <KillRow killer={playerName || "you"} victim="Jett" you />
        </div>
        <Crosshair className="absolute top-[37.5%] left-1/2 size-6 -translate-1/2 text-foreground/25 lg:top-1/2" aria-hidden />
        {hint.lyric && (
          <p className="absolute top-[38%] left-4 text-xl leading-none font-black tracking-tight [text-shadow:2px_2px_0_#000] lg:text-3xl" aria-hidden>
            BABY BET
            <br />
            AYY
          </p>
        )}
        {hint.slow && <span className="absolute bottom-[44%] left-3 rounded bg-black/70 px-1.5 py-1 font-mono text-[11px] lg:bottom-14 lg:left-4">0.5× slow-mo</span>}
        <p className="absolute inset-x-3 bottom-[37%] flex justify-between gap-2 font-mono text-[11px] text-muted-foreground lg:inset-x-4 lg:bottom-4 lg:text-xs">
          <span className="truncate">{item.title}</span>
          <span className="tabular">{durationSec}s</span>
        </p>
      </Frame>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 backdrop-blur-[3px] [mask-image:linear-gradient(to_top,#000,transparent)] lg:hidden" />
      </div>

      <form
        ref={formRef}
        action={formAction}
        noValidate
        onSubmit={(e) => {
          // Ask "check your choices" first. Incomplete forms go straight through so the server's message shows.
          if (confirmed.current || !e.currentTarget.checkValidity()) {
            confirmed.current = false;
            return;
          }
          e.preventDefault();
          confirmRef.current?.showModal();
        }}
        className="flex min-w-0 flex-col gap-4 lg:max-w-lg lg:gap-6"
      >
        <div className="max-lg:sr-only">{intro}</div>

        {items.length === 1 ? (
          <input type="hidden" name="style" value={item.slug} />
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="sr-only">Style</legend>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
              {items.map((i) => (
                <label
                  key={i.slug}
                  className={cn(
                    pill,
                    "flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap",
                    slug === i.slug ? "border-foreground bg-foreground text-background" : "bg-panel text-foreground hover:bg-panel-raised",
                  )}
                >
                  <input type="radio" name="style" value={i.slug} checked={slug === i.slug} onChange={() => setSlug(i.slug)} className="sr-only" />
                  {i.title}
                </label>
              ))}
            </div>
            <p className="min-h-10 text-sm text-muted-foreground" aria-live="polite">
              {item.beta && <span className="mr-1.5 rounded border border-warning/40 px-1.5 py-0.5 text-[11px] text-warning">Beta</span>}
              {item.description}
            </p>
          </fieldset>
        )}

        <input type="hidden" name="source" value={source} />
        <div className="overflow-hidden rounded-2xl border bg-panel">
          {source === "url" ? (
            <Row id={`${uid}-url`} label="Match" invalid={!!errorFor("url")}>
              <input
                id={`${uid}-url`}
                name="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="YouTube link to your match"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!!errorFor("url")}
                className={rowInput}
              />
              {canUpload && (
                <button type="button" onClick={() => setSource("upload")} aria-label="Upload a file instead" className={rowButton}>
                  <Upload className="size-4" aria-hidden />
                </button>
              )}
            </Row>
          ) : (
            <div className="flex flex-col gap-2 border-b p-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <label htmlFor={`${uid}-file`} className="text-xs text-muted-foreground">
                  Match recording
                </label>
                <button type="button" onClick={() => setSource("url")} className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  <Link2 className="size-4" aria-hidden /> Use a link
                </button>
              </div>
              <VideoUpload id={`${uid}-file`} maxUploadMb={maxUploadMb} state={upload} onChange={setUpload} />
              {upload.kind === "done" && (
                <>
                  <input type="hidden" name="uploadKey" value={upload.key} />
                  <input type="hidden" name="uploadName" value={upload.name} />
                </>
              )}
            </div>
          )}

          {visibleFields.map((f) => (
            <Row key={f.name} id={`${uid}-${f.name}`} label={f.label} invalid={!!errorFor(f.name)}>
              <input
                id={`${uid}-${f.name}`}
                name={`field:${f.name}`}
                type={f.type === "url" ? "url" : "text"}
                inputMode={f.type === "url" ? "url" : undefined}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={f.type === "url" ? "YouTube link" : f.help}
                required={f.required}
                maxLength={f.max}
                value={fields[f.name] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.name]: e.target.value }))}
                aria-invalid={!!errorFor(f.name)}
                aria-describedby={f.help && f.type === "url" ? `${uid}-${f.name}-help` : undefined}
                className={rowInput}
              />
              {f.help && f.type === "url" && (
                <span id={`${uid}-${f.name}-help`} className="sr-only">
                  {f.help}
                </span>
              )}
            </Row>
          ))}
          <CostRow range={range} available={available} short={short} needsAccount={needsAccount} starterCredits={starterCredits} />
        </div>

        {(fieldError || general) && (
          <p role="alert" className="text-sm text-danger">
            {fieldError ?? general}
          </p>
        )}

        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <div className="flex items-stretch gap-3">
            <fieldset className="flex shrink-0 rounded-xl border bg-panel p-1">
              <legend className="sr-only">Length</legend>
              {item.durations.map((d) => (
                <label
                  key={d}
                  className={cn(
                    pill,
                    "flex w-12 items-center justify-center rounded-lg font-mono text-sm tabular",
                    durationSec === d ? "bg-panel-raised text-foreground shadow-[inset_0_0_0_1px_var(--input)]" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <input type="radio" name="duration" value={d} checked={durationSec === d} onChange={() => setDurationSec(d)} className="sr-only" />
                  {d}s
                </label>
              ))}
            </fieldset>
            {needsAccount ? (
              <Link href="/sign-up" className={cn(buttonVariants({ size: "lg" }), "h-14 min-w-0 flex-1 rounded-xl")}>
                Create a free account
              </Link>
            ) : short > 0 && canBuy ? (
              <Link href="/account" className={cn(buttonVariants({ size: "lg" }), "h-14 min-w-0 flex-1 flex-col gap-0 rounded-xl leading-tight")}>
                Add credits to start
                <span className="font-mono text-xs font-normal opacity-85 tabular">
                  need {formatCredits(range.max)}, have {formatCredits(available)}
                </span>
              </Link>
            ) : (
              <button
                type="submit"
                disabled={pending || short > 0 || uploadBusy}
                className={cn(buttonVariants({ size: "lg" }), "h-14 min-w-0 flex-1 rounded-xl")}
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {pending ? "Starting…" : upload.kind === "uploading" && source === "upload" ? "Uploading…" : "Make my montage"}
              </button>
            )}
          </div>
          {needsAccount && (
            <Link href="/sign-in" className="self-center rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              I have an account
            </Link>
          )}
        </div>
      </form>

      <dialog ref={confirmRef} aria-labelledby={`${uid}-confirm`} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border bg-panel p-0 text-foreground backdrop:bg-black/70">
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id={`${uid}-confirm`} className="text-lg font-semibold">
              Check your choices
            </h2>
            <p className="text-sm text-muted-foreground">Once it starts, these can&apos;t be changed.</p>
          </div>
          <dl className="flex flex-col divide-y rounded-xl border text-sm">
            {[
              ["Style", item.title],
              ["Length", `${durationSec} s`],
              ["Match", source === "upload" ? (upload.kind === "done" ? upload.name : "Uploaded file") : url.trim()],
              ...visibleFields.map((f) => [f.label, fields[f.name]?.trim() ?? ""]),
              ["Estimated cost", `${formatCredits(range.min)}–${formatCredits(range.max)} credits, charged after it's made`],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="break-all">{v || "—"}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={() => confirmRef.current?.close()} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "sm:flex-1")}>
              Change something
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                confirmRef.current?.close();
                confirmed.current = true;
                formRef.current?.requestSubmit();
              }}
              className={cn(buttonVariants({ size: "lg" }), "sm:flex-1")}
            >
              Make my montage
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

const rowInput = "h-8 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/80";
const rowButton =
  "flex size-10 shrink-0 items-center justify-center rounded-lg border text-foreground hover:bg-panel-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** One line of the form card: a small label above a borderless input. */
function Row({ id, label, invalid, children }: { id: string; label: string; invalid: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-0.5 border-b px-4 pt-2.5 pb-2 last:border-b-0 focus-within:bg-panel-raised", invalid && "shadow-[inset_2px_0_0_var(--accent-red)]")}>
      <label htmlFor={id} className={cn("text-xs", invalid ? "text-danger" : "text-muted-foreground")}>
        {label}
      </label>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** The last line of the form card: what this edit usually costs, with how it's worked out behind the i. */
function CostRow({ range, available, short, needsAccount, starterCredits }: { range: { min: number; max: number }; available: number; short: number; needsAccount: boolean; starterCredits: number }) {
  return (
    <details className="group border-t px-4 py-3">
      <summary className="flex min-h-7 cursor-pointer list-none items-center justify-between gap-3 rounded select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="text-sm text-muted-foreground">Estimated cost</span>
        <span className="flex items-center gap-2 text-sm">
          <span aria-live="polite">
            <span className="font-mono tabular">
              {formatCredits(range.min)}–{formatCredits(range.max)}
            </span>{" "}
            credits
          </span>
          <Info className="size-4 text-muted-foreground transition-colors group-open:text-foreground" aria-label="How is this worked out?" />
        </span>
      </summary>
      <div className="flex flex-col gap-2 pt-2 text-sm leading-relaxed text-muted-foreground">
        <p>
          You pay for editing time: 1 credit a second. Long matches and more kills take longer. Credits come off after it&apos;s made, and a montage that fails costs
          nothing.
        </p>
        {needsAccount ? (
          <p>New accounts get {formatCredits(starterCredits)} free credits.</p>
        ) : (
          <p className={cn(short > 0 && "text-danger")}>
            To start, you need {formatCredits(range.max)} free, enough for the longest this edit usually takes. You have {formatCredits(available)}.
          </p>
        )}
      </div>
    </details>
  );
}
