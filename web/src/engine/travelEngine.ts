import wasmUrl from './engine.wasm?url';
import type { WorkerRequest, WorkerResult } from './engineWorker';
import { EDGE_BOARD, EDGE_ROAD, FLAG_CYCLEWAY, type Network } from './network';
import { buildProfile, type Profile, type ProfileOptions } from './profile';
import { type Snap, SnapIndex } from './snap';

const NONE = 0xffffffff;

/**
 * Seconds of a share of an edge: none at all when the share is zero, even along a forbidden way (0 × ∞ would give NaN,
 * which the engine refuses: the cursor at the very end of a one-way street must still start from that end)
 */
const part = (share: number, seconds: number) => (share > 0 ? share * seconds : 0);
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
  private readonly worker: Worker;
  private nextId = 0;
  private pending = new Map<number, (r: WorkerResult) => void>();

  private constructor(net: Network) {
    this.net = net;
    this.worker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      this.pending.get(event.data.id)?.(event.data);
      this.pending.delete(event.data.id);
    };
    this.post({ type: 'init', wasmUrl: new URL(wasmUrl, window.location.href).href });
    const lat = 2 * Math.atan(Math.exp(net.origin[1] / 6378137)) - Math.PI / 2;
    this.groundScale = Math.cos(lat);
  }

  static async create(net: Network, options: ProfileOptions) {
    const engine = new TravelEngine(net);
    engine.setProfile(options);

    return engine;
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  setProfile(options: ProfileOptions) {
    const p = buildProfile(this.net, options);
    this.profile = p;
    // The worker gets its own copy of the graph (the page keeps the profile for snapping and paths)
    this.post({
      type: 'graph',
      nodes: this.net.nodeCount,
      offsets: p.offsets,
      heads: p.heads,
      costs: p.costs,
      arcEdge: p.arcEdge,
    });
    // The roads one can start from depend on the mode only
    const key = `${options.mode}/${options.bus}`;
    const index = this.snapIndexes.get(key) ?? new SnapIndex(this.net, p);
    this.snapIndexes.set(key, index);
    this.snapIndex = index;

    return p;
  }

  /** Metres per second on foot, from the model */
  get walkSpeed() {
    return this.profile.model.walkKmh / 3.6;
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
    const toA = direction === 'departure' ? part(s.f, bwd[e]) : part(s.f, fwd[e]);
    const toB = direction === 'departure' ? part(1 - s.f, fwd[e]) : part(1 - s.f, bwd[e]);

    return { toA, toB };
  }

  /**
   * Shortest times from (or towards) a point, up to `maxSeconds`, computed by the worker. Hand the result back with
   * `recycle` once done with it: its buffers are reused.
   */
  async run(x: number, y: number, maxSeconds: number): Promise<Result | undefined> {
    const snap = this.snap(x, y);
    if (!snap) return undefined;
    const profile = this.profile;
    const access = (snap.distance * this.groundScale) / this.walkSpeed;
    const { toA, toB } = this.endCosts(snap);
    this.nextId += 1;
    const id = this.nextId;
    const answer = new Promise<WorkerResult>((resolve) => this.pending.set(id, resolve));
    this.post({
      type: 'run',
      id,
      sources: [this.net.edgeA[snap.edge], this.net.edgeB[snap.edge]],
      costs: [access + toA, access + toB],
      maxCost: maxSeconds,
    });
    const r = await answer;

    return { profile, dist: r.dist, predNode: r.predNode, predEdge: r.predEdge, snap, access, settled: r.settled, runMs: r.runMs };
  }

  /** Gives the buffers of a result back to the worker */
  recycle(r: Result) {
    if (!r.dist.buffer.byteLength) return;
    this.post({ type: 'recycle', buffers: [r.dist.buffer, r.predNode.buffer, r.predEdge.buffer] as ArrayBuffer[] }, [
      r.dist.buffer,
      r.predNode.buffer,
      r.predEdge.buffer,
    ] as ArrayBuffer[]);
  }

  /** Seconds between the result's origin and a point, and the edge end the trip goes through */
  timeAt(r: Result, x: number, y: number) {
    const s = this.snap(x, y);
    if (!s) return undefined;
    const { fwd, bwd, direction } = r.profile;
    const [a, b] = [this.net.edgeA[s.edge], this.net.edgeB[s.edge]];
    const walk = (s.distance * this.groundScale) / this.walkSpeed;
    // Departure: origin … A → point (forwards), origin … B → point (backwards). Arrival: the reverse.
    const viaA = r.dist[a] + (direction === 'departure' ? part(s.f, fwd[s.edge]) : part(s.f, bwd[s.edge]));
    const viaB = r.dist[b] + (direction === 'departure' ? part(1 - s.f, bwd[s.edge]) : part(1 - s.f, fwd[s.edge]));
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


}
