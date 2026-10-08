import wasmUrl from './engine.wasm?url';
import { EDGE_BOARD, EDGE_ROAD, FLAG_CYCLEWAY, type Network } from './network';
import { buildProfile, type Profile, type ProfileOptions, WALK_SPEED } from './profile';
import { type Snap, SnapIndex } from './snap';

/** Exports of crates/engine */
interface EngineExports {
  memory: WebAssembly.Memory;
  reserve: (nodes: number, arcs: number, sources: number) => void;
  run: (sources: number, maxCost: number) => number;
  offsets_ptr: () => number;
  heads_ptr: () => number;
  costs_ptr: () => number;
  arc_edge_ptr: () => number;
  src_nodes_ptr: () => number;
  src_costs_ptr: () => number;
  dist_ptr: () => number;
  pred_node_ptr: () => number;
  pred_edge_ptr: () => number;
}

const NONE = 0xffffffff;
/** Beyond this, the cursor is off the network */
const MAX_SNAP_METRES = 600;

/** Times of one run, kept while the origin is pinned */
export interface Result {
  profile: Profile;
  /** Seconds per node, Infinity unreached */
  dist: Float32Array;
  predNode: Uint32Array;
  predEdge: Uint32Array;
  /** Where the origin joined the network */
  snap: Snap;
  /** Seconds walked from the origin to the network */
  access: number;
  settled: number;
  /** Milliseconds of the engine run */
  runMs: number;
}

export interface PathStep {
  edge: number;
  /** Seconds spent on it */
  cost: number;
}

/** The engine of the page: one profile at a time, a run per cursor move */
export class TravelEngine {
  profile!: Profile;
  private snapIndexes = new Map<string, SnapIndex>();
  private snapIndex!: SnapIndex;
  /** Ground metres per Mercator metre in the zone */
  readonly groundScale: number;

  readonly net: Network;
  private readonly wasm: EngineExports;

  private constructor(net: Network, wasm: EngineExports) {
    this.net = net;
    this.wasm = wasm;
    const lat = 2 * Math.atan(Math.exp(net.origin[1] / 6378137)) - Math.PI / 2;
    this.groundScale = Math.cos(lat);
  }

  static async create(net: Network, options: ProfileOptions) {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {});
    const engine = new TravelEngine(net, instance.exports as unknown as EngineExports);
    engine.setProfile(options);

    return engine;
  }

  setProfile(options: ProfileOptions) {
    const p = buildProfile(this.net, options);
    this.profile = p;
    const w = this.wasm;
    w.reserve(this.net.nodeCount, p.heads.length, 2);
    // Views after `reserve`: it may have grown the memory
    const mem = w.memory.buffer;
    new Uint32Array(mem, w.offsets_ptr(), p.offsets.length).set(p.offsets);
    new Uint32Array(mem, w.heads_ptr(), p.heads.length).set(p.heads);
    new Float32Array(mem, w.costs_ptr(), p.costs.length).set(p.costs);
    new Uint32Array(mem, w.arc_edge_ptr(), p.arcEdge.length).set(p.arcEdge);
    // The roads one can start from depend on the mode only
    const key = `${options.mode}/${options.bus}`;
    const index = this.snapIndexes.get(key) ?? new SnapIndex(this.net, p);
    this.snapIndexes.set(key, index);
    this.snapIndex = index;

    return p;
  }

  snap(x: number, y: number) {
    const s = this.snapIndex.nearest(x, y);

    return s && s.distance * this.groundScale <= MAX_SNAP_METRES ? s : undefined;
  }

  /** Seconds to reach A and B of the snapped edge from the point (towards the point, for an arrival) */
  private endCosts(s: Snap) {
    const { fwd, bwd, direction } = this.profile;
    const e = s.edge;
    // Departure: point → A goes backwards along the edge. Arrival: A → point goes forwards.
    const toA = direction === 'departure' ? s.f * bwd[e] : s.f * fwd[e];
    const toB = direction === 'departure' ? (1 - s.f) * fwd[e] : (1 - s.f) * bwd[e];

    return { toA, toB };
  }

  /**
   * Shortest times from (or towards) a point, up to `maxSeconds`. The returned arrays are views on the engine
   * memory, overwritten by the next run: `pin` copies them.
   */
  run(x: number, y: number, maxSeconds: number): Result | undefined {
    const snap = this.snap(x, y);
    if (!snap) return undefined;
    const w = this.wasm;
    const access = (snap.distance * this.groundScale) / WALK_SPEED;
    const { toA, toB } = this.endCosts(snap);
    const mem = w.memory.buffer;
    new Uint32Array(mem, w.src_nodes_ptr(), 2).set([this.net.edgeA[snap.edge], this.net.edgeB[snap.edge]]);
    new Float32Array(mem, w.src_costs_ptr(), 2).set([access + toA, access + toB]);
    const t0 = performance.now();
    const settled = w.run(2, maxSeconds);
    const runMs = performance.now() - t0;
    const buffer = w.memory.buffer;
    const n = this.net.nodeCount;

    return {
      profile: this.profile,
      dist: new Float32Array(buffer, w.dist_ptr(), n),
      predNode: new Uint32Array(buffer, w.pred_node_ptr(), n),
      predEdge: new Uint32Array(buffer, w.pred_edge_ptr(), n),
      snap,
      access,
      settled,
      runMs,
    };
  }

  /** A copy that the next runs leave alone */
  static pin(r: Result): Result {
    return { ...r, dist: r.dist.slice(), predNode: r.predNode.slice(), predEdge: r.predEdge.slice() };
  }

  /** Seconds between the result's origin and a point, and the edge end the trip goes through */
  timeAt(r: Result, x: number, y: number) {
    const s = this.snap(x, y);
    if (!s) return undefined;
    const { fwd, bwd, direction } = r.profile;
    const [a, b] = [this.net.edgeA[s.edge], this.net.edgeB[s.edge]];
    const walk = (s.distance * this.groundScale) / WALK_SPEED;
    // Departure: origin … A → point (forwards), origin … B → point (backwards). Arrival: the reverse.
    const viaA = r.dist[a] + (direction === 'departure' ? s.f * fwd[s.edge] : s.f * bwd[s.edge]);
    const viaB = r.dist[b] + (direction === 'departure' ? (1 - s.f) * bwd[s.edge] : (1 - s.f) * fwd[s.edge]);
    const node = viaA <= viaB ? a : b;
    const seconds = Math.min(viaA, viaB) + walk;

    return Number.isFinite(seconds) ? { seconds, node, snap: s, walk } : undefined;
  }

  /** Edges from the origin to `node`, in travel order */
  path(r: Result, node: number): PathStep[] {
    const steps: PathStep[] = [];
    for (let n = node; r.predNode[n] !== NONE && steps.length < 5000; n = r.predNode[n]) {
      steps.push({ edge: r.predEdge[n], cost: r.dist[n] - r.dist[r.predNode[n]] });
    }
    // Departure: the predecessors lead back to the origin. Arrival (reversed graph): they already lead to it.
    return r.profile.direction === 'departure' ? steps.reverse() : steps;
  }

  /** Points of an edge, oriented from `from` */
  edgePoints(edge: number, from: number) {
    const { coordStart, coords, edgeA, nodeXY } = this.net;
    const [s, t] = [coordStart[edge], coordStart[edge + 1]];
    if (s === t) return [[nodeXY[from * 2], nodeXY[from * 2 + 1]] as [number, number]];
    const pts: [number, number][] = [];
    for (let p = s; p < t; p += 1) pts.push([coords[p * 2], coords[p * 2 + 1]]);

    return edgeA[edge] === from ? pts : pts.reverse();
  }

  /** Stations and lines one can board within `limit` seconds (bus lines only when the profile takes them) */
  reachedTransit(dist: Float32Array, limit: number) {
    const { net, profile } = this;
    const stations = new Set<number>();
    const lines = new Set<number>();
    for (let e = 0; e < net.edgeCount; e += 1) {
      if (net.edgeKind[e] !== EDGE_BOARD || !(profile.fwd[e] < Infinity)) continue;
      if (dist[net.edgeA[e]] <= limit) {
        stations.add(net.edgeA[e]);
        lines.add(net.edgeName[e]);
      }
    }

    return { stations: stations.size, lines: lines.size };
  }

  /** The metro, RER or tram station reached first */
  nearestStation(dist: Float32Array) {
    let best = -1;
    for (const s of this.net.railStations) if (best < 0 || dist[s] < dist[best]) best = s;

    return best >= 0 && Number.isFinite(dist[best])
      ? { name: this.net.stopNames.get(best) ?? '', seconds: dist[best] }
      : undefined;
  }

  /** Kilometres of cycle lanes and greenways reached within `limit` seconds */
  cyclewayKm(dist: Float32Array, limit: number) {
    const { edgeA, edgeB, edgeLength, edgeKind, edgeFlags, edgeCount } = this.net;
    let m = 0;
    for (let e = 0; e < edgeCount; e += 1)
      if (edgeKind[e] === EDGE_ROAD && edgeFlags[e] & FLAG_CYCLEWAY && Math.max(dist[edgeA[e]], dist[edgeB[e]]) <= limit)
        m += edgeLength[e];

    return m / 1000;
  }

  /** Share (0..1) of the metro, RER and tram stations reached within each duration (seconds) */
  stationShare(dist: Float32Array, limits: number[]) {
    const stations = this.net.railStations;
    if (!stations.length) return limits.map(() => 0);

    return limits.map((limit) => stations.reduce((n, s) => n + (dist[s] <= limit ? 1 : 0), 0) / stations.length);
  }

  /** Kilometres of streets reached within each duration (seconds), for the panel */
  reachedKm(dist: Float32Array, limits: number[]) {
    const { edgeA, edgeB, edgeLength, edgeKind, edgeCount } = this.net;
    const km = limits.map(() => 0);
    for (let e = 0; e < edgeCount; e += 1) {
      if (edgeKind[e] !== EDGE_ROAD) continue;
      const t = Math.max(dist[edgeA[e]], dist[edgeB[e]]);
      for (let i = 0; i < limits.length; i += 1) if (t <= limits[i]) km[i] += edgeLength[e];
    }

    return km.map((m) => m / 1000);
  }
}
