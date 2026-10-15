import wasmUrl from './engine.wasm?url';
import type { WorkerRequest, WorkerResult } from './engine.worker';
import { EDGE_BOARD, EDGE_ROAD, FLAG_CYCLEWAY, type Network } from './network';
import { buildProfile, type Profile, type ProfileOptions } from './profile';
import { type Snap, SnapIndex, type SnapParts } from './snap';
import { MAX_SNAP_METRES, part, type ZoneXY } from './trip';
import type { CompareRequest, CompareResult } from './compare.worker';
import { EngineCore } from './engineCore';
import { isEngine } from './wasm';
import type { Mode } from '@/shared/config';

const NONE = 0xffffffff;

/** The engine compiled once per page: the main thread instantiates it again for each region */
let compiled: Promise<WebAssembly.Module> | undefined;

/** An instance of the engine on the main thread, for the short runs; undefined if it cannot start */
const startInlineCore = async (): Promise<EngineCore | undefined> => {
  try {
    compiled ??= WebAssembly.compileStreaming(fetch(new URL(wasmUrl, window.location.href)));
    const instance = await WebAssembly.instantiate(await compiled, {});

    return isEngine(instance.exports) ? new EngineCore(instance.exports) : undefined;
  } catch {
    return undefined;
  }
};


/** One engine worker (WebAssembly) and its graph */
class EngineWorker {
  private readonly worker: Worker;
  private nextId = 0;
  private pending = new Map<number, (r: WorkerResult) => void>();

  constructor() {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
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

  run(sources: number[], costs: number[], maxCost: number, texture: boolean, paths: boolean) {
    this.nextId += 1;
    const id = this.nextId;
    const answer = new Promise<WorkerResult>((resolve) => this.pending.set(id, resolve));
    this.post({ type: 'run', id, sources, costs, maxCost, texture, paths });

    return answer;
  }

  terminate(): void {
    this.worker.terminate();
  }

  recycle(buffers: ArrayBuffer[]) {
    const kept = buffers.filter((b) => b.byteLength);
    if (!kept.length) return;
    this.post({ type: 'recycle', buffers: kept }, kept);
  }
}

/** Times of one run, kept while the origin is pinned */
export interface Result {
  profile: Profile;
  /** Seconds per node, Infinity unreached */
  dist: Float32Array;
  /** Predecessors, empty when the run was asked without paths */
  predNode: Uint32Array;
  predEdge: Uint32Array;
  /** The times laid out for the network texture */
  times: Float32Array;
  /** Where the origin joined the network */
  snap: Snap;
  /** Seconds walked from the origin to the network */
  access: number;
  settled: number;
  /** Milliseconds of the engine run */
  runMs: number;
  /** With closed sections: the times of the same run with every section open */
  baseDist?: Float32Array;
  /** Computed on the main thread: its buffers go back to its pool there */
  inline?: boolean;
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
  /** The same engine on the main thread, for the runs short enough to be drawn in the frame of the mouse move */
  private inline?: EngineCore;
  /** Runs without the closed sections, side by side, to measure what they cost; started on the first cut */
  private baseWorker?: EngineWorker;
  /** Profile without the closed sections, while some are closed */
  private baseline?: Profile;
  /** Boardings of the current profile, for the transit figures */
  private boardingCache?: { profile: Profile; station: Uint32Array; line: Uint32Array };
  /** Cycle lanes and greenways of the network */
  private cycleways?: Uint32Array;
  /** The worker comparing the modes on one trip, started at the first comparison */
  private comparer?: {
    worker: Worker;
    lastId: number;
    pending: Map<number, (seconds: Partial<Record<Mode, number>> | undefined) => void>;
  };

  private constructor(net: Network) {
    this.net = net;
    const lat = 2 * Math.atan(Math.exp(net.origin[1] / 6378137)) - Math.PI / 2;
    this.groundScale = Math.cos(lat);
  }

  /** `first`: the profile and snap index built by the worker that loaded the network, used if they match `options` */
  static async create(net: Network, options: ProfileOptions, first?: { profile: Profile; snap: SnapParts }): Promise<TravelEngine> {
    const engine = new TravelEngine(net);
    engine.inline = await startInlineCore();
    engine.setProfile(options, first);

    return engine;
  }

  setProfile(options: ProfileOptions, built?: { profile: Profile; snap: SnapParts }): Profile {
    const fits = built && !options.closed.length && built.profile.mode === options.mode && !built.profile.closed.length;
    // The options keep their identity (the page compares them, the model by reference)
    const p = fits ? { ...built.profile, ...options } : buildProfile(this.net, options);
    this.profile = p;
    this.worker.graph(this.net.nodeCount, p);
    this.inline?.graph({ nodes: this.net.nodeCount, offsets: p.offsets, heads: p.heads, costs: p.costs, arcEdge: p.arcEdge });

    this.setBaseline(p);

    // The roads one can start from depend on the mode, and on the closed roads (never cached: one per set of cuts)
    const roadCut = options.closed.some((e) => this.net.edgeKind[e] === EDGE_ROAD);
    const key = `${options.mode}/${options.bus}`;
    const index = (!roadCut && this.snapIndexes.get(key)) || new SnapIndex(this.net, fits ? built.snap : p, this.baseline);
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

  /** Stops the workers: the engine of another region takes over */
  dispose(): void {
    this.worker.terminate();
    this.baseWorker?.terminate();
    this.comparer?.worker.terminate();
  }

  /**
   * Seconds of one trip in each mode, for the current settings, computed by a worker of its own (it gets a copy of
   * the network once). Only the latest request is answered: an older one resolves to undefined.
   */
  compare(from: ZoneXY, to: ZoneXY, modes: Mode[]): Promise<Partial<Record<Mode, number>> | undefined> {
    const comparer = (this.comparer ??= this.startComparer());
    comparer.lastId += 1;
    const id = comparer.lastId;
    const { bus, hour, model, closed } = this.profile;
    const request: CompareRequest = { type: 'compare', id, from, to, options: { bus, hour, model, closed }, modes };
    comparer.worker.postMessage(request);

    return new Promise((resolve) => comparer.pending.set(id, resolve));
  }

  private startComparer(): NonNullable<TravelEngine['comparer']> {
    const worker = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' });
    const comparer: NonNullable<TravelEngine['comparer']> = { worker, lastId: 0, pending: new Map() };
    worker.onmessage = (event: MessageEvent<CompareResult>) => {
      const { id, seconds } = event.data;
      // Older requests overtaken meanwhile get nothing
      for (const [pendingId, resolve] of comparer.pending) {
        if (pendingId > id) continue;
        resolve(pendingId === id && id === comparer.lastId ? seconds : undefined);
        comparer.pending.delete(pendingId);
      }
    };
    worker.postMessage({ type: 'network', net: this.net } satisfies CompareRequest);

    return comparer;
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
   * `recycle` once done with it: its buffers are reused. Without `paths`, no trip can be traced from it (`path`).
   */
  async run(x: number, y: number, maxSeconds: number, { paths = true }: { paths?: boolean } = {}): Promise<Result | undefined> {
    const start = this.start(x, y);
    if (!start) return undefined;

    const { profile, baseline } = this;
    const { snap, access, sources, toA, toB } = start;

    // With closed sections, the same run with every section open, side by side in the second worker. The snapped edge
    // is open in both profiles (the snap index leaves out closed roads).
    const [r, base] = await Promise.all([
      this.worker.run(sources, [access + toA, access + toB], maxSeconds, true, paths),
      baseline && this.baseWorker?.run(sources, this.endCosts(baseline, snap).map((c) => access + c), maxSeconds, false, false),
    ]);

    // Only the times of the baseline are kept
    if (base) this.baseWorker?.recycle([base.times.buffer] as ArrayBuffer[]);

    return {
      profile,
      dist: r.dist,
      predNode: r.predNode,
      predEdge: r.predEdge,
      times: r.times,
      snap,
      access,
      settled: r.settled,
      runMs: r.runMs,
      baseDist: base?.dist,
    };
  }

  /** The run can be made on the main thread (`runNow`): the engine started there, and no closed section */
  get canRunNow(): boolean {
    return !!this.inline && !this.baseline;
  }

  /**
   * The same run as `run`, on the main thread, synchronously: for runs of a few milliseconds, whose times then make
   * the frame of the mouse move. Undefined off the network, or when it cannot run here (`canRunNow`).
   */
  runNow(x: number, y: number, maxSeconds: number, { paths = true }: { paths?: boolean } = {}): Result | undefined {
    const { inline, profile } = this;
    const start = this.start(x, y);
    if (!inline || this.baseline || !start) return undefined;

    const { snap, access, sources, toA, toB } = start;
    const r = inline.run(sources, [access + toA, access + toB], maxSeconds, { texture: true, paths });

    return { profile, ...r, snap, access, inline: true };
  }

  /** Where a run from (x, y) starts: the snapped street, the walk to it, its two ends and the seconds to each */
  private start(x: number, y: number) {
    const snap = this.snap(x, y);
    if (!snap) return undefined;

    const access = (snap.distance * this.groundScale) / this.walkSpeed;
    const [toA, toB] = this.endCosts(this.profile, snap);

    return { snap, access, sources: [this.net.edgeA[snap.edge], this.net.edgeB[snap.edge]], toA, toB };
  }

  /** Gives the buffers of a result back to the engine that made them */
  recycle(r: Result): void {
    if (r.inline) return this.inline?.recycle([r.dist.buffer, r.predNode.buffer, r.predEdge.buffer, r.times.buffer] as ArrayBuffer[]);
    this.worker.recycle([r.dist.buffer, r.predNode.buffer, r.predEdge.buffer, r.times.buffer] as ArrayBuffer[]);
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
    if (!r.predNode.length) return steps;
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
    const { station, line } = this.boardings();
    const stations = new Set<number>();
    const lines = new Set<number>();
    for (let i = 0; i < station.length; i += 1)
      if (dist[station[i]] <= limit) {
        stations.add(station[i]);
        lines.add(line[i]);
      }

    return { stations: stations.size, lines: lines.size };
  }

  /** The boardings the profile can take, station and line: read at every move, listed once per profile */
  private boardings(): { station: Uint32Array; line: Uint32Array } {
    const { net, profile } = this;
    if (this.boardingCache?.profile === profile) return this.boardingCache;

    const edges: number[] = [];
    for (let e = 0; e < net.edgeCount; e += 1) if (net.edgeKind[e] === EDGE_BOARD && profile.fwd[e] < Infinity) edges.push(e);
    this.boardingCache = {
      profile,
      station: Uint32Array.from(edges, (e) => net.edgeA[e]),
      line: Uint32Array.from(edges, (e) => net.edgeName[e]),
    };

    return this.boardingCache;
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
    this.cycleways ??= Uint32Array.from(
      Array.from({ length: edgeCount }, (_, e) => e).filter((e) => edgeKind[e] === EDGE_ROAD && edgeFlags[e] & FLAG_CYCLEWAY),
    );
    let m = 0;
    for (const e of this.cycleways) if (Math.max(dist[edgeA[e]], dist[edgeB[e]]) <= limit) m += edgeLength[e];

    return m / 1000;
  }


}
