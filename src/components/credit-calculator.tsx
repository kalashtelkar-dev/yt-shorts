"use client";

import { useId, useState } from "react";
import { formatCredits } from "@/lib/format";

type Style = { title: string; min: number; max: number };

/** "What ₹X gets you": a slider over top-up amounts, with the credits and how many of each style that makes. */
export function CreditCalculator({ minRupees, maxRupees, paisePerCredit, styles }: { minRupees: number; maxRupees: number; paisePerCredit: number; styles: Style[] }) {
  const [rupees, setRupees] = useState(minRupees);
  const id = useId();
  const credits = Math.floor((rupees * 100) / paisePerCredit);
  const pct = ((rupees - minRupees) / Math.max(1, maxRupees - minRupees)) * 100;
  return (
    <div className="grid gap-5 rounded-2xl border bg-panel p-5 sm:p-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="font-semibold">
            What ₹{formatCredits(rupees)} gets you
          </label>
          <span className="font-mono text-sm tabular">{formatCredits(credits)} credits</span>
        </div>
        <input
          id={id}
          type="range"
          min={minRupees}
          max={maxRupees}
          step={50}
          value={rupees}
          onChange={(e) => setRupees(Number(e.target.value))}
          className="video-range h-7 w-full"
          style={{ "--progress": `${pct}%` } as React.CSSProperties}
        />
        <p className="text-sm text-muted-foreground">1 credit is 1 second of editing. GST included. A montage that fails costs nothing.</p>
      </div>
      <dl className="grid auto-cols-fr grid-flow-col gap-3">
        {styles.map((s) => {
          const lo = Math.floor(credits / s.max);
          const hi = Math.floor(credits / s.min);
          return (
            <div key={s.title} className="flex flex-col gap-0.5">
              <dd className="font-mono text-2xl tabular">{lo === hi ? lo : `${lo}–${hi}`}</dd>
              <dt className="text-xs text-muted-foreground">{s.title}</dt>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
