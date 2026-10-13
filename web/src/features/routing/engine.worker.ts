/// <reference lib="webworker" />
/**
 * Runs the WebAssembly engine (crates/engine) off the main thread, so that the map and the cursor stay fluid even
 * when a run over the whole region takes tens of milliseconds. The page snaps the cursor itself and sends the start
 * nodes; the worker answers with the times and predecessors, in buffers it hands over (no copy) and gets back.
 */

import { type EngineExports, isEngine } from './wasm';

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

const state: {
  wasm?: EngineExports;
  /** Settles once the engine is instantiated */
  ready?: Promise<void>;
  /** Nodes of the current graph */
  nodes: number;
} = { nodes: 0 };

/** Result buffers handed back by the page, reused */
const pool: ArrayBuffer[] = [];

/** A buffer of the right size: recycled when possible */
const take = (): ArrayBuffer => {
  const bytes = state.nodes * 4;
  for (let i = pool.length - 1; i >= 0; i -= 1) if (pool[i].byteLength === bytes) return pool.splice(i, 1)[0];

  return new ArrayBuffer(bytes);
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    state.ready = WebAssembly.instantiateStreaming(fetch(msg.wasmUrl), {}).then(({ instance }) => {
      if (!isEngine(instance.exports)) throw new Error('engine.wasm: unexpected exports');
      state.wasm = instance.exports;
    });

    return;
  }
  await state.ready;
  const w = state.wasm;
  if (!w) return;

  if (msg.type === 'recycle') {
    pool.push(...msg.buffers);
    if (pool.length > 12) pool.splice(0, pool.length - 12);

    return;
  }
  if (msg.type === 'graph') {
    state.nodes = msg.nodes;
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
  dist.set(new Float32Array(out, w.dist_ptr(), state.nodes));
  predNode.set(new Uint32Array(out, w.pred_node_ptr(), state.nodes));
  predEdge.set(new Uint32Array(out, w.pred_edge_ptr(), state.nodes));
  const result: WorkerResult = { id: msg.id, dist, predNode, predEdge, settled, runMs };
  self.postMessage(result, [dist.buffer, predNode.buffer, predEdge.buffer]);
};
