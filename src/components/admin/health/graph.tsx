"use client";

import {
  Background,
  BaseEdge,
  getBezierPath,
  Handle,
  NodeToolbar,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import type { ProbeView } from "@/lib/health";
import { formatTime } from "@/lib/format";
import { formatPct } from "@/lib/uptime";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, StatusMark, TIER_LABEL, type ViewStatus } from "./shared";

// Topology of what the app uses. Loaded with next/dynamic on the health page only.

type NodeData = { probe: ProbeView; selected: boolean; hovered: boolean; root?: boolean; rangeLabel: string; below: boolean };
type EdgeData = { status: ViewStatus; offset: number };

function ProbeNode({ data }: NodeProps<Node<NodeData>>) {
  const { probe, selected, hovered, root, rangeLabel, below } = data;
  return (
    <>
      <NodeToolbar isVisible={hovered} position={below ? Position.Bottom : Position.Top} offset={8}>
        <div className="w-60 rounded-md border bg-popover p-3 text-xs shadow-lg">
          <p className="flex items-center gap-2 text-sm font-medium">
            <StatusMark status={probe.status as ViewStatus} />
            {probe.name}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Status</dt>
            <dd>{STATUS_LABEL[probe.status as ViewStatus]}</dd>
            {probe.latencyMs !== null && (
              <>
                <dt className="text-muted-foreground">Latency</dt>
                <dd className="font-mono tabular">{probe.latencyMs} ms</dd>
              </>
            )}
            <dt className="text-muted-foreground">Uptime</dt>
            <dd className="font-mono tabular">
              {formatPct(probe.uptime)} <span className="font-sans text-muted-foreground">· {rangeLabel}</span>
            </dd>
            <dt className="text-muted-foreground">Checked</dt>
            <dd className="font-mono tabular">{probe.checkedAt ? formatTime(probe.checkedAt) : "never"}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>
              {TIER_LABEL[probe.tier]}
              {probe.critical ? " · critical" : ""}
            </dd>
          </dl>
          {probe.message && <p className="mt-2 rounded bg-background p-1.5 font-mono break-words text-muted-foreground">{probe.message}</p>}
          <p className="mt-2 text-muted-foreground">Click for recent checks</p>
        </div>
      </NodeToolbar>
      <div
        className={cn(
          "flex w-[184px] cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors",
          root ? "border-primary bg-primary text-primary-foreground" : "bg-panel hover:bg-panel-raised",
          probe.status === "down" && !root && "border-danger/70",
          selected && "ring-2 ring-ring/60",
        )}
      >
        <Handle type="target" position={Position.Left} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-muted-foreground" />
        <div className="flex items-center gap-2">
          {!root && <StatusMark status={probe.status as ViewStatus} />}
          <span className="truncate text-[13px] font-medium">{probe.name}</span>
          {probe.latencyMs !== null && (
            <span className={cn("ml-auto font-mono text-[11px] tabular", root ? "text-primary-foreground/80" : "text-muted-foreground")}>{probe.latencyMs}ms</span>
          )}
        </div>
        <span className={cn("text-[10px] tracking-wide uppercase", root ? "text-primary-foreground/80" : "text-muted-foreground")}>{TIER_LABEL[probe.tier]}</span>
        <Handle type="source" position={Position.Right} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-muted-foreground" />
      </div>
    </>
  );
}

const STROKE: Record<ViewStatus, string> = {
  up: "var(--success)",
  degraded: "var(--warning)",
  down: "var(--accent-red)",
  not_configured: "var(--muted-foreground)",
  unknown: "var(--muted-foreground)",
};

/** Edge with packets drifting from source to target: steady when healthy, slow when degraded, none when broken. */
function PacketEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<EdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const status = data?.status ?? "unknown";
  const flowing = status === "up" || status === "degraded";
  const dur = status === "degraded" ? 7 : 3.6;
  const begin = (data?.offset ?? 0) * dur;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: STROKE[status], strokeWidth: 1.5, strokeDasharray: flowing ? undefined : status === "down" ? "5 4" : "3 4", opacity: flowing ? 0.85 : 1 }}
      />
      {flowing &&
        [0, 0.5].map((k) => (
          <circle key={k} r={2.4} fill={STROKE[status]} className="motion-reduce:hidden">
            <animateMotion dur={`${dur}s`} begin={`-${(begin + k * dur).toFixed(2)}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
    </>
  );
}

const nodeTypes = { probe: ProbeNode };
const edgeTypes = { packet: PacketEdge };

export default function HealthGraph({
  probes,
  selected,
  onSelect,
  rangeLabel,
}: {
  probes: ProbeView[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  rangeLabel: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const { nodes, edges, height } = useMemo(() => {
    const by = new Map(probes.map((p) => [p.id, p]));
    const engines = probes.filter((p) => p.tier === "workers");
    // Four columns, left to right: the app → what it talks to → the Engine X gateway → what's behind it.
    const col = { a: 0, b: 224, c: 448, d: 672 };
    const behind = [by.get("storage"), ...engines].filter((p): p is ProbeView => !!p);
    const gatewayY = 300;
    const behindTop = gatewayY - ((behind.length - 1) * 72) / 2;
    const place: [string, number, number, boolean?][] = [
      ["web", col.a, 150, true],
      ["postgres", col.b, 0],
      ["redis", col.b, 72],
      ["queue", col.b, 144],
      ["worker", col.b, gatewayY],
      ["enginex", col.c, gatewayY],
      ...behind.map((p, i) => [p.id, col.d, behindTop + i * 72] as [string, number, number]),
    ];
    const nodes: Node<NodeData>[] = place
      .filter(([id]) => by.has(id))
      .map(([id, x, y, root]) => ({
        id,
        type: "probe",
        position: { x, y },
        // Cards open below nodes near the top so the graph edge doesn't clip them.
        data: { probe: by.get(id)!, selected: selected === id, hovered: hovered === id, root, rangeLabel, below: y - Math.min(0, behindTop) < 220 },
        draggable: false,
      }));
    const links: [string, string][] = [
      ["web", "postgres"],
      ["web", "redis"],
      ["web", "queue"],
      ["web", "worker"],
      ["worker", "enginex"],
      ...behind.map((p) => ["enginex", p.id] as [string, string]),
    ];
    const edges: Edge<EdgeData>[] = links
      .filter(([s, t]) => by.has(s) && by.has(t))
      .map(([s, t], i) => ({ id: `${s}-${t}`, source: s, target: t, type: "packet", data: { status: by.get(t)!.status as ViewStatus, offset: (i * 0.37) % 1 } }));
    const bottom = Math.max(gatewayY + 60, behindTop + behind.length * 72);
    const top = Math.min(0, behindTop);
    return { nodes, edges, height: Math.min(640, Math.max(380, (bottom - top) * 0.75 + 60)) };
  }, [probes, selected, hovered, rangeLabel]);

  return (
    <div style={{ height }} className="w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.06, maxZoom: 1.1 }}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => onSelect(n.id === selected ? null : n.id)}
        onNodeMouseEnter={(_, n) => setHovered(n.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onPaneClick={() => onSelect(null)}
        style={{ background: "transparent" }}
      >
        <Background color="var(--border)" gap={24} />
      </ReactFlow>
    </div>
  );
}
