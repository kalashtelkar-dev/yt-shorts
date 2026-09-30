"use client";

import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { startTransition, useActionState, useState } from "react";
import { saveCatalogAction, validateTemplateAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CatalogFormValues = {
  id: string | null;
  slug: string;
  title: string;
  description: string;
  templateId: string;
  uploadTemplateId: string | null;
  indexTemplates: unknown;
  enabled: boolean;
  beta: boolean;
  sortOrder: number;
  durations: number[];
  creditRanges: Record<string, { min: number; max: number }>;
  fields: unknown;
  inputMap: unknown;
  stageMap: unknown;
  outputKey: string;
};

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const textareaClass =
  "min-h-40 w-full rounded-lg border border-input bg-panel-raised px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CatalogForm({ initial }: { initial: CatalogFormValues }) {
  const [saveState, save, saving] = useActionState(saveCatalogAction, null);
  const [check, validate, validating] = useActionState(validateTemplateAction, null);
  const [durationsText, setDurationsText] = useState(initial.durations.join(", "));
  const durations = [...new Set(durationsText.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  // Submitting via onSubmit (not <form action>) so React doesn't reset the fields after a rejected save.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget);
    startTransition(() => (submitter?.dataset.intent === "validate" ? validate(data) : save(data)));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <section className="grid grid-cols-1 gap-4 rounded-xl border bg-panel p-4 md:grid-cols-2">
        <L label="Title" hint="Shown to users on the style card">
          <Input name="title" defaultValue={initial.title} required maxLength={80} />
        </L>
        <L label="Slug" hint="Stable ID, e.g. kill-montage">
          <Input name="slug" defaultValue={initial.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" className="font-mono" />
        </L>
        <L label="Description" hint="One line under the title" className="md:col-span-2">
          <Input name="description" defaultValue={initial.description} maxLength={300} />
        </L>
        <div className="flex flex-wrap gap-6 md:col-span-2">
          <Check name="enabled" label="Enabled (visible to users)" defaultChecked={initial.enabled} />
          <Check name="beta" label="Show a Beta tag" defaultChecked={initial.beta} />
          <label className="flex items-center gap-2 text-sm">
            Sort order
            <Input name="sortOrder" type="number" min={0} max={1000} defaultValue={initial.sortOrder} className="w-24" />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border bg-panel p-4">
        <h2 className="text-sm font-medium">Template</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
          <L label="Engine X template ID" hint="Changing it affects new jobs only; running jobs keep their snapshot">
            <Input name="templateId" defaultValue={initial.templateId} required className="font-mono" />
          </L>
          <L label="Output field with the video" hint="Usually montage">
            <Input name="outputKey" defaultValue={initial.outputKey} required className="font-mono" />
          </L>
          <L label="Upload template ID (optional)" hint="Pipeline that takes an uploaded file instead of a link. Empty = no upload option. Checked on save." className="md:col-span-2">
            <Input name="uploadTemplateId" defaultValue={initial.uploadTemplateId ?? ""} className="font-mono" />
          </L>
          <L
            label="Index pipelines (staged styles)"
            hint='JSON: {"gameplay": "tpl_…", "gameplayUpload": "tpl_…", "song": "tpl_…", "songUpload": "tpl_…"}. Set = the template above is a style pipeline fed by these. Empty = a single-pipeline style.'
            className="md:col-span-2"
          >
            <textarea name="indexTemplates" defaultValue={initial.indexTemplates ? pretty(initial.indexTemplates) : ""} spellCheck={false} rows={4} className={textareaClass} />
          </L>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" data-intent="validate" formNoValidate variant="outline" disabled={validating}>
            {validating && <Loader2 className="animate-spin" aria-hidden />}
            Validate
          </Button>
          <span className="text-sm text-muted-foreground">Checks the template and the input map against Engine X.</span>
        </div>
        {check && <Report state={check} />}
      </section>

      <section className="flex flex-col gap-4 rounded-xl border bg-panel p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Lengths and credits</h2>
          <p className="text-sm text-muted-foreground">
            1 credit is 1 second of editing. Users see the range before they start, need the highest free to start, and pay for the time actually used.
          </p>
        </div>
        <L label="Lengths users can pick (seconds)" hint="Comma-separated, e.g. 30, 60, 90">
          <Input name="durations" value={durationsText} onChange={(e) => setDurationsText(e.target.value)} className="max-w-xs font-mono" />
        </L>
        <div className="flex flex-wrap gap-4">
          {durations.map((d) => (
            <fieldset key={d} className="grid gap-1.5 text-sm">
              <legend className="mb-1.5 font-medium">
                <span className="font-mono">{d} s</span> uses (credits)
              </legend>
              <div className="flex items-center gap-2">
                <Input name={`min:${d}`} aria-label={`Lowest credits for ${d} s`} type="number" min={1} step={1} required defaultValue={initial.creditRanges[String(d)]?.min ?? ""} className="w-24 font-mono" />
                <span className="text-muted-foreground">to</span>
                <Input name={`max:${d}`} aria-label={`Highest credits for ${d} s`} type="number" min={1} step={1} required defaultValue={initial.creditRanges[String(d)]?.max ?? ""} className="w-24 font-mono" />
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 rounded-xl border bg-panel p-4 xl:grid-cols-3">
        <L label="Form fields (JSON)" hint='[{"name":"playerName","label":"Your in-game name","type":"text","required":true,"max":32}]'>
          <textarea name="fields" defaultValue={pretty(initial.fields)} spellCheck={false} className={textareaClass} />
        </L>
        <L label="Input map (JSON)" hint="Pipeline input → $source.url, $durationSec, $fields.name[.sub] or a literal">
          <textarea name="inputMap" defaultValue={pretty(initial.inputMap)} spellCheck={false} className={textareaClass} />
        </L>
        <L label="Stage map (JSON)" hint='Step-id prefix → label users see, in pipeline order: [{"match":"download","label":"Downloading your video"}]'>
          <textarea name="stageMap" defaultValue={pretty(initial.stageMap)} spellCheck={false} className={textareaClass} />
        </L>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {initial.id ? "Save changes" : "Create item"}
        </Button>
        {saveState && (
          <p role="status" className={cn("max-w-2xl text-sm", saveState.ok ? (saveState.message.includes("warnings") ? "text-warning" : "text-success") : "text-danger")}>
            {saveState.message}
          </p>
        )}
      </div>
    </form>
  );
}

function L({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("grid content-start gap-1.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs break-words text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--accent-strong)]" />
      {label}
    </label>
  );
}

function Report({ state }: { state: NonNullable<Awaited<ReturnType<typeof validateTemplateAction>>> }) {
  if (state.message) return <p className="text-sm text-danger">{state.message}</p>;
  const r = state.report!;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 text-sm" role="status">
      <p className={cn("flex items-center gap-2 font-medium", r.ok ? "text-success" : "text-danger")}>
        {r.ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
        {r.ok ? "Valid. Jobs can run on this template." : "Not valid. Saving is blocked until these are fixed."}
      </p>
      {r.errors.map((e) => (
        <p key={e} className="flex gap-2 text-danger">
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {e}
        </p>
      ))}
      {r.warnings.map((w) => (
        <p key={w} className="flex gap-2 text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {w}
        </p>
      ))}
      {r.pipeline && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          <dt>name</dt>
          <dd className="text-foreground">{r.pipeline.name}</dd>
          <dt>version</dt>
          <dd className="text-foreground">
            head v{r.pipeline.version ?? "?"} · published {r.pipeline.publishedVersion ? `v${r.pipeline.publishedVersion}` : "never"}
          </dd>
          <dt>inputs</dt>
          <dd className="break-words text-foreground">{r.pipeline.inputs.map((i) => `${i.name}${i.required ? "*" : ""}`).join(", ") || "none"}</dd>
          <dt>outputs</dt>
          <dd className="break-words text-foreground">{r.pipeline.outputs.join(", ") || "none"}</dd>
        </dl>
      )}
    </div>
  );
}
