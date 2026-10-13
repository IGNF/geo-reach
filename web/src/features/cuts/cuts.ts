import { EDGE_RIDE, EDGE_ROAD, FLAG_BUS, type Line, type Network } from '@/features/routing';

/**
 * Closed sections, a what-if: a metro, RER, train or tram line between two neighbouring stations (both ways), or one
 * BD TOPO road section (every mode). Their edges become impassable, the engine routes around them.
 */
export type Cut =
  /** Stations as numbered in the region's transit file (node − firstStation), a < b */
  | { kind: 'rail'; line: number; a: number; b: number }
  | { kind: 'road'; edge: number };

export const cutKey = (c: Cut): string => (c.kind === 'rail' ? `r${c.line}.${c.a}.${c.b}` : `s${c.edge}`);

/** `r<line>.<station>.<station>` or `s<edge>`, as in the URL; undefined when malformed */
export const parseCut = (key: string): Cut | undefined => {
  const rail = /^r(\d+)\.(\d+)\.(\d+)$/.exec(key);
  if (rail) {
    const [line, a, b] = rail.slice(1).map(Number);

    return { kind: 'rail', line, a: Math.min(a, b), b: Math.max(a, b) };
  }
  const road = /^s(\d+)$/.exec(key);

  return road ? { kind: 'road', edge: Number(road[1]) } : undefined;
};

/** The cut a rail ride or a road edge belongs to (bus rides are not cut) */
export const cutOfEdge = (net: Network, e: number): Cut | undefined => {
  if (net.edgeKind[e] === EDGE_ROAD) return { kind: 'road', edge: e };
  if (net.edgeKind[e] !== EDGE_RIDE || net.edgeFlags[e] & FLAG_BUS) return undefined;
  const sa = net.stopStation.get(net.edgeA[e]);
  const sb = net.stopStation.get(net.edgeB[e]);
  if (sa === undefined || sb === undefined) return undefined;
  const [a, b] = [sa - net.firstStation, sb - net.firstStation];

  return { kind: 'rail', line: net.edgeName[e], a: Math.min(a, b), b: Math.max(a, b) };
};

/** Rail rides by cut key, built once per network */
const railIndexes = new WeakMap<Network, Map<string, number[]>>();
const railIndex = (net: Network): Map<string, number[]> => {
  const cached = railIndexes.get(net);
  if (cached) return cached;

  const index = new Map<string, number[]>();
  for (let e = 0; e < net.edgeCount; e += 1) {
    const cut = net.edgeKind[e] === EDGE_RIDE ? cutOfEdge(net, e) : undefined;
    if (!cut) continue;

    const key = cutKey(cut);
    const edges = index.get(key) ?? [];
    edges.push(e);
    index.set(key, edges);
  }
  railIndexes.set(net, index);

  return index;
};

/** Edges of a cut: none when it does not exist in this network (a link made on other data) */
export const edgesOfCut = (net: Network, c: Cut): number[] => {
  if (c.kind === 'road') return c.edge < net.edgeCount && net.edgeKind[c.edge] === EDGE_ROAD ? [c.edge] : [];

  return railIndex(net).get(cutKey(c)) ?? [];
};

/** Every edge closed by the cuts, sorted */
export const closedEdges = (net: Network, cuts: Cut[]): Uint32Array =>
  Uint32Array.from(cuts.flatMap((c) => edgesOfCut(net, c))).sort();

export interface CutLabel {
  line?: Line;
  /** Stations (rail) or street name (road, empty when unnamed) */
  text: string;
}

export const cutLabel = (net: Network, c: Cut): CutLabel => {
  if (c.kind === 'road') {
    const name = net.edgeName[c.edge];

    return { text: name < net.names.length ? net.names[name] : '' };
  }
  const station = (s: number) => net.stopNames.get(net.firstStation + s) ?? '?';

  return { line: net.lines[c.line], text: `${station(c.a)} ↔ ${station(c.b)}` };
};
