import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HindsightGraphEdge, HindsightGraphNode } from "../../lib/auraTypes";

/** A node position in the constellation's user units. */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Colour of a memory per its cognitive layer.
 *
 * Two vocabularies are in play: the daemon reports the raw `fact_type`
 * (`episodic`, `semantic`, ...) while the AuraDesk layer filter uses
 * `world` / `experience` / `observation`. Both are mapped so the legend
 * always matches the colours on screen.
 */
export function factTypeNodeColor(
  factType: string | null | undefined,
  fallback?: string | null
): string {
  const key = (factType ?? "").toLowerCase();
  switch (key) {
    // AuraDesk layer vocabulary.
    case "world":
    case "episodic":
      return "#38bdf8";
    case "experience":
    case "procedural":
      return "#34d399";
    case "observation":
    case "preference":
      return "#fbbf24";
    // Hindsight cognitive-layer vocabulary.
    case "semantic":
      return "#a78bfa";
    case "contextual":
      return "#f472b6";
    default:
      return fallback || "#64748b";
  }
}

/** Human label for a link type, used by the legend. */
export function linkTypeLabel(linkType: string | null | undefined): string {
  const key = (linkType ?? "").toLowerCase();
  switch (key) {
    case "semantic":
      return "semântica";
    case "temporal":
      return "temporal";
    case "entity":
      return "entidade";
    case "caused_by":
      return "causal";
    default:
      return linkType || "—";
  }
}

export interface HindsightGraphViewProps {
  nodes: HindsightGraphNode[];
  edges: HindsightGraphEdge[];
  positions: Record<string, Point2D>;
  width: number;
  height: number;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /** How many labels are shown at once when nothing is hovered or selected. */
  maxPersistentLabels?: number;
}

/**
 * The knowledge graph.
 *
 * It is a dark surface in BOTH themes — like the galaxy, its visual
 * identity does not follow the global UI theme — so the node and edge
 * colours are always read against a deep background.
 *
 * The view supports wheel zoom and pointer drag so a dense graph can
 * actually be explored, sizes the nodes by their degree so hubs stand
 * out, and only keeps labels for what the reader is looking at.
 */
export function HindsightGraphView({
  nodes,
  edges,
  positions,
  width,
  height,
  selectedNodeId,
  onSelectNode,
  maxPersistentLabels = 14,
}: HindsightGraphViewProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: width, h: height });
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  /** Number of links each node takes part in. */
  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of nodes) map.set(node.id, 0);
    for (const edge of edges) {
      if (map.has(edge.source)) map.set(edge.source, (map.get(edge.source) ?? 0) + 1);
      if (map.has(edge.target)) map.set(edge.target, (map.get(edge.target) ?? 0) + 1);
    }
    return map;
  }, [nodes, edges]);

  /** The neighbours of the focused node — they get their label back. */
  const focusIds = useMemo(() => {
    const ids = new Set<string>();
    const focus = hoveredNodeId ?? selectedNodeId;
    if (!focus) return ids;
    ids.add(focus);
    for (const edge of edges) {
      if (edge.source === focus) ids.add(edge.target);
      if (edge.target === focus) ids.add(edge.source);
    }
    return ids;
  }, [edges, hoveredNodeId, selectedNodeId]);

  /**
   * The nodes that keep a visible label: the focused ones plus the
   * best-connected nodes, so the graph stays readable instead of turning
   * into a wall of overlapping text.
   */
  const labelledIds = useMemo(() => {
    const ids = new Set<string>(focusIds);
    if (focusIds.size > 0) return ids;
    const ranked = [...nodes].sort(
      (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
    );
    for (const node of ranked.slice(0, maxPersistentLabels)) ids.add(node.id);
    return ids;
  }, [nodes, degree, focusIds, maxPersistentLabels]);

  const nodeRadius = useCallback(
    (nodeId: string, selected: boolean) => {
      if (selected) return 11;
      const d = degree.get(nodeId) ?? 0;
      return Math.min(13, 5 + Math.sqrt(d) * 1.7);
    },
    [degree]
  );

  const edgeWidth = useCallback((edge: HindsightGraphEdge, highlighted: boolean) => {
    if (highlighted) return 2.4;
    const weight = edge.weight ?? 0;
    return Math.min(3.2, 0.9 + Math.max(0, weight) * 1.6);
  }, []);

  /** Zooms around the pointer so the point under the cursor stays put. */
  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = view.w / rect.width;
      const scaleY = view.h / rect.height;
      const px = (event.clientX - rect.left) * scaleX;
      const py = (event.clientY - rect.top) * scaleY;

      const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
      const nextW = Math.min(width * 3, Math.max(width / 6, view.w * factor));
      const nextH = (nextW / view.w) * view.h;
      setView({
        x: px - ((px - view.x) / view.w) * nextW,
        y: py - ((py - view.y) / view.h) * nextH,
        w: nextW,
        h: nextH,
      });
    },
    [view, width, height]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      svg.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    },
    [view]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      const svg = svgRef.current;
      if (!drag || !svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = view.w / rect.width;
      const scaleY = view.h / rect.height;
      setView((prev) => ({
        ...prev,
        x: drag.vx - (event.clientX - drag.x) * scaleX,
        y: drag.vy - (event.clientY - drag.y) * scaleY,
      }));
    },
    [view]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }, []);

  /** Restores the full view. */
  const resetView = useCallback(() => {
    setView({ x: 0, y: 0, w: width, h: height });
  }, [width, height]);

  const zoomBy = useCallback(
    (factor: number) => {
      setView((prev) => {
        const nextW = Math.min(width * 3, Math.max(width / 6, prev.w * factor));
        const nextH = (nextW / prev.w) * prev.h;
        const cx = prev.x + prev.w / 2;
        const cy = prev.y + prev.h / 2;
        return { x: cx - nextW / 2, y: cy - nextH / 2, w: nextW, h: nextH };
      });
    },
    [width]
  );

  const isZoomed = view.w < width - 1;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        aria-label={t("hindsightPanel.tabs.graph")}
        className="aura-graph-surface h-[460px] w-full touch-none select-none rounded-aura-md border border-aura-border/40"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(event) => {
          // A click on the background clears the selection.
          if (event.target === svgRef.current) onSelectNode(null);
        }}
      >
        {/* Edges */}
        <g>
          {edges.map((edge) => {
            const from = positions[edge.source];
            const to = positions[edge.target];
            if (!from || !to) return null;
            const highlighted =
              focusIds.size > 0 &&
              (edge.source === focusIds.values().next().value ||
                edge.target === focusIds.values().next().value);
            const dimmed = focusIds.size > 0 && !highlighted;
            return (
              <g key={edge.id}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={
                    highlighted
                      ? "rgb(56 189 248)"
                      : edge.color || "rgba(148, 163, 184, 0.45)"
                  }
                  strokeWidth={edgeWidth(edge, highlighted)}
                  strokeOpacity={dimmed ? 0.12 : highlighted ? 0.95 : 0.5}
                  strokeDasharray={edge.lineStyle === "dashed" ? "4 3" : undefined}
                />
                {highlighted && (edge.entityName || edge.linkType) && (
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 5}
                    textAnchor="middle"
                    className="fill-sky-300 text-[10px] font-medium pointer-events-none"
                  >
                    {edge.entityName || linkTypeLabel(edge.linkType)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {nodes.map((node) => {
            const pos = positions[node.id];
            if (!pos) return null;
            const selected = node.id === selectedNodeId;
            const focused = focusIds.has(node.id);
            const dimmed = focusIds.size > 0 && !focused;
            const fill = factTypeNodeColor(node.factType, node.color);
            const radius = nodeRadius(node.id, selected);
            const showLabel = labelledIds.has(node.id);

            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                role="button"
                tabIndex={0}
                aria-label={node.label || node.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(node.id);
                }}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectNode(node.id);
                  }
                }}
                style={{ cursor: "pointer", opacity: dimmed ? 0.25 : 1 }}
              >
                <title>
                  {node.label || node.text || node.id}
                  {node.factType ? ` · ${node.factType}` : ""}
                </title>
                {selected && (
                  <circle
                    r={radius + 5}
                    fill="none"
                    stroke="rgb(56 189 248)"
                    strokeWidth={2}
                    strokeOpacity={0.85}
                  />
                )}
                <circle
                  r={radius}
                  fill={fill}
                  stroke={
                    selected || focused
                      ? "rgb(248 250 252)"
                      : "rgba(15, 23, 42, 0.8)"
                  }
                  strokeWidth={selected ? 2 : 1.2}
                />
                {showLabel && (
                  <text
                    y={radius + 13}
                    textAnchor="middle"
                    className="fill-slate-200 text-[11px] font-medium pointer-events-none"
                    style={{ paintOrder: "stroke", stroke: "rgba(2, 6, 23, 0.75)", strokeWidth: 3 }}
                  >
                    {truncateGraphLabel(node.label || node.text || node.id, 20)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* View controls */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.3)}
          aria-label={t("hindsightPanel.graph.zoomIn")}
          title={t("hindsightPanel.graph.zoomIn")}
          className="h-7 w-7 rounded-full border border-sky-400/25 bg-slate-950/80 text-sm text-sky-200 backdrop-blur-md hover:bg-sky-500/20 transition-colors"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.3)}
          aria-label={t("hindsightPanel.graph.zoomOut")}
          title={t("hindsightPanel.graph.zoomOut")}
          className="h-7 w-7 rounded-full border border-sky-400/25 bg-slate-950/80 text-sm text-sky-200 backdrop-blur-md hover:bg-sky-500/20 transition-colors"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          disabled={!isZoomed}
          aria-label={t("hindsightPanel.graph.resetView")}
          title={t("hindsightPanel.graph.resetView")}
          className="h-7 w-7 rounded-full border border-sky-400/25 bg-slate-950/80 text-[10px] text-sky-200 backdrop-blur-md hover:bg-sky-500/20 transition-colors disabled:opacity-40"
        >
          ⟲
        </button>
      </div>
    </div>
  );
}

/** Shortens a node label for display. */
function truncateGraphLabel(text: string, maxLen = 20): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}
