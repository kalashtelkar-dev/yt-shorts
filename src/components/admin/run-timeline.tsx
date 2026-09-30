import { Empty } from "@/components/admin/bits";
import { KIND, secs, timelineBars } from "@/components/admin/timeline";
import type { TimelineLane } from "@/server/admin/queries";

const TICKS = [5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800];
const L = 190, W = 640, R = 110, ROW = 22, HEAD = 26, AXIS = 22; // prettier-ignore

export function RunTimeline({ lanes, now }: { lanes: TimelineLane[]; now: number }) {
  const rows = timelineBars(lanes, now);
  if (!rows.length) return <Empty>Step times show up here once the run starts.</Empty>;
  const total = Math.max(...rows.map((r) => r.to));
  const tick = TICKS.find((t) => total / t <= 8) ?? 3600;
  const x = (s: number) => L + (s / (Math.ceil(total / tick) * tick || 1)) * W;
  const height = AXIS + rows.reduce((h, r) => h + HEAD + r.bars.length * ROW, 0) + 6;
  const kinds = [...new Map(rows.flatMap((r) => r.bars).map((b) => [KIND[b.engine].label, KIND[b.engine]])).values()];
  let y = AXIS;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          {kinds.map((k) => (
            <li key={k.label} className="flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden="true">
                <rect width="10" height="10" rx="3" className={k.fill} />
              </svg>
              {k.label}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Start to finish <span className="font-mono text-foreground tabular">{secs(total)}</span>
          {rows.length > 1 && (
            <>
              {" "}
              · runs added up <span className="font-mono text-foreground tabular">{secs(rows.reduce((a, r) => a + r.to - r.from, 0))}</span>
            </>
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        {/* Drawn at its own size (12 px text): it may shrink to the panel, never stretch past it. */}
        <svg viewBox={`0 0 ${L + W + R} ${height}`} className="block h-auto w-full min-w-[720px]" style={{ maxWidth: L + W + R }} role="img" aria-label={`Timeline of every step, ${secs(total)} from start to finish`}>
          {Array.from({ length: Math.ceil(total / tick) + 1 }, (_, i) => i * tick).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={AXIS - 4} y2={height} className="stroke-border" />
              <text x={x(t)} y={12} textAnchor="middle" fontSize={11} className="fill-muted-foreground font-mono">
                {t === 0 ? "0" : tick >= 60 ? `${t / 60} min` : `${t} s`}
              </text>
            </g>
          ))}
          {rows.map((r) => {
            const head = y + HEAD / 2 + 3;
            y += HEAD;
            return (
              <g key={r.name}>
                <text x={0} y={head + 4} fontSize={12} fontWeight={600} className="fill-foreground">
                  {r.name}
                </text>
                <line x1={x(r.from)} x2={x(r.to)} y1={head} y2={head} strokeWidth={2} strokeLinecap="round" className="stroke-muted-foreground" />
                <text x={x(r.to) + 6} y={head + 4} fontSize={11} className="fill-muted-foreground font-mono">
                  {secs(r.to - r.from)}
                </text>
                {r.bars.map((b) => {
                  const top = y;
                  y += ROW;
                  const bx = x(b.start), bw = Math.max(3, x(b.end) - bx); // prettier-ignore
                  const label = `${b.running ? "running · " : ""}${secs(b.end - b.start)}${b.items}`;
                  const right = bx + bw + 8 + label.length * 6.6 < L + W + R;
                  return (
                    <g key={b.step} className="group">
                      <title>{`${b.step} · ${b.engine} · ${label} · starts at ${secs(b.start)}`}</title>
                      <rect x={0} y={top} width={L + W + R} height={ROW} rx={3} className="fill-transparent group-hover:fill-border" />
                      <text x={12} y={top + 15} fontSize={12} className="fill-foreground font-mono">
                        {b.step}
                      </text>
                      <rect x={bx} y={top + 5} width={bw} height={ROW - 10} rx={3} className={`${KIND[b.engine].fill}${b.running ? " opacity-60" : ""}`} />
                      <text x={right ? bx + bw + 6 : bx - 6} y={top + 15} textAnchor={right ? "start" : "end"} fontSize={11} className="fill-muted-foreground font-mono">
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
