import type { CSSProperties, ReactNode } from "react";
import { StoryPlayer, type Step } from "@/components/story-player";
import { brand } from "@/config/brand";

/**
 * "How it works" on the landing page: a stick-figure player at his desk tells the five steps, and the 9:16 frame
 * beside him shows what's on his screen. All drawing is server-rendered SVG; the player only flips `data-step`,
 * and CSS (globals.css, `.hiw`) turns his joints and swaps the screens. It loops while on screen (see CLAUDE.md §8).
 */
const STEPS: Step[] = [
  { label: "Play", lead: "You had a great match.", rest: "Every kill is in the recording." },
  { label: "Paste", lead: "Paste your match link, type your in-game name and pick a song.", rest: "Then press Make my montage." },
  { label: "Scan", lead: `${brand.name} reads the kill feed`, rest: "and finds every kill with your name on it." },
  { label: "Relax", lead: "It keeps going on our servers.", rest: "Close the tab, grab a drink and come back to the same link." },
  { label: "Post", lead: "Your montage is ready.", rest: "Watch it, download it and post it. You only pay for the seconds of editing." },
];

export function HowItWorks() {
  return (
    <StoryPlayer steps={STEPS}>
      <div className="aspect-[176/222] self-end md:aspect-[336/222]">
        <svg viewBox="60 64 336 222" preserveAspectRatio="xMinYMax slice" aria-hidden className="block size-full">
          <Room />
        </svg>
      </div>
      <div className="aspect-[9/16] w-full self-end overflow-hidden rounded-t-[22px] border border-b-0 border-input bg-background">
        <svg viewBox="0 0 180 320" aria-hidden className="block size-full">
          <defs>
            <linearGradient id="hiw-scan" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent-red)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--accent-red)" stopOpacity=".45" />
            </linearGradient>
          </defs>
          {[Phone0, Phone1, Phone2, Phone3, Phone4].map((S, n) => (
            <g key={n} data-scene={n}>
              <S />
            </g>
          ))}
        </svg>
      </div>
    </StoryPlayer>
  );
}

/* ── The player: a side-view rig with its hip at the origin, facing right. 0° points a limb straight down. ── */

type Joint = "torso" | "head" | "shN" | "shF" | "elN" | "elF" | "hipN" | "hipF" | "knN" | "knF" | "ftN" | "ftF";
type Pose = { at: [number, number] } & Record<Joint, number>;

const BASE: Record<Joint, [number, number]> = {
  torso: [0, 0],
  head: [1, -58],
  shN: [2, -52],
  shF: [0, -52],
  elN: [0, 30],
  elF: [0, 30],
  hipN: [0, 0],
  hipF: [0, 0],
  knN: [0, 40],
  knF: [0, 40],
  ftN: [0, 42],
  ftF: [0, 42],
};
const SEATED = { hipN: -88, knN: 88, ftN: -90, hipF: -82, knF: 84, ftF: -90 };
// One pose per step: typing, pointing at the screen, chin in hand, leaning back with a drink, jumping up.
const POSES: Pose[] = [
  { at: [112, 236], torso: 10, head: -4, shN: -52, elN: -53, shF: -46, elF: -58, ...SEATED },
  { at: [112, 236], torso: 14, head: -10, shN: -110, elN: -12, shF: -46, elF: -58, ...SEATED },
  { at: [112, 236], torso: 24, head: 10, shN: -69, elN: -130, shF: -58, elF: -40, ...SEATED },
  { at: [110, 234], torso: -10, head: -10, shN: -26, elN: -114, shF: 6, elF: -62, hipN: -82, knN: 66, ftN: -74, hipF: -78, knF: 70, ftF: -82 },
  { at: [138, 196], torso: 0, head: -12, shN: -160, elN: -8, shF: -146, elF: -16, hipN: -8, knN: 16, ftN: -90, hipF: 14, knF: 6, ftF: -90 },
];

/** Per-step transforms as CSS variables (--p0…--p4); `.hiw[data-step="n"] [data-j]` picks one. */
function poseVars(transform: (p: Pose) => string): CSSProperties {
  return Object.fromEntries(POSES.map((p, n) => [`--p${n}`, transform(p)])) as CSSProperties;
}
const jointVars = (j: Joint) => poseVars((p) => `translate(${BASE[j][0]}px, ${BASE[j][1]}px) rotate(${p[j]}deg)`);

function J({ j, children }: { j: Joint; children: ReactNode }) {
  return (
    <g data-j style={jointVars(j)}>
      {children}
    </g>
  );
}

const limb = (len: number, far: boolean) => (
  <path d={`M0 0 V${len}`} fill="none" strokeWidth={5} strokeLinecap="round" className={far ? "stroke-muted-foreground" : "stroke-foreground"} />
);

function Arm({ far }: { far?: boolean }) {
  const s = far ? "F" : "N";
  return (
    <J j={`sh${s}`}>
      {limb(30, !!far)}
      <J j={`el${s}`}>
        <g className={far ? "hiw-tap-far" : "hiw-tap"}>
          {limb(28, !!far)}
          <circle cy={29} r={4} className={far ? "fill-muted-foreground" : "fill-foreground"} />
        </g>
        {!far && (
          // The drink for step 4, held level whatever the arm is doing.
          <g data-j className="hiw-mug" style={poseVars((p) => `translate(0px, 29px) rotate(${-(p.torso + p.shN + p.elN)}deg)`)}>
            <rect x={-1} y={-11} width={12} height={13} rx={2} strokeWidth={2} className="fill-panel-raised stroke-foreground" />
            <path d="M11 -8 q5 0 5 4 q0 4 -5 4" fill="none" strokeWidth={2} className="stroke-foreground" />
            <path d="M3 -15 q3 -4 0 -8" fill="none" strokeWidth={2} strokeLinecap="round" className="hiw-steam stroke-foreground" />
            <path d="M8 -15 q3 -4 0 -8" fill="none" strokeWidth={2} strokeLinecap="round" className="hiw-steam stroke-foreground [animation-delay:.6s]" />
          </g>
        )}
      </J>
    </J>
  );
}

function Leg({ far }: { far?: boolean }) {
  const s = far ? "F" : "N";
  return (
    <J j={`hip${s}`}>
      {limb(40, !!far)}
      <J j={`kn${s}`}>
        {limb(42, !!far)}
        <J j={`ft${s}`}>
          <path d="M0 0 V13" fill="none" strokeWidth={6.5} strokeLinecap="round" className={far ? "stroke-muted-foreground" : "stroke-foreground"} />
        </J>
      </J>
    </J>
  );
}

function Player() {
  return (
    <g className="hiw-jump">
      <g data-j style={poseVars((p) => `translate(${p.at[0]}px, ${p.at[1]}px)`)}>
        <Leg far />
        <J j="torso">
          <Arm far />
          <path d="M0 0 C4 -18 5 -38 1 -56" fill="none" strokeWidth={10} strokeLinecap="round" className="stroke-foreground" />
          <J j="head">
            <path d="M0 0 V-8" strokeWidth={4.5} strokeLinecap="round" className="stroke-foreground" />
            <ellipse cx={3} cy={-21} rx={12.5} ry={14} strokeWidth={4} className="fill-background stroke-foreground" />
            <path d="M15 -23 l3.5 4.5 l-3.5 1" fill="none" strokeWidth={2.5} strokeLinejoin="round" className="stroke-foreground" />
            <circle cx={10} cy={-24} r={1.7} className="fill-foreground" />
            {/* Headset: band, ear cup, mic */}
            <path d="M-10 -24 a13.5 14 0 0 1 25 -6" fill="none" strokeWidth={3} strokeLinecap="round" className="stroke-foreground" />
            <rect x={-7} y={-27} width={8} height={12} rx={3} className="fill-danger" />
            <path d="M1 -17 q6 9 15 6" fill="none" strokeWidth={2} strokeLinecap="round" className="stroke-muted-foreground" />
            <circle cx={16} cy={-11} r={2} className="fill-danger" />
          </J>
          <Arm />
        </J>
        <Leg />
      </g>
    </g>
  );
}

/* ── The room: gaming chair, desk, monitor, keyboard, mouse, PC. Floor at y=280, desk top at y=210. ── */

function Room() {
  const metal = { fill: "var(--panel-raised)", stroke: "var(--metal)", strokeWidth: 2 };
  const bar = { fill: "none", stroke: "var(--metal)", strokeWidth: 3, strokeLinecap: "round" as const };
  return (
    <>
      <path d="M0 280 H460" strokeWidth={2} className="stroke-input" />
      {/* Chair */}
      <path d="M88 244 L74 146 Q72 126 88 124 L98 124 Q112 126 108 146 L104 244Z" {...metal} />
      <path d="M90 150 L98 236" strokeWidth={3} strokeLinecap="round" className="stroke-danger" />
      <rect x={74} y={112} width={30} height={18} rx={8} {...metal} />
      <rect x={80} y={239} width={66} height={10} rx={5} {...metal} />
      <path d="M112 249 V264 M86 270 H140 M100 216 H136 M126 216 V239" {...bar} />
      <circle cx={88} cy={274} r={4} {...metal} />
      <circle cx={138} cy={274} r={4} {...metal} />
      {/* Desk and PC */}
      <rect x={150} y={210} width={242} height={7} rx={2} {...metal} />
      <path d="M378 217 V280" {...bar} />
      <rect x={328} y={222} width={40} height={58} rx={4} {...metal} />
      <path d="M334 230 V272" strokeWidth={2.5} strokeLinecap="round" className="hiw-rgb stroke-danger" />
      <circle cx={352} cy={246} r={9} fill="none" stroke="var(--metal)" strokeWidth={2} />
      <path d="M152 220 H322" strokeWidth={1.5} className="hiw-rgb stroke-danger opacity-35" />
      {/* Monitor, turned a little towards the player */}
      <path d="M306 178 V209" {...bar} />
      <ellipse cx={306} cy={209} rx={16} ry={2.5} fill="var(--metal)" />
      <g transform="translate(246 108) skewY(-5) scale(.9 1)">
        <rect x={-4} y={-4} width={132} height={80} rx={5} strokeWidth={2} stroke="var(--metal)" className="fill-background" />
        <svg width={124} height={70} viewBox="0 0 320 180">
          {[Monitor0, Monitor1, Monitor2, Monitor3, Monitor4].map((S, n) => (
            <g key={n} data-scene={n}>
              <S />
            </g>
          ))}
        </svg>
      </g>
      {/* Keyboard and mouse */}
      <path d="M160 210 L166 204 H206 L202 210Z" fill="var(--metal)" />
      <path d="M168 206 H200" strokeWidth={1.5} strokeDasharray="3 1.5" className="stroke-input" />
      <ellipse cx={220} cy={208} rx={6} ry={3} fill="var(--metal)" />
      <Player />
    </>
  );
}

/* ── The 9:16 frame: what's on his screen at each step (180×320) ── */

function Hills() {
  return (
    <>
      <rect width={180} height={320} className="fill-panel" />
      <path d="M0 210 L40 170 L70 190 L110 140 L150 180 L180 160 V320 H0Z" className="fill-panel-raised" />
      <path d="M0 250 L60 230 L120 245 L180 225 V320 H0Z" className="fill-border" />
    </>
  );
}

function KillFeed({ x, y, size }: { x: number; y: number; size: number }) {
  const h = size * 1.75;
  return ["Viper", "Jett", "Sage"].map((enemy, n) => (
    <g key={enemy} className="hiw-feed-row" style={{ animationDelay: `${0.5 + n * 0.8}s` }}>
      <rect x={x} y={y + n * (h + 4)} width={size * 11} height={h} rx={3} strokeWidth={n === 2 ? 1 : 0} className="fill-background/60 stroke-danger" />
      <text x={x + size * 0.7} y={y + n * (h + 4) + h * 0.72} fontSize={size} fontWeight={600} className="fill-foreground">
        nova
      </text>
      <text x={x + size * 4} y={y + n * (h + 4) + h * 0.72} fontSize={size} className="fill-danger">
        ▸
      </text>
      <text x={x + size * 5.2} y={y + n * (h + 4) + h * 0.72} fontSize={size} className="fill-muted-foreground">
        {enemy}
      </text>
    </g>
  ));
}

function Phone0() {
  return (
    <>
      <Hills />
      <KillFeed x={74} y={14} size={9} />
      <path d="M90 150 v-8 M90 166 v8 M82 158 h-8 M98 158 h8" strokeWidth={2} strokeLinecap="round" className="stroke-foreground" />
      <text x={90} y={230} fontSize={12} fontWeight={800} textAnchor="middle" className="fill-success">
        Round won
      </text>
      <text x={12} y={290} fontSize={8} className="fill-muted-foreground">
        Health
      </text>
      <text x={12} y={304} fontSize={14} className="fill-foreground font-mono">
        100
      </text>
      <text x={168} y={304} fontSize={14} textAnchor="end" className="fill-foreground font-mono">
        24/90
      </text>
    </>
  );
}

function Phone1() {
  const rows: [string, string][] = [
    ["Match", "youtube.com/watch?v=k1ll"],
    ["Your in-game name", "nova"],
    ["Song (YouTube link)", "youtu.be/phonk-mix"],
  ];
  return (
    <>
      <rect width={180} height={320} className="fill-background" />
      <text x={16} y={44} fontSize={15} fontWeight={800} className="fill-foreground">
        Make a montage
      </text>
      <rect x={8} y={64} width={164} height={128} rx={12} className="fill-panel stroke-border" />
      {rows.map(([label, value], n) => {
        const y = 82 + n * 40;
        return (
          <g key={label}>
            <text x={16} y={y} fontSize={8} className="fill-muted-foreground">
              {label}
            </text>
            <text x={16} y={y + 16} fontSize={10.5} className="fill-foreground">
              {value}
            </text>
            {/* Typing: a cover that shrinks off the value */}
            <rect x={14} y={y + 5} width={152} height={15} className="hiw-typed fill-panel" style={{ animationDelay: `${0.3 + n * 0.8}s` }} />
            {n < 2 && <path d={`M16 ${y + 24} H164`} className="stroke-border" />}
          </g>
        );
      })}
      <g className="hiw-press [animation-delay:.6s]">
        <rect x={8} y={206} width={164} height={34} rx={9} className="fill-primary" />
        <text x={90} y={227} fontSize={11.5} fontWeight={600} textAnchor="middle" className="fill-primary-foreground">
          Make my montage
        </text>
      </g>
    </>
  );
}

function Phone2() {
  return (
    <>
      <Hills />
      <rect width={180} height={110} fill="url(#hiw-scan)" className="hiw-scan" />
      <rect x={72} y={12} width={102} height={58} rx={4} fill="none" strokeDasharray="4 3" className="stroke-danger" />
      <rect y={238} width={180} height={82} className="fill-panel" />
      <circle cx={16} cy={258} r={3.5} className="hiw-live fill-danger" />
      <text x={26} y={261} fontSize={10} className="fill-foreground" data-stage>
        Finding your kills
      </text>
      <text x={16} y={290} fontSize={8} className="fill-muted-foreground">
        Kills found
      </text>
      <text x={16} y={308} fontSize={18} className="fill-foreground font-mono" data-kills>
        12
      </text>
    </>
  );
}

function Phone3() {
  return (
    <>
      <rect width={180} height={320} className="fill-background" />
      <rect x={8} y={40} width={164} height={230} rx={12} className="fill-panel stroke-border" />
      <rect x={22} y={56} width={136} height={120} rx={6} className="fill-panel-raised" />
      <path d="M78 104 l26 12 l-26 12z" className="fill-input" />
      <circle cx={26} cy={198} r={3.5} className="hiw-live fill-danger" />
      <text x={36} y={201} fontSize={10} className="fill-foreground">
        Rendering your montage
      </text>
      <rect x={22} y={212} width={136} height={5} rx={2.5} className="fill-input" />
      <rect x={22} y={212} width={136} height={5} rx={2.5} className="hiw-fill fill-danger" />
      <text x={22} y={238} fontSize={8.5} className="fill-muted-foreground">
        You can close this tab.
      </text>
      <text x={22} y={251} fontSize={8.5} className="fill-muted-foreground">
        We&apos;ll keep going.
      </text>
    </>
  );
}

function Phone4() {
  return (
    <>
      <rect width={180} height={320} className="fill-background" />
      <rect x={20} y={14} width={140} height={226} rx={12} className="fill-panel-raised stroke-border" />
      <path d="M20 170 L60 130 L90 150 L120 110 L160 150 V240 H20Z" className="fill-border" />
      <text x={90} y={50} fontSize={16} fontWeight={900} textAnchor="middle" className="fill-foreground">
        12 kills
      </text>
      <circle cx={90} cy={120} r={20} className="fill-background/50" />
      <path d="M84 110 l18 10 l-18 10z" className="fill-foreground" />
      <text x={28} y={232} fontSize={9} className="fill-foreground font-mono">
        0:30
      </text>
      <g className="hiw-appear [animation-delay:.8s]">
        <rect x={20} y={252} width={140} height={32} rx={9} className="fill-primary" />
        <text x={90} y={272} fontSize={11.5} fontWeight={600} textAnchor="middle" className="fill-primary-foreground">
          Download
        </text>
      </g>
      <text x={90} y={302} fontSize={8.5} textAnchor="middle" className="fill-muted-foreground">
        Also saved in My videos
      </text>
    </>
  );
}

/* ── His monitor (320×180): the game, then the desktop site as simple blocks (too small to read anyway) ── */

function Monitor0() {
  return (
    <>
      <rect width={320} height={180} className="fill-panel" />
      <path d="M0 110 L50 80 L95 98 L150 62 L210 92 L260 70 L320 88 V180 H0Z" className="fill-panel-raised" />
      <path d="M0 140 L90 124 L170 136 L250 120 L320 130 V180 H0Z" className="fill-border" />
      <path d="M222 180 L250 132 L300 124 L320 136 V180Z" className="fill-input" />
      <KillFeed x={214} y={10} size={8} />
      <path d="M160 84 v-6 M160 96 v6 M154 90 h-6 M166 90 h6" strokeWidth={2} strokeLinecap="round" className="stroke-foreground" />
      <text x={10} y={170} fontSize={12} className="fill-foreground font-mono">
        100
      </text>
    </>
  );
}

/** The desktop layout: logo bar, the 9:16 preview on the left, `panel` on the right. */
function Desktop({ preview, children }: { preview?: ReactNode; children: ReactNode }) {
  return (
    <>
      <rect width={320} height={180} className="fill-background" />
      <rect width={320} height={14} className="fill-panel" />
      <rect x={8} y={4} width={6} height={6} rx={1} fill="var(--brand-logo)" />
      <rect x={18} y={5} width={34} height={4} rx={2} className="fill-foreground" />
      <svg x={12} y={24} width={86} height={148} viewBox="0 0 180 320" preserveAspectRatio="xMidYMid slice">
        <Hills />
        {preview}
      </svg>
      <rect x={12} y={24} width={86} height={148} rx={7} fill="none" className="stroke-border" />
      {children}
    </>
  );
}

const block = (x: number, y: number, w: number, h: number, cls: string) => <rect x={x} y={y} width={w} height={h} rx={Math.min(h / 2, 5)} className={cls} />;

function Monitor1() {
  return (
    <Desktop>
      {block(114, 28, 120, 10, "fill-foreground")}
      <rect x={114} y={48} width={192} height={88} rx={8} className="fill-panel stroke-border" />
      {[0, 1, 2].map((n) => (
        <g key={n}>
          {block(124, 60 + n * 26, 40, 5, "fill-muted-foreground")}
          {block(124, 70 + n * 26, 110 - n * 30, 6, "fill-foreground")}
        </g>
      ))}
      <g className="hiw-press [animation-delay:.6s]">{block(114, 146, 192, 22, "fill-primary")}</g>
    </Desktop>
  );
}

function Monitor2() {
  return (
    <Desktop preview={<rect width={180} height={110} fill="url(#hiw-scan)" className="hiw-scan" />}>
      <circle cx={118} cy={33} r={4} className="hiw-live fill-danger" />
      {block(128, 29, 110, 8, "fill-foreground")}
      <text x={114} y={88} fontSize={36} className="fill-foreground font-mono" data-kills>
        12
      </text>
      {[0, 1, 2, 3].map((n) => (
        <g key={n}>
          <circle cx={118} cy={112 + n * 15} r={3} className={n < 2 ? "fill-success" : "fill-input"} />
          {block(126, 109 + n * 15, 90, 6, n < 2 ? "fill-foreground" : "fill-input")}
        </g>
      ))}
    </Desktop>
  );
}

function Monitor3() {
  return (
    <Desktop preview={<path d="M80 146 l26 14 l-26 14z" className="fill-muted-foreground" />}>
      <circle cx={118} cy={33} r={4} className="hiw-live fill-danger" />
      {block(128, 29, 130, 8, "fill-foreground")}
      <rect x={114} y={52} width={192} height={6} rx={3} className="fill-input" />
      <rect x={114} y={52} width={192} height={6} rx={3} className="hiw-fill fill-danger" />
      {block(114, 70, 150, 5, "fill-muted-foreground")}
    </Desktop>
  );
}

function Monitor4() {
  return (
    <Desktop
      preview={
        <>
          <circle cx={90} cy={160} r={26} className="fill-background/50" />
          <path d="M82 146 l24 14 l-24 14z" className="fill-foreground" />
        </>
      }
    >
      {block(114, 28, 150, 11, "fill-foreground")}
      <text x={114} y={82} fontSize={26} className="fill-foreground font-mono">
        12
      </text>
      <text x={168} y={82} fontSize={26} className="fill-foreground font-mono">
        0:30
      </text>
      <g className="hiw-appear [animation-delay:.8s]">{block(114, 100, 120, 24, "fill-primary")}</g>
    </Desktop>
  );
}
