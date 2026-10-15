import { TIMES_WIDTH, UNREACHED } from '@/shared/gl';
import type { EngineExports } from './wasm';

/** The arrays of a profile the engine runs on (compressed rows) */
export interface EngineGraph {
  nodes: number;
  offsets: Uint32Array;
  heads: Uint32Array;
  costs: Float32Array;
  arcEdge: Uint32Array;
}

export interface CoreRun {
  dist: Float32Array;
  /** Empty if not asked */
  predNode: Uint32Array;
  predEdge: Uint32Array;
  /** The times as the network texture holds them (rows of TIMES_WIDTH, unreached nodes at UNREACHED); empty if not asked */
  times: Float32Array;
  settled: number;
  runMs: number;
}

/**
 * One instance of the WebAssembly engine and its graph, with a pool of result buffers: run by the engine worker, and
 * on the main thread for the short runs (the times then make the very frame of the mouse move).
 */
export class EngineCore {
  private readonly w: EngineExports;
  private nodes = 0;
  /** Result buffers handed back, reused */
  private readonly pool: ArrayBuffer[] = [];

  constructor(w: EngineExports) {
    this.w = w;
  }

  graph({ nodes, offsets, heads, costs, arcEdge }: EngineGraph): void {
    const { w } = this;
    this.nodes = nodes;
    this.pool.length = 0;
    w.reserve(nodes, heads.length, 2);
    // Views after `reserve`: it may have grown the memory
    const mem = w.memory.buffer;
    new Uint32Array(mem, w.offsets_ptr(), offsets.length).set(offsets);
    new Uint32Array(mem, w.heads_ptr(), heads.length).set(heads);
    new Float32Array(mem, w.costs_ptr(), costs.length).set(costs);
    new Uint32Array(mem, w.arc_edge_ptr(), arcEdge.length).set(arcEdge);
  }

  /** Buffers of a result the caller is done with */
  recycle(buffers: ArrayBuffer[]): void {
    this.pool.push(...buffers.filter((b) => b.byteLength));
    if (this.pool.length > 16) this.pool.splice(0, this.pool.length - 16);
  }

  /** A buffer of this size (default: one value per node), recycled when possible */
  private take(bytes = this.nodes * 4): ArrayBuffer {
    const { pool } = this;
    for (let i = pool.length - 1; i >= 0; i -= 1) if (pool[i].byteLength === bytes) return pool.splice(i, 1)[0];

    return new ArrayBuffer(bytes);
  }

  /** `texture`: the times laid out for the GPU as well; `paths`: the predecessors too (to trace a trip) */
  run(sources: number[], costs: number[], maxCost: number, { texture, paths }: { texture: boolean; paths: boolean }): CoreRun {
    const { w, nodes } = this;
    const mem = w.memory.buffer;
    new Uint32Array(mem, w.src_nodes_ptr(), 2).set(sources);
    new Float32Array(mem, w.src_costs_ptr(), 2).set(costs);
    const t0 = performance.now();
    const settled = w.run(sources.length, maxCost);
    const runMs = performance.now() - t0;

    const out = w.memory.buffer;
    const dist = new Float32Array(this.take());
    dist.set(new Float32Array(out, w.dist_ptr(), nodes));
    // The predecessors only when a trip is traced: two copies of a value per node less on every move otherwise
    const predNode = new Uint32Array(paths ? this.take() : new ArrayBuffer(0));
    const predEdge = new Uint32Array(paths ? this.take() : new ArrayBuffer(0));
    if (paths) {
      predNode.set(new Uint32Array(out, w.pred_node_ptr(), nodes));
      predEdge.set(new Uint32Array(out, w.pred_edge_ptr(), nodes));
    }
    const times = new Float32Array(texture ? this.take(Math.ceil(nodes / TIMES_WIDTH) * TIMES_WIDTH * 4) : new ArrayBuffer(0));
    if (texture) for (let i = 0; i < nodes; i += 1) times[i] = dist[i] < UNREACHED ? dist[i] : UNREACHED;

    return { dist, predNode, predEdge, times, settled, runMs };
  }
}
