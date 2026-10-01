"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { confirmPurchaseAction, saveBillingProfileAction, startPurchaseAction } from "@/app/(user)/actions";
import { buttonVariants } from "@/components/ui/button";
import { SelectField } from "@/components/select-field";
import { GST_STATES, rupees, stateName } from "@/lib/billing";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";

type Profile = { stateCode: string; legalName: string | null; gstin: string | null } | null;
type Style = { title: string; min: number; max: number; durationSec: number };

const ROW = 52; // px per wheel row

/** Pick an amount on a scroll wheel, see the credits it buys, pay. GST details are optional (Profile tab). */
export function BuyCredits({ amounts, paisePerCredit, gstPercent, styles }: { amounts: number[]; paisePerCredit: number; gstPercent: number; styles: Style[] }) {
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState<"pick" | "paying" | "done">("pick");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ credits: number; invoiceId: string } | null>(null);
  const [mock, setMock] = useState<{ amountPaise: number; credits: number; confirm: () => void; cancel: () => void } | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const amount = amounts[idx];
  const credits = Math.floor((amount * 100) / paisePerCredit);

  function pay() {
    setError(null);
    start(async () => {
      const r = await startPurchaseAction(amount);
      if (!r.ok) return setError(r.error.message);
      const o = r.data;
      const finish = async (resp: { orderId: string; paymentId?: string; signature?: string }) => {
        setStep("paying");
        const c = await confirmPurchaseAction(resp);
        if (!c.ok) {
          setStep("pick");
          return setError(c.error.message);
        }
        setDone(c.data);
        setStep("done");
        router.refresh();
      };
      if (o.provider === "mock" && o.mock) {
        const m = o.mock;
        setMock({
          amountPaise: o.amountPaise,
          credits: o.credits,
          confirm: () => {
            setMock(null);
            void finish({ orderId: o.orderId, paymentId: m.paymentId, signature: m.signature });
          },
          cancel: () => setMock(null),
        });
        return;
      }
      try {
        await loadCashfree();
        const res = await window.Cashfree({ mode: o.mode }).checkout({ paymentSessionId: o.sessionId, redirectTarget: "_modal" });
        // Closed or failed: nothing to confirm. Otherwise the server asks Cashfree whether it's paid.
        if (res.error) return setError("The payment didn't finish. Nothing was charged; try again or use another method.");
        await finish({ orderId: o.orderId });
      } catch {
        setError("We couldn't open the payment page. Check your connection and try again.");
      }
    });
  }

  if (step === "done" && done) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border bg-panel p-6" role="status">
        <span className="flex size-11 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl">Added {formatCredits(done.credits)} credits</h2>
          <p className="text-sm text-muted-foreground">Your tax invoice is ready.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/create" className={buttonVariants({ size: "lg" })}>
            Make a montage
          </Link>
          <Link href={`/account/billing/invoices/${done.invoiceId}`} className={buttonVariants({ size: "lg", variant: "outline" })}>
            View invoice
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 items-stretch overflow-hidden rounded-2xl border bg-panel">
        <Wheel amounts={amounts} idx={idx} onChange={setIdx} />
        <div className="flex flex-col justify-center gap-1 border-l px-4 sm:px-6">
          <span className="text-sm text-muted-foreground">You get</span>
          <span className="font-mono text-4xl leading-none tabular">{formatCredits(credits)}</span>
          <span className="text-sm text-muted-foreground">credits</span>
          <span className="mt-3 text-xs text-muted-foreground">About {Math.max(1, Math.round(credits / 60))} min of editing</span>
        </div>
      </div>

      {styles.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">That makes about</span>
          <ul className="flex flex-col">
            {styles.map((s) => {
              const lo = Math.floor(credits / s.max);
              const hi = Math.floor(credits / s.min);
              return (
                <li key={s.title} className="flex justify-between gap-3 border-b py-2.5 text-sm">
                  <span>
                    {s.title}, {s.durationSec} s
                  </span>
                  <span className="font-mono tabular">{lo === hi ? lo : `${lo}–${hi}`}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-1.5 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <button type="button" onClick={pay} disabled={busy || step === "paying"} className={cn(buttonVariants({ size: "lg" }), "h-13 w-full text-base")}>
          {(busy || step === "paying") && <Loader2 className="animate-spin" aria-hidden />}
          {step === "paying" ? "Confirming your payment…" : `Pay ${rupees(amount * 100)}`}
        </button>
        <span className="text-center text-xs text-muted-foreground">
          Includes {gstPercent}% GST. UPI, cards or netbanking through Cashfree. You get a tax invoice. By paying you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/refunds" className="underline underline-offset-4 hover:text-foreground">
            Refund policy
          </Link>
          .
        </span>
      </div>

      {mock && <MockCheckout {...mock} />}
    </div>
  );
}

/** A scroll-snap wheel of rupee amounts. Arrow keys and clicks work too. */
function Wheel({ amounts, idx, onChange }: { amounts: number[]; idx: number; onChange: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const id = useId();
  const go = (i: number, smooth = true) => {
    const next = Math.max(0, Math.min(amounts.length - 1, i));
    onChange(next);
    box.current?.scrollTo({ top: next * ROW, behavior: smooth ? "smooth" : "auto" });
  };
  // Coming back (after the details step), start where the pick was, not at the top.
  useEffect(() => {
    if (box.current) box.current.scrollTop = idx * ROW;
    return () => cancelAnimationFrame(frame.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="relative h-[260px]">
      <div aria-hidden className="pointer-events-none absolute inset-x-2.5 top-[104px] h-[52px] rounded-[10px] border border-input bg-panel-raised" />
      <div
        ref={box}
        role="listbox"
        aria-label="Amount to pay"
        aria-activedescendant={`${id}-${idx}`}
        tabIndex={0}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => {
            const i = Math.max(0, Math.min(amounts.length - 1, Math.round(top / ROW)));
            if (i !== idx) onChange(i);
          });
        }}
        onKeyDown={(e) => {
          const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 3, PageUp: -3 };
          if (e.key in moves) {
            e.preventDefault();
            go(idx + moves[e.key]);
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            go(e.key === "Home" ? 0 : amounts.length - 1);
          }
        }}
        className="relative h-full snap-y snap-mandatory overflow-y-scroll py-[104px] [scrollbar-width:none] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset [&::-webkit-scrollbar]:hidden"
      >
        {amounts.map((a, i) => (
          <div
            key={a}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === idx}
            onClick={() => go(i)}
            className={cn(
              "flex h-[52px] cursor-pointer snap-center items-center justify-center font-mono tabular transition-[color,transform] duration-150",
              i === idx ? "scale-110 text-2xl text-foreground" : "text-lg text-muted-foreground/60",
            )}
          >
            {rupees(a * 100)}
          </div>
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-panel to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-panel to-transparent" />
    </div>
  );
}

/** State (for CGST+SGST vs IGST) and optional business details for the tax invoice. */
export function BillingDetailsForm({
  initial,
  submitLabel,
  onSaved,
  onCancel,
  collapsible = false,
}: {
  initial: Profile;
  submitLabel: string;
  onSaved?: () => void;
  onCancel?: () => void;
  /** Folded behind a summary line (the Profile tab), closed by default. */
  collapsible?: boolean;
}) {
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const uid = useId();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await saveBillingProfileAction({ stateCode: String(f.get("stateCode") ?? ""), legalName: String(f.get("legalName") ?? ""), gstin: String(f.get("gstin") ?? "") });
      if (!r.ok) return setError({ field: r.error.field, message: r.error.message });
      setSaved(true);
      onSaved?.();
    });
  }
  const input = "h-11 w-full rounded-lg border border-input bg-panel-raised px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-danger";
  return (
    <Fold collapsible={collapsible} initial={initial}>
    <form onSubmit={submit} className={cn("flex flex-col gap-4", collapsible ? "border-t p-5" : "rounded-2xl border bg-panel p-5")}>
      {collapsible ? (
        <p className="text-sm text-muted-foreground">Your state decides which GST applies.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Details for your tax invoice</h2>
          <p className="text-sm text-muted-foreground">We ask once. Your state decides which GST applies.</p>
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span>Your state</span>
        <SelectField
          name="stateCode"
          label="Your state"
          placeholder="Pick your state"
          required
          invalid={error?.field === "stateCode"}
          defaultValue={initial?.stateCode}
          options={GST_STATES.map((s) => ({ value: s.code, label: s.name }))}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span>
          Business name <span className="text-muted-foreground">(optional)</span>
        </span>
        <input name="legalName" defaultValue={initial?.legalName ?? ""} maxLength={120} autoComplete="organization" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span>
          GSTIN <span className="text-muted-foreground">(optional, for a business invoice)</span>
        </span>
        <input
          name="gstin"
          defaultValue={initial?.gstin ?? ""}
          maxLength={15}
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="29ABCDE1234F1Z5"
          aria-invalid={error?.field === "gstin"}
          aria-describedby={`${uid}-err`}
          className={cn(input, "font-mono uppercase")}
        />
      </label>
      <p id={`${uid}-err`} role={error ? "alert" : undefined} className={cn("text-sm", error ? "text-danger" : "sr-only")}>
        {error?.message}
      </p>
      {saved && !onSaved && (
        <p role="status" className="text-sm text-success">
          Saved.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={buttonVariants({ size: "lg" })}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonVariants({ size: "lg", variant: "ghost" })}>
            Back
          </button>
        )}
      </div>
    </form>
    </Fold>
  );
}

/** The Profile tab's fold: a summary line (what's saved) that opens the form. */
function Fold({ collapsible, initial, children }: { collapsible: boolean; initial: Profile; children: React.ReactNode }) {
  if (!collapsible) return <>{children}</>;
  const summary = initial ? [stateName(initial.stateCode), initial.legalName, initial.gstin && `GSTIN ${initial.gstin}`].filter(Boolean).join(", ") : "Not set yet";
  return (
    <details className="group rounded-2xl border bg-panel">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-5 select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">Details for your tax invoice</span>
          <span className="truncate text-sm text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      {children}
    </details>
  );
}

/** Stands in for Cashfree's checkout when PAYMENTS_PROVIDER=mock (local testing only). */
function MockCheckout({ amountPaise, credits, confirm, cancel }: { amountPaise: number; credits: number; confirm: () => void; cancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={cancel} aria-labelledby="mock-pay-title" className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-2xl border bg-panel p-6 text-foreground backdrop:bg-black/70">
      <div className="flex flex-col gap-4">
        <span className="self-start rounded border border-warning/40 px-2 py-0.5 text-xs text-warning">Test payment</span>
        <h2 id="mock-pay-title" className="text-lg font-semibold">
          Pay {rupees(amountPaise)}
        </h2>
        <p className="text-sm text-muted-foreground">For {formatCredits(credits)} credits. This is the local mock; no money moves.</p>
        <div className="flex gap-2">
          <button type="button" onClick={confirm} className={cn(buttonVariants({ size: "lg" }), "flex-1")}>
            Pay
          </button>
          <button type="button" onClick={cancel} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "flex-1")}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}

declare global {
  interface Window {
    Cashfree: (o: { mode: "sandbox" | "production" }) => {
      checkout(o: { paymentSessionId: string | null; redirectTarget: "_modal" }): Promise<{ error?: { message?: string }; paymentDetails?: unknown }>;
    };
  }
}

let cashfreeScript: Promise<void> | null = null;
/** Cashfree's checkout script, loaded only when someone pays. */
function loadCashfree(): Promise<void> {
  if (typeof window.Cashfree === "function") return Promise.resolve();
  cashfreeScript ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: "https://sdk.cashfree.com/js/v3/cashfree.js", async: true });
    s.onload = () => resolve();
    s.onerror = () => {
      cashfreeScript = null;
      reject(new Error("checkout script failed"));
    };
    document.head.append(s);
  });
  return cashfreeScript;
}
