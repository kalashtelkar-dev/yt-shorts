"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type Step = { label: string; lead: string; rest: string };

const STEP_MS = 3800;

/**
 * Plays the "How it works" story on a loop: sets `data-step` (CSS turns the player's joints and swaps the screens)
 * and `data-playing` (screen animations run only then). It plays only while it's on screen, stays paused once
 * someone presses Pause, and under reduced motion advances as still frames.
 */
export function StoryPlayer({ steps, children }: { steps: Step[]; children: React.ReactNode }) {
  const [step, setStep] = useState(0);
  const [wantPlay, setWantPlay] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const playing = wantPlay && visible;

  useEffect(() => {
    const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAnimate(motion);
    setWantPlay(true);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.4 });
    if (root.current) io.observe(root.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((n) => (n + 1) % steps.length), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step, steps.length]);

  // The scan step counts kills up while it plays; at rest it shows the finished count the server rendered.
  useEffect(() => {
    const el = root.current;
    if (!el || !playing || !animate || step !== 2) return;
    const kills = el.querySelectorAll("[data-kills]");
    const stage = el.querySelectorAll("[data-stage]");
    let k = 0;
    const show = () => {
      kills.forEach((e) => (e.textContent = String(k)));
      stage.forEach((e) => (e.textContent = k < 6 ? "Reading the kill feed" : "Finding your kills"));
    };
    show();
    const t = setInterval(() => {
      k++;
      show();
      if (k >= 12) clearInterval(t);
    }, 260);
    return () => {
      clearInterval(t);
      k = 12;
      show();
    };
  }, [playing, animate, step]);

  const s = steps[step];
  return (
    <div ref={root} className="hiw" data-step={step} data-playing={playing && animate ? "" : undefined}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,128px)] items-end gap-x-3 gap-y-3 overflow-hidden rounded-3xl border bg-panel px-3 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,170px)] sm:px-5 sm:pt-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,210px)_minmax(0,1fr)] md:gap-x-5 md:pt-6">
        {children}
        <div className="col-span-full row-start-1 min-h-[6.75rem] rounded-xl border bg-panel-raised px-3.5 py-3 sm:min-h-[5.75rem] md:col-span-1 md:col-start-3 md:row-start-1 md:min-h-0 md:self-center">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-danger">
              Step {step + 1} of {steps.length}
            </span>
            <button
              type="button"
              onClick={() => setWantPlay(!wantPlay)}
              aria-label={wantPlay ? "Pause the story" : "Play the story"}
              className="-my-1.5 -mr-1.5 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5"
            >
              {wantPlay ? <Pause aria-hidden /> : <Play aria-hidden />}
            </button>
          </div>
          <p aria-live={playing ? "off" : "polite"} className="mt-0.5 text-sm sm:text-[0.95rem]">
            <strong className="font-semibold">{s.lead}</strong> {s.rest}
          </p>
        </div>
      </div>
    </div>
  );
}
