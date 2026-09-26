"use client";

import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { ProbeView } from "@/lib/health";
import { cn } from "@/lib/utils";
import { StatusMark, TIER_LABEL, type ViewStatus } from "./shared";

// Topology of what the app uses. Loaded with next/dynamic on the health page only.

type Data = { probe: ProbeView; selected: boolean; root?: boolean };

function ProbeNode({ data }: NodeProps<Node<Data>>) {
  const { probe, selected, root } = data;
  return (
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
        {probe.latencyMs !== null && <span className={cn("ml-auto font-mono text-[11px] tabular", root ? "text-primary-foreground/80" : "text-muted-foreground")}>{probe.latencyMs}ms</span>}
      </div>
      <span className={cn("text-[10px] tracking-wide uppercase", root ? "text-primary-foreground/80" : "text-muted-foreground")}>{TIER_LABEL[probe.tier]}</span>
      <Handle type="source" position={Position.Right} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { probe: ProbeNode };

const EDGE_STYLE: Record<ViewStatus, { stroke: string; strokeDasharray?: string }> = {
  up: { stroke: "var(--success)" },
  degraded: { stroke: "var(--warning)" },
  down: { stroke: "var(--accent-red)", strokeDasharray: "5 4" },
  not_configured: { stroke: "var(--muted-foreground)", strokeDasharray: "3 4" },
  unknown: { stroke: "var(--muted-foreground)", strokeDasharray: "3 4" },
};

export default function HealthGraph({ probes, selected, onSelect }: { probes: ProbeView[]; selected: string | null; onSelect: (id: string | null) => void }) {
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
    const nodes: Node<Data>[] = place
      .filter(([id]) => by.has(id))
      .map(([id, x, y, root]) => ({ id, type: "probe", position: { x, y }, data: { probe: by.get(id)!, selected: selected === id, root }, draggable: false }));
    const links: [string, string][] = [
      ["web", "postgres"],
      ["web", "redis"],
      ["web", "queue"],
      ["web", "worker"],
      ["worker", "enginex"],
      ...behind.map((p) => ["enginex", p.id] as [string, string]),
    ];
    const edges: Edge[] = links
      .filter(([s, t]) => by.has(s) && by.has(t))
      .map(([s, t]) => ({ id: `${s}-${t}`, source: s, target: t, style: { strokeWidth: 1.5, ...EDGE_STYLE[by.get(t)!.status as ViewStatus] }, animated: false }));
    const bottom = Math.max(gatewayY + 60, behindTop + behind.length * 72);
    const top = Math.min(0, behindTop);
    return { nodes, edges, height: Math.min(640, Math.max(380, (bottom - top) * 0.75 + 60)) };
  }, [probes, selected]);

  return (
    <div style={{ height }} className="w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
        onPaneClick={() => onSelect(null)}
        style={{ background: "transparent" }}
      >
        <Background color="var(--border)" gap={24} />
      </ReactFlow>
    </div>
  );
}
