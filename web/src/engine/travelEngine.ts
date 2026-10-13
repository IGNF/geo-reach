import wasmUrl from '@/engine/engine.wasm?url';
import type { WorkerRequest, WorkerResult } from '@/engine/engineWorker';
import { EDGE_BOARD, EDGE_ROAD, FLAG_CYCLEWAY, type Network } from '@/engine/network';
import { buildProfile, type Profile, type ProfileOptions } from '@/engine/profile';
import { type Snap, SnapIndex } from '@/engine/snap';

const NONE = 0xffffffff;

/**
 * Seconds of a share of an edge: none at all when the share is zero, even along a forbidden way (0 × ∞ would give NaN,
 * which the engine refuses: the cursor at the very end of a one-way street must still start from that end)
 */
const part = (share: number, seconds: number) => (share > 0 ? share * seconds : 0);
/** Beyond this, the cursor is off the network */
const MAX_SNAP_METRES = 600;

/** One engine worker (WebAssembly) and its graph */
class EngineWorker {
  private readonly worker: Worker;
  private nextId = 0;
  private pending = new Map<number, (r: WorkerResult) => void>();

  constructor() {
    this.worker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      this.pending.get(event.data.id)?.(event.data);
      this.pending.delete(event.data.id);
    };
    this.post({ type: 'init', wasmUrl: new URL(wasmUrl, window.location.href).href });
  }

  post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  graph(nodes: number, p: Profile) {
    // The worker gets its own copy of the graph (the page keeps the profile for snapping and paths)
    this.post({ type: 'graph', nodes, offsets: p.offsets, heads: p.heads, costs: p.costs, arcEdge: p.arcEdge });
  }

  run(sources: number[], costs: number[], maxCost: number) {
    this.nextId += 1;
    const id = this.nextId;
    const answer = new Promise<WorkerResult>((resolve) => this.pending.set(id, resolve));
    this.post({ type: 'run', id, sources, costs, maxCost });

    return answer;
  }

  recycle(buffers: ArrayBuffer[]) {
    if (!buffers[0].byteLength) return;
    this.post({ type: 'recycle', buffers }, buffers);
  }
}

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
  /** With closed sections: the times of the same run with every section open */
  baseDist?: Float32Array;
}

/** What the closed sections cost from the origin: rail stations within reach without them, and their delays */
export interface CutImpact {
  /** Stations reached within the limit with every section open */
  reached: number;
  /** Stations that lose a minute or more, by name, worst first; Infinity: now beyond the limit */
  delays: { name: string; seconds: number }[];
}

/** A point joined to the network: the ends of its street and the seconds from each to the point */
export interface Anchor {
  a: number;
  b: number;
  toA: number;
  toB: number;
  snap: Snap;
  /** Seconds walked from the street to the point */
  walk: number;
}

/** Time from the origin of a result to a point, and how the trip reaches it */
export interface TimeAt {
  seconds: number;
  /** End of the snapped edge the trip goes through */
  node: number;
  snap: Snap;
  /** Seconds walked from the network to the point */
  walk: number;
}

export interface PathStep {
  edge: number;
  /** Seconds spent on it */
  cost: number;
  /** Node it is entered from, in travel order */
  from: number;
}

/** The engine of the page: one profile at a time, a run per cursor move */
export class TravelEngine {
  profile!: Profile;
  private snapIndexes = new Map<string, SnapIndex>();
  private snapIndex!: SnapIndex;
  /** Ground metres per Mercator metre in the zone */
  readonly groundScale: number;

  readonly net: Network;
  private readonly worker = new EngineWorker();
  /** Runs without the closed sections, side by side, to measure what they cost; started on the first cut */
  private baseWorker?: EngineWorker;
  /** Profile without the closed sections, while some are closed */
  private baseline?: Profile;

  private constructor(net: Network) {
    this.net = net;
    const lat = 2 * Math.atan(Math.exp(net.origin[1] / 6378137)) - Math.PI / 2;
    this.groundScale = Math.cos(lat);
  }

  static async create(net: Network, options: ProfileOptions): Promise<TravelEngine> {
    const engine = new TravelEngine(net);
    engine.setProfile(options);

    return engine;
  }

  setProfile(options: ProfileOptions): Profile {
    const p = buildProfile(this.net, options);
    this.profile = p;
    this.worker.graph(this.net.nodeCount, p);

    this.setBaseline(p);

    // The roads one can start from depend on the mode, and on the closed roads (never cached: one per set of cuts)
    const roadCut = options.closed.some((e) => this.net.edgeKind[e] === EDGE_ROAD);
    const key = `${options.mode}/${options.bus}`;
    const index = (!roadCut && this.snapIndexes.get(key)) || new SnapIndex(this.net, p);
    if (!roadCut) this.snapIndexes.set(key, index);
    this.snapIndex = index;

    return p;
  }

  /**
   * With closed sections, the same profile with every section open, for the second worker. Rebuilt only when something
   * else than the cuts changed (the mode, the hour…).
   */
  private setBaseline(p: Profile) {
    if (!p.closed.length) {
      this.baseline = undefined;

      return;
    }

    const b = this.baseline;
    const same = b && b.mode === p.mode && b.direction === p.direction && b.bus === p.bus && b.hour === p.hour && b.model === p.model;
    if (same) return;

    this.baseline = buildProfile(this.net, { ...p, closed: new Uint32Array(0) });
    this.baseWorker ??= new EngineWorker();
    this.baseWorker.graph(this.net.nodeCount, this.baseline);
  }

  /** Metres per second on foot, from the model */
  get walkSpeed(): number {
    return this.profile.model.walkKmh / 3.6;
  }

  snap(x: number, y: number): Snap | undefined {
    const s = this.snapIndex.nearest(x, y);

    return s && s.distance * this.groundScale <= MAX_SNAP_METRES ? s : undefined;
  }

  /** Seconds to reach A and B of the snapped edge from the point (towards the point, for an arrival) */
  private endCosts({ fwd, bwd, direction }: Profile, s: Snap): [number, number] {
    const e = s.edge;
    // Departure: point → A goes backwards along the edge. Arrival: A → point goes forwards.
    const toA = direction === 'departure' ? part(s.f, bwd[e]) : part(s.f, fwd[e]);
    const toB = direction === 'departure' ? part(1 - s.f, fwd[e]) : part(1 - s.f, bwd[e]);

    return [toA, toB];
  }

  /**
   * Shortest times from (or towards) a point, up to `maxSeconds`, computed by the worker. Hand the result back with
   * `recycle` once done with it: its buffers are reused.
   */
  async run(x: number, y: number, maxSeconds: number): Promise<Result | undefined> {
    const snap = this.snap(x, y);
    if (!snap) return undefined;

    const { profile, baseline } = this;
    const access = (snap.distance * this.groundScale) / this.walkSpeed;
    const [toA, toB] = this.endCosts(profile, snap);
    const sources = [this.net.edgeA[snap.edge], this.net.edgeB[snap.edge]];

    // With closed sections, the same run with every section open, side by side in the second worker. The snapped edge
    // is open in both profiles (the snap index leaves out closed roads).
    const [r, base] = await Promise.all([
      this.worker.run(sources, [access + toA, access + toB], maxSeconds),
      baseline && this.baseWorker?.run(sources, this.endCosts(baseline, snap).map((c) => access + c), maxSeconds),
    ]);

    // Only the times of the baseline are kept
    if (base) this.baseWorker?.recycle([base.predNode.buffer, base.predEdge.buffer] as ArrayBuffer[]);

    return {
      profile,
      dist: r.dist,
      predNode: r.predNode,
      predEdge: r.predEdge,
      snap,
      access,
      settled: r.settled,
      runMs: r.runMs,
      baseDist: base?.dist,
    };
  }

  /** Gives the buffers of a result back to the workers */
  recycle(r: Result): void {
    this.worker.recycle([r.dist.buffer, r.predNode.buffer, r.predEdge.buffer] as ArrayBuffer[]);
    if (r.baseDist) this.baseWorker?.recycle([r.baseDist.buffer] as ArrayBuffer[]);
  }

  /** Rail stations delayed by the closed sections, from the result's origin (none without a baseline) */
  cutImpact(r: Result, limit: number): CutImpact | undefined {
    const base = r.baseDist;
    if (!base) return undefined;
    const reached = [...this.net.railStations].filter((s) => base[s] <= limit);

    // A name can cover several station nodes: its worst delay
    const delays = new Map<string, number>();
    for (const s of reached) {
      const delay = r.dist[s] - base[s];
      if (delay < 60) continue;

      const name = this.net.stopNames.get(s) ?? '';
      delays.set(name, Math.max(delays.get(name) ?? 0, delay));
    }

    return {
      reached: reached.length,
      delays: [...delays].map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds),
    };
  }

  /**
   * How a point joins the network of a profile: the two ends of its nearest street, and the seconds from each end to
   * the point (along the street, then the walk to the point). Its time is then min(t(a) + toA, t(b) + toB).
   */
  anchor(x: number, y: number, profile: Profile = this.profile): Anchor | undefined {
    const s = this.snap(x, y);
    if (!s) return undefined;

    const { fwd, bwd, direction } = profile;
    const walk = (s.distance * this.groundScale) / this.walkSpeed;
    // Departure: A → point goes forwards along the edge, B → point backwards. Arrival: the reverse.
    const toA = (direction === 'departure' ? part(s.f, fwd[s.edge]) : part(s.f, bwd[s.edge])) + walk;
    const toB = (direction === 'departure' ? part(1 - s.f, bwd[s.edge]) : part(1 - s.f, fwd[s.edge])) + walk;

    return { a: this.net.edgeA[s.edge], b: this.net.edgeB[s.edge], toA, toB, snap: s, walk };
  }

  /** Seconds between the result's origin and a point, and the edge end the trip goes through */
  timeAt(r: Result, x: number, y: number): TimeAt | undefined {
    const at = this.anchor(x, y, r.profile);
    if (!at) return undefined;

    const viaA = r.dist[at.a] + at.toA;
    const viaB = r.dist[at.b] + at.toB;
    const seconds = Math.min(viaA, viaB);

    return Number.isFinite(seconds) ? { seconds, node: viaA <= viaB ? at.a : at.b, snap: at.snap, walk: at.walk } : undefined;
  }

  /** Edges from the origin to `node`, in travel order */
  path(r: Result, node: number): PathStep[] {
    const steps: PathStep[] = [];
    for (let n = node; r.predNode[n] !== NONE && steps.length < 5000; n = r.predNode[n]) {
      // Reversed graph (arrival): the predecessor is the node one travels to
      const from = r.profile.direction === 'departure' ? r.predNode[n] : n;
      steps.push({ edge: r.predEdge[n], cost: r.dist[n] - r.dist[r.predNode[n]], from });
    }
    // Departure: the predecessors lead back to the origin. Arrival (reversed graph): they already lead to it.
    return r.profile.direction === 'departure' ? steps.reverse() : steps;
  }

  /** Points of an edge, oriented from `from` */
  edgePoints(edge: number, from: number): [number, number][] {
    const { coordStart, coords, edgeA, nodeXY } = this.net;
    const [s, t] = [coordStart[edge], coordStart[edge + 1]];
    if (s === t) return [[nodeXY[from * 2], nodeXY[from * 2 + 1]] as [number, number]];
    const pts: [number, number][] = [];
    for (let p = s; p < t; p += 1) pts.push([coords[p * 2], coords[p * 2 + 1]]);

    return edgeA[edge] === from ? pts : pts.reverse();
  }

  /** Stations and lines one can board within `limit` seconds (bus lines only when the profile takes them) */
  reachedTransit(dist: Float32Array, limit: number): { stations: number; lines: number } {
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
  nearestStation(dist: Float32Array): { name: string; seconds: number } | undefined {
    const best = [...this.net.railStations].reduce<number | undefined>(
      (b, s) => (b === undefined || dist[s] < dist[b] ? s : b),
      undefined,
    );
    if (best === undefined || !Number.isFinite(dist[best])) return undefined;

    return { name: this.net.stopNames.get(best) ?? '', seconds: dist[best] };
  }

  /** Kilometres of cycle lanes and greenways reached within `limit` seconds */
  cyclewayKm(dist: Float32Array, limit: number): number {
    const { edgeA, edgeB, edgeLength, edgeKind, edgeFlags, edgeCount } = this.net;
    let m = 0;
    for (let e = 0; e < edgeCount; e += 1)
      if (edgeKind[e] === EDGE_ROAD && edgeFlags[e] & FLAG_CYCLEWAY && Math.max(dist[edgeA[e]], dist[edgeB[e]]) <= limit)
        m += edgeLength[e];

    return m / 1000;
  }


}
