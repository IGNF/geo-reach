/// <reference lib="webworker" />
/**
 * Runs the WebAssembly engine (crates/engine) off the main thread, so that the map and the cursor stay fluid even
 * when a run over the whole region takes tens of milliseconds. The page snaps the cursor itself and sends the start
 * nodes; the worker answers with the times and predecessors, in buffers it hands over (no copy) and gets back.
 */

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

export type WorkerRequest =
  | { type: 'init'; wasmUrl: string }
  | { type: 'graph'; nodes: number; offsets: Uint32Array; heads: Uint32Array; costs: Float32Array; arcEdge: Uint32Array }
  | { type: 'run'; id: number; sources: number[]; costs: number[]; maxCost: number }
  /** Buffers of a result the page is done with */
  | { type: 'recycle'; buffers: ArrayBuffer[] };

export interface WorkerResult {
  id: number;
  dist: Float32Array;
  predNode: Uint32Array;
  predEdge: Uint32Array;
  settled: number;
  runMs: number;
}

let wasm: EngineExports | undefined;
let ready: Promise<void> | undefined;
let nodes = 0;
const pool: ArrayBuffer[] = [];

/** A buffer of the right size: recycled when possible */
const take = () => {
  const bytes = nodes * 4;
  for (let i = pool.length - 1; i >= 0; i -= 1) if (pool[i].byteLength === bytes) return pool.splice(i, 1)[0];

  return new ArrayBuffer(bytes);
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    ready = WebAssembly.instantiateStreaming(fetch(msg.wasmUrl), {}).then(({ instance }) => {
      wasm = instance.exports as unknown as EngineExports;
    });

    return;
  }
  await ready;
  const w = wasm;
  if (!w) return;
  if (msg.type === 'recycle') {
    pool.push(...msg.buffers);
    if (pool.length > 12) pool.splice(0, pool.length - 12);

    return;
  }
  if (msg.type === 'graph') {
    nodes = msg.nodes;
    pool.length = 0;
    w.reserve(msg.nodes, msg.heads.length, 2);
    // Views after `reserve`: it may have grown the memory
    const mem = w.memory.buffer;
    new Uint32Array(mem, w.offsets_ptr(), msg.offsets.length).set(msg.offsets);
    new Uint32Array(mem, w.heads_ptr(), msg.heads.length).set(msg.heads);
    new Float32Array(mem, w.costs_ptr(), msg.costs.length).set(msg.costs);
    new Uint32Array(mem, w.arc_edge_ptr(), msg.arcEdge.length).set(msg.arcEdge);

    return;
  }
  const mem = w.memory.buffer;
  new Uint32Array(mem, w.src_nodes_ptr(), 2).set(msg.sources);
  new Float32Array(mem, w.src_costs_ptr(), 2).set(msg.costs);
  const t0 = performance.now();
  const settled = w.run(msg.sources.length, msg.maxCost);
  const runMs = performance.now() - t0;
  const out = w.memory.buffer;
  const dist = new Float32Array(take());
  const predNode = new Uint32Array(take());
  const predEdge = new Uint32Array(take());
  dist.set(new Float32Array(out, w.dist_ptr(), nodes));
  predNode.set(new Uint32Array(out, w.pred_node_ptr(), nodes));
  predEdge.set(new Uint32Array(out, w.pred_edge_ptr(), nodes));
  const result: WorkerResult = { id: msg.id, dist, predNode, predEdge, settled, runMs };
  self.postMessage(result, [dist.buffer, predNode.buffer, predEdge.buffer]);
};
