import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Box,
  Brain,
  Cpu,
  Database,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Layers,
  Maximize2,
  Minimize2,
  Orbit,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Triangle,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  hindsightApi,
  raglightApi,
  type AiProviderStatus,
  type HindsightGalaxyGlobe,
  type HindsightGalaxyLink,
  type HindsightGalaxySnapshot,
  type HindsightRecallItem,
  type HindsightStatus,
  type RaglightStatus,
} from "../lib/ipc";
import { AuraSpaceBackdrop } from "./AuraSpaceBackdrop";
import { MemoryGlobeInspector, type ConnectedGalaxyGlobe } from "./MemoryGlobeInspector";
import { Badge, Button } from "./ui";

export interface AuraPyramidStationProps {
  aiStatus: AiProviderStatus | null;
  hindsightStatus: HindsightStatus | null;
  raglightStatus: RaglightStatus | null;
  memories?: HindsightRecallItem[];
  galaxySnapshot?: HindsightGalaxySnapshot | null;
  focusedMemoryId?: string | null;
  onFocusedMemoryHandled?: () => void;
  onOpenHindsightBank?: (bankId: string) => void;
  creatingMemoryIds?: string[];
  activeMemoryIds?: string[];
  activePulseTick?: number;
  speaking?: boolean;
  listening?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onOpenSettings?: () => void;
}

/**
 * The galaxy owns its visual identity: it always renders in its deep-space
 * palette, in BOTH the light and the dark UI theme. This is the single
 * decision point every cosmic drawing routine reads — flipping it to `true`
 * would make the whole cosmos follow the light palette again.
 */
const GALAXY_LIGHT = false;

type Rgb = readonly [number, number, number];

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface ProjectedPoint {
  sx: number;
  sy: number;
  depth: number;
  scale: number;
  view: Vec3;
}

interface RingSpec {
  radius: number;
  tiltX: number;
  tiltZ: number;
  speed: number;
}

interface BankPalette {
  rgb: Rgb;
  hex: string;
  pillClass: string;
}

type GraphNode =
  | {
      kind: "apex";
      id: string;
      orbitPos: Vec3;
      graphPos: Vec3;
      rgb: Rgb;
      radiusBase: number;
      showInCollapsed: boolean;
    }
  | {
      kind: "bank";
      id: string;
      bank: string;
      memoryCount: number;
      orbitRingIndex: number;
      orbitPhase: number;
      bobOffset: number;
      graphPos: Vec3;
      rgb: Rgb;
      pillClass: string;
      radiusBase: number;
      showInCollapsed: boolean;
    }
  | {
      kind: "memory";
      id: string;
      bank: string;
      bankHubId: string;
      title?: string;
      content: string;
      source: string;
      createdAt?: string | null;
      factType?: string | null;
      context?: string | null;
      documentId?: string | null;
      entities?: string[];
      tags?: string[];
      degree?: number;
      isFallback: boolean;
      orbitRingIndex: number;
      orbitPhase: number;
      bobOffset: number;
      graphPos: Vec3;
      rgb: Rgb;
      pillClass: string;
      radiusBase: number;
      showInCollapsed: boolean;
    }
  | {
      kind: "raglight-hub";
      id: string;
      folderCount: number;
      orbitPhase: number;
      bobOffset: number;
      graphPos: Vec3;
      rgb: Rgb;
      radiusBase: number;
      showInCollapsed: boolean;
    }
  | {
      kind: "raglight";
      id: string;
      folder: string;
      isFallback: boolean;
      orbitPhase: number;
      spinOffset: number;
      bobOffset: number;
      graphPos: Vec3;
      rgb: Rgb;
      radiusBase: number;
      showInCollapsed: boolean;
    };

type EdgeKind = "apex-hub" | "hub-leaf" | "hub-hub" | "cross-link" | "rag-bridge";
type MemorySignalMode = "creating" | "using";

interface ExplosionEffect {
  active: boolean;
  progress: number;
  sparks: Array<{ dir: Vec3; speed: number; size: number }>;
}

interface GraphEdge {
  key: string;
  fromId: string;
  toId: string;
  kind: EdgeKind;
  rgb: Rgb;
}

interface ClusterSector {
  hubId: string;
  label: string;
  centerPos: Vec3;
  normalDir: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  radius: number;
  rgb: Rgb;
}

interface GraphTopology {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: ClusterSector[];
  nodeMap: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
}

interface PreparedNode {
  node: GraphNode;
  world: Vec3;
  view: Vec3;
  proj: ProjectedPoint;
  radiusPx: number;
  alphaScale: number;
}

interface ProjectedHit {
  id: string;
  sx: number;
  sy: number;
  radiusPx: number;
  depth: number;
}

interface EnergyPulse {
  edgeKey: string;
  fromId: string;
  toId: string;
  progress: number;
  speed: number;
  rgb: Rgb;
  hop: number;
}

interface Shockwave {
  nodeId: string;
  progress: number;
  rgb: Rgb;
}

interface SceneSnapshot {
  aiOnline: boolean;
  hindsightOnline: boolean;
  ragRunning: boolean;
  ragReady: boolean;
  speaking: boolean;
  listening: boolean;
  expanded: boolean;
  enable4d: boolean;
  activePulseTick: number;
  activeNodeId: string | null;
  topology: GraphTopology;
}

const DEFAULT_YAW = 0.58;
const DEFAULT_PITCH = 0.36;
const MIN_PITCH = -1.15;
const MAX_PITCH = 1.2;
const DEFAULT_ZOOM = 1.0;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.4;
const CAM_DIST = 5.85;
const BASE_HALF = 0.72;
const BASE_Y = -0.54;
const APEX_Y = 0.86;
const PYRAMID_RADIUS = BASE_HALF * Math.SQRT2;
const MAX_ORBIT_MEMORIES = 48;
const MAX_RAGLIGHT_NODES = 16;
const MAX_ACTIVE_PULSES = 68;
const MAX_ACTIVE_SHOCKWAVES = 24;

const RAGLIGHT_RING: RingSpec = {
  radius: Math.max(1.58, PYRAMID_RADIUS * 1.55),
  tiltX: -0.22,
  tiltZ: 0.28,
  speed: -0.18,
};

const HINDSIGHT_RINGS: readonly RingSpec[] = [
  { radius: Math.max(1.88, PYRAMID_RADIUS * 1.84), tiltX: 0.24, tiltZ: -0.18, speed: 0.14 },
  { radius: Math.max(2.12, PYRAMID_RADIUS * 2.08), tiltX: -0.18, tiltZ: -0.28, speed: 0.1 },
  { radius: Math.max(2.34, PYRAMID_RADIUS * 2.28), tiltX: 0.14, tiltZ: 0.24, speed: -0.08 },
];

const PENTACHORON_VERTICES: readonly Vec4[] = [
  { x: 0, y: 0.5, z: 0, w: 0.24 },
  { x: 0, y: -0.28, z: 0.38, w: -0.18 },
  { x: -0.34, y: -0.28, z: -0.2, w: -0.18 },
  { x: 0.34, y: -0.28, z: -0.2, w: -0.18 },
  { x: 0, y: 0.04, z: 0, w: -0.46 },
];

const PENTACHORON_EDGES: readonly [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 3],
  [2, 4],
  [3, 4],
];

const OCTAHEDRON_FACES: readonly [number, number, number][] = [
  [0, 2, 4],
  [0, 4, 3],
  [0, 3, 5],
  [0, 5, 2],
  [1, 4, 2],
  [1, 3, 4],
  [1, 5, 3],
  [1, 2, 5],
];

// All 10 triangular faces of the 4D Pentachoron (5-cell simplex)
const PENTACHORON_FACES: readonly [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 1],
  [0, 1, 4],
  [0, 2, 4],
  [0, 3, 4],
  [1, 2, 4],
  [2, 3, 4],
  [3, 1, 4],
  [1, 2, 3],
];

// Unified vivid cyber-cyan palette (monochromatic high-contrast luminance shades)
const CYAN_RGB: Rgb = [0, 232, 255];
const INDIGO_RGB: Rgb = [14, 185, 255];
const EMERALD_RGB: Rgb = [64, 244, 255];
const EMERALD_CORE_RGB: Rgb = [0, 196, 235];
const ICE_RGB: Rgb = [212, 250, 255];

const BANK_PALETTES: readonly BankPalette[] = [
  {
    rgb: [0, 232, 255],
    hex: "#00e8ff",
    pillClass: "border-cyan-400/45 bg-cyan-500/15 text-cyan-200",
  },
  {
    rgb: [28, 214, 255],
    hex: "#1cd6ff",
    pillClass: "border-cyan-400/45 bg-cyan-500/15 text-cyan-200",
  },
  {
    rgb: [0, 194, 255],
    hex: "#00c2ff",
    pillClass: "border-sky-400/45 bg-sky-500/15 text-sky-200",
  },
  {
    rgb: [88, 242, 255],
    hex: "#58f2ff",
    pillClass: "border-cyan-300/45 bg-cyan-400/15 text-cyan-100",
  },
  {
    rgb: [14, 172, 245],
    hex: "#0eacf5",
    pillClass: "border-sky-400/45 bg-sky-500/15 text-sky-200",
  },
];

const STAR_FIELD = Array.from({ length: 30 }, (_, i) => {
  const s1 = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const s2 = Math.sin((i + 1) * 78.233) * 19341.1234;
  return {
    nx: s1 - Math.floor(s1),
    ny: s2 - Math.floor(s2),
    size: i % 5 === 0 ? 1.5 : 1.0,
    phase: i * 0.9,
  };
});

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getBankPalette(bank: string): BankPalette {
  const idx = hashString(bank || "default") % BANK_PALETTES.length;
  return BANK_PALETTES[idx];
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function rotateView(v: Vec3, yaw: number, pitch: number): Vec3 {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const x1 = v.x * cosY + v.z * sinY;
  const z1 = -v.x * sinY + v.z * cosY;

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const y2 = v.y * cosP - z1 * sinP;
  const z2 = v.y * sinP + z1 * cosP;

  return { x: x1, y: y2, z: z2 };
}

function projectView(
  view: Vec3,
  cx: number,
  cy: number,
  focal: number
): ProjectedPoint | null {
  const depth = CAM_DIST - view.z;
  if (depth <= 0.4) return null;
  const scale = focal / depth;
  return {
    sx: cx + view.x * scale,
    sy: cy - view.y * scale,
    depth,
    scale,
    view,
  };
}

function project4Dto3D(v: Vec4, wAngle: number): { pos: Vec3; w: number } {
  // Coupled 4D rotations across XW, YW, and ZW so nested hyper-triangles invert inside themselves
  const cosA = Math.cos(wAngle);
  const sinA = Math.sin(wAngle);
  const x1 = v.x * cosA - v.w * sinA;
  const w1 = v.x * sinA + v.w * cosA;

  const cosB = Math.cos(wAngle * 0.67);
  const sinB = Math.sin(wAngle * 0.67);
  const y2 = v.y * cosB - w1 * sinB;
  const w2 = v.y * sinB + w1 * cosB;

  const cosC = Math.cos(wAngle * 0.43);
  const sinC = Math.sin(wAngle * 0.43);
  const z3 = v.z * cosC - w2 * sinC;
  const w3 = v.z * sinC + w2 * cosC;

  const d4 = 2.05;
  const invW = 1 / Math.max(0.55, d4 - w3);
  const scale4 = d4 * invW * 0.74;

  return {
    pos: {
      x: x1 * scale4,
      y: y2 * scale4 + 0.04,
      z: z3 * scale4,
    },
    w: w3,
  };
}

function ringPointToWorld(ring: RingSpec, theta: number, yOffset = 0): Vec3 {
  const lx = ring.radius * Math.cos(theta);
  const lz = ring.radius * Math.sin(theta);
  const ly = yOffset;

  const cx = Math.cos(ring.tiltX);
  const sx = Math.sin(ring.tiltX);
  const y1 = ly * cx - lz * sx;
  const z1 = ly * sx + lz * cx;

  const cz = Math.cos(ring.tiltZ);
  const sz = Math.sin(ring.tiltZ);
  const x2 = lx * cz - y1 * sz;
  const y2 = lx * sz + y1 * cz;

  return { x: x2, y: y2, z: z1 };
}

function extractKeywords(content: string): Set<string> {
  const words = content.toLowerCase().match(/[a-z0-9\u00c0-\u024f]{4,}/g);
  return new Set(words ?? []);
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function buildSectorBasis(dir: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const w = normalizeVec3(dir);
  const upRef: Vec3 = Math.abs(w.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalizeVec3(crossVec3(upRef, w));
  const v = normalizeVec3(crossVec3(w, u));
  return { u, v, w };
}

function buildGraphTopology(
  memories: HindsightRecallItem[],
  banks: string[],
  ragFolders: string[],
  ragEnabled: boolean,
  ragRunning: boolean,
  globeMetaMap?: Map<string, HindsightGalaxyGlobe>,
  snapshotLinks?: HindsightGalaxyLink[]
): GraphTopology {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const clusters: ClusterSector[] = [];

  const apexNode: GraphNode = {
    kind: "apex",
    id: "apex-core",
    orbitPos: { x: 0, y: APEX_Y, z: 0 },
    graphPos: { x: 0, y: 0.1, z: 0 },
    rgb: CYAN_RGB,
    radiusBase: 7.4,
    showInCollapsed: false,
  };
  nodes.push(apexNode);

  const realMemories = memories.slice(0, MAX_ORBIT_MEMORIES);
  const indexedFolders = ragFolders.slice(0, MAX_RAGLIGHT_NODES);
  const hasRagHub = indexedFolders.length > 0 || ragEnabled || ragRunning;

  // Gather unique bank names across status.banks and recalled memories
  const bankSet = new Set<string>(banks.filter(Boolean));
  realMemories.forEach((m) => {
    if (m.bank) bankSet.add(m.bank);
  });
  if (bankSet.size === 0 && realMemories.length > 0) {
    bankSet.add("default");
  }
  const bankNames = Array.from(bankSet).slice(0, MAX_ORBIT_MEMORIES);

  // Count memories per bank
  const bankMemCounts = new Map<string, number>();
  realMemories.forEach((m) => {
    const b = m.bank || bankNames[0] || "default";
    bankMemCounts.set(b, (bankMemCounts.get(b) ?? 0) + 1);
  });

  const totalHubs = Math.max(1, bankNames.length + (hasRagHub ? 1 : 0));
  const bankHubPosMap = new Map<string, Vec3>();
  const bankHubIds: string[] = [];

  const sectorPosition = (sectorIdx: number): Vec3 => {
    const theta = (sectorIdx / totalHubs) * Math.PI * 2 + 0.42;
    const tiltY = totalHubs === 1 ? 0.18 : 0.36 * Math.sin(theta * 2 + 0.45);
    const r = totalHubs === 1 ? 1.18 : 1.28;
    return {
      x: Math.cos(theta) * r,
      y: tiltY,
      z: Math.sin(theta) * r,
    };
  };

  // 1) Hindsight Bank Hubs cleanly segmented in distinct angular sectors
  bankNames.forEach((bank, idx) => {
    const hubId = `bank-${bank}`;
    const palette = getBankPalette(bank);
    const graphPos = sectorPosition(idx);
    bankHubPosMap.set(bank, graphPos);
    bankHubIds.push(hubId);

    nodes.push({
      kind: "bank",
      id: hubId,
      bank,
      memoryCount: bankMemCounts.get(bank) ?? 0,
      orbitRingIndex: 0,
      orbitPhase: (idx / Math.max(1, bankNames.length)) * Math.PI * 2 + 0.35,
      bobOffset: idx * 0.75,
      graphPos,
      rgb: palette.rgb,
      pillClass: palette.pillClass,
      radiusBase: 6.6,
      showInCollapsed: realMemories.length === 0,
    });

    edges.push({
      key: `${apexNode.id}->${hubId}`,
      fromId: apexNode.id,
      toId: hubId,
      kind: "apex-hub",
      rgb: palette.rgb,
    });

    const basis = buildSectorBasis(graphPos);
    const count = bankMemCounts.get(bank) ?? 0;
    const layers = Math.max(1, Math.ceil(count / 5));
    clusters.push({
      hubId,
      label: bank,
      centerPos: {
        x: graphPos.x + basis.w.x * 0.54,
        y: graphPos.y + basis.w.y * 0.54,
        z: graphPos.z + basis.w.z * 0.54,
      },
      normalDir: basis.w,
      uAxis: basis.u,
      vAxis: basis.v,
      radius: count === 0 ? 0.34 : 0.5 + (layers - 1) * 0.24,
      rgb: palette.rgb,
    });
  });

  // 2) RAGLight Vector Hub + Segmented Folder Crystal Rosette
  let ragHubId: string | null = null;
  const ragLeafNodes: Array<{ id: string; kw: Set<string> }> = [];
  if (hasRagHub) {
    ragHubId = "raglight-hub";
    const ragHubPos = sectorPosition(bankNames.length);
    const basis = buildSectorBasis(ragHubPos);
    nodes.push({
      kind: "raglight-hub",
      id: ragHubId,
      folderCount: indexedFolders.length,
      orbitPhase: 0.75,
      bobOffset: 0.25,
      graphPos: ragHubPos,
      rgb: EMERALD_RGB,
      radiusBase: 6.8,
      showInCollapsed: false,
    });

    edges.push({
      key: `${apexNode.id}->${ragHubId}`,
      fromId: apexNode.id,
      toId: ragHubId,
      kind: "apex-hub",
      rgb: EMERALD_RGB,
    });

    bankHubIds.forEach((bHubId) => {
      edges.push({
        key: `${ragHubId}->${bHubId}`,
        fromId: ragHubId!,
        toId: bHubId,
        kind: "hub-hub",
        rgb: EMERALD_RGB,
      });
    });

    const ragLayers = Math.max(1, Math.ceil(Math.max(1, indexedFolders.length) / 5));
    clusters.push({
      hubId: ragHubId,
      label: "RAG",
      centerPos: {
        x: ragHubPos.x + basis.w.x * 0.54,
        y: ragHubPos.y + basis.w.y * 0.54,
        z: ragHubPos.z + basis.w.z * 0.54,
      },
      normalDir: basis.w,
      uAxis: basis.u,
      vAxis: basis.v,
      radius: indexedFolders.length === 0 ? 0.36 : 0.5 + (ragLayers - 1) * 0.24,
      rgb: EMERALD_RGB,
    });

    if (indexedFolders.length > 0) {
      indexedFolders.forEach((folder, idx) => {
        const nodeId = `rag-folder-${idx}-${folder}`;
        const ringLayer = Math.floor(idx / 5);
        const slotInLayer = idx % 5;
        const countInLayer = Math.min(5, indexedFolders.length - ringLayer * 5);
        const ang = (slotInLayer / Math.max(1, countInLayer)) * Math.PI * 2 + ringLayer * 0.55;
        const spread = indexedFolders.length === 1 ? 0 : 0.4 + ringLayer * 0.24;
        const fwd = 0.5 + ringLayer * 0.22;

        const graphPos: Vec3 = {
          x:
            ragHubPos.x +
            basis.w.x * fwd +
            basis.u.x * Math.cos(ang) * spread +
            basis.v.x * Math.sin(ang) * spread,
          y:
            ragHubPos.y +
            basis.w.y * fwd +
            basis.u.y * Math.cos(ang) * spread +
            basis.v.y * Math.sin(ang) * spread,
          z:
            ragHubPos.z +
            basis.w.z * fwd +
            basis.u.z * Math.cos(ang) * spread +
            basis.v.z * Math.sin(ang) * spread,
        };

        nodes.push({
          kind: "raglight",
          id: nodeId,
          folder,
          isFallback: false,
          orbitPhase: (idx / indexedFolders.length) * Math.PI * 2 + 0.55,
          spinOffset: idx * 1.35,
          bobOffset: idx * 1.1,
          graphPos,
          rgb: EMERALD_RGB,
          radiusBase: 5.8,
          showInCollapsed: true,
        });
        ragLeafNodes.push({
          id: nodeId,
          kw: extractKeywords(folder.replace(/[\\/._-]+/g, " ")),
        });

        edges.push({
          key: `${ragHubId}->${nodeId}`,
          fromId: ragHubId!,
          toId: nodeId,
          kind: "hub-leaf",
          rgb: EMERALD_RGB,
        });
      });
    } else {
      const anchorId = "rag-anchor-0";
      nodes.push({
        kind: "raglight",
        id: anchorId,
        folder: "",
        isFallback: true,
        orbitPhase: 0.65,
        spinOffset: 0.4,
        bobOffset: 0,
        graphPos: {
          x: ragHubPos.x + basis.w.x * 0.54,
          y: ragHubPos.y + basis.w.y * 0.54,
          z: ragHubPos.z + basis.w.z * 0.54,
        },
        rgb: EMERALD_RGB,
        radiusBase: 4.8,
        showInCollapsed: true,
      });
      ragLeafNodes.push({ id: anchorId, kw: new Set<string>() });
      edges.push({
        key: `${ragHubId}->${anchorId}`,
        fromId: ragHubId,
        toId: anchorId,
        kind: "hub-leaf",
        rgb: EMERALD_RGB,
      });
    }
  }

  // 3) Hindsight Memory Leaf Nodes arranged in segmented circular rosettes per Bank Hub
  if (realMemories.length > 0) {
    const ringCount = realMemories.length <= 6 ? 1 : realMemories.length <= 14 ? 2 : 3;
    const perRingCounts = new Array<number>(ringCount).fill(0);
    realMemories.forEach((_, i) => {
      perRingCounts[i % ringCount] += 1;
    });
    const perRingCursor = new Array<number>(ringCount).fill(0);

    const byBank = new Map<string, number[]>();
    realMemories.forEach((m, idx) => {
      const b = m.bank || bankNames[0] || "default";
      const arr = byBank.get(b) ?? [];
      arr.push(idx);
      byBank.set(b, arr);
    });

    const memoryNodes: Array<Extract<GraphNode, { kind: "memory" }> & { kw: Set<string> }> = [];

    realMemories.forEach((m, idx) => {
      const bank = m.bank || bankNames[0] || "default";
      const bankHubId = `bank-${bank}`;
      const palette = getBankPalette(bank);
      const ringIndex = idx % ringCount;
      const slot = perRingCursor[ringIndex];
      perRingCursor[ringIndex] += 1;
      const totalInRing = Math.max(1, perRingCounts[ringIndex]);

      const bankIndices = byBank.get(bank) ?? [idx];
      const localSlot = bankIndices.indexOf(idx);
      const hubPos = bankHubPosMap.get(bank) ?? sectorPosition(0);
      const basis = buildSectorBasis(hubPos);

      const ringLayer = Math.floor(localSlot / 5);
      const slotInLayer = localSlot % 5;
      const countInLayer = Math.min(5, bankIndices.length - ringLayer * 5);
      const ang = (slotInLayer / Math.max(1, countInLayer)) * Math.PI * 2 + ringLayer * 0.58;
      const spread = bankIndices.length === 1 ? 0 : 0.4 + ringLayer * 0.24;
      const fwd = 0.5 + ringLayer * 0.22;

      const graphPos: Vec3 = {
        x:
          hubPos.x +
          basis.w.x * fwd +
          basis.u.x * Math.cos(ang) * spread +
          basis.v.x * Math.sin(ang) * spread,
        y:
          hubPos.y +
          basis.w.y * fwd +
          basis.u.y * Math.cos(ang) * spread +
          basis.v.y * Math.sin(ang) * spread,
        z:
          hubPos.z +
          basis.w.z * fwd +
          basis.u.z * Math.cos(ang) * spread +
          basis.v.z * Math.sin(ang) * spread,
      };

      const meta = m.id ? globeMetaMap?.get(m.id) : undefined;
      const factType = meta?.factType ?? null;
      const baseRgb =
        factType === "observation"
          ? lerpRgb(palette.rgb, EMERALD_RGB, 0.35)
          : factType === "experience"
            ? lerpRgb(palette.rgb, [192, 132, 252], 0.35)
            : palette.rgb;

      const node: Extract<GraphNode, { kind: "memory" }> = {
        kind: "memory",
        id: m.id || `mem-${idx}`,
        bank,
        bankHubId,
        title: meta?.title,
        content: meta?.content || m.content,
        source: m.source,
        createdAt: meta?.date ?? m.createdAt ?? null,
        factType,
        context: meta?.context ?? null,
        documentId: meta?.documentId ?? null,
        entities: meta?.entities ?? [],
        tags: meta?.tags ?? [],
        degree: 0,
        isFallback: false,
        orbitRingIndex: ringIndex,
        orbitPhase: (slot / totalInRing) * Math.PI * 2 + ringIndex * 1.15,
        bobOffset: idx * 0.85,
        graphPos,
        rgb: baseRgb,
        pillClass: palette.pillClass,
        radiusBase: Math.min(
          7.6,
          5.0 + (meta?.entities.length ? Math.min(2.2, meta.entities.length * 0.38) : 0)
        ),
        showInCollapsed: true,
      };

      nodes.push(node);
      memoryNodes.push({ ...node, kw: extractKeywords(node.content || "") });

      edges.push({
        key: `${bankHubId}->${node.id}`,
        fromId: bankHubId,
        toId: node.id,
        kind: "hub-leaf",
        rgb: baseRgb,
      });
    });

    // Real Hindsight graph links first, then keyword cross-links
    const memNodeMap = new Map(memoryNodes.map((n) => [n.id, n]));
    const addedCrossKeys = new Set<string>();
    const perNodeCross = new Map<string, number>();

    if (snapshotLinks && snapshotLinks.length > 0) {
      for (const gl of snapshotLinks) {
        const a = memNodeMap.get(gl.source);
        const b = memNodeMap.get(gl.target);
        if (!a || !b || a.id === b.id) continue;
        const pairKey = a.id < b.id ? `${a.id}<->${b.id}` : `${b.id}<->${a.id}`;
        if (addedCrossKeys.has(pairKey)) continue;
        addedCrossKeys.add(pairKey);
        edges.push({
          key: `cross:${pairKey}`,
          fromId: a.id,
          toId: b.id,
          kind: "cross-link",
          rgb: lerpRgb(a.rgb, b.rgb, 0.5),
        });
        perNodeCross.set(a.id, (perNodeCross.get(a.id) ?? 0) + 1);
        perNodeCross.set(b.id, (perNodeCross.get(b.id) ?? 0) + 1);
      }
    }

    // Cross-links between Hindsight memories sharing source or keywords
    let crossCount = addedCrossKeys.size;
    for (let i = 0; i < memoryNodes.length && crossCount < 42; i += 1) {
      const a = memoryNodes[i];
      if ((perNodeCross.get(a.id) ?? 0) >= 2) continue;
      for (let j = i + 1; j < memoryNodes.length && crossCount < 42; j += 1) {
        const b = memoryNodes[j];
        if ((perNodeCross.get(b.id) ?? 0) >= 2) continue;
        const pairKey = a.id < b.id ? `${a.id}<->${b.id}` : `${b.id}<->${a.id}`;
        if (addedCrossKeys.has(pairKey)) continue;
        const sameSource = Boolean(a.source && b.source && a.source === b.source);
        let sharedKw = false;
        if (!sameSource && a.kw.size > 0 && b.kw.size > 0) {
          for (const w of a.kw) {
            if (b.kw.has(w)) {
              sharedKw = true;
              break;
            }
          }
        }
        if (sameSource || sharedKw) {
          addedCrossKeys.add(pairKey);
          edges.push({
            key: `cross:${pairKey}`,
            fromId: a.id,
            toId: b.id,
            kind: "cross-link",
            rgb: lerpRgb(a.rgb, b.rgb, 0.5),
          });
          perNodeCross.set(a.id, (perNodeCross.get(a.id) ?? 0) + 1);
          perNodeCross.set(b.id, (perNodeCross.get(b.id) ?? 0) + 1);
          crossCount += 1;
        }
      }
    }

    // Marry Hindsight memories with RAGLight folder nodes via semantic / structural neural bridges
    const bridgedMemoryIds = new Set<string>();
    if (ragLeafNodes.length > 0) {
      for (let rIdx = 0; rIdx < ragLeafNodes.length; rIdx += 1) {
        const rNode = ragLeafNodes[rIdx];
        const scored = memoryNodes.map((mNode, mIdx) => {
          let score = 0;
          for (const tok of rNode.kw) {
            if (mNode.kw.has(tok)) score += 2;
            if ((mNode.source || "").toLowerCase().includes(tok)) score += 2;
          }
          return { mNode, score, tie: (mIdx + rIdx) % memoryNodes.length };
        });
        scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.tie - b.tie));

        const linksPerRag = Math.min(2, scored.length);
        for (let k = 0; k < linksPerRag; k += 1) {
          const targetMem = scored[k].mNode;
          bridgedMemoryIds.add(targetMem.id);
          edges.push({
            key: `bridge:${targetMem.id}<->${rNode.id}`,
            fromId: targetMem.id,
            toId: rNode.id,
            kind: "rag-bridge",
            rgb: lerpRgb(targetMem.rgb, EMERALD_RGB, 0.5),
          });
        }
      }
    }

    // Ensure every Hindsight memory has an active neural synapse beyond its hub
    for (let i = 0; i < memoryNodes.length; i += 1) {
      const mNode = memoryNodes[i];
      const hasExtra = (perNodeCross.get(mNode.id) ?? 0) > 0 || bridgedMemoryIds.has(mNode.id);
      if (hasExtra) continue;

      if (ragLeafNodes.length > 0) {
        const rNode = ragLeafNodes[i % ragLeafNodes.length];
        edges.push({
          key: `bridge:${mNode.id}<->${rNode.id}`,
          fromId: mNode.id,
          toId: rNode.id,
          kind: "rag-bridge",
          rgb: lerpRgb(mNode.rgb, EMERALD_RGB, 0.5),
        });
      } else if (ragHubId) {
        edges.push({
          key: `bridge:${mNode.id}<->${ragHubId}`,
          fromId: mNode.id,
          toId: ragHubId,
          kind: "rag-bridge",
          rgb: lerpRgb(mNode.rgb, EMERALD_RGB, 0.5),
        });
      } else if (memoryNodes.length > 1) {
        const peer = memoryNodes[(i + 1) % memoryNodes.length];
        edges.push({
          key: `cross:${mNode.id}<->${peer.id}`,
          fromId: mNode.id,
          toId: peer.id,
          kind: "cross-link",
          rgb: lerpRgb(mNode.rgb, peer.rgb, 0.5),
        });
      }
    }
  }

  const nodeMap = new Map<string, GraphNode>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const adjacency = new Map<string, GraphEdge[]>();
  edges.forEach((e) => {
    const a = adjacency.get(e.fromId) ?? [];
    a.push(e);
    adjacency.set(e.fromId, a);
    const b = adjacency.get(e.toId) ?? [];
    b.push(e);
    adjacency.set(e.toId, b);
  });

  return { nodes, edges, clusters, nodeMap, adjacency };
}

function drawBackgroundStars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  galaxyLight: boolean
) {
  const starRgb: Rgb = galaxyLight ? [14, 116, 144] : [186, 230, 253];
  for (let i = 0; i < STAR_FIELD.length; i += 1) {
    const st = STAR_FIELD[i];
    const x = st.nx * width;
    const y = st.ny * height;
    const twinkle = 0.18 + 0.24 * Math.sin(t * 1.1 + st.phase);
    ctx.fillStyle = rgba(starRgb, galaxyLight ? twinkle * 0.4 : twinkle);
    ctx.beginPath();
    ctx.arc(x, y, st.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSingleRingPass(
  ctx: CanvasRenderingContext2D,
  ring: RingSpec,
  col: Rgb,
  dashed: boolean,
  alpha: number,
  lineWidth: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  frontPass: boolean
) {
  if (alpha <= 0.01) return;
  const segments = 64;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = rgba(col, alpha);
  ctx.setLineDash(dashed ? [4, 7] : []);

  let prevPt: ProjectedPoint | null = null;
  for (let s = 0; s <= segments; s += 1) {
    const th = (s / segments) * Math.PI * 2;
    const world = ringPointToWorld(ring, th);
    const view = rotateView(world, yaw, pitch);
    const proj = projectView(view, cx, cy, focal);
    if (s > 0 && prevPt && proj) {
      const midZ = (prevPt.view.z + proj.view.z) * 0.5;
      if ((midZ >= 0) === frontPass) {
        ctx.beginPath();
        ctx.moveTo(prevPt.sx, prevPt.sy);
        ctx.lineTo(proj.sx, proj.sy);
        ctx.stroke();
      }
    }
    prevPt = proj;
  }
  ctx.setLineDash([]);
}

function drawOrbitRingsPass(
  ctx: CanvasRenderingContext2D,
  hindsightRingIndices: number[],
  hasRaglightRing: boolean,
  ragActive: boolean,
  expandSmooth: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  galaxyLight: boolean,
  activityBoost: number,
  frontPass: boolean
) {
  const ringFade = 1 - expandSmooth * 0.72;
  if (ringFade <= 0.02) return;

  const cyanRgb: Rgb = galaxyLight ? [3, 105, 161] : CYAN_RGB;
  const indigoRgb: Rgb = galaxyLight ? [67, 56, 202] : INDIGO_RGB;
  const emeraldRgb: Rgb = galaxyLight ? [5, 150, 105] : EMERALD_RGB;

  for (let rIdx = 0; rIdx < hindsightRingIndices.length; rIdx += 1) {
    const idx = hindsightRingIndices[rIdx];
    const ring = HINDSIGHT_RINGS[idx];
    const col = idx % 2 === 0 ? cyanRgb : indigoRgb;
    const alpha =
      (frontPass
        ? (galaxyLight ? 0.19 : 0.21) + activityBoost * 0.08
        : galaxyLight
          ? 0.07
          : 0.08) * ringFade;
    drawSingleRingPass(
      ctx,
      ring,
      col,
      idx === 1,
      alpha,
      frontPass ? 0.95 : 0.75,
      yaw,
      pitch,
      cx,
      cy,
      focal,
      frontPass
    );
  }

  if (hasRaglightRing) {
    const ragAlpha =
      (frontPass
        ? (galaxyLight ? 0.24 : 0.26) + (ragActive ? 0.14 : 0) + activityBoost * 0.06
        : galaxyLight
          ? 0.08
          : 0.1) * ringFade;
    drawSingleRingPass(
      ctx,
      RAGLIGHT_RING,
      emeraldRgb,
      true,
      ragAlpha,
      frontPass ? 1.05 : 0.8,
      yaw,
      pitch,
      cx,
      cy,
      focal,
      frontPass
    );
  }
}

function drawListeningRipples(
  ctx: CanvasRenderingContext2D,
  t: number,
  listenLevel: number,
  expandSmooth: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  galaxyLight: boolean
) {
  if (listenLevel <= 0.02) return;
  const rippleRgb: Rgb = galaxyLight ? [2, 132, 199] : CYAN_RGB;
  const segs = 48;
  const baseY = lerp(BASE_Y, -0.35, expandSmooth);

  for (let k = 0; k < 2; k += 1) {
    const phase = (t * 0.72 + k * 0.5) % 1;
    const radius = 0.74 + phase * (0.92 + expandSmooth * 0.55);
    const alpha = (1 - phase) * 0.52 * listenLevel;
    ctx.strokeStyle = rgba(rippleRgb, alpha);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let s = 0; s <= segs; s += 1) {
      const th = (s / segs) * Math.PI * 2;
      const v = rotateView(
        { x: Math.cos(th) * radius, y: baseY, z: Math.sin(th) * radius },
        yaw,
        pitch
      );
      const p = projectView(v, cx, cy, focal);
      if (!p) continue;
      if (!started) {
        ctx.moveTo(p.sx, p.sy);
        started = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();
  }
}

function drawVoiceAuraBloom(
  ctx: CanvasRenderingContext2D,
  t: number,
  speakLevel: number,
  listenLevel: number,
  expandSmooth: number,
  zoom: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  galaxyLight: boolean
) {
  const activity = Math.max(speakLevel, listenLevel * 0.55);
  const centerProj = projectView(rotateView({ x: 0, y: 0.12, z: 0 }, yaw, pitch), cx, cy, focal);
  if (!centerProj) return;

  const voiceHarmonic = 0.5 + 0.5 * (0.65 * Math.sin(t * 7.2) + 0.35 * Math.sin(t * 13.4));
  const cyan: Rgb = galaxyLight ? [0, 150, 220] : CYAN_RGB;
  const brightCyan: Rgb = galaxyLight ? [2, 132, 199] : ICE_RGB;
  const auraCol = speakLevel > 0.05 ? lerpRgb(cyan, brightCyan, 0.35 * voiceHarmonic) : cyan;

  const baseR = (76 + activity * (72 + 30 * voiceHarmonic) + expandSmooth * 34) * zoom;
  const grad = ctx.createRadialGradient(
    centerProj.sx,
    centerProj.sy,
    baseR * 0.06,
    centerProj.sx,
    centerProj.sy,
    baseR
  );
  const peakAlpha = (galaxyLight ? 0.15 : 0.2) + speakLevel * 0.32 + listenLevel * 0.12;
  grad.addColorStop(0, rgba(auraCol, peakAlpha));
  grad.addColorStop(0.45, rgba(cyan, peakAlpha * 0.45));
  grad.addColorStop(1, rgba(cyan, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(centerProj.sx, centerProj.sy, baseR, 0, Math.PI * 2);
  ctx.fill();
}

interface PreparedPyramidAuraShell {
  verts: Array<{ view: Vec3; proj: ProjectedPoint | null }>;
}

function preparePyramidalAuraShell(
  scale: number,
  spinY: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number
): PreparedPyramidAuraShell {
  const pivotY = 0.14;
  const cosS = Math.cos(spinY);
  const sinS = Math.sin(spinY);

  const localVerts: readonly Vec3[] = [
    { x: 0, y: (APEX_Y - pivotY) * scale + pivotY, z: 0 },
    {
      x: -BASE_HALF * scale,
      y: (BASE_Y - pivotY) * scale + pivotY,
      z: BASE_HALF * scale,
    },
    {
      x: BASE_HALF * scale,
      y: (BASE_Y - pivotY) * scale + pivotY,
      z: BASE_HALF * scale,
    },
    {
      x: BASE_HALF * scale,
      y: (BASE_Y - pivotY) * scale + pivotY,
      z: -BASE_HALF * scale,
    },
    {
      x: -BASE_HALF * scale,
      y: (BASE_Y - pivotY) * scale + pivotY,
      z: -BASE_HALF * scale,
    },
  ];

  const verts = localVerts.map((v) => {
    const rx = v.x * cosS + v.z * sinS;
    const rz = -v.x * sinS + v.z * cosS;
    const view = rotateView({ x: rx, y: v.y, z: rz }, yaw, pitch);
    const proj = projectView(view, cx, cy, focal);
    return { view, proj };
  });

  return { verts };
}

function drawPyramidalVoiceAuraPass(
  ctx: CanvasRenderingContext2D,
  shell: PreparedPyramidAuraShell,
  alphaGain: number,
  lineWidth: number,
  frontPass: boolean,
  galaxyLight: boolean
) {
  if (alphaGain <= 0.015) return;
  const { verts } = shell;
  const cyan: Rgb = galaxyLight ? [0, 150, 220] : CYAN_RGB;
  const bright: Rgb = galaxyLight ? [2, 132, 199] : ICE_RGB;

  const faceIndices: readonly [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 1],
  ];

  for (let i = 0; i < faceIndices.length; i += 1) {
    const [a, b, c] = faceIndices[i];
    const va = verts[a];
    const vb = verts[b];
    const vc = verts[c];
    if (!va.proj || !vb.proj || !vc.proj) continue;
    const avgZ = (va.view.z + vb.view.z + vc.view.z) / 3;
    if ((avgZ >= 0) !== frontPass) continue;

    ctx.fillStyle = rgba(cyan, (frontPass ? 0.08 : 0.04) * alphaGain);
    ctx.beginPath();
    ctx.moveTo(va.proj.sx, va.proj.sy);
    ctx.lineTo(vb.proj.sx, vb.proj.sy);
    ctx.lineTo(vc.proj.sx, vc.proj.sy);
    ctx.closePath();
    ctx.fill();
  }

  const edges: readonly [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 1],
  ];

  for (let i = 0; i < edges.length; i += 1) {
    const [a, b] = edges[i];
    const va = verts[a];
    const vb = verts[b];
    if (!va.proj || !vb.proj) continue;
    const midZ = (va.view.z + vb.view.z) * 0.5;
    if ((midZ >= 0) !== frontPass) continue;

    ctx.strokeStyle = rgba(
      i < 4 ? bright : cyan,
      Math.min(0.95, (frontPass ? 0.78 : 0.34) * alphaGain)
    );
    ctx.lineWidth = lineWidth * (frontPass ? 1 : 0.72);
    ctx.beginPath();
    ctx.moveTo(va.proj.sx, va.proj.sy);
    ctx.lineTo(vb.proj.sx, vb.proj.sy);
    ctx.stroke();
  }
}

function drawPentachoronLayer(
  ctx: CanvasRenderingContext2D,
  wAngle: number,
  layerScale: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  boost: number,
  alphaScale: number,
  cyan: Rgb,
  brightCyan: Rgb
) {
  const transformed = PENTACHORON_VERTICES.map((v4) => {
    const p3 = project4Dto3D(v4, wAngle);
    const scaled: Vec3 = {
      x: p3.pos.x * layerScale,
      y: p3.pos.y * layerScale,
      z: p3.pos.z * layerScale,
    };
    const view = rotateView(scaled, yaw, pitch);
    const proj = projectView(view, cx, cy, focal);
    return { w: p3.w, view, proj };
  });

  // Translucent nested 4D triangular faces inverting inside each other
  const faceAlpha = Math.min(0.16, 0.045 * boost * alphaScale);
  if (faceAlpha > 0.008) {
    for (let f = 0; f < PENTACHORON_FACES.length; f += 1) {
      const [i0, i1, i2] = PENTACHORON_FACES[f];
      const a = transformed[i0];
      const b = transformed[i1];
      const c = transformed[i2];
      if (!a.proj || !b.proj || !c.proj) continue;
      const wNorm = clamp(((a.w + b.w + c.w) / 3 + 0.65) / 1.3, 0, 1);
      ctx.fillStyle = rgba(lerpRgb(cyan, brightCyan, wNorm), faceAlpha * (0.55 + wNorm * 0.65));
      ctx.beginPath();
      ctx.moveTo(a.proj.sx, a.proj.sy);
      ctx.lineTo(b.proj.sx, b.proj.sy);
      ctx.lineTo(c.proj.sx, c.proj.sy);
      ctx.closePath();
      ctx.fill();
    }
  }

  for (let i = 0; i < PENTACHORON_EDGES.length; i += 1) {
    const [aIdx, bIdx] = PENTACHORON_EDGES[i];
    const a = transformed[aIdx];
    const b = transformed[bIdx];
    if (!a.proj || !b.proj) continue;

    const avgW = (a.w + b.w) * 0.5;
    const wNorm = clamp((avgW + 0.65) / 1.3, 0, 1);
    const edgeRgb = lerpRgb(cyan, brightCyan, wNorm);
    const alpha = Math.min(0.95, (0.34 + wNorm * 0.38) * boost * alphaScale);

    ctx.strokeStyle = rgba(edgeRgb, alpha);
    ctx.lineWidth = (0.95 + wNorm * 0.6) * (alphaScale > 0.8 ? 1 : 0.85);
    ctx.beginPath();
    ctx.moveTo(a.proj.sx, a.proj.sy);
    ctx.lineTo(b.proj.sx, b.proj.sy);
    ctx.stroke();
  }

  for (let i = 0; i < transformed.length; i += 1) {
    const pt = transformed[i];
    if (!pt.proj) continue;
    const wNorm = clamp((pt.w + 0.65) / 1.3, 0, 1);
    const r = 1.65 + wNorm * 1.15;
    ctx.fillStyle = rgba(brightCyan, Math.min(0.96, (0.55 + wNorm * 0.4) * boost * alphaScale));
    ctx.beginPath();
    ctx.arc(pt.proj.sx, pt.proj.sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPentachoron(
  ctx: CanvasRenderingContext2D,
  t: number,
  wAngle: number,
  dilation: number,
  expandSmooth: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  speakLevel: number,
  listenLevel: number,
  galaxyLight: boolean
) {
  const cyan: Rgb = galaxyLight ? [0, 150, 220] : CYAN_RGB;
  const brightCyan: Rgb = galaxyLight ? [2, 132, 199] : ICE_RGB;
  const boost = 1 + speakLevel * 0.65 + listenLevel * 0.4;
  const baseScale = dilation * (1 + expandSmooth * 0.35);

  // Inner 4D Quantum Singularity Core glow
  const coreProj = projectView(
    rotateView({ x: 0, y: 0.04 * dilation, z: 0 }, yaw, pitch),
    cx,
    cy,
    focal
  );
  if (coreProj) {
    const corePulse = 1 + 0.2 * Math.sin(t * 4.2) + speakLevel * 0.45 + listenLevel * 0.25;
    const coreR = 14 * corePulse * (1 + expandSmooth * 0.25);
    const coreGrad = ctx.createRadialGradient(
      coreProj.sx,
      coreProj.sy,
      0.5,
      coreProj.sx,
      coreProj.sy,
      coreR
    );
    coreGrad.addColorStop(0, rgba([255, 255, 255], 0.92));
    coreGrad.addColorStop(0.35, rgba(cyan, 0.65));
    coreGrad.addColorStop(1, rgba(cyan, 0));
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(coreProj.sx, coreProj.sy, coreR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer 4D hyper-triangle shell + Inner counter-inverting 4D hyper-triangle moving inside itself
  drawPentachoronLayer(
    ctx,
    wAngle,
    baseScale * 0.96,
    yaw,
    pitch,
    cx,
    cy,
    focal,
    boost,
    1.0,
    cyan,
    brightCyan
  );
  drawPentachoronLayer(
    ctx,
    -wAngle * 1.24 + 0.85,
    baseScale * 0.56,
    yaw,
    pitch,
    cx,
    cy,
    focal,
    boost * 1.1,
    0.85,
    cyan,
    brightCyan
  );
}

function drawHarmonicEdge(
  ctx: CanvasRenderingContext2D,
  startWorld: Vec3,
  endWorld: Vec3,
  edgeIdx: number,
  t: number,
  speakLevel: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  color: Rgb,
  width: number,
  alpha: number
) {
  if (alpha <= 0.01) return;
  if (speakLevel <= 0.025) {
    const pA = projectView(rotateView(startWorld, yaw, pitch), cx, cy, focal);
    const pB = projectView(rotateView(endWorld, yaw, pitch), cx, cy, focal);
    if (!pA || !pB) return;
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pA.sx, pA.sy);
    ctx.lineTo(pB.sx, pB.sy);
    ctx.stroke();
    return;
  }

  const steps = 14;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;

  for (let s = 0; s <= steps; s += 1) {
    const u = s / steps;
    const bx = lerp(startWorld.x, endWorld.x, u);
    const by = lerp(startWorld.y, endWorld.y, u);
    const bz = lerp(startWorld.z, endWorld.z, u);
    const radialLen = Math.hypot(bx, bz) || 1;
    const env = Math.sin(u * Math.PI);
    const multiSine =
      Math.sin(t * 7 + u * 6.5 + edgeIdx * 1.3) +
      0.5 * Math.sin(t * 13 - u * 8.5 + edgeIdx * 0.7);
    const amp = speakLevel * 0.04 * env * multiSine;

    const displaced: Vec3 = {
      x: bx + (bx / radialLen) * amp,
      y: by + amp * 0.25,
      z: bz + (bz / radialLen) * amp,
    };
    const p = projectView(rotateView(displaced, yaw, pitch), cx, cy, focal);
    if (!p) continue;
    if (!started) {
      ctx.moveTo(p.sx, p.sy);
      started = true;
    } else {
      ctx.lineTo(p.sx, p.sy);
    }
  }
  ctx.stroke();
}

function drawDiamondMarker(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  size: number,
  color: Rgb,
  alpha: number
) {
  if (alpha <= 0.02) return;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = 1.05;
  ctx.beginPath();
  ctx.moveTo(sx, sy - size);
  ctx.lineTo(sx + size, sy);
  ctx.lineTo(sx, sy + size);
  ctx.lineTo(sx - size, sy);
  ctx.closePath();
  ctx.stroke();
}

function drawCyberneticBaseDeck(
  ctx: CanvasRenderingContext2D,
  t: number,
  baseY: number,
  baseCorners: readonly Vec3[],
  expandSmooth: number,
  speakLevel: number,
  listenLevel: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  cyan: Rgb,
  indigo: Rgb,
  emerald: Rgb
) {
  const deckFade = 1 - expandSmooth * 0.58;
  if (deckFade <= 0.03) return;
  const deckY = baseY - 0.06 - expandSmooth * 0.34;
  const activity = Math.max(speakLevel, listenLevel);
  const dilationScale = Math.abs(baseY) / Math.abs(BASE_Y);

  // 1) Outer Calibration Stator Ring with 24 radial degree ticks
  const outerR = 1.12 * dilationScale + expandSmooth * 0.38;
  const tickCount = 24;
  const spinOuter = t * 0.14;
  const segments = 48;

  for (let q = 0; q < 4; q += 1) {
    const startA = spinOuter + (q * Math.PI) / 2 + 0.1;
    const endA = spinOuter + ((q + 1) * Math.PI) / 2 - 0.1;
    ctx.strokeStyle = rgba(q % 2 === 0 ? cyan : emerald, (0.34 + activity * 0.22) * deckFade);
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    let started = false;
    const qSteps = segments / 4;
    for (let s = 0; s <= qSteps; s += 1) {
      const a = lerp(startA, endA, s / qSteps);
      const p = projectView(
        rotateView({ x: Math.cos(a) * outerR, y: deckY, z: Math.sin(a) * outerR }, yaw, pitch),
        cx,
        cy,
        focal
      );
      if (!p) continue;
      if (!started) {
        ctx.moveTo(p.sx, p.sy);
        started = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();
  }

  for (let i = 0; i < tickCount; i += 1) {
    const a = spinOuter + (i / tickCount) * Math.PI * 2;
    const isMajor = i % 6 === 0;
    const r0 = outerR - (isMajor ? 0.07 : 0.035);
    const r1 = outerR + (isMajor ? 0.05 : 0.02);
    const p0 = projectView(
      rotateView({ x: Math.cos(a) * r0, y: deckY, z: Math.sin(a) * r0 }, yaw, pitch),
      cx,
      cy,
      focal
    );
    const p1 = projectView(
      rotateView({ x: Math.cos(a) * r1, y: deckY, z: Math.sin(a) * r1 }, yaw, pitch),
      cx,
      cy,
      focal
    );
    if (!p0 || !p1) continue;
    ctx.strokeStyle = rgba(
      isMajor ? cyan : indigo,
      (isMajor ? 0.56 : 0.25) * deckFade
    );
    ctx.lineWidth = isMajor ? 1.25 : 0.75;
    ctx.beginPath();
    ctx.moveTo(p0.sx, p0.sy);
    ctx.lineTo(p1.sx, p1.sy);
    ctx.stroke();
  }

  // 2) Inner Counter-Rotating Data-Bus Arcs
  const innerR = 0.88 * dilationScale + expandSmooth * 0.24;
  const spinInner = -t * (0.36 + activity * 0.35);
  for (let k = 0; k < 3; k += 1) {
    const arcStart = spinInner + (k * Math.PI * 2) / 3;
    const arcEnd = arcStart + 0.92;
    ctx.strokeStyle = rgba(k === 1 ? emerald : cyan, (0.44 + activity * 0.26) * deckFade);
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    let started = false;
    let firstPt: ProjectedPoint | null = null;
    let lastPt: ProjectedPoint | null = null;
    for (let s = 0; s <= 12; s += 1) {
      const a = lerp(arcStart, arcEnd, s / 12);
      const p = projectView(
        rotateView({ x: Math.cos(a) * innerR, y: deckY + 0.02, z: Math.sin(a) * innerR }, yaw, pitch),
        cx,
        cy,
        focal
      );
      if (!p) continue;
      if (!firstPt) firstPt = p;
      lastPt = p;
      if (!started) {
        ctx.moveTo(p.sx, p.sy);
        started = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();
    if (firstPt) {
      ctx.fillStyle = rgba(cyan, 0.78 * deckFade);
      ctx.beginPath();
      ctx.arc(firstPt.sx, firstPt.sy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (lastPt) {
      ctx.fillStyle = rgba(emerald, 0.78 * deckFade);
      ctx.beginPath();
      ctx.arc(lastPt.sx, lastPt.sy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3) Base Floor Octagonal Quantum Emitter & Diagonal Corner Conduits
  if (expandSmooth < 0.7) {
    const plateFade = 1 - expandSmooth * 1.4;
    const octR = 0.25;
    ctx.strokeStyle = rgba(cyan, (0.42 + activity * 0.25) * plateFade);
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    let octStarted = false;
    for (let i = 0; i <= 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const p = projectView(
        rotateView({ x: Math.cos(a) * octR, y: baseY, z: Math.sin(a) * octR }, yaw, pitch),
        cx,
        cy,
        focal
      );
      if (!p) continue;
      if (!octStarted) {
        ctx.moveTo(p.sx, p.sy);
        octStarted = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();

    for (let c = 0; c < baseCorners.length; c += 1) {
      const corner = baseCorners[c];
      const innerAnchor: Vec3 = { x: corner.x * 0.34, y: corner.y, z: corner.z * 0.34 };
      const pOuter = projectView(rotateView(corner, yaw, pitch), cx, cy, focal);
      const pInner = projectView(rotateView(innerAnchor, yaw, pitch), cx, cy, focal);
      if (pOuter && pInner) {
        ctx.strokeStyle = rgba(c % 2 === 0 ? indigo : emerald, 0.34 * plateFade);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(pOuter.sx, pOuter.sy);
        ctx.lineTo(pInner.sx, pInner.sy);
        ctx.stroke();
      }
    }
  }
}

function drawCyberCircuitFacet(
  ctx: CanvasRenderingContext2D,
  aW: Vec3,
  bW: Vec3,
  cW: Vec3,
  facetIdx: number,
  isFront: boolean,
  alphaMult: number,
  t: number,
  speakLevel: number,
  listenLevel: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  cyan: Rgb,
  indigo: Rgb,
  emerald: Rgb
) {
  const bary = (u: number, v: number, w: number): ProjectedPoint | null =>
    projectView(
      rotateView(
        {
          x: aW.x * u + bW.x * v + cW.x * w,
          y: aW.y * u + bW.y * v + cW.y * w,
          z: aW.z * u + bW.z * v + cW.z * w,
        },
        yaw,
        pitch
      ),
      cx,
      cy,
      focal
    );

  const activity = Math.max(speakLevel, listenLevel);
  const traceAlpha = (isFront ? 0.5 : 0.15) * alphaMult + activity * 0.14;

  // 1) Stepped holographic telemetry tiers
  for (const tierU of [0.3, 0.62]) {
    const rem = 1 - tierU;
    const lp = bary(tierU, rem, 0);
    const rp = bary(tierU, 0, rem);
    if (lp && rp) {
      ctx.strokeStyle = rgba(tierU > 0.5 ? cyan : indigo, traceAlpha * 0.72);
      ctx.lineWidth = isFront ? 0.95 : 0.6;
      ctx.beginPath();
      ctx.moveTo(lp.sx, lp.sy);
      ctx.lineTo(rp.sx, rp.sy);
      ctx.stroke();
    }
  }

  if (!isFront) return;

  // 2) Recessed Inner Cybernetic Triangle Window
  const winTop = bary(0.68, 0.16, 0.16);
  const winLeft = bary(0.16, 0.62, 0.22);
  const winRight = bary(0.16, 0.22, 0.62);
  if (winTop && winLeft && winRight) {
    ctx.strokeStyle = rgba(facetIdx % 2 === 0 ? cyan : emerald, 0.34 * alphaMult + activity * 0.15);
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(winTop.sx, winTop.sy);
    ctx.lineTo(winLeft.sx, winLeft.sy);
    ctx.lineTo(winRight.sx, winRight.sy);
    ctx.closePath();
    ctx.stroke();
  }

  // 3) Symmetrical Stepped PCB / Neural Bus Circuit Traces + Junction Nodes
  const drawBus = (pts: Array<[number, number, number]>, col: Rgb) => {
    const projected = pts.map(([u, v, w]) => bary(u, v, w));
    if (projected.some((p) => !p)) return;
    const valid = projected as ProjectedPoint[];
    ctx.strokeStyle = rgba(col, traceAlpha * 0.88);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(valid[0].sx, valid[0].sy);
    for (let i = 1; i < valid.length; i += 1) {
      ctx.lineTo(valid[i].sx, valid[i].sy);
    }
    ctx.stroke();

    // Solder pad node at the elbow
    const elbow = valid[1];
    ctx.fillStyle = rgba(col, Math.min(1, traceAlpha + 0.22));
    ctx.beginPath();
    ctx.arc(elbow.sx, elbow.sy, 1.45, 0, Math.PI * 2);
    ctx.fill();
  };

  drawBus(
    [
      [0.08, 0.68, 0.24],
      [0.3, 0.48, 0.22],
      [0.3, 0.38, 0.32],
      [0.54, 0.26, 0.2],
    ],
    cyan
  );
  drawBus(
    [
      [0.08, 0.24, 0.68],
      [0.3, 0.22, 0.48],
      [0.3, 0.32, 0.38],
      [0.54, 0.2, 0.26],
    ],
    emerald
  );

  // 4) Central Vertical Data Spine + Climbing Quantum Packet Dot
  const spineTop = bary(0.84, 0.08, 0.08);
  const spineBot = bary(0.08, 0.46, 0.46);
  if (spineTop && spineBot) {
    ctx.strokeStyle = rgba(cyan, traceAlpha * 0.6);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(spineTop.sx, spineTop.sy);
    ctx.lineTo(spineBot.sx, spineBot.sy);
    ctx.stroke();

    const packetPhase = (t * (0.42 + speakLevel * 0.85 + listenLevel * 0.55) + facetIdx * 0.27) % 1;
    const pu = lerp(0.1, 0.82, packetPhase);
    const pRem = (1 - pu) * 0.5;
    const pkt = bary(pu, pRem, pRem);
    if (pkt) {
      ctx.fillStyle = rgba([255, 255, 255], 0.88 * alphaMult);
      ctx.beginPath();
      ctx.arc(pkt.sx, pkt.sy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHologramScanSlice(
  ctx: CanvasRenderingContext2D,
  apexWorld: Vec3,
  baseCorners: readonly Vec3[],
  expandSmooth: number,
  t: number,
  speakLevel: number,
  listenLevel: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  cyan: Rgb,
  emerald: Rgb
) {
  if (expandSmooth >= 0.72) return;
  const fade = 1 - expandSmooth / 0.72;
  const scanPhase = t === 0 ? 0.42 : (t * (0.25 + listenLevel * 0.32 + speakLevel * 0.42)) % 1;
  const env = Math.sin(scanPhase * Math.PI);
  if (env <= 0.04) return;

  const u = 1 - scanPhase;
  const ringPts = baseCorners.map((bc) =>
    projectView(rotateView(lerpVec3(apexWorld, bc, u), yaw, pitch), cx, cy, focal)
  );
  if (ringPts.some((p) => !p)) return;
  const valid = ringPts as ProjectedPoint[];

  ctx.fillStyle = rgba(cyan, 0.075 * env * fade);
  ctx.beginPath();
  ctx.moveTo(valid[0].sx, valid[0].sy);
  for (let i = 1; i < valid.length; i += 1) {
    ctx.lineTo(valid[i].sx, valid[i].sy);
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgba(lerpRgb(cyan, emerald, scanPhase), 0.52 * env * fade);
  ctx.lineWidth = 1.15;
  ctx.stroke();

  const centerPt = projectView(
    rotateView({ x: 0, y: lerp(apexWorld.y, baseCorners[0].y, u), z: 0 }, yaw, pitch),
    cx,
    cy,
    focal
  );
  if (centerPt) {
    ctx.strokeStyle = rgba(cyan, 0.24 * env * fade);
    ctx.lineWidth = 0.75;
    for (let i = 0; i < valid.length; i += 1) {
      ctx.beginPath();
      ctx.moveTo(centerPt.sx, centerPt.sy);
      ctx.lineTo(valid[i].sx, valid[i].sy);
      ctx.stroke();
    }
  }
}

function bloomPetalVertex(
  v: Vec3,
  hingeMid: Vec3,
  outDir: Vec3,
  bloom: number
): Vec3 {
  if (bloom <= 0.002) return v;
  // Translate radially outward and tilt open symmetrically like a blooming crystal petal
  const dx = v.x - hingeMid.x;
  const dy = v.y - hingeMid.y;
  const dz = v.z - hingeMid.z;
  const radialProj = dx * outDir.x + dz * outDir.z;
  const angle = bloom * 0.92;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const rotRadial = radialProj * cosA + dy * sinA;
  const rotY = -radialProj * sinA + dy * cosA;
  const radialDelta = rotRadial - radialProj;

  return {
    x: hingeMid.x + dx + radialDelta * outDir.x + outDir.x * bloom * 0.72,
    y: hingeMid.y + rotY - bloom * 0.14,
    z: hingeMid.z + dz + radialDelta * outDir.z + outDir.z * bloom * 0.72,
  };
}

function drawBloomingPyramid(
  ctx: CanvasRenderingContext2D,
  t: number,
  yaw: number,
  pitch: number,
  wAngle: number,
  expandSmooth: number,
  cx: number,
  cy: number,
  focal: number,
  speakLevel: number,
  listenLevel: number,
  snap: SceneSnapshot,
  galaxyLight: boolean
): {
  apexProj: ProjectedPoint | null;
  rightFacetProj: ProjectedPoint | null;
  centerProj: ProjectedPoint | null;
} {
  const voiceHarmonic = 0.5 + 0.5 * (0.65 * Math.sin(t * 7) + 0.35 * Math.sin(t * 13));
  // Clearly visible dilation of the entire pyramid/triangle when Aura speaks
  const dilation =
    1 + speakLevel * (0.26 + 0.14 * voiceHarmonic) + listenLevel * 0.07;

  const apexWorld: Vec3 = { x: 0, y: APEX_Y * dilation, z: 0 };
  const baseCorners: readonly Vec3[] = [
    { x: -BASE_HALF * dilation, y: BASE_Y * dilation, z: BASE_HALF * dilation },
    { x: BASE_HALF * dilation, y: BASE_Y * dilation, z: BASE_HALF * dilation },
    { x: BASE_HALF * dilation, y: BASE_Y * dilation, z: -BASE_HALF * dilation },
    { x: -BASE_HALF * dilation, y: BASE_Y * dilation, z: -BASE_HALF * dilation },
  ];

  // Unified vivid cyber-cyan colors (single cohesive palette, high-contrast)
  const cyan: Rgb = galaxyLight ? [0, 150, 220] : CYAN_RGB;
  const indigo: Rgb = galaxyLight ? [2, 128, 198] : INDIGO_RGB;
  const emerald: Rgb = galaxyLight ? [6, 182, 212] : EMERALD_RGB;
  const brightCyan: Rgb = galaxyLight ? [2, 132, 199] : ICE_RGB;

  const speakEdgeRgb = lerpRgb(cyan, brightCyan, 0.35 + 0.45 * voiceHarmonic);

  // Cybernetic Base Stator Deck & Octagonal Reactor Emitter
  drawCyberneticBaseDeck(
    ctx,
    t,
    BASE_Y * dilation,
    baseCorners,
    expandSmooth,
    speakLevel,
    listenLevel,
    yaw,
    pitch,
    cx,
    cy,
    focal,
    cyan,
    indigo,
    emerald
  );

  // Build 4 triangular petals (unfolding smoothly with expandSmooth) + square base plate
  interface Petal {
    facetIdx: number;
    worldVerts: Vec3[];
    viewVerts: Vec3[];
    projVerts: Array<ProjectedPoint | null>;
    depth: number;
    frontFacing: boolean;
    light: number;
    tintTop: Rgb;
    tintBottom: Rgb;
    isBase: boolean;
  }

  const petalConfigs: Array<{
    c1: number;
    c2: number;
    tintTop: Rgb;
    tintBottom: Rgb;
  }> = [
    { c1: 0, c2: 1, tintTop: cyan, tintBottom: indigo },
    { c1: 1, c2: 2, tintTop: cyan, tintBottom: emerald },
    { c1: 2, c2: 3, tintTop: indigo, tintBottom: emerald },
    { c1: 3, c2: 0, tintTop: cyan, tintBottom: indigo },
  ];

  const petals: Petal[] = petalConfigs.map((cfg, facetIdx) => {
    const b1 = baseCorners[cfg.c1];
    const b2 = baseCorners[cfg.c2];
    const hingeMid: Vec3 = {
      x: (b1.x + b2.x) * 0.5,
      y: BASE_Y * dilation,
      z: (b1.z + b2.z) * 0.5,
    };
    const outDir = normalizeVec3({ x: hingeMid.x, y: 0, z: hingeMid.z });

    const w0 = bloomPetalVertex(apexWorld, hingeMid, outDir, expandSmooth);
    const w1 = bloomPetalVertex(b1, hingeMid, outDir, expandSmooth);
    const w2 = bloomPetalVertex(b2, hingeMid, outDir, expandSmooth);

    const worldVerts = [w0, w1, w2];
    const viewVerts = worldVerts.map((v) => rotateView(v, yaw, pitch));
    const projVerts = viewVerts.map((v) => projectView(v, cx, cy, focal));

    const v0 = viewVerts[0];
    const v1 = viewVerts[1];
    const v2 = viewVerts[2];
    const e1x = v1.x - v0.x;
    const e1y = v1.y - v0.y;
    const e1z = v1.z - v0.z;
    const e2x = v2.x - v0.x;
    const e2y = v2.y - v0.y;
    const e2z = v2.z - v0.z;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    const cxV = (v0.x + v1.x + v2.x) / 3;
    const cyV = (v0.y + v1.y + v2.y) / 3;
    const czV = (v0.z + v1.z + v2.z) / 3;
    const dot = nx * -cxV + ny * -cyV + nz * (CAM_DIST - czV);
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const light = Math.max(0, (nx * 0.42 + ny * 0.72 + nz * 0.55) / nLen);

    return {
      facetIdx,
      worldVerts,
      viewVerts,
      projVerts,
      depth: CAM_DIST - czV,
      frontFacing: dot > 0,
      light,
      tintTop: cfg.tintTop,
      tintBottom: cfg.tintBottom,
      isBase: false,
    };
  });

  // Base plate drops slightly and fades smoothly as pyramid blossoms
  const baseScale = 1 + expandSmooth * 0.35;
  const baseWorld = [0, 3, 2, 1].map((idx) => ({
    x: baseCorners[idx].x * baseScale,
    y: baseCorners[idx].y - expandSmooth * 0.48,
    z: baseCorners[idx].z * baseScale,
  }));
  const baseView = baseWorld.map((v) => rotateView(v, yaw, pitch));
  const baseProj = baseView.map((v) => projectView(v, cx, cy, focal));
  const bv0 = baseView[0];
  const bv1 = baseView[1];
  const bv2 = baseView[2];
  const bnx = (bv1.y - bv0.y) * (bv2.z - bv0.z) - (bv1.z - bv0.z) * (bv2.y - bv0.y);
  const bny = (bv1.z - bv0.z) * (bv2.x - bv0.x) - (bv1.x - bv0.x) * (bv2.z - bv0.z);
  const bnz = (bv1.x - bv0.x) * (bv2.y - bv0.y) - (bv1.y - bv0.y) * (bv2.x - bv0.x);
  const bcz = baseView.reduce((acc, v) => acc + v.z, 0) / 4;
  const bdot = bnx * -bv0.x + bny * -bv0.y + bnz * (CAM_DIST - bv0.z);

  petals.push({
    facetIdx: 4,
    worldVerts: baseWorld,
    viewVerts: baseView,
    projVerts: baseProj,
    depth: CAM_DIST - bcz,
    frontFacing: bdot > 0,
    light: 0.25,
    tintTop: indigo,
    tintBottom: emerald,
    isBase: true,
  });

  const facetFade = 1 - expandSmooth * 0.56;
  const paintPetal = (petal: Petal, isFront: boolean) => {
    if (petal.projVerts.some((p) => !p)) return;
    const valid = petal.projVerts as ProjectedPoint[];

    ctx.beginPath();
    ctx.moveTo(valid[0].sx, valid[0].sy);
    for (let i = 1; i < valid.length; i += 1) {
      ctx.lineTo(valid[i].sx, valid[i].sy);
    }
    ctx.closePath();

    const p0 = valid[0];
    const pLast = valid[Math.min(2, valid.length - 1)];
    const grad = ctx.createLinearGradient(p0.sx, p0.sy, pLast.sx, pLast.sy);
    const topCol =
      speakLevel > 0.05 ? lerpRgb(petal.tintTop, speakEdgeRgb, speakLevel * 0.55) : petal.tintTop;
    const botCol =
      speakLevel > 0.05
        ? lerpRgb(petal.tintBottom, speakEdgeRgb, speakLevel * 0.45)
        : petal.tintBottom;

    const alphaMult = petal.isBase ? 1 - expandSmooth * 0.72 : facetFade;
    if (isFront) {
      const baseA = ((galaxyLight ? 0.14 : 0.17) + petal.light * 0.15) * alphaMult;
      grad.addColorStop(0, rgba(topCol, baseA + 0.06 * alphaMult));
      grad.addColorStop(1, rgba(botCol, baseA * 0.68));
    } else {
      const backA = (galaxyLight ? 0.05 : 0.08) * alphaMult;
      grad.addColorStop(0, rgba(topCol, backA));
      grad.addColorStop(1, rgba(botCol, backA * 0.65));
    }
    ctx.fillStyle = grad;
    ctx.fill();

    // Cybernetic PCB traces, inner triangular window, and precision exoskeleton rails
    if (!petal.isBase) {
      const [aW, bW, cW] = petal.worldVerts;
      drawCyberCircuitFacet(
        ctx,
        aW,
        bW,
        cW,
        petal.facetIdx,
        isFront,
        alphaMult,
        t,
        speakLevel,
        listenLevel,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        cyan,
        indigo,
        emerald
      );

      // Machined double-rail exoskeleton edges
      const edgeCol =
        speakLevel > 0.04
          ? lerpRgb(petal.tintTop, speakEdgeRgb, speakLevel * 0.65)
          : petal.tintTop;
      const edgeAlpha = (isFront ? 0.92 : 0.32) * (1 - expandSmooth * 0.32);
      const edgeWidth = (isFront ? 1.65 : 0.9) + speakLevel * 0.75;
      drawHarmonicEdge(
        ctx,
        aW,
        bW,
        0,
        t,
        speakLevel,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        edgeCol,
        edgeWidth,
        edgeAlpha
      );
      drawHarmonicEdge(
        ctx,
        aW,
        cW,
        1,
        t,
        speakLevel,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        petal.tintBottom,
        edgeWidth,
        edgeAlpha
      );
      drawHarmonicEdge(
        ctx,
        bW,
        cW,
        2,
        t,
        speakLevel * 0.6,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        petal.tintBottom,
        isFront ? 1.3 : 0.78,
        edgeAlpha * 0.84
      );

      if (isFront) {
        drawDiamondMarker(ctx, valid[1].sx, valid[1].sy, 3.6, cyan, 0.72 * alphaMult);
        drawDiamondMarker(ctx, valid[2].sx, valid[2].sy, 3.6, emerald, 0.72 * alphaMult);
      }
    }
  };

  // 1) Back-facing blooming petals
  petals
    .filter((p) => !p.frontFacing)
    .sort((a, b) => b.depth - a.depth)
    .forEach((p) => paintPetal(p, false));

  // 2) Inner laser core column, volumetric scan-slice & optional 4D Pentachoron
  const coreApexPos = lerpVec3(apexWorld, { x: 0, y: 0.1, z: 0 }, expandSmooth);
  const apexProj = projectView(rotateView(coreApexPos, yaw, pitch), cx, cy, focal);
  const centerProj = projectView(rotateView({ x: 0, y: 0.08, z: 0 }, yaw, pitch), cx, cy, focal);
  const baseCenterProj = projectView(
    rotateView({ x: 0, y: BASE_Y * dilation - expandSmooth * 0.25, z: 0 }, yaw, pitch),
    cx,
    cy,
    focal
  );

  if (apexProj && baseCenterProj) {
    const spineRgb = speakLevel > 0.05 ? lerpRgb(cyan, speakEdgeRgb, speakLevel) : cyan;
    const spineFade = 1 - expandSmooth * 0.45;
    ctx.strokeStyle = rgba(spineRgb, (0.28 + listenLevel * 0.32 + speakLevel * 0.28) * spineFade);
    ctx.lineWidth = 2.6 + speakLevel * 1.2;
    ctx.beginPath();
    ctx.moveTo(apexProj.sx, apexProj.sy);
    ctx.lineTo(baseCenterProj.sx, baseCenterProj.sy);
    ctx.stroke();

    ctx.strokeStyle = rgba([255, 255, 255], (0.55 + listenLevel * 0.25) * spineFade);
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(apexProj.sx, apexProj.sy);
    ctx.lineTo(baseCenterProj.sx, baseCenterProj.sy);
    ctx.stroke();
  }

  drawHologramScanSlice(
    ctx,
    apexWorld,
    baseCorners,
    expandSmooth,
    t,
    speakLevel,
    listenLevel,
    yaw,
    pitch,
    cx,
    cy,
    focal,
    cyan,
    emerald
  );

  if (snap.enable4d) {
    drawPentachoron(
      ctx,
      t,
      wAngle,
      dilation,
      expandSmooth,
      yaw,
      pitch,
      cx,
      cy,
      focal,
      speakLevel,
      listenLevel,
      GALAXY_LIGHT
    );
  }

  // 3) Front-facing blooming petals
  petals
    .filter((p) => p.frontFacing)
    .sort((a, b) => b.depth - a.depth)
    .forEach((p) => paintPetal(p, true));

  // 4) Levitating Cybernetic Apex Capstone Collar + Synthesis Core Halo
  if (expandSmooth < 0.65) {
    const collarFade = 1 - expandSmooth / 0.65;
    const collarY = lerp(apexWorld.y, BASE_Y * dilation, 0.2);
    const collarR = 0.2 * dilation;
    const collarSpin = -t * 1.15;
    ctx.strokeStyle = rgba(cyan, (0.56 + listenLevel * 0.28) * collarFade);
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    let collarStarted = false;
    for (let i = 0; i <= 6; i += 1) {
      const a = collarSpin + (i / 6) * Math.PI * 2;
      const p = projectView(
        rotateView({ x: Math.cos(a) * collarR, y: collarY, z: Math.sin(a) * collarR }, yaw, pitch),
        cx,
        cy,
        focal
      );
      if (!p) continue;
      if (!collarStarted) {
        ctx.moveTo(p.sx, p.sy);
        collarStarted = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();
  }

  if (apexProj) {
    const haloScale = 1 + listenLevel * 0.45 + speakLevel * 0.38 + expandSmooth * 0.25;
    const haloR = 24 * haloScale;
    const apexRgb =
      speakLevel > 0.05
        ? lerpRgb(cyan, speakEdgeRgb, speakLevel * 0.65)
        : snap.aiOnline
          ? cyan
          : ([245, 158, 11] as const);
    const g = ctx.createRadialGradient(
      apexProj.sx,
      apexProj.sy,
      1,
      apexProj.sx,
      apexProj.sy,
      haloR
    );
    g.addColorStop(0, rgba(apexRgb, 0.82));
    g.addColorStop(0.42, rgba(apexRgb, 0.28));
    g.addColorStop(1, rgba(apexRgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(apexProj.sx, apexProj.sy, haloR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgba(apexRgb, 0.96);
    ctx.beginPath();
    ctx.arc(apexProj.sx, apexProj.sy, 3.8 + listenLevel * 1.1 + expandSmooth * 1.4, 0, Math.PI * 2);
    ctx.fill();

    drawDiamondMarker(ctx, apexProj.sx, apexProj.sy, 7.5 + listenLevel * 2, apexRgb, 0.72);
  }

  const rightFacetProj = projectView(
    rotateView(
      {
        x: BASE_HALF * dilation * (0.65 + expandSmooth * 0.72),
        y: BASE_Y * dilation * 0.45,
        z: 0,
      },
      yaw,
      pitch
    ),
    cx,
    cy,
    focal
  );

  return { apexProj, rightFacetProj, centerProj };
}

function drawEmeraldCrystalNode(
  ctx: CanvasRenderingContext2D,
  item: PreparedNode,
  node: Extract<GraphNode, { kind: "raglight" | "raglight-hub" }>,
  rightFacetProj: ProjectedPoint | null,
  expandSmooth: number,
  t: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  isActive: boolean,
  ragActive: boolean,
  galaxyLight: boolean
) {
  const { proj, world, radiusPx, alphaScale } = item;
  if (alphaScale <= 0.02) return;
  const depthFade = Math.max(0.48, Math.min(1, (CAM_DIST + 1.8 - proj.depth) / 3.6)) * alphaScale;
  const emeraldCore: Rgb = galaxyLight ? [0, 145, 215] : EMERALD_CORE_RGB;
  const emeraldBright: Rgb = galaxyLight ? EMERALD_CORE_RGB : EMERALD_RGB;
  const emeraldEdge: Rgb = galaxyLight ? [2, 132, 199] : ICE_RGB;

  // Collapsed-mode emerald tether to right prism facet when hovered/active/running
  if (
    expandSmooth < 0.35 &&
    node.kind === "raglight" &&
    rightFacetProj &&
    (isActive || ragActive || (proj.view.z >= 0 && !node.isFallback))
  ) {
    const filamentActive = isActive || ragActive;
    const lineAlpha =
      (filamentActive ? 0.56 : galaxyLight ? 0.14 : 0.16) * depthFade * (1 - expandSmooth * 2.8);
    if (lineAlpha > 0.01) {
      ctx.strokeStyle = rgba(emeraldBright, lineAlpha);
      ctx.lineWidth = isActive ? 1.55 : filamentActive ? 1.15 : 0.75;
      ctx.beginPath();
      ctx.moveTo(proj.sx, proj.sy);
      ctx.lineTo(rightFacetProj.sx, rightFacetProj.sy);
      ctx.stroke();
    }
  }

  // Soft emerald aura halo
  const haloR = radiusPx * (isActive ? 3.2 : 2.35);
  const halo = ctx.createRadialGradient(proj.sx, proj.sy, 0.5, proj.sx, proj.sy, haloR);
  halo.addColorStop(0, rgba(emeraldBright, (isActive ? 0.8 : 0.45) * depthFade));
  halo.addColorStop(0.55, rgba(emeraldCore, (isActive ? 0.26 : 0.14) * depthFade));
  halo.addColorStop(1, rgba(emeraldCore, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(proj.sx, proj.sy, haloR, 0, Math.PI * 2);
  ctx.fill();

  if (isActive) {
    const ringPulse = 1 + 0.14 * Math.sin(t * 4.5);
    ctx.strokeStyle = rgba(emeraldEdge, 0.92 * alphaScale);
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, radiusPx * 2.15 * ringPulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rotating 3D emerald octahedron
  const spinOffset = node.kind === "raglight" ? node.spinOffset : 0.8;
  const r =
    node.kind === "raglight-hub"
      ? isActive
        ? 0.11
        : 0.088
      : node.isFallback
        ? 0.056
        : isActive
          ? 0.095
          : 0.072;
  const h = r * 1.38;
  const spin = t * 1.4 + spinOffset;
  const cSpin = Math.cos(spin);
  const sSpin = Math.sin(spin);
  const tilt = 0.26;
  const cTilt = Math.cos(tilt);
  const sTilt = Math.sin(tilt);

  const localVerts: readonly Vec3[] = [
    { x: 0, y: h, z: 0 },
    { x: 0, y: -h, z: 0 },
    { x: r, y: 0, z: 0 },
    { x: -r, y: 0, z: 0 },
    { x: 0, y: 0, z: r },
    { x: 0, y: 0, z: -r },
  ];

  const octaView: Vec3[] = [];
  const octaProj: Array<ProjectedPoint | null> = [];

  for (let i = 0; i < localVerts.length; i += 1) {
    const lv = localVerts[i];
    const rx = lv.x * cSpin + lv.z * sSpin;
    const rz = -lv.x * sSpin + lv.z * cSpin;
    const ry = lv.y * cTilt - rz * sTilt;
    const rzz = lv.y * sTilt + rz * cTilt;
    const vw = rotateView(
      { x: world.x + rx, y: world.y + ry, z: world.z + rzz },
      yaw,
      pitch
    );
    octaView.push(vw);
    octaProj.push(projectView(vw, cx, cy, focal));
  }

  const shadedFaces: Array<{
    pts: [ProjectedPoint, ProjectedPoint, ProjectedPoint];
    depth: number;
    light: number;
  }> = [];

  for (let f = 0; f < OCTAHEDRON_FACES.length; f += 1) {
    const [i0, i1, i2] = OCTAHEDRON_FACES[f];
    const p0 = octaProj[i0];
    const p1 = octaProj[i1];
    const p2 = octaProj[i2];
    if (!p0 || !p1 || !p2) continue;
    const v0 = octaView[i0];
    const v1 = octaView[i1];
    const v2 = octaView[i2];
    const nx = (v1.y - v0.y) * (v2.z - v0.z) - (v1.z - v0.z) * (v2.y - v0.y);
    const ny = (v1.z - v0.z) * (v2.x - v0.x) - (v1.x - v0.x) * (v2.z - v0.z);
    const nz = (v1.x - v0.x) * (v2.y - v0.y) - (v1.y - v0.y) * (v2.x - v0.x);
    const czV = (v0.z + v1.z + v2.z) / 3;
    if (nx * -v0.x + ny * -v0.y + nz * (CAM_DIST - v0.z) <= 0) continue;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const light = Math.max(0.15, (nx * 0.4 + ny * 0.72 + nz * 0.56) / nLen);
    shadedFaces.push({
      pts: [p0, p1, p2],
      depth: CAM_DIST - czV,
      light,
    });
  }

  shadedFaces
    .sort((a, b) => b.depth - a.depth)
    .forEach((face) => {
      const col = lerpRgb(emeraldCore, emeraldBright, face.light);
      ctx.fillStyle = rgba(col, (0.58 + face.light * 0.34) * depthFade);
      ctx.strokeStyle = rgba(emeraldEdge, (0.65 + face.light * 0.3) * depthFade);
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(face.pts[0].sx, face.pts[0].sy);
      ctx.lineTo(face.pts[1].sx, face.pts[1].sy);
      ctx.lineTo(face.pts[2].sx, face.pts[2].sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
}

function drawNodesPass(
  ctx: CanvasRenderingContext2D,
  nodes: PreparedNode[],
  apexProj: ProjectedPoint | null,
  rightFacetProj: ProjectedPoint | null,
  expandSmooth: number,
  t: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  activeNodeId: string | null,
  signalMap: Map<string, MemorySignalMode>,
  ragActive: boolean,
  galaxyLight: boolean
) {
  for (let i = 0; i < nodes.length; i += 1) {
    const item = nodes[i];
    const { node, proj, radiusPx, alphaScale } = item;
    if (alphaScale <= 0.02) continue;
    const signal = signalMap.get(node.id);
    const isActive = activeNodeId === node.id || Boolean(signal);

    if (node.kind === "raglight" || node.kind === "raglight-hub") {
      drawEmeraldCrystalNode(
        ctx,
        item,
        node,
        rightFacetProj,
        expandSmooth,
        t,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        isActive,
        ragActive,
        GALAXY_LIGHT
      );
      continue;
    }

    const depthFade = Math.max(0.45, Math.min(1, (CAM_DIST + 1.8 - proj.depth) / 3.6)) * alphaScale;
    const rgb = signal ? ICE_RGB : node.rgb;

    // Collapsed-mode whisper tether to apex for front nodes
    if (expandSmooth < 0.35 && apexProj && (proj.view.z >= 0 || isActive) && node.kind !== "apex") {
      const tetherAlpha =
        (isActive ? 0.68 : (galaxyLight ? 0.13 : 0.15) * depthFade) * (1 - expandSmooth * 2.8);
      if (tetherAlpha > 0.01) {
        ctx.strokeStyle = rgba(rgb, tetherAlpha);
        ctx.lineWidth = isActive ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(proj.sx, proj.sy);
        ctx.lineTo(apexProj.sx, apexProj.sy);
        ctx.stroke();
      }
    }

    // Outer luminous halo (expanded & brighter when Aura is creating or utilizing this memory)
    const haloR =
      radiusPx * (signal === "creating" ? 4.4 : signal === "using" ? 4.0 : isActive ? 3.6 : node.kind === "bank" ? 2.9 : 2.5);
    const halo = ctx.createRadialGradient(proj.sx, proj.sy, 0.5, proj.sx, proj.sy, haloR);
    halo.addColorStop(0, rgba(rgb, (signal ? 0.96 : isActive ? 0.88 : 0.52) * depthFade));
    halo.addColorStop(0.5, rgba(CYAN_RGB, (signal ? 0.44 : isActive ? 0.32 : 0.16) * depthFade));
    halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Expanding birth pulse ring when Aura is creating a memory
    if (signal === "creating") {
      const birthPhase = (t * 1.4) % 1;
      const birthR = radiusPx * (1.4 + birthPhase * 2.8);
      ctx.strokeStyle = rgba(ICE_RGB, Math.sin(birthPhase * Math.PI) * 0.92);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(proj.sx, proj.sy, birthR, 0, Math.PI * 2);
      ctx.stroke();

      drawDiamondMarker(ctx, proj.sx, proj.sy, radiusPx * 2.1, ICE_RGB, 0.9);
    }

    // Double counter-rotating active beacon when Aura is utilizing a memory
    if (signal === "using") {
      const uSpin = -t * 2.1 + i;
      ctx.strokeStyle = rgba(ICE_RGB, 0.92);
      ctx.lineWidth = 1.35;
      for (let k = 0; k < 2; k += 1) {
        const a0 = uSpin + k * Math.PI;
        ctx.beginPath();
        ctx.arc(proj.sx, proj.sy, radiusPx * 2.45, a0, a0 + 0.95);
        ctx.stroke();
      }
    }

    // Segmented cybernetic reticle arcs around memory capsules & bank hubs
    if (node.kind === "bank" || node.kind === "memory" || isActive) {
      const spin = t * (node.kind === "bank" ? -0.9 : 1.15) + i * 0.72;
      const ringR =
        radiusPx * (isActive ? 2.15 : node.kind === "bank" ? 1.85 : 1.62);
      ctx.strokeStyle = rgba(
        isActive ? ICE_RGB : rgb,
        (isActive ? 0.94 : node.kind === "bank" ? 0.65 : 0.42 * (0.35 + expandSmooth * 0.65)) *
          depthFade
      );
      ctx.lineWidth = isActive ? 1.45 : node.kind === "bank" ? 1.1 : 0.85;
      for (let arcIdx = 0; arcIdx < 2; arcIdx += 1) {
        const a0 = spin + arcIdx * Math.PI;
        ctx.beginPath();
        ctx.arc(proj.sx, proj.sy, ringR, a0, a0 + 1.05);
        ctx.stroke();
      }
    }

    // Core sphere / hexagonal hub / diamond memory crystal
    const isFallbackMem = node.kind === "memory" && node.isFallback;
    if (node.kind === "bank") {
      ctx.fillStyle = rgba(rgb, 0.92 * depthFade);
      ctx.strokeStyle = rgba(ICE_RGB, 0.75 * depthFade);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let h = 0; h < 6; h += 1) {
        const ha = (h / 6) * Math.PI * 2 + t * 0.3;
        const hx = proj.sx + Math.cos(ha) * radiusPx;
        const hy = proj.sy + Math.sin(ha) * radiusPx;
        if (h === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = rgba(rgb, Math.min(1, (isFallbackMem ? 0.68 : 0.96) * depthFade));
      ctx.beginPath();
      ctx.arc(proj.sx, proj.sy, radiusPx * (signal ? 1.2 : 1), 0, Math.PI * 2);
      ctx.fill();

      // Inner crystal diamond glint on memory nodes
      if (node.kind === "memory" && !isFallbackMem) {
        const ds = radiusPx * (signal ? 0.68 : 0.55);
        ctx.fillStyle = rgba(ICE_RGB, (signal ? 0.95 : 0.72) * depthFade);
        ctx.beginPath();
        ctx.moveTo(proj.sx, proj.sy - ds);
        ctx.lineTo(proj.sx + ds, proj.sy);
        ctx.lineTo(proj.sx, proj.sy + ds);
        ctx.lineTo(proj.sx - ds, proj.sy);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Specular highlight dot
    ctx.fillStyle = rgba([255, 255, 255], (galaxyLight ? 0.68 : 0.85) * depthFade);
    ctx.beginPath();
    ctx.arc(proj.sx - radiusPx * 0.28, proj.sy - radiusPx * 0.28, radiusPx * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRoundedPillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawClusterSectors(
  ctx: CanvasRenderingContext2D,
  clusters: ClusterSector[],
  expandSmooth: number,
  t: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  galaxyLight: boolean
) {
  if (expandSmooth <= 0.12 || clusters.length === 0) return;
  const colBase: Rgb = galaxyLight ? [0, 150, 220] : CYAN_RGB;
  const segs = 36;

  for (let c = 0; c < clusters.length; c += 1) {
    const cl = clusters[c];
    const centerView = rotateView(cl.centerPos, yaw, pitch);
    const centerProj = projectView(centerView, cx, cy, focal);
    if (!centerProj) continue;

    // Soft radial aura disk framing the segmented memory cluster
    const screenR = cl.radius * centerProj.scale * expandSmooth;
    const radialFill = ctx.createRadialGradient(
      centerProj.sx,
      centerProj.sy,
      screenR * 0.1,
      centerProj.sx,
      centerProj.sy,
      Math.max(12, screenR)
    );
    const fillAlpha = (galaxyLight ? 0.055 : 0.075) * expandSmooth;
    radialFill.addColorStop(0, rgba(cl.rgb, fillAlpha));
    radialFill.addColorStop(0.75, rgba(colBase, fillAlpha * 0.45));
    radialFill.addColorStop(1, rgba(colBase, 0));
    ctx.fillStyle = radialFill;
    ctx.beginPath();
    ctx.arc(centerProj.sx, centerProj.sy, Math.max(12, screenR), 0, Math.PI * 2);
    ctx.fill();

    // Tilted 3D circular boundary ring enclosing the sector's memories
    const r = cl.radius * (0.72 + 0.28 * expandSmooth);
    ctx.strokeStyle = rgba(colBase, (galaxyLight ? 0.24 : 0.3) * expandSmooth);
    ctx.lineWidth = 0.95;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    let started = false;
    for (let s = 0; s <= segs; s += 1) {
      const a = (s / segs) * Math.PI * 2 + t * 0.08 * (c % 2 === 0 ? 1 : -1);
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r;
      const worldPt: Vec3 = {
        x: cl.centerPos.x + cl.uAxis.x * ca + cl.vAxis.x * sa,
        y: cl.centerPos.y + cl.uAxis.y * ca + cl.vAxis.y * sa,
        z: cl.centerPos.z + cl.uAxis.z * ca + cl.vAxis.z * sa,
      };
      const proj = projectView(rotateView(worldPt, yaw, pitch), cx, cy, focal);
      if (!proj) continue;
      if (!started) {
        ctx.moveTo(proj.sx, proj.sy);
        started = true;
      } else {
        ctx.lineTo(proj.sx, proj.sy);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawClusterNodeLabels(
  ctx: CanvasRenderingContext2D,
  frontNodes: PreparedNode[],
  expandSmooth: number,
  zoom: number,
  width: number,
  height: number,
  activeNodeId: string | null,
  signalMap: Map<string, MemorySignalMode>
) {
  const hasSignaledNodes = signalMap.size > 0;
  const visibility = hasSignaledNodes
    ? Math.max(0.85, expandSmooth * clamp((zoom - 0.98) / 0.28, 0.38, 1))
    : expandSmooth * clamp((zoom - 0.98) / 0.28, 0.38, 1);
  if (visibility <= 0.14) return;

  const placedBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const overlaps = (x: number, y: number, w: number, h: number) =>
    placedBoxes.some(
      (b) => x < b.x + b.w + 6 && x + w + 6 > b.x && y < b.y + b.h + 5 && y + h + 5 > b.y
    );

  // Order: active hovered/selected -> signaled (creating/using) -> bank/raglight hubs -> nearest leaves
  const candidates = [...frontNodes]
    .filter((item) => {
      if (item.node.kind === "apex") return false;
      if (item.node.kind === "memory" && item.node.isFallback) return false;
      if (item.node.kind === "raglight" && item.node.isFallback) return false;
      return item.proj.sx > 24 && item.proj.sx < width - 24 && item.proj.sy > 84 && item.proj.sy < height - 122;
    })
    .sort((a, b) => {
      const aActive = a.node.id === activeNodeId ? 0 : 1;
      const bActive = b.node.id === activeNodeId ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aSig = signalMap.has(a.node.id) ? 0 : 1;
      const bSig = signalMap.has(b.node.id) ? 0 : 1;
      if (aSig !== bSig) return aSig - bSig;
      const aHub = a.node.kind === "bank" || a.node.kind === "raglight-hub" ? 0 : 1;
      const bHub = b.node.kind === "bank" || b.node.kind === "raglight-hub" ? 0 : 1;
      if (aHub !== bHub) return aHub - bHub;
      return a.proj.depth - b.proj.depth;
    });

  ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  let leafLabelsDrawn = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    const { node, proj, radiusPx } = item;
    const signal = signalMap.get(node.id);
    const isActive = node.id === activeNodeId || Boolean(signal);
    const isHub = node.kind === "bank" || node.kind === "raglight-hub";
    if (!isActive && !isHub && leafLabelsDrawn >= 7) continue;

    let rawLabel = "";
    if (node.kind === "bank") {
      rawLabel = node.bank;
    } else if (node.kind === "raglight-hub") {
      rawLabel = "RAGLight";
    } else if (node.kind === "memory") {
      rawLabel = node.content.trim().replace(/\s+/g, " ");
      if (rawLabel.length > 24) rawLabel = `${rawLabel.slice(0, 23)}…`;
    } else if (node.kind === "raglight") {
      const parts = node.folder.split(/[\\/]/).filter(Boolean);
      rawLabel = parts[parts.length - 1] ?? node.folder;
      if (rawLabel.length > 22) rawLabel = `${rawLabel.slice(0, 21)}…`;
    }

    if (!rawLabel) continue;

    const textW = Math.min(164, ctx.measureText(rawLabel).width);
    const pillW = textW + (signal ? 24 : 18);
    const pillH = isHub ? 20 : 18;
    const px = clamp(proj.sx - pillW * 0.5, 16, width - pillW - 16);
    const py = clamp(proj.sy - radiusPx - pillH - 6, 80, height - 120 - pillH);

    if (!isActive && overlaps(px, py, pillW, pillH)) continue;
    placedBoxes.push({ x: px, y: py, w: pillW, h: pillH });
    if (!isActive && !isHub) leafLabelsDrawn += 1;

    const alpha = visibility * (isActive ? 0.98 : isHub ? 0.88 : 0.8);
    // The galaxy is a deep-space surface in BOTH themes, so its labels use
    // the space palette in both: a pale pill floating over the void. A label
    // that followed the global UI theme would break the galaxy's own visual
    // identity — and would be unreadable against the stars.
    const bgCol = "rgba(4, 15, 30, 0.82)";
    const borderCol = rgba(
      isActive ? ICE_RGB : node.rgb,
      isActive ? 0.95 * alpha : isHub ? 0.68 * alpha : 0.45 * alpha
    );
    const textCol = "rgba(224, 249, 255, 0.96)";

    ctx.save();
    ctx.globalAlpha = alpha;
    drawRoundedPillRect(ctx, px, py, pillW, pillH, pillH * 0.5);
    ctx.fillStyle = bgCol;
    ctx.fill();
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = signal ? 1.5 : isActive ? 1.25 : 0.9;
    ctx.stroke();

    // Glowing indicator dot (plus outer halo ring when creating/using)
    if (signal) {
      ctx.strokeStyle = rgba(ICE_RGB, 0.85);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px + 9, py + pillH * 0.5, 4.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(isActive ? ICE_RGB : node.rgb, 0.98);
    ctx.beginPath();
    ctx.arc(px + (signal ? 9 : 8), py + pillH * 0.5, 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = textCol;
    ctx.fillText(rawLabel, px + (signal ? 17 : 14), py + pillH * 0.5 + 0.5, textW);
    ctx.restore();
  }
}

function drawGraphEdges(
  ctx: CanvasRenderingContext2D,
  edges: GraphEdge[],
  preparedMap: Map<string, PreparedNode>,
  expandSmooth: number,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  activeNodeId: string | null,
  signalMap: Map<string, MemorySignalMode>,
  activePulses: EnergyPulse[],
  galaxyLight: boolean
) {
  if (expandSmooth <= 0.02) return;

  // Track edges currently brightened by energy pulses
  const energizedEdges = new Map<string, number>();
  for (let i = 0; i < activePulses.length; i += 1) {
    const p = activePulses[i];
    energizedEdges.set(p.edgeKey, Math.max(energizedEdges.get(p.edgeKey) ?? 0, 1));
  }

  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i];
    const a = preparedMap.get(e.fromId);
    const b = preparedMap.get(e.toId);
    if (!a || !b) continue;

    const signaledEdge = signalMap.has(e.fromId) || signalMap.has(e.toId);
    const connectedToActive =
      signaledEdge || activeNodeId === e.fromId || activeNodeId === e.toId;
    const pulseBoost = energizedEdges.get(e.key) ?? 0;

    let baseAlpha = 0.26;
    let lineWidth = 1.0;
    if (e.kind === "apex-hub") {
      baseAlpha = 0.38;
      lineWidth = 1.35;
    } else if (e.kind === "hub-hub") {
      baseAlpha = 0.25;
      lineWidth = 1.1;
    } else if (e.kind === "rag-bridge") {
      baseAlpha = 0.26;
      lineWidth = 1.05;
    } else if (e.kind === "cross-link") {
      baseAlpha = 0.18;
      lineWidth = 0.85;
    }

    const alpha =
      (baseAlpha + (connectedToActive ? 0.44 : 0) + pulseBoost * 0.35) *
      expandSmooth *
      (galaxyLight ? 0.92 : 1);

    ctx.strokeStyle = rgba(signaledEdge ? ICE_RGB : e.rgb, Math.min(0.95, alpha));
    ctx.lineWidth = lineWidth + (connectedToActive ? 0.75 : 0) + pulseBoost * 0.7;
    if (e.kind === "cross-link") ctx.setLineDash([3, 5]);
    else if (e.kind === "rag-bridge") ctx.setLineDash([5, 3]);

    ctx.beginPath();
    ctx.moveTo(a.proj.sx, a.proj.sy);
    if (e.kind === "rag-bridge" || e.kind === "cross-link") {
      const midWorld = lerpVec3(a.world, b.world, 0.5);
      const ctrlWorld = lerpVec3(midWorld, { x: 0, y: 0.12, z: 0 }, 0.34);
      const ctrlProj = projectView(rotateView(ctrlWorld, yaw, pitch), cx, cy, focal);
      if (ctrlProj) {
        ctx.quadraticCurveTo(ctrlProj.sx, ctrlProj.sy, b.proj.sx, b.proj.sy);
      } else {
        ctx.lineTo(b.proj.sx, b.proj.sy);
      }
    } else {
      ctx.lineTo(b.proj.sx, b.proj.sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawOpeningExplosion(
  ctx: CanvasRenderingContext2D,
  explosion: ExplosionEffect,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  focal: number,
  galaxyLight: boolean
) {
  if (!explosion.active) return;
  const p = clamp(explosion.progress, 0, 1);
  const env = Math.sin(p * Math.PI);
  if (env <= 0.01) return;

  const centerProj = projectView(rotateView({ x: 0, y: 0.12, z: 0 }, yaw, pitch), cx, cy, focal);
  const cyan: Rgb = galaxyLight ? [0, 150, 220] : CYAN_RGB;
  const ice: Rgb = galaxyLight ? [2, 132, 199] : ICE_RGB;

  if (centerProj) {
    // Rapid expanding supernova plasma flash + 2 shockwave rings
    const flashR = lerp(18, 220, smoothstep(p));
    const flashGrad = ctx.createRadialGradient(
      centerProj.sx,
      centerProj.sy,
      1,
      centerProj.sx,
      centerProj.sy,
      flashR
    );
    flashGrad.addColorStop(0, rgba(ice, 0.55 * (1 - p)));
    flashGrad.addColorStop(0.35, rgba(cyan, 0.28 * env));
    flashGrad.addColorStop(1, rgba(cyan, 0));
    ctx.fillStyle = flashGrad;
    ctx.beginPath();
    ctx.arc(centerProj.sx, centerProj.sy, flashR, 0, Math.PI * 2);
    ctx.fill();

    for (let r = 0; r < 2; r += 1) {
      const rp = clamp(p * (1 + r * 0.22) - r * 0.08, 0, 1);
      if (rp <= 0 || rp >= 1) continue;
      const ringR = lerp(12, 265, rp);
      ctx.strokeStyle = rgba(r === 0 ? ice : cyan, Math.sin(rp * Math.PI) * 0.85);
      ctx.lineWidth = 2.4 * (1 - rp * 0.6);
      ctx.beginPath();
      ctx.arc(centerProj.sx, centerProj.sy, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Radial plasma sparks bursting outward in 3D space
  for (let i = 0; i < explosion.sparks.length; i += 1) {
    const sp = explosion.sparks[i];
    const dist = sp.speed * smoothstep(p);
    const tailDist = Math.max(0, dist - 0.36 * (1 - p * 0.5));
    const headWorld: Vec3 = {
      x: sp.dir.x * dist,
      y: sp.dir.y * dist + 0.12,
      z: sp.dir.z * dist,
    };
    const tailWorld: Vec3 = {
      x: sp.dir.x * tailDist,
      y: sp.dir.y * tailDist + 0.12,
      z: sp.dir.z * tailDist,
    };
    const hp = projectView(rotateView(headWorld, yaw, pitch), cx, cy, focal);
    const tp = projectView(rotateView(tailWorld, yaw, pitch), cx, cy, focal);
    if (!hp || !tp) continue;

    ctx.strokeStyle = rgba(ice, env * 0.85);
    ctx.lineWidth = sp.size * (1 - p * 0.4);
    ctx.beginPath();
    ctx.moveTo(tp.sx, tp.sy);
    ctx.lineTo(hp.sx, hp.sy);
    ctx.stroke();

    ctx.fillStyle = rgba([255, 255, 255], env * 0.92);
    ctx.beginPath();
    ctx.arc(hp.sx, hp.sy, sp.size * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEnergyPulsesAndShockwaves(
  ctx: CanvasRenderingContext2D,
  pulses: EnergyPulse[],
  shockwaves: Shockwave[],
  preparedMap: Map<string, PreparedNode>,
  apexFallbackProj: ProjectedPoint | null,
  galaxyLight: boolean
) {
  // Draw glowing energy packets + comet trails along edges
  for (let i = 0; i < pulses.length; i += 1) {
    const p = pulses[i];
    const fromNode = preparedMap.get(p.fromId);
    const toNode = preparedMap.get(p.toId);
    const pFrom = fromNode?.proj ?? (p.fromId === "apex-core" ? apexFallbackProj : null);
    const pTo = toNode?.proj ?? (p.toId === "apex-core" ? apexFallbackProj : null);
    if (!pFrom || !pTo) continue;

    const headU = smoothstep(p.progress);
    const tailU = Math.max(0, headU - 0.22);
    const hx = lerp(pFrom.sx, pTo.sx, headU);
    const hy = lerp(pFrom.sy, pTo.sy, headU);
    const tx = lerp(pFrom.sx, pTo.sx, tailU);
    const ty = lerp(pFrom.sy, pTo.sy, tailU);

    const grad = ctx.createLinearGradient(tx, ty, hx, hy);
    grad.addColorStop(0, rgba(p.rgb, 0));
    grad.addColorStop(1, rgba(p.rgb, galaxyLight ? 0.88 : 0.96));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    const glowR = 9;
    const halo = ctx.createRadialGradient(hx, hy, 0.5, hx, hy, glowR);
    halo.addColorStop(0, rgba([255, 255, 255], 0.95));
    halo.addColorStop(0.35, rgba(p.rgb, 0.85));
    halo.addColorStop(1, rgba(p.rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(hx, hy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw expanding radial shockwaves around queried nodes
  for (let i = 0; i < shockwaves.length; i += 1) {
    const sw = shockwaves[i];
    const target = preparedMap.get(sw.nodeId);
    const pt = target?.proj ?? (sw.nodeId === "apex-core" ? apexFallbackProj : null);
    if (!pt) continue;

    const radius = lerp(6, 32, sw.progress);
    const alpha = (1 - sw.progress) * (galaxyLight ? 0.72 : 0.82);
    ctx.strokeStyle = rgba(sw.rgb, alpha);
    ctx.lineWidth = 1.6 * (1 - sw.progress * 0.5);
    ctx.beginPath();
    ctx.arc(pt.sx, pt.sy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

type BankSourceBucket = "experience" | "observation" | "world" | "files" | "other";

function classifyMemoryCategory(source?: string | null): BankSourceBucket {
  const s = (source ?? "").trim().toLowerCase();
  if (!s) return "other";
  if (s.includes("experience") || s.includes("episodic")) return "experience";
  if (s.includes("observation") || s.includes("mental")) return "observation";
  if (s.includes("world") || s.includes("fact") || s.includes("entity")) return "world";
  if (s.includes("doc") || s.includes("file") || s.includes("rag") || s.includes("pdf")) {
    return "files";
  }
  return "other";
}

function formatRagFileName(path: string): string {
  const clean = path.trim().replace(/[\\/]+$/, "");
  if (!clean) return path;
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

function formatMemoryDate(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return parsed.toLocaleDateString();
}

export function AuraPyramidStation({
  aiStatus,
  hindsightStatus,
  raglightStatus,
  memories = [],
  galaxySnapshot = null,
  focusedMemoryId = null,
  onFocusedMemoryHandled,
  onOpenHindsightBank,
  creatingMemoryIds = [],
  activeMemoryIds = [],
  activePulseTick = 0,
  speaking = false,
  listening = false,
  expanded: expandedProp,
  onExpandedChange,
  onOpenSettings,
}: AuraPyramidStationProps) {
  const { t, i18n } = useTranslation();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = expandedProp !== undefined ? expandedProp : internalExpanded;

  const setExpandedState = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(isExpanded) : next;
      if (expandedProp === undefined) {
        setInternalExpanded(resolved);
      }
      onExpandedChange?.(resolved);
    },
    [expandedProp, isExpanded, onExpandedChange]
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [galaxySearch, setGalaxySearch] = useState("");
  const [enable4d, setEnable4d] = useState(true);
  const [pulseLit, setPulseLit] = useState(false);

  // Interactive Bank Memory & Files Explorer state
  const [bankExplorerOpen, setBankExplorerOpen] = useState(false);
  const [explorerBank, setExplorerBank] = useState<string>("");
  const [explorerCategory, setExplorerCategory] = useState<"all" | BankSourceBucket>("all");
  const [explorerQuery, setExplorerQuery] = useState("");
  const [bankQueriedMemories, setBankQueriedMemories] = useState<HindsightRecallItem[]>([]);
  const [bankRagSources, setBankRagSources] = useState<string[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [expandedMemoryIds, setExpandedMemoryIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (activePulseTick <= 0) return;
    setPulseLit(true);
    const timer = window.setTimeout(() => {
      setPulseLit(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [activePulseTick]);

  const aiOnline = Boolean(
    aiStatus?.ready &&
      aiStatus.activeProvider &&
      aiStatus.activeProvider !== "offline"
  );
  const aiStatusLabel = aiOnline
    ? aiStatus?.model
      ? `${aiStatus.activeProvider} · ${aiStatus.model}`
      : (aiStatus?.activeProvider ?? t("settings.items.aiProvider.offline"))
    : t("settings.items.aiProvider.offline");

  const hindsightOnline = Boolean(hindsightStatus?.online || galaxySnapshot?.online);
  const hindsightBanks = useMemo(() => {
    const set = new Set<string>(Array.isArray(hindsightStatus?.banks) ? hindsightStatus.banks : []);
    (galaxySnapshot?.banks ?? []).forEach((b) => {
      if (b.id.trim()) set.add(b.id.trim());
    });
    return Array.from(set);
  }, [hindsightStatus?.banks, galaxySnapshot?.banks]);
  const hindsightBanksCount = hindsightBanks.length;
  const hindsightLocalCount =
    typeof hindsightStatus?.localCount === "number" ? hindsightStatus.localCount : 0;
  const hindsightStatusLabel = hindsightOnline
    ? t("hermes.station.hindsightOnline", { banks: hindsightBanksCount })
    : t("hermes.station.hindsightLocal", { count: hindsightLocalCount });

  const ragRunning = Boolean(raglightStatus?.running);
  const ragEnabled = Boolean(raglightStatus?.enabled);
  const ragReady = Boolean(!ragRunning && ragEnabled);
  const ragFolders = useMemo(
    () => (Array.isArray(raglightStatus?.folders) ? raglightStatus.folders : []),
    [raglightStatus?.folders]
  );
  const ragFoldersCount = ragFolders.length;
  const raglightStatusLabel = ragRunning
    ? t("hermes.station.raglightOnline", { folders: ragFoldersCount })
    : ragReady
      ? t("hermes.station.raglightReady", { folders: ragFoldersCount })
      : t("hermes.station.raglightIdle");

  const globeMetaMap = useMemo(() => {
    const map = new Map<string, HindsightGalaxyGlobe>();
    for (const g of galaxySnapshot?.globes ?? []) {
      if (g.id) map.set(g.id, g);
    }
    return map;
  }, [galaxySnapshot?.globes]);

  const combinedMemories = useMemo(() => {
    const merged: HindsightRecallItem[] = [];
    const seen = new Set<string>();
    const appendUnique = (items: HindsightRecallItem[]) => {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const key = item.id ? `id:${item.id}` : `${item.bank || ""}::${item.content}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
    };
    const snapshotRecall: HindsightRecallItem[] = (galaxySnapshot?.globes ?? []).map((g) => ({
      id: g.id,
      bank: g.bankId,
      content: g.content,
      source: g.factType || "hindsight_http",
      createdAt: g.date ?? null,
    }));
    appendUnique(snapshotRecall);
    appendUnique(memories);
    appendUnique(bankQueriedMemories);
    return merged;
  }, [galaxySnapshot?.globes, memories, bankQueriedMemories]);

  const explorerBanks = useMemo(() => {
    const set = new Set<string>();
    if (hindsightStatus?.defaultBank?.trim()) set.add(hindsightStatus.defaultBank.trim());
    hindsightBanks.forEach((b) => {
      if (b.trim()) set.add(b.trim());
    });
    combinedMemories.forEach((m) => {
      if (m.bank?.trim()) set.add(m.bank.trim());
    });
    return Array.from(set);
  }, [hindsightStatus?.defaultBank, hindsightBanks, combinedMemories]);

  const activeExplorerBank = useMemo(() => {
    if (explorerBank && explorerBanks.includes(explorerBank)) return explorerBank;
    return explorerBanks[0] ?? "";
  }, [explorerBank, explorerBanks]);

  const topology = useMemo(
    () =>
      buildGraphTopology(
        combinedMemories,
        hindsightBanks,
        ragFolders,
        ragEnabled,
        ragRunning,
        globeMetaMap,
        galaxySnapshot?.links
      ),
    [
      combinedMemories,
      hindsightBanks,
      ragFolders,
      ragEnabled,
      ragRunning,
      globeMetaMap,
      galaxySnapshot?.links,
    ]
  );

  const orbitMemoryCount = Math.min(combinedMemories.length, MAX_ORBIT_MEMORIES);
  const selectedGraphNode = useMemo(
    () => (selectedNodeId ? topology.nodeMap.get(selectedNodeId) ?? null : null),
    [topology, selectedNodeId]
  );
  const hoveredGraphNode = useMemo(
    () => (hoveredNodeId ? topology.nodeMap.get(hoveredNodeId) ?? null : null),
    [topology, hoveredNodeId]
  );
  const activeGraphNode = hoveredGraphNode ?? selectedGraphNode;

  // Refs for 60fps animation loop without React re-renders
  const viewportRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ width: 760, height: 520, dpr: 1 });
  const yawRef = useRef(DEFAULT_YAW);
  const pitchRef = useRef(DEFAULT_PITCH);
  const lookYawRef = useRef(0);
  const lookPitchRef = useRef(0);
  const lastEmittedCamRef = useRef({ yaw: 0, pitch: 0, zoom: DEFAULT_ZOOM });
  const velYawRef = useRef(0);
  const velPitchRef = useRef(0);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const targetZoomRef = useRef(DEFAULT_ZOOM);
  const expandProgressRef = useRef(isExpanded ? 1 : 0);
  const wAngleRef = useRef(0.35);
  const timeRef = useRef(0);
  const speakLevelRef = useRef(0);
  const listenLevelRef = useRef(0);
  const resettingRef = useRef(false);
  const flyTargetRef = useRef<{ yaw: number; pitch: number; zoom: number } | null>(null);
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const pointerLastRef = useRef({ x: 0, y: 0 });
  const reducedMotionRef = useRef(false);
  /** The global UI theme, tracked only to know when the galaxy must repaint. */
  const isLightThemeRef = useRef(false);
  const projectedHitsRef = useRef<ProjectedHit[]>([]);
  const pyramidCenterHitRef = useRef<{ sx: number; sy: number; radius: number } | null>(null);

  const pulsesRef = useRef<EnergyPulse[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const lastPulseTickRef = useRef(activePulseTick);
  const pulseTimerRef = useRef(0);
  const seenMemoryIdsRef = useRef<Set<string>>(new Set());
  const hasBootMemoriesRef = useRef(false);
  const prevSignalTickRef = useRef(activePulseTick);
  const prevSpeakingSignalRef = useRef(speaking);
  const memorySignalMapRef = useRef<
    Map<string, { mode: MemorySignalMode; expiresAt: number }>
  >(new Map());
  const explosionRef = useRef<ExplosionEffect>({
    active: false,
    progress: 0,
    sparks: [],
  });
  const wasExpandedOpenRef = useRef(isExpanded);
  const scrollExpandSyncRef = useRef<(next: boolean) => void>(() => {});
  scrollExpandSyncRef.current = (next: boolean) => {
    if (next !== isExpanded) {
      setExpandedState(next);
    }
  };

  const snapshotRef = useRef<SceneSnapshot>({
    aiOnline,
    hindsightOnline,
    ragRunning,
    ragReady,
    speaking,
    listening,
    expanded: isExpanded,
    enable4d,
    activePulseTick,
    activeNodeId: activeGraphNode?.id ?? null,
    topology,
  });

  snapshotRef.current = {
    aiOnline,
    hindsightOnline,
    ragRunning,
    ragReady,
    speaking,
    listening,
    expanded: isExpanded,
    enable4d,
    activePulseTick,
    activeNodeId: activeGraphNode?.id ?? null,
    topology,
  };

  const emitCameraOrbit = useCallback((force = false) => {
    if (typeof window === "undefined") return;
    const yaw = lookYawRef.current;
    const pitch = lookPitchRef.current;
    const zoom = zoomRef.current;
    const lastCam = lastEmittedCamRef.current;
    if (
      force ||
      Math.abs(yaw - lastCam.yaw) > 0.0005 ||
      Math.abs(pitch - lastCam.pitch) > 0.0005 ||
      Math.abs(zoom - lastCam.zoom) > 0.001
    ) {
      lastCam.yaw = yaw;
      lastCam.pitch = pitch;
      lastCam.zoom = zoom;
      const detail = { yaw, pitch, zoom };
      window.dispatchEvent(new CustomEvent("auradesk://camera-orbit", { detail }));
      window.dispatchEvent(new CustomEvent("aura:station-camera", { detail }));
    }
  }, []);

  const spawnShockwave = useCallback((nodeId: string, rgb: Rgb) => {
    if (shockwavesRef.current.length >= MAX_ACTIVE_SHOCKWAVES) {
      shockwavesRef.current.shift();
    }
    shockwavesRef.current.push({ nodeId, progress: 0, rgb });
  }, []);

  const spawnPulseCascade = useCallback(
    (topo: GraphTopology, burst: boolean) => {
      const hubEdges = topo.edges.filter((e) => e.kind === "apex-hub");
      if (hubEdges.length === 0) return;

      const count = burst ? Math.min(hubEdges.length, 4) : 1;
      const offset = Math.floor(Math.random() * hubEdges.length);
      for (let i = 0; i < count; i += 1) {
        if (pulsesRef.current.length >= MAX_ACTIVE_PULSES) {
          pulsesRef.current.shift();
        }
        const edge = hubEdges[(offset + i) % hubEdges.length];
        pulsesRef.current.push({
          edgeKey: edge.key,
          fromId: edge.fromId,
          toId: edge.toId,
          progress: 0,
          speed: 0.95 + Math.random() * 0.45,
          rgb: edge.rgb,
          hop: 0,
        });
      }
      if (burst) {
        spawnShockwave("apex-core", CYAN_RGB);
      }
    },
    [spawnShockwave]
  );

  const spawnNodeBurst = useCallback(
    (topo: GraphTopology, node: GraphNode) => {
      spawnShockwave(node.id, node.rgb);
      const connected = topo.adjacency.get(node.id) ?? [];
      for (let i = 0; i < Math.min(connected.length, 4); i += 1) {
        if (pulsesRef.current.length >= MAX_ACTIVE_PULSES) {
          pulsesRef.current.shift();
        }
        const edge = connected[i];
        const targetId = edge.fromId === node.id ? edge.toId : edge.fromId;
        pulsesRef.current.push({
          edgeKey: edge.key,
          fromId: node.id,
          toId: targetId,
          progress: 0,
          speed: 1.15,
          rgb: node.rgb,
          hop: 2,
        });
      }
    },
    [spawnShockwave]
  );

  const spawnOpeningExplosion = useCallback(
    (topo: GraphTopology) => {
      if (reducedMotionRef.current) return;
      const sparks: Array<{ dir: Vec3; speed: number; size: number }> = [];
      const sparkCount = 28;
      for (let i = 0; i < sparkCount; i += 1) {
        const y = 1 - ((i + 0.5) / sparkCount) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const phi = i * Math.PI * (3 - Math.sqrt(5));
        sparks.push({
          dir: { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r },
          speed: 1.75 + (i % 5) * 0.34,
          size: 1.4 + (i % 3) * 0.65,
        });
      }
      explosionRef.current = { active: true, progress: 0, sparks };

      // Full-network neural eruption across Hindsight & RAGLight connections
      spawnShockwave("apex-core", ICE_RGB);
      for (let i = 0; i < topo.edges.length; i += 1) {
        if (pulsesRef.current.length >= MAX_ACTIVE_PULSES) break;
        const edge = topo.edges[i];
        if (edge.kind === "apex-hub" || edge.kind === "rag-bridge" || i % 2 === 0) {
          pulsesRef.current.push({
            edgeKey: edge.key,
            fromId: edge.fromId,
            toId: edge.toId,
            progress: 0,
            speed: 1.15 + (i % 4) * 0.18,
            rgb: edge.kind === "rag-bridge" ? ICE_RGB : edge.rgb,
            hop: edge.kind === "apex-hub" ? 0 : 2,
          });
        }
      }
    },
    [spawnShockwave]
  );

  // Automatically detect and signal memories being created ("creating") or actively utilized ("using")
  useEffect(() => {
    const nowT = timeRef.current;
    const nowWall = Date.now();
    const sigMap = memorySignalMapRef.current;

    if (!hasBootMemoriesRef.current) {
      if (memories.length > 0) {
        memories.forEach((m, idx) => {
          const id = m.id || `mem-${idx}`;
          seenMemoryIdsRef.current.add(id);
          if (m.createdAt) {
            const age = nowWall - new Date(m.createdAt).getTime();
            if (!Number.isNaN(age) && age >= 0 && age < 12000) {
              sigMap.set(id, { mode: "creating", expiresAt: nowT + 6.0 });
            }
          }
        });
        hasBootMemoriesRef.current = true;
      } else if (activePulseTick > 0) {
        hasBootMemoriesRef.current = true;
      }
    } else {
      memories.forEach((m, idx) => {
        const id = m.id || `mem-${idx}`;
        if (!seenMemoryIdsRef.current.has(id)) {
          seenMemoryIdsRef.current.add(id);
          sigMap.set(id, { mode: "creating", expiresAt: nowT + 6.5 });
          const node = topology.nodeMap.get(id);
          if (node) spawnNodeBurst(topology, node);
        }
      });
    }

    const pulseIncreased = activePulseTick > prevSignalTickRef.current;
    const startedSpeaking = speaking && !prevSpeakingSignalRef.current;
    prevSignalTickRef.current = activePulseTick;
    prevSpeakingSignalRef.current = speaking;

    if ((pulseIncreased || startedSpeaking) && memories.length > 0) {
      const topUsed = Math.min(4, memories.length);
      for (let i = 0; i < topUsed; i += 1) {
        const id = memories[i].id || `mem-${i}`;
        const existing = sigMap.get(id);
        if (!existing || existing.mode !== "creating" || existing.expiresAt <= nowT) {
          sigMap.set(id, { mode: "using", expiresAt: nowT + 5.5 });
          const node = topology.nodeMap.get(id);
          if (node) spawnNodeBurst(topology, node);
        }
      }
    }

    creatingMemoryIds.forEach((id) => {
      sigMap.set(id, { mode: "creating", expiresAt: nowT + 6.0 });
    });
    activeMemoryIds.forEach((id) => {
      const cur = sigMap.get(id);
      if (!cur || cur.mode !== "creating") {
        sigMap.set(id, { mode: "using", expiresAt: nowT + 5.0 });
      }
    });
  }, [memories, activePulseTick, speaking, creatingMemoryIds, activeMemoryIds, topology, spawnNodeBurst]);

  const drawScene = useCallback(
    (dt: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const snap = snapshotRef.current;
      const { width, height, dpr } = sizeRef.current;

      // Two distinct themes live here:
      //  - `GALAXY_LIGHT` is the GALAXY theme. The galaxy has its own visual
      //    identity and always renders in its deep-space palette, so every
      //    cosmic body (stars, orbits, globes, pulses) AND every overlay it
      //    draws (node labels) uses the dark branch regardless of the global
      //    UI theme.
      //  - The GLOBAL UI theme never reaches this canvas: the galaxy is a
      //    deep-space surface in both themes, so what it draws must not
      //    change when the app around it changes colour.

      // Smoothly lerp activity, zoom, and scroll-coupled expandProgress inside refs
      //
      // With reduced motion the frame must be DETERMINISTIC: the scene is
      // drawn once and redrawn on every resize or theme change, and every
      // draw has to produce the very same pixels. A lerp that creeps a
      // little on each draw would make every redraw differ from the last
      // one — the canvas would never settle. So under reduced motion the
      // values snap to their targets instead.
      const still = reducedMotionRef.current;
      const rate = still ? 1 : 1 - Math.exp(-Math.max(0.001, dt) * 6.0);
      const zoomRate = still ? 1 : 1 - Math.exp(-Math.max(0.001, dt) * 4.4);
      const expandRate = still ? 1 : 1 - Math.exp(-Math.max(0.001, dt) * 2.8);
      speakLevelRef.current = lerp(speakLevelRef.current, snap.speaking ? 1 : 0, rate);
      listenLevelRef.current = lerp(
        listenLevelRef.current,
        snap.listening && !snap.speaking ? 1 : 0,
        rate
      );
      zoomRef.current = lerp(zoomRef.current, targetZoomRef.current, zoomRate);
      const scrollExpandBoost = clamp((zoomRef.current - 1.03) / 0.28, 0, 1);
      const targetExpand = Math.max(snap.expanded ? 1 : 0, scrollExpandBoost);
      if (targetExpand >= 0.32 && !wasExpandedOpenRef.current) {
        wasExpandedOpenRef.current = true;
        spawnOpeningExplosion(snap.topology);
      } else if (targetExpand < 0.08 && wasExpandedOpenRef.current) {
        wasExpandedOpenRef.current = false;
      }

      expandProgressRef.current = lerp(
        expandProgressRef.current,
        targetExpand,
        expandRate
      );
      const expandSmooth = smoothstep(expandProgressRef.current);

      if (!reducedMotionRef.current && explosionRef.current.active) {
        explosionRef.current.progress += dt * 1.15;
        if (explosionRef.current.progress >= 1) {
          explosionRef.current.active = false;
          explosionRef.current.progress = 0;
        }
      }

      if (!reducedMotionRef.current) {
        timeRef.current += dt;
        wAngleRef.current +=
          dt *
          (0.34 +
            listenLevelRef.current * 0.6 +
            speakLevelRef.current * (1.15 + 0.35 * Math.sin(timeRef.current * 5.2)));
      }

      // Check activePulseTick increment
      if (snap.activePulseTick > lastPulseTickRef.current) {
        lastPulseTickRef.current = snap.activePulseTick;
        if (!reducedMotionRef.current) {
          spawnPulseCascade(snap.topology, true);
        }
      }

      // Ambient / active energy pulse scheduler
      if (!reducedMotionRef.current) {
        pulseTimerRef.current += dt;
        const interval =
          speakLevelRef.current > 0.3
            ? 0.28
            : listenLevelRef.current > 0.3
              ? 0.44
              : expandSmooth > 0.6
                ? 2.1
                : 0;
        if (interval > 0 && pulseTimerRef.current >= interval) {
          pulseTimerRef.current = 0;
          spawnPulseCascade(snap.topology, speakLevelRef.current > 0.3);
        }
      }

      // Advance pulses & cascade hops (Apex -> Hubs -> Leaves -> Apex return)
      if (!reducedMotionRef.current && pulsesRef.current.length > 0) {
        const nextPulses: EnergyPulse[] = [];
        for (let i = 0; i < pulsesRef.current.length; i += 1) {
          const p = pulsesRef.current[i];
          const np = p.progress + dt * p.speed;
          if (np < 1) {
            nextPulses.push({ ...p, progress: np });
          } else {
            spawnShockwave(p.toId, p.rgb);
            if (p.hop === 0) {
              const children = (snap.topology.adjacency.get(p.toId) ?? []).filter(
                (e) => e.fromId === p.toId && e.kind === "hub-leaf"
              );
              const pickCount = Math.min(children.length, 2);
              const startIdx = children.length > 0 ? Math.floor(Math.random() * children.length) : 0;
              for (let c = 0; c < pickCount; c += 1) {
                if (nextPulses.length >= MAX_ACTIVE_PULSES) break;
                const childEdge = children[(startIdx + c) % children.length];
                nextPulses.push({
                  edgeKey: childEdge.key,
                  fromId: childEdge.fromId,
                  toId: childEdge.toId,
                  progress: 0,
                  speed: 1.05 + Math.random() * 0.35,
                  rgb: childEdge.rgb,
                  hop: 1,
                });
              }
            } else if (p.hop === 1 && nextPulses.length < MAX_ACTIVE_PULSES) {
              nextPulses.push({
                edgeKey: `return:${p.toId}->apex-core`,
                fromId: p.toId,
                toId: "apex-core",
                progress: 0,
                speed: 1.25,
                rgb: CYAN_RGB,
                hop: 2,
              });
            }
          }
        }
        pulsesRef.current = nextPulses;
      }

      // Advance shockwaves
      if (!reducedMotionRef.current && shockwavesRef.current.length > 0) {
        const nextSw: Shockwave[] = [];
        for (let i = 0; i < shockwavesRef.current.length; i += 1) {
          const sw = shockwavesRef.current[i];
          const np = sw.progress + dt * 1.45;
          if (np < 1) nextSw.push({ ...sw, progress: np });
        }
        shockwavesRef.current = nextSw;
      }

      // Update camera orientation
      if (!draggingRef.current) {
        if (flyTargetRef.current) {
          const ft = flyTargetRef.current;
          const yawDiff = Math.atan2(
            Math.sin(ft.yaw - yawRef.current),
            Math.cos(ft.yaw - yawRef.current)
          );
          const pitchDiff = ft.pitch - pitchRef.current;
          const ease = 1 - Math.exp(-Math.max(0.016, dt) * 7.2);
          yawRef.current += yawDiff * ease;
          pitchRef.current += pitchDiff * ease;
          lookYawRef.current += -lookYawRef.current * ease;
          lookPitchRef.current += -lookPitchRef.current * ease;
          targetZoomRef.current = ft.zoom;
          if (Math.abs(yawDiff) < 0.008 && Math.abs(pitchDiff) < 0.008) {
            flyTargetRef.current = null;
          }
        } else if (resettingRef.current) {
          const yawDiff = Math.atan2(
            Math.sin(DEFAULT_YAW - yawRef.current),
            Math.cos(DEFAULT_YAW - yawRef.current)
          );
          const pitchDiff = DEFAULT_PITCH - pitchRef.current;
          const ease = 1 - Math.exp(-Math.max(0.016, dt) * 8.5);
          yawRef.current += yawDiff * ease;
          pitchRef.current += pitchDiff * ease;
          lookYawRef.current += -lookYawRef.current * ease;
          lookPitchRef.current += -lookPitchRef.current * ease;
          if (
            Math.abs(yawDiff) < 0.003 &&
            Math.abs(pitchDiff) < 0.003 &&
            Math.abs(lookYawRef.current) < 0.003 &&
            Math.abs(lookPitchRef.current) < 0.003 &&
            Math.abs(zoomRef.current - targetZoomRef.current) < 0.006
          ) {
            yawRef.current = DEFAULT_YAW;
            pitchRef.current = DEFAULT_PITCH;
            lookYawRef.current = 0;
            lookPitchRef.current = 0;
            zoomRef.current = targetZoomRef.current;
            resettingRef.current = false;
          }
        } else {
          const damping = Math.exp(-Math.max(0, dt) * 5.2);
          yawRef.current += velYawRef.current * dt;
          pitchRef.current = clamp(
            pitchRef.current + velPitchRef.current * dt,
            MIN_PITCH,
            MAX_PITCH
          );
          lookYawRef.current += velYawRef.current * dt * 1.15;
          lookPitchRef.current = clamp(
            lookPitchRef.current + velPitchRef.current * dt,
            MIN_PITCH,
            MAX_PITCH
          );
          velYawRef.current *= damping;
          velPitchRef.current *= damping;

          if (!reducedMotionRef.current) {
            const idleSpin =
              (0.24 - expandSmooth * 0.08) +
              speakLevelRef.current * 0.14 +
              listenLevelRef.current * 0.09;
            yawRef.current += dt * idleSpin;
          }
        }
      }

      emitCameraOrbit(false);

      const t = timeRef.current;
      const yaw = yawRef.current;
      const pitch = pitchRef.current + speakLevelRef.current * 0.038 * Math.sin(t * 3.1);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Position center slightly higher so bottom-28 stays completely clear for floating prompt bar
      const cx = width * 0.5;
      const cy = height * 0.44;
      const baseFocal = Math.min(width * 0.72, height * 0.96);
      const focal = baseFocal * zoomRef.current;

      drawBackgroundStars(ctx, width, height, t, GALAXY_LIGHT);

      // Compute world & projected positions for all topology nodes
      const preparedNodes: PreparedNode[] = [];
      const preparedMap = new Map<string, PreparedNode>();
      const activeHindsightRings = new Set<number>();
      let hasRagRing = false;

      for (let i = 0; i < snap.topology.nodes.length; i += 1) {
        const node = snap.topology.nodes[i];
        let orbitPos: Vec3 = { x: 0, y: 0, z: 0 };
        let alphaScale = 1;

        if (node.kind === "apex") {
          orbitPos = node.orbitPos;
          alphaScale = expandSmooth;
        } else if (node.kind === "raglight-hub") {
          orbitPos = { x: 0, y: 0, z: 0 };
          alphaScale = expandSmooth;
        } else if (node.kind === "bank") {
          const ring = HINDSIGHT_RINGS[node.orbitRingIndex];
          const theta = node.orbitPhase + t * ring.speed;
          const bob = 0.04 * Math.sin(t * 1.6 + node.bobOffset);
          orbitPos = node.showInCollapsed
            ? ringPointToWorld(ring, theta, bob)
            : { x: 0, y: 0, z: 0 };
          if (node.showInCollapsed) activeHindsightRings.add(node.orbitRingIndex);
          alphaScale = node.showInCollapsed ? 1 : expandSmooth;
        } else if (node.kind === "memory") {
          const ring = HINDSIGHT_RINGS[node.orbitRingIndex];
          const theta = node.orbitPhase + t * ring.speed;
          const bob = 0.04 * Math.sin(t * 1.6 + node.bobOffset);
          orbitPos = ringPointToWorld(ring, theta, bob);
          activeHindsightRings.add(node.orbitRingIndex);
          alphaScale = 1;
        } else if (node.kind === "raglight") {
          const theta = node.orbitPhase + t * RAGLIGHT_RING.speed;
          const bob = 0.04 * Math.sin(t * 1.6 + node.bobOffset);
          orbitPos = ringPointToWorld(RAGLIGHT_RING, theta, bob);
          hasRagRing = true;
          alphaScale = 1;
        }

        if (alphaScale <= 0.02) continue;

        // Subtle organic float in expanded graph space
        const drift: Vec3 =
          expandSmooth > 0.02
            ? {
                x: Math.sin(t * 0.7 + i * 1.1) * 0.03 * expandSmooth,
                y: Math.cos(t * 0.85 + i * 0.9) * 0.03 * expandSmooth,
                z: Math.sin(t * 0.65 + i * 1.3) * 0.03 * expandSmooth,
              }
            : { x: 0, y: 0, z: 0 };

        const worldBase = lerpVec3(orbitPos, node.graphPos, expandSmooth);
        const world: Vec3 = {
          x: worldBase.x + drift.x,
          y: worldBase.y + drift.y,
          z: worldBase.z + drift.z,
        };
        const view = rotateView(world, yaw, pitch);
        const proj = projectView(view, cx, cy, focal);
        if (!proj) continue;

        const radiusPx = node.radiusBase * (CAM_DIST / proj.depth) * (0.85 + 0.15 * zoomRef.current);
        const prep: PreparedNode = { node, world, view, proj, radiusPx, alphaScale };
        preparedNodes.push(prep);
        preparedMap.set(node.id, prep);
      }

      const hindsightRings = Array.from(activeHindsightRings.values());
      const behindNodes = preparedNodes
        .filter((o) => o.view.z < 0)
        .sort((a, b) => a.view.z - b.view.z);
      const frontNodes = preparedNodes
        .filter((o) => o.view.z >= 0)
        .sort((a, b) => a.view.z - b.view.z);

      const activityBoost = Math.max(speakLevelRef.current, listenLevelRef.current);
      const ragActive = snap.ragRunning || snap.activeNodeId?.startsWith("rag") === true;

      // Build current active memory signal map (creating / using)
      const activeSignals = new Map<string, MemorySignalMode>();
      memorySignalMapRef.current.forEach((entry, id) => {
        if (entry.expiresAt > t) {
          activeSignals.set(id, entry.mode);
        } else {
          memorySignalMapRef.current.delete(id);
        }
      });

      // Pass 1: Back orbital rings + back nodes
      if (hindsightRings.length > 0 || hasRagRing) {
        drawOrbitRingsPass(
          ctx,
          hindsightRings,
          hasRagRing,
          ragActive,
          expandSmooth,
          yaw,
          pitch,
          cx,
          cy,
          focal,
          GALAXY_LIGHT,
          activityBoost,
          false
        );
      }
      drawNodesPass(
        ctx,
        behindNodes,
        null,
        null,
        expandSmooth,
        t,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        snap.activeNodeId,
        activeSignals,
        ragActive,
        GALAXY_LIGHT
      );

      // Pass 2: Listening ripples + Volumetric Voice Aura & Back 4D Tesseract Shell
      drawListeningRipples(
        ctx,
        t,
        listenLevelRef.current,
        expandSmooth,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        GALAXY_LIGHT
      );

      drawVoiceAuraBloom(
        ctx,
        t,
        speakLevelRef.current,
        listenLevelRef.current,
        expandSmooth,
        zoomRef.current,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        GALAXY_LIGHT
      );

      // Pyramidal / triangular aura shell + expanding voice aura waves (zero cubes!)
      const voiceHarmonic =
        0.5 + 0.5 * (0.65 * Math.sin(t * 7) + 0.35 * Math.sin(t * 13));
      const pyramidDilation =
        1 +
        speakLevelRef.current * (0.26 + 0.14 * voiceHarmonic) +
        listenLevelRef.current * 0.07;
      const auraEnvelopeScale =
        pyramidDilation * (1.14 + speakLevelRef.current * 0.18) + expandSmooth * 0.25;
      const auraEnvelopeAlpha =
        (0.22 + speakLevelRef.current * 0.58 + listenLevelRef.current * 0.25) *
        (1 - expandSmooth * 0.65);
      const auraEnvelopeShell = preparePyramidalAuraShell(
        auraEnvelopeScale,
        t * 0.18,
        yaw,
        pitch,
        cx,
        cy,
        focal
      );

      const waveShells: Array<{ shell: PreparedPyramidAuraShell; alpha: number }> = [];
      const waveDrive = Math.max(speakLevelRef.current, listenLevelRef.current * 0.45);
      if (waveDrive > 0.05 && expandSmooth < 0.75) {
        const waveCount = speakLevelRef.current > 0.1 ? 2 : 1;
        for (let k = 0; k < waveCount; k += 1) {
          const wavePhase = t === 0 ? 0.35 : (t * 0.82 + k * 0.5) % 1;
          const waveAlpha =
            Math.sin(wavePhase * Math.PI) *
            (0.62 * speakLevelRef.current + 0.22 * listenLevelRef.current) *
            (1 - expandSmooth * 0.75);
          if (waveAlpha > 0.02) {
            const waveScale =
              pyramidDilation *
              (1.12 + wavePhase * (0.48 + speakLevelRef.current * 0.38));
            waveShells.push({
              shell: preparePyramidalAuraShell(
                waveScale,
                -t * 0.22 + k * 0.4,
                yaw,
                pitch,
                cx,
                cy,
                focal
              ),
              alpha: waveAlpha,
            });
          }
        }
      }

      drawPyramidalVoiceAuraPass(
        ctx,
        auraEnvelopeShell,
        auraEnvelopeAlpha,
        1.15 + speakLevelRef.current * 0.45,
        false,
        GALAXY_LIGHT
      );
      for (let w = 0; w < waveShells.length; w += 1) {
        drawPyramidalVoiceAuraPass(
          ctx,
          waveShells[w].shell,
          waveShells[w].alpha,
          1.3,
          false,
          GALAXY_LIGHT
        );
      }

      // Pass 3: Blooming & Dilating 3D Pyramid Petals + Nested Self-Inverting 4D Triangles
      const { apexProj, rightFacetProj, centerProj } = drawBloomingPyramid(
        ctx,
        t,
        yaw,
        pitch,
        wAngleRef.current,
        expandSmooth,
        cx,
        cy,
        focal,
        speakLevelRef.current,
        listenLevelRef.current,
        snap,
        GALAXY_LIGHT
      );

      drawPyramidalVoiceAuraPass(
        ctx,
        auraEnvelopeShell,
        auraEnvelopeAlpha,
        1.15 + speakLevelRef.current * 0.45,
        true,
        GALAXY_LIGHT
      );
      for (let w = 0; w < waveShells.length; w += 1) {
        drawPyramidalVoiceAuraPass(
          ctx,
          waveShells[w].shell,
          waveShells[w].alpha,
          1.3,
          true,
          GALAXY_LIGHT
        );
      }

      // Pass 4: Front orbital rings + segmented cluster sectors + 3D graph edges + front nodes
      if (hindsightRings.length > 0 || hasRagRing) {
        drawOrbitRingsPass(
          ctx,
          hindsightRings,
          hasRagRing,
          ragActive,
          expandSmooth,
          yaw,
          pitch,
          cx,
          cy,
          focal,
          GALAXY_LIGHT,
          activityBoost,
          true
        );
      }
      drawClusterSectors(
        ctx,
        snap.topology.clusters,
        expandSmooth,
        t,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        GALAXY_LIGHT
      );
      drawGraphEdges(
        ctx,
        snap.topology.edges,
        preparedMap,
        expandSmooth,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        snap.activeNodeId,
        activeSignals,
        pulsesRef.current,
        GALAXY_LIGHT
      );
      drawNodesPass(
        ctx,
        frontNodes,
        apexProj,
        rightFacetProj,
        expandSmooth,
        t,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        snap.activeNodeId,
        activeSignals,
        ragActive,
        GALAXY_LIGHT
      );

      // Pass 5: Opening Supernova Explosion + Real-Time Energy Pulses + Radial Shockwaves
      drawOpeningExplosion(
        ctx,
        explosionRef.current,
        yaw,
        pitch,
        cx,
        cy,
        focal,
        GALAXY_LIGHT
      );
      drawEnergyPulsesAndShockwaves(
        ctx,
        pulsesRef.current,
        shockwavesRef.current,
        preparedMap,
        apexProj,
        GALAXY_LIGHT
      );

      // Pass 6: Sleek holographic mini-labels over segmented memory nodes
      drawClusterNodeLabels(
        ctx,
        frontNodes,
        expandSmooth,
        zoomRef.current,
        width,
        height,
        snap.activeNodeId,
        activeSignals
      );

      // Store hit-test caches
      projectedHitsRef.current = [...preparedNodes]
        .sort((a, b) => a.proj.depth - b.proj.depth)
        .map((o) => ({
          id: o.node.id,
          sx: o.proj.sx,
          sy: o.proj.sy,
          radiusPx: o.radiusPx,
          depth: o.proj.depth,
        }));

      pyramidCenterHitRef.current = centerProj
        ? { sx: centerProj.sx, sy: centerProj.sy, radius: Math.max(72, 96 * zoomRef.current) }
        : null;

      ctx.restore();
    },
    [emitCameraOrbit, spawnOpeningExplosion, spawnPulseCascade, spawnShockwave]
  );

  // Watch the global UI theme so the galaxy repaints when the app changes
  // colour — the canvas does not change colour with it (the galaxy owns its
  // own deep-space palette), but a repaint keeps the frame in sync with the
  // rest of the layout, and it is what the reduced-motion path needs to stay
  // deterministic: the repaint must produce the very same pixels.
  const drawSceneRef = useRef<((dt: number) => void) | null>(null);
  useEffect(() => {
    drawSceneRef.current = drawScene;
  }, [drawScene]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const syncTheme = () => {
      const next = root.getAttribute("data-theme") === "light";
      if (next === isLightThemeRef.current) return;
      isLightThemeRef.current = next;
      drawSceneRef.current?.(0);
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    emitCameraOrbit(true);
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const measure = () => {
      const rect = viewport.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width || viewport.clientWidth || 760));
      const height = Math.max(420, Math.round(rect.height || viewport.clientHeight || 520));
      const dpr =
        typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    measure();

    const mq =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    reducedMotionRef.current = Boolean(mq?.matches);

    let rafId: number | null = null;
    let lastTs = 0;

    const tick = (ts: number) => {
      const dt = lastTs === 0 ? 0.016 : Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      drawScene(dt);
      if (!reducedMotionRef.current) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const startOrRenderStatic = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (reducedMotionRef.current) {
        expandProgressRef.current = snapshotRef.current.expanded ? 1 : 0;
        drawScene(0);
      } else {
        lastTs = 0;
        rafId = requestAnimationFrame(tick);
      }
    };

    const handleMotionChange = (ev: MediaQueryListEvent) => {
      reducedMotionRef.current = ev.matches;
      startOrRenderStatic();
    };
    mq?.addEventListener?.("change", handleMotionChange);

    const handleWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      resettingRef.current = false;
      const normalizedDelta = ev.deltaMode === 1 ? ev.deltaY * 18 : ev.deltaY;
      const nextZoom = clamp(
        targetZoomRef.current - normalizedDelta * 0.0009,
        MIN_ZOOM,
        MAX_ZOOM
      );
      targetZoomRef.current = nextZoom;

      // Scroll-to-dive: scrolling in smoothly enters the expanded segmented universe;
      // scrolling back out smoothly folds back into the serene 3D pyramid.
      if (normalizedDelta < 0 && nextZoom >= 1.16) {
        scrollExpandSyncRef.current(true);
      } else if (normalizedDelta > 0 && nextZoom <= 1.05) {
        scrollExpandSyncRef.current(false);
      }

      if (reducedMotionRef.current) {
        zoomRef.current = nextZoom;
        expandProgressRef.current =
          nextZoom >= 1.16 ? 1 : nextZoom <= 1.05 ? 0 : expandProgressRef.current;
        emitCameraOrbit(false);
        drawScene(0);
      }
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        measure();
        if (reducedMotionRef.current) drawScene(0);
      });
      ro.observe(viewport);
    }

    startOrRenderStatic();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro?.disconnect();
      mq?.removeEventListener?.("change", handleMotionChange);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [drawScene, emitCameraOrbit]);

  // Redraw cleanly on prop updates when reduced-motion is enabled
  useEffect(() => {
    if (reducedMotionRef.current) {
      expandProgressRef.current = isExpanded ? 1 : 0;
      drawScene(0);
    }
  }, [
    aiOnline,
    hindsightOnline,
    ragRunning,
    ragReady,
    speaking,
    listening,
    isExpanded,
    enable4d,
    activeGraphNode,
    topology,
    drawScene,
  ]);

  const hitTestNode = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let bestId: string | null = null;
    let bestDist = Infinity;
    const hits = projectedHitsRef.current;
    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i];
      const threshold = Math.max(16, hit.radiusPx + 10);
      const dist = Math.hypot(x - hit.sx, y - hit.sy);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        bestId = hit.id;
      }
    }
    return bestId;
  };

  const hitTestPyramidCenter = (clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    const center = pyramidCenterHitRef.current;
    if (!canvas || !center) return false;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return Math.hypot(x - center.sx, y - center.sy) <= center.radius;
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    resettingRef.current = false;
    flyTargetRef.current = null;
    draggingRef.current = true;
    didDragRef.current = false;
    velYawRef.current = 0;
    velPitchRef.current = 0;
    pointerLastRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) {
      const dx = e.clientX - pointerLastRef.current.x;
      const dy = e.clientY - pointerLastRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        didDragRef.current = true;
      }
      pointerLastRef.current = { x: e.clientX, y: e.clientY };

      const sensitivity = 0.0085;
      yawRef.current += dx * sensitivity;
      pitchRef.current = clamp(
        pitchRef.current + dy * sensitivity,
        MIN_PITCH,
        MAX_PITCH
      );
      lookYawRef.current += dx * sensitivity * 1.15;
      lookPitchRef.current = clamp(
        lookPitchRef.current + dy * sensitivity,
        MIN_PITCH,
        MAX_PITCH
      );
      velYawRef.current = dx * 0.45;
      velPitchRef.current = dy * 0.45;

      if (reducedMotionRef.current) {
        emitCameraOrbit(false);
        drawScene(0);
      }
      return;
    }

    const hitId = hitTestNode(e.clientX, e.clientY);
    if (hitId !== hoveredNodeId) {
      setHoveredNodeId(hitId);
      if (hitId) {
        const node = topology.nodeMap.get(hitId);
        if (node) spawnShockwave(node.id, node.rgb);
      }
    }
    const overCenter = !hitId && !isExpanded && hitTestPyramidCenter(e.clientX, e.clientY);
    e.currentTarget.style.cursor = hitId || overCenter ? "pointer" : "grab";
  };

  const fetchBankExplorerItems = useCallback(
    async (bank: string | null, query: string, includeRagQuery = false) => {
      const cleanQuery = query.trim();
      setBankLoading(true);
      try {
        const cleanBank = bank && bank.trim().length > 0 ? bank.trim() : null;
        const recallPromise = hindsightApi?.recall
          ? hindsightApi
              .recall(cleanQuery, cleanBank, 60)
              .catch(() => [] as HindsightRecallItem[])
          : Promise.resolve([] as HindsightRecallItem[]);

        const ragPromise =
          includeRagQuery && cleanQuery.length > 0 && raglightApi?.query
            ? raglightApi
                .query(cleanQuery, 8)
                .catch(() => ({ answer: "", sources: [] as string[] }))
            : Promise.resolve(null);

        const [rows, ragRes] = await Promise.all([recallPromise, ragPromise]);

        if (Array.isArray(rows) && rows.length > 0) {
          setBankQueriedMemories((prev) => {
            const seen = new Set<string>();
            const merged: HindsightRecallItem[] = [];
            for (const item of [...rows, ...prev]) {
              const key = `${item.bank || ""}::${item.id || ""}::${item.content}`;
              if (!seen.has(key)) {
                seen.add(key);
                merged.push(item);
              }
            }
            return merged.slice(0, 120);
          });
        }

        if (ragRes && Array.isArray(ragRes.sources)) {
          setBankRagSources(ragRes.sources.filter((s) => typeof s === "string" && s.trim().length > 0));
        }
      } finally {
        setBankLoading(false);
      }
    },
    []
  );

  const openBankExplorer = useCallback(
    (targetBank?: string | null, category: "all" | BankSourceBucket = "all") => {
      const chosenBank =
        targetBank && targetBank.trim().length > 0
          ? targetBank.trim()
          : activeExplorerBank;
      if (chosenBank) {
        setExplorerBank(chosenBank);
      }
      setExplorerCategory(category);
      setBankExplorerOpen(true);
      void fetchBankExplorerItems(chosenBank || null, explorerQuery, category === "files");
    },
    [activeExplorerBank, explorerQuery, fetchBankExplorerItems]
  );

  const focusNodeIn3d = useCallback(
    (nodeId: string) => {
      resettingRef.current = false;
      setBankExplorerOpen(false);
      setSelectedNodeId(nodeId);
      setExpandedState(true);
      const node = topology.nodeMap.get(nodeId);
      if (node) {
        spawnNodeBurst(topology, node);
        const pos = node.graphPos;
        const targetYaw = -Math.atan2(pos.x, pos.z);
        const targetPitch = clamp(
          Math.atan2(pos.y, Math.hypot(pos.x, pos.z) || 1),
          MIN_PITCH,
          MAX_PITCH
        );
        const targetZoom = 1.72;
        flyTargetRef.current = { yaw: targetYaw, pitch: targetPitch, zoom: targetZoom };
        targetZoomRef.current = targetZoom;
        if (reducedMotionRef.current) {
          yawRef.current = targetYaw;
          pitchRef.current = targetPitch;
          zoomRef.current = targetZoom;
          expandProgressRef.current = 1;
          flyTargetRef.current = null;
          drawScene(0);
        }
      }
    },
    [drawScene, setExpandedState, spawnNodeBurst, topology]
  );

  useEffect(() => {
    if (!focusedMemoryId) return;
    if (topology.nodeMap.has(focusedMemoryId)) {
      focusNodeIn3d(focusedMemoryId);
      onFocusedMemoryHandled?.();
    }
  }, [focusedMemoryId, focusNodeIn3d, onFocusedMemoryHandled, topology.nodeMap]);

  const connectedGlobes = useMemo<ConnectedGalaxyGlobe[]>(() => {
    if (!selectedGraphNode || selectedGraphNode.kind !== "memory") return [];
    const adjEdges = topology.adjacency.get(selectedGraphNode.id) ?? [];
    const result: ConnectedGalaxyGlobe[] = [];
    const seen = new Set<string>();
    for (const edge of adjEdges) {
      const peerId = edge.fromId === selectedGraphNode.id ? edge.toId : edge.fromId;
      if (seen.has(peerId)) continue;
      const peer = topology.nodeMap.get(peerId);
      if (!peer || peer.kind !== "memory") continue;
      seen.add(peerId);
      result.push({
        id: peer.id,
        bankId: peer.bank,
        title: peer.title || peer.context || peer.content.slice(0, 48),
        linkType: edge.kind,
        entityName: peer.entities?.[0] ?? null,
      });
    }
    return result;
  }, [selectedGraphNode, topology.adjacency, topology.nodeMap]);

  const galaxySearchResults = useMemo(() => {
    const q = galaxySearch.trim().toLowerCase();
    if (!q) return [];
    return topology.nodes
      .filter((n): n is Extract<GraphNode, { kind: "memory" }> => n.kind === "memory")
      .filter((n) => {
        const hay = [
          n.title ?? "",
          n.content,
          n.bank,
          n.context ?? "",
          n.factType ?? "",
          ...(n.entities ?? []),
          ...(n.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [galaxySearch, topology.nodes]);

  const handleBackToGalaxy = useCallback(() => {
    flyTargetRef.current = null;
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setBankExplorerOpen(false);
    targetZoomRef.current = isExpanded ? 1.24 : DEFAULT_ZOOM;
    if (reducedMotionRef.current) {
      yawRef.current = DEFAULT_YAW;
      pitchRef.current = DEFAULT_PITCH;
      zoomRef.current = targetZoomRef.current;
      emitCameraOrbit(false);
      drawScene(0);
    } else {
      resettingRef.current = true;
    }
  }, [drawScene, emitCameraOrbit, isExpanded]);

  const toggleMemoryExpanded = useCallback((id: string) => {
    setExpandedMemoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExplorerSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void fetchBankExplorerItems(
      activeExplorerBank || null,
      explorerQuery,
      explorerCategory === "files" || ragEnabled || ragRunning
    );
  };

  const getCategoryLabel = (bucket: "all" | BankSourceBucket): string => {
    const keyMap: Record<"all" | BankSourceBucket, string> = {
      all: "hermes.station.bankCategoryAll",
      experience: "hermes.station.bankCategoryExperience",
      observation: "hermes.station.bankCategoryObservation",
      world: "hermes.station.bankCategoryWorld",
      files: "hermes.station.bankCategoryFiles",
      other: "hermes.station.bankCategoryOther",
    };
    const key = keyMap[bucket];
    if (i18n.exists(key)) return t(key);
    if (bucket === "files") return t("settings.raglight.sourcesLabel");
    return bucket;
  };

  const creatingSet = useMemo(() => new Set(creatingMemoryIds), [creatingMemoryIds]);
  const activeSet = useMemo(() => new Set(activeMemoryIds), [activeMemoryIds]);

  const bankScopedMemories = useMemo(() => {
    if (!activeExplorerBank) return combinedMemories;
    const filtered = combinedMemories.filter(
      (m) => (m.bank || activeExplorerBank) === activeExplorerBank
    );
    return filtered;
  }, [activeExplorerBank, combinedMemories]);

  const bankBucketCounts = useMemo(() => {
    const counts: Record<BankSourceBucket, number> = {
      experience: 0,
      observation: 0,
      world: 0,
      files: 0,
      other: 0,
    };
    bankScopedMemories.forEach((m) => {
      counts[classifyMemoryCategory(m.source)] += 1;
    });
    return counts;
  }, [bankScopedMemories]);

  const filteredBankMemories = useMemo(() => {
    const q = explorerQuery.trim().toLowerCase();
    return bankScopedMemories.filter((m) => {
      const bucket = classifyMemoryCategory(m.source);
      if (explorerCategory !== "all" && bucket !== explorerCategory) return false;
      if (!q) return true;
      return (
        m.content.toLowerCase().includes(q) ||
        (m.source ?? "").toLowerCase().includes(q) ||
        (m.bank ?? "").toLowerCase().includes(q)
      );
    });
  }, [bankScopedMemories, explorerCategory, explorerQuery]);

  const filteredRagFolders = useMemo(() => {
    const q = explorerQuery.trim().toLowerCase();
    if (!q) return ragFolders;
    return ragFolders.filter((f) => f.toLowerCase().includes(q));
  }, [ragFolders, explorerQuery]);

  const filteredRagSources = useMemo(() => {
    const q = explorerQuery.trim().toLowerCase();
    if (!q) return bankRagSources;
    return bankRagSources.filter((s) => s.toLowerCase().includes(q));
  }, [bankRagSources, explorerQuery]);

  const bankFilesTotalCount =
    bankBucketCounts.files + ragFolders.length + bankRagSources.length;

  const toggleExpandView = useCallback(() => {
    resettingRef.current = false;
    flyTargetRef.current = null;
    const next = !isExpanded;
    setExpandedState(next);
    targetZoomRef.current = next
      ? Math.max(targetZoomRef.current, 1.38)
      : DEFAULT_ZOOM;
    if (reducedMotionRef.current) {
      zoomRef.current = targetZoomRef.current;
      expandProgressRef.current = next ? 1 : 0;
      emitCameraOrbit(false);
      drawScene(0);
    }
  }, [drawScene, emitCameraOrbit, isExpanded, setExpandedState]);

  const finishPointerDrag = (e: ReactPointerEvent<HTMLCanvasElement>, allowClick: boolean) => {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    if (allowClick && wasDragging && !didDragRef.current) {
      const hitId = hitTestNode(e.clientX, e.clientY);
      if (hitId) {
        const node = topology.nodeMap.get(hitId);
        if (node) spawnNodeBurst(topology, node);
        if (node?.kind === "bank") {
          setSelectedNodeId(hitId);
          openBankExplorer(node.bank, "all");
        } else if (node?.kind === "memory") {
          focusNodeIn3d(hitId);
        } else {
          setSelectedNodeId((prev) => (prev === hitId ? null : hitId));
        }
      } else if (!isExpanded && hitTestPyramidCenter(e.clientX, e.clientY)) {
        toggleExpandView();
      } else {
        setSelectedNodeId(null);
      }
    }
    didDragRef.current = false;
  };

  const handleZoomDelta = (delta: number) => {
    resettingRef.current = false;
    flyTargetRef.current = null;
    const nextZoom = clamp(targetZoomRef.current + delta, MIN_ZOOM, MAX_ZOOM);
    targetZoomRef.current = nextZoom;
    if (delta > 0 && nextZoom >= 1.16) {
      setExpandedState(true);
    } else if (delta < 0 && nextZoom <= 1.05) {
      setExpandedState(false);
    }
    if (reducedMotionRef.current) {
      zoomRef.current = nextZoom;
      emitCameraOrbit(false);
      drawScene(0);
    }
  };

  const handleResetView = () => {
    flyTargetRef.current = null;
    velYawRef.current = 0;
    velPitchRef.current = 0;
    targetZoomRef.current = isExpanded ? 1.32 : DEFAULT_ZOOM;
    if (reducedMotionRef.current) {
      yawRef.current = DEFAULT_YAW;
      pitchRef.current = DEFAULT_PITCH;
      lookYawRef.current = 0;
      lookPitchRef.current = 0;
      zoomRef.current = targetZoomRef.current;
      emitCameraOrbit(false);
      drawScene(0);
    } else {
      resettingRef.current = true;
    }
  };

  const liveStateVariant = speaking
    ? ("info" as const)
    : listening
      ? ("success" as const)
      : pulseLit
        ? ("info" as const)
        : ("neutral" as const);
  const liveStateLabel = speaking
    ? t("hermes.station.speakingState")
    : listening
      ? t("hermes.station.listeningState")
      : pulseLit
        ? t("hermes.station.neuralPulseActive")
        : t("hermes.station.standby");

  return (
    <section
      ref={viewportRef}
      aria-label={t("hermes.station.title")}
      data-testid="aura-pyramid-station"
      className="aura-galaxy-surface relative flex-1 w-full h-full min-h-[520px] select-none overflow-hidden"
    >
      {/* Fullscreen Open-Space 3D / 4D Canvas (kept first in DOM for pixel assertions, layered at z-10 above WebGL backdrop) */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("hermes.station.title")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishPointerDrag(e, true)}
        onPointerCancel={(e) => finishPointerDrag(e, false)}
        onPointerLeave={(e) => {
          if (hoveredNodeId !== null) setHoveredNodeId(null);
          finishPointerDrag(e, false);
        }}
        onDoubleClick={handleResetView}
        className="absolute inset-0 z-10 block h-full w-full touch-none cursor-grab active:cursor-grabbing"
      />

      {/* Deep-Space WebGL Galaxy Shader (z-0 inside .aura-galaxy-surface so it stays visible in both themes) */}
      <AuraSpaceBackdrop contained immersive galaxyDark />

      {/* Top-Left Floating Minimal Telemetry Pills + Node Inspector / Bank Explorer Drawer */}
      <div className="pointer-events-none absolute top-3 left-3 bottom-28 z-20 flex flex-col items-start gap-2 max-w-[calc(100%-1.5rem)] lg:max-w-[58%]">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 shrink-0">
          {/* AI Core Pill */}
          <button
            type="button"
            onClick={() => onOpenSettings?.()}
            className="inline-flex items-center gap-1.5 rounded-full backdrop-blur-md bg-aura-surface/50 border border-aura-border/35 hover:border-aura-accent/55 px-2.5 py-1 text-[11px] text-aura-primary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
          >
            <Cpu className="h-3 w-3 text-aura-accent shrink-0" aria-hidden="true" />
            <span className="font-medium">{t("hermes.station.apexLabel")}</span>
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                aiOnline ? "bg-aura-info" : "bg-aura-warning"
              }`}
            />
            <span className="text-aura-secondary truncate max-w-[140px]">
              {aiStatusLabel}
            </span>
          </button>

          {/* Hindsight Memory Pill (Opens Bank & Memories Explorer) */}
          <button
            type="button"
            aria-expanded={bankExplorerOpen && explorerCategory !== "files"}
            onClick={() => {
              if (bankExplorerOpen && explorerCategory !== "files") {
                setBankExplorerOpen(false);
              } else {
                openBankExplorer(activeExplorerBank, "all");
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-full backdrop-blur-md px-2.5 py-1 text-[11px] text-aura-primary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus border ${
              bankExplorerOpen && explorerCategory !== "files"
                ? "bg-cyan-500/20 border-cyan-400/70"
                : "bg-aura-surface/50 border-aura-border/35 hover:border-cyan-400/55"
            }`}
          >
            <Brain className="h-3 w-3 text-cyan-300 shrink-0" aria-hidden="true" />
            <span className="font-medium">{t("hermes.station.hindsightLabel")}</span>
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                hindsightOnline ? "bg-aura-info" : "bg-cyan-400/80"
              }`}
            />
            <span className="text-aura-secondary truncate max-w-[140px]">
              {hindsightStatusLabel}
            </span>
          </button>

          {/* RAGLight Vector Pill (Opens Bank Explorer on Sources/Files tab) */}
          <button
            type="button"
            aria-expanded={bankExplorerOpen && explorerCategory === "files"}
            onClick={() => {
              if (bankExplorerOpen && explorerCategory === "files") {
                setBankExplorerOpen(false);
              } else {
                openBankExplorer(activeExplorerBank, "files");
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-full backdrop-blur-md px-2.5 py-1 text-[11px] text-aura-primary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus border ${
              bankExplorerOpen && explorerCategory === "files"
                ? "bg-cyan-500/20 border-cyan-400/70"
                : "bg-aura-surface/50 border-aura-border/35 hover:border-cyan-400/55"
            }`}
          >
            <Database className="h-3 w-3 text-cyan-300 shrink-0" aria-hidden="true" />
            <span className="font-medium">{t("hermes.station.raglightLabel")}</span>
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                ragRunning
                  ? "bg-aura-success"
                  : ragReady
                    ? "bg-aura-info"
                    : "bg-aura-text-muted"
              }`}
            />
            <span className="text-aura-secondary truncate max-w-[140px]">
              {raglightStatusLabel}
            </span>
          </button>

          {/* Live State / Neural Pulse Pill */}
          <Badge
            variant={liveStateVariant}
            className="rounded-full backdrop-blur-md bg-aura-surface/55 px-2.5 py-1 text-[11px]"
          >
            <Activity
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 ${
                speaking || listening || pulseLit ? "animate-pulse" : ""
              }`}
            />
            <span>{liveStateLabel}</span>
          </Badge>
        </div>

        {/* Global Galaxy 3D Search */}
        <div className="aura-galaxy-chrome-scope pointer-events-auto relative w-[min(360px,100%)] shrink-0">
          <div className="flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-slate-950/70 backdrop-blur-md px-3 py-1 shadow-md">
            <Search className="h-3.5 w-3.5 text-sky-300 shrink-0" aria-hidden="true" />
            <input
              type="search"
              data-testid="galaxy-search-input"
              value={galaxySearch}
              onChange={(e) => setGalaxySearch(e.target.value)}
              placeholder={t("hermes.galaxy.searchPlaceholder")}
              aria-label={t("hermes.galaxy.searchPlaceholder")}
              className="w-full bg-transparent text-[11px] text-slate-100 placeholder:text-slate-400 focus:outline-none"
            />
            {galaxySearch && (
              <button
                type="button"
                aria-label={t("sessions.cancel")}
                onClick={() => setGalaxySearch("")}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>

          {galaxySearch.trim().length > 0 && (
            <div className="mt-1 rounded-xl border border-sky-400/30 bg-slate-950/90 backdrop-blur-xl p-1.5 shadow-2xl space-y-1 max-h-56 overflow-y-auto">
              {galaxySearchResults.length === 0 ? (
                <div className="px-2.5 py-2 text-[11px] text-slate-400">
                  {t("hermes.galaxy.searchEmpty")}
                </div>
              ) : (
                galaxySearchResults.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => {
                      setGalaxySearch("");
                      focusNodeIn3d(hit.id);
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-slate-100 hover:bg-sky-500/20 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {hit.title || hit.context || hit.content.slice(0, 56)}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {hit.bank} · {hit.factType || hit.source}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-sky-300 font-medium">
                      {t("hermes.galaxy.flyTo")}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Interactive Hindsight Bank & Files Explorer OR Compact Hover/Selected Preview */}
        {bankExplorerOpen ? (
          <div
            data-testid="aura-bank-explorer"
            className="pointer-events-auto flex flex-col min-h-0 w-[min(420px,100%)] flex-1 rounded-aura-md backdrop-blur-xl bg-aura-surface/75 border border-cyan-400/35 shadow-xl overflow-hidden"
          >
            {/* Explorer Header */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-aura-border/35 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Brain className="h-3.5 w-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold text-aura-primary truncate">
                  {t("hermes.station.hindsightLabel")}
                </span>
                <Badge variant="info" className="text-[10px] shrink-0">
                  {t("settings.hindsight.banksCount", { count: explorerBanks.length })}
                </Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={bankLoading}
                  onClick={() =>
                    void fetchBankExplorerItems(
                      activeExplorerBank || null,
                      explorerQuery,
                      explorerCategory === "files" || ragEnabled || ragRunning
                    )
                  }
                  aria-label={t("settings.raglight.refreshButton")}
                  className="h-6 w-6 p-0 rounded-full text-aura-secondary hover:text-aura-primary"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${bankLoading ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setBankExplorerOpen(false)}
                  aria-label={t("compact.close")}
                  className="h-6 w-6 p-0 rounded-full text-aura-secondary hover:text-aura-primary"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* Bank Tabs Strip */}
            {explorerBanks.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 border-b border-aura-border/25 shrink-0">
                {explorerBanks.map((bank) => {
                  const active = bank === activeExplorerBank;
                  const countForBank = combinedMemories.filter(
                    (m) => (m.bank || bank) === bank
                  ).length;
                  return (
                    <button
                      key={bank}
                      type="button"
                      onClick={() => {
                        setExplorerBank(bank);
                        focusNodeIn3d(`bank-${bank}`);
                        void fetchBankExplorerItems(bank, explorerQuery, false);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer border ${
                        active
                          ? "bg-cyan-500/20 border-cyan-400/70 text-cyan-200"
                          : "bg-aura-surface/40 border-aura-border/35 text-aura-secondary hover:text-aura-primary hover:border-cyan-400/45"
                      }`}
                    >
                      <FolderOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{bank}</span>
                      <span className="opacity-75">{countForBank}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Recall / Filter Bar + Category Filter Pills */}
            <div className="px-3 py-2 space-y-2 border-b border-aura-border/25 shrink-0">
              <form onSubmit={handleExplorerSubmit} className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <Search
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-aura-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={explorerQuery}
                    onChange={(e) => setExplorerQuery(e.target.value)}
                    placeholder={t("settings.hindsight.testRecallPlaceholder")}
                    aria-label={t("settings.hindsight.testRecallPlaceholder")}
                    className="w-full h-7 rounded-aura-sm bg-aura-surface/60 border border-aura-border/40 pl-7 pr-2 text-[11px] text-aura-primary placeholder:text-aura-muted focus:outline-none focus:border-cyan-400/65"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={bankLoading}
                  className="h-7 px-2 text-[11px] shrink-0"
                >
                  {t("settings.raglight.testQueryButton")}
                </Button>
                {(explorerQuery.trim().length > 0 || explorerCategory !== "all") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setExplorerQuery("");
                      setExplorerCategory("all");
                    }}
                    aria-label={t("kanban.clearFilters")}
                    className="h-7 px-1.5 text-[11px] shrink-0 text-aura-secondary hover:text-aura-primary"
                  >
                    {t("kanban.clearFilters")}
                  </Button>
                )}
              </form>

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  aria-pressed={explorerCategory === "all"}
                  aria-label={t("hermes.station.memoriesOrbiting", {
                    count: bankScopedMemories.length,
                  })}
                  onClick={() => setExplorerCategory("all")}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors cursor-pointer ${
                    explorerCategory === "all"
                      ? "bg-cyan-500/20 border-cyan-400/70 text-cyan-200"
                      : "bg-aura-surface/40 border-aura-border/35 text-aura-secondary hover:text-aura-primary"
                  }`}
                >
                  <Layers className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                  {i18n.exists("hermes.station.bankCategoryAll") && (
                    <span>{t("hermes.station.bankCategoryAll")}</span>
                  )}
                  <span>{bankScopedMemories.length}</span>
                </button>

                {(
                  [
                    { key: "experience", Icon: Sparkles },
                    { key: "observation", Icon: Eye },
                    { key: "world", Icon: Globe },
                    { key: "other", Icon: Brain },
                  ] as const
                ).map(({ key, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={explorerCategory === key}
                    onClick={() => setExplorerCategory(key)}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors cursor-pointer ${
                      explorerCategory === key
                        ? "bg-cyan-500/20 border-cyan-400/70 text-cyan-200"
                        : "bg-aura-surface/40 border-aura-border/35 text-aura-secondary hover:text-aura-primary"
                    }`}
                  >
                    <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                    <span>{getCategoryLabel(key)}</span>
                    <span className="opacity-75">{bankBucketCounts[key]}</span>
                  </button>
                ))}

                <button
                  type="button"
                  aria-pressed={explorerCategory === "files"}
                  onClick={() => setExplorerCategory("files")}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors cursor-pointer ${
                    explorerCategory === "files"
                      ? "bg-cyan-500/20 border-cyan-400/70 text-cyan-200"
                      : "bg-aura-surface/40 border-aura-border/35 text-aura-secondary hover:text-aura-primary"
                  }`}
                >
                  <FileText className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                  <span>{getCategoryLabel("files")}</span>
                  <span className="opacity-75">{bankFilesTotalCount}</span>
                </button>
              </div>
            </div>

            {/* Scrollable List of Bank Memories & Files */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
              {filteredBankMemories.length > 0 && (
                <div className="space-y-1.5">
                  {filteredBankMemories.map((m, idx) => {
                    const nodeId = m.id || `mem-${idx}`;
                    const rowKey = `${m.bank || activeExplorerBank}::${nodeId}::${idx}`;
                    const isFocused = selectedNodeId === nodeId;
                    const isExpandedRow = expandedMemoryIds.has(rowKey);
                    const isCreating = creatingSet.has(nodeId);
                    const isUsing = activeSet.has(nodeId);
                    const bucket = classifyMemoryCategory(m.source);

                    return (
                      <div
                        key={rowKey}
                        className={`rounded-aura-sm border px-2.5 py-2 transition-colors ${
                          isFocused
                            ? "bg-cyan-500/15 border-cyan-400/70"
                            : "bg-aura-surface/45 border-aura-border/30 hover:border-cyan-400/45"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="inline-flex items-center gap-1 rounded-aura-sm border border-cyan-400/35 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-mono text-cyan-200">
                              {bucket === "experience" && (
                                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                              )}
                              {bucket === "observation" && (
                                <Eye className="h-2.5 w-2.5" aria-hidden="true" />
                              )}
                              {bucket === "world" && (
                                <Globe className="h-2.5 w-2.5" aria-hidden="true" />
                              )}
                              {bucket === "files" && (
                                <FileText className="h-2.5 w-2.5" aria-hidden="true" />
                              )}
                              {bucket === "other" && (
                                <Brain className="h-2.5 w-2.5" aria-hidden="true" />
                              )}
                              <span>{m.source || bucket}</span>
                            </span>
                            {(isCreating || isUsing) && (
                              <span
                                aria-label={t("hermes.station.neuralPulseActive")}
                                className="inline-block h-2 w-2 rounded-full bg-cyan-300 animate-pulse"
                              />
                            )}
                            {m.createdAt && (
                              <span className="text-[10px] text-aura-muted">
                                {formatMemoryDate(m.createdAt)}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => focusNodeIn3d(nodeId)}
                            aria-label={t("hermes.station.selectNodeHint")}
                            className="p-1 rounded-full text-aura-muted hover:text-cyan-300 transition-colors cursor-pointer shrink-0"
                          >
                            <Orbit className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            toggleMemoryExpanded(rowKey);
                            focusNodeIn3d(nodeId);
                          }}
                          className="w-full text-left cursor-pointer"
                        >
                          <p
                            className={`text-[11px] text-aura-primary leading-relaxed break-words ${
                              isExpandedRow ? "" : "line-clamp-3"
                            }`}
                          >
                            {m.content}
                          </p>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Indexed Folders & File Sources (shown in All or Files tab) */}
              {(explorerCategory === "all" || explorerCategory === "files") &&
                (filteredRagFolders.length > 0 || filteredRagSources.length > 0) && (
                  <div className="space-y-1.5 pt-1 border-t border-aura-border/25">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-cyan-200/90">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Database className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {t("settings.raglight.foldersLabel")}
                      </span>
                      <span className="shrink-0 opacity-75">
                        {filteredRagFolders.length + filteredRagSources.length}
                      </span>
                    </div>

                    {filteredRagFolders.map((folder, idx) => {
                      const folderNodeId = `rag-folder-${idx}-${folder}`;
                      const isFocused = selectedNodeId === folderNodeId;
                      return (
                        <button
                          key={folderNodeId}
                          type="button"
                          onClick={() => focusNodeIn3d(folderNodeId)}
                          className={`w-full text-left flex items-center justify-between gap-2 rounded-aura-sm border px-2.5 py-1.5 transition-colors cursor-pointer ${
                            isFocused
                              ? "bg-cyan-500/15 border-cyan-400/70"
                              : "bg-aura-surface/40 border-aura-border/30 hover:border-cyan-400/45"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FolderOpen
                              className="h-3.5 w-3.5 text-cyan-300 shrink-0"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <div className="text-[11px] font-medium text-aura-primary truncate">
                                {formatRagFileName(folder)}
                              </div>
                              <div className="text-[10px] font-mono text-aura-muted truncate">
                                {folder}
                              </div>
                            </div>
                          </div>
                          <Orbit className="h-3 w-3 text-aura-muted shrink-0" aria-hidden="true" />
                        </button>
                      );
                    })}

                    {filteredRagSources.map((sourcePath, idx) => (
                      <div
                        key={`${sourcePath}-${idx}`}
                        className="flex items-center gap-2 rounded-aura-sm border border-aura-border/30 bg-aura-surface/40 px-2.5 py-1.5"
                      >
                        <FileText
                          className="h-3.5 w-3.5 text-cyan-300 shrink-0"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-aura-primary truncate">
                            {formatRagFileName(sourcePath)}
                          </div>
                          <div className="text-[10px] font-mono text-aura-muted truncate">
                            {sourcePath}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {filteredBankMemories.length === 0 &&
                (explorerCategory !== "files" ||
                  (filteredRagFolders.length === 0 && filteredRagSources.length === 0)) && (
                  <div className="rounded-aura-sm border border-aura-border/25 bg-aura-surface/30 px-3 py-4 text-center text-[11px] text-aura-muted">
                    {explorerCategory === "files"
                      ? t("settings.raglight.emptyResult")
                      : explorerQuery.trim().length > 0 || explorerCategory !== "all"
                        ? t("settings.hindsight.emptyRecall")
                        : t("hermes.station.noMemories")}
                  </div>
                )}
            </div>
          </div>
        ) : selectedGraphNode?.kind === "memory" ? (
          <MemoryGlobeInspector
            globe={{
              id: selectedGraphNode.id,
              bankId: selectedGraphNode.bank,
              bankName: selectedGraphNode.bank,
              title:
                selectedGraphNode.title ||
                selectedGraphNode.context ||
                selectedGraphNode.content.slice(0, 64),
              content: selectedGraphNode.isFallback
                ? t("hermes.station.noMemories")
                : selectedGraphNode.content,
              factType: selectedGraphNode.factType ?? selectedGraphNode.source,
              date: selectedGraphNode.createdAt,
              context: selectedGraphNode.context,
              documentId: selectedGraphNode.documentId,
              entities: selectedGraphNode.entities ?? [],
              tags: selectedGraphNode.tags ?? [],
            }}
            connectedGlobes={connectedGlobes}
            onSelectGlobe={(id) => focusNodeIn3d(id)}
            onBackToGalaxy={handleBackToGalaxy}
            onOpenHindsightBank={onOpenHindsightBank}
          />
        ) : activeGraphNode ? (
          <div className="pointer-events-auto max-w-sm rounded-aura-md backdrop-blur-xl bg-aura-surface/65 border border-aura-border/40 px-3.5 py-2.5 shadow-lg space-y-1">
            {activeGraphNode.kind === "apex" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={aiOnline ? "info" : "warning"} className="text-[11px]">
                    <Cpu className="h-3 w-3" aria-hidden="true" />
                    {t("hermes.station.apexLabel")}
                  </Badge>
                  <span className="text-[11px] text-aura-secondary">{liveStateLabel}</span>
                </div>
                <p className="text-xs text-aura-primary">{aiStatusLabel}</p>
              </>
            )}

            {activeGraphNode.kind === "bank" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openBankExplorer(activeGraphNode.bank, "all")}
                    className={`inline-flex items-center gap-1 rounded-aura-sm border px-2 py-0.5 text-[11px] font-medium cursor-pointer hover:border-cyan-400/70 ${activeGraphNode.pillClass}`}
                  >
                    <FolderOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {t("hermes.station.memoryBankTag", { bank: activeGraphNode.bank })}
                  </button>
                  <span className="text-[11px] text-aura-secondary">
                    {activeGraphNode.memoryCount > 0
                      ? t("hermes.station.memoriesOrbiting", {
                          count: activeGraphNode.memoryCount,
                        })
                      : hindsightStatusLabel}
                  </span>
                </div>
                <p className="text-xs text-aura-secondary">
                  {activeGraphNode.memoryCount > 0
                    ? t("hermes.station.selectNodeHint")
                    : t("hermes.station.noMemories")}
                </p>
              </>
            )}

            {activeGraphNode.kind === "memory" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openBankExplorer(activeGraphNode.bank, "all")}
                    className={`inline-flex items-center gap-1 rounded-aura-sm border px-2 py-0.5 text-[11px] font-medium cursor-pointer hover:border-cyan-400/70 ${activeGraphNode.pillClass}`}
                  >
                    <FolderOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {t("hermes.station.memoryBankTag", { bank: activeGraphNode.bank })}
                  </button>
                  {!activeGraphNode.isFallback && activeGraphNode.source && (
                    <span className="text-[11px] text-aura-muted truncate">
                      {activeGraphNode.source}
                    </span>
                  )}
                  {!activeGraphNode.isFallback && activeGraphNode.createdAt && (
                    <span className="text-[11px] text-aura-muted">
                      {formatMemoryDate(activeGraphNode.createdAt)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-aura-primary leading-relaxed line-clamp-3">
                  {activeGraphNode.isFallback
                    ? t("hermes.station.noMemories")
                    : activeGraphNode.content}
                </p>
              </>
            )}

            {activeGraphNode.kind === "raglight-hub" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openBankExplorer(activeExplorerBank, "files")}
                    className="cursor-pointer"
                  >
                    <Badge variant="success" className="text-[11px]">
                      <Database className="h-3 w-3" aria-hidden="true" />
                      {t("hermes.station.raglightLabel")}
                    </Badge>
                  </button>
                  <span className="text-[11px] text-aura-secondary">
                    {t("hermes.station.raglightNodesCount", {
                      count: activeGraphNode.folderCount,
                    })}
                  </span>
                </div>
                <p className="text-xs text-aura-primary">{raglightStatusLabel}</p>
              </>
            )}

            {activeGraphNode.kind === "raglight" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openBankExplorer(activeExplorerBank, "files")}
                    className="cursor-pointer"
                  >
                    <Badge variant="success" className="text-[11px]">
                      <Database className="h-3 w-3" aria-hidden="true" />
                      {t("hermes.station.raglightLabel")}
                    </Badge>
                  </button>
                  <span className="text-[11px] text-aura-muted truncate">
                    {raglightStatusLabel}
                  </span>
                </div>
                <p className="text-xs text-aura-primary font-mono truncate">
                  {activeGraphNode.isFallback
                    ? raglightStatusLabel
                    : activeGraphNode.folder}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="pointer-events-none flex flex-wrap items-center gap-2 rounded-full backdrop-blur-sm bg-aura-surface/30 px-2.5 py-1 text-[11px] text-aura-muted">
            <Triangle className="h-3 w-3 text-aura-accent shrink-0" aria-hidden="true" />
            <span>{t("hermes.station.dragHint")}</span>
            {orbitMemoryCount > 0 && (
              <span className="inline-flex items-center gap-1 text-aura-secondary">
                <Orbit className="h-3 w-3 text-aura-accent" aria-hidden="true" />
                {t("hermes.station.memoriesOrbiting", { count: orbitMemoryCount })}
              </span>
            )}
            {ragFoldersCount > 0 && (
              <span className="inline-flex items-center gap-1 text-cyan-300/90">
                <Database className="h-3 w-3" aria-hidden="true" />
                {t("hermes.station.raglightNodesCount", { count: ragFoldersCount })}
              </span>
            )}
            {orbitMemoryCount > 0 || ragFoldersCount > 0 ? (
              <span>{t("hermes.station.selectNodeHint")}</span>
            ) : (
              <span>{t("hermes.station.noMemories")}</span>
            )}
          </div>
        )}
      </div>

      {/* Top-Right Floating Translucent Controls (Expand Universe, 4D Layer, Zoom -/+, Reset, Settings) */}
      <div className="pointer-events-auto absolute top-3 right-3 z-20 flex flex-wrap items-center justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={isExpanded ? "primary" : "secondary"}
          aria-pressed={isExpanded}
          onClick={toggleExpandView}
          className="h-7 px-2.5 text-[11px] rounded-full backdrop-blur-md"
        >
          {isExpanded ? (
            <Minimize2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3 w-3" aria-hidden="true" />
          )}
          {isExpanded
            ? t("hermes.station.collapsePyramid")
            : t("hermes.station.expandUniverse")}
        </Button>

        <Button
          type="button"
          size="sm"
          variant={enable4d ? "secondary" : "ghost"}
          aria-pressed={enable4d}
          onClick={() => setEnable4d((v) => !v)}
          className={`h-7 px-2.5 text-[11px] rounded-full backdrop-blur-md ${
            enable4d
              ? "border-aura-accent/45 text-aura-accent bg-aura-surface/55"
              : "bg-aura-surface/40 border border-aura-border/35 text-aura-secondary"
          }`}
        >
          <Box className="h-3 w-3" aria-hidden="true" />
          {t("hermes.station.dimension4d")}
        </Button>

        <div className="inline-flex items-center rounded-full backdrop-blur-md bg-aura-surface/45 border border-aura-border/35 p-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handleZoomDelta(-0.22)}
            aria-label={t("hermes.station.zoomOut")}
            className="h-6 w-6 p-0 rounded-full text-aura-secondary hover:text-aura-primary"
          >
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handleZoomDelta(0.22)}
            aria-label={t("hermes.station.zoomIn")}
            className="h-6 w-6 p-0 rounded-full text-aura-secondary hover:text-aura-primary"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleResetView}
          aria-label={t("hermes.station.resetView")}
          className="h-7 px-2.5 text-[11px] rounded-full backdrop-blur-md bg-aura-surface/45 border border-aura-border/35 text-aura-secondary hover:text-aura-primary"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {t("hermes.station.resetView")}
        </Button>

        {onOpenSettings && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onOpenSettings}
            aria-label={t("hermes.station.configureHint")}
            className="h-7 w-7 p-0 rounded-full backdrop-blur-md bg-aura-surface/45 border border-aura-border/35 text-aura-secondary hover:text-aura-primary"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </section>
  );
}
