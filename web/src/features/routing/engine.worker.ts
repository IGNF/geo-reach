/// <reference lib="webworker" />
/**
 * Runs the WebAssembly engine (crates/engine) off the main thread, so that the map and the cursor stay fluid even
 * when a run over the whole region takes tens of milliseconds. The page snaps the cursor itself and sends the start
 * nodes; the worker answers with the times and predecessors, in buffers it hands over (no copy) and gets back.
 */

import { type CoreRun, EngineCore, type EngineGraph } from './engineCore';
import { isEngine } from './wasm';

export type WorkerRequest =
  | { type: 'init'; wasmUrl: string }
  | ({ type: 'graph' } & EngineGraph)
  /** `texture`: the times laid out for the GPU as well; `paths`: the predecessors too (to trace a trip) */
  | { type: 'run'; id: number; sources: number[]; costs: number[]; maxCost: number; texture: boolean; paths: boolean }
  /** Buffers of a result the page is done with */
  | { type: 'recycle'; buffers: ArrayBuffer[] };

export interface WorkerResult extends CoreRun {
  id: number;
}

/** A run that failed (the engine could not start, or trapped): the page rejects its promise */
export interface WorkerFailure {
  id: number;
  error: string;
}

const state: {
  core?: EngineCore;
  /** Settles once the engine is instantiated */
  ready?: Promise<void>;
} = {};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    state.ready = WebAssembly.instantiateStreaming(fetch(msg.wasmUrl), {}).then(({ instance }) => {
      if (!isEngine(instance.exports)) throw new Error('engine.wasm: unexpected exports');
      state.core = new EngineCore(instance.exports);
    });

    return;
  }
  try {
    await state.ready;
    const { core } = state;
    if (!core) throw new Error('engine.wasm: not started');

    if (msg.type === 'recycle') return core.recycle(msg.buffers);
    if (msg.type === 'graph') return core.graph(msg);

    const run = core.run(msg.sources, msg.costs, msg.maxCost, msg);
    const result: WorkerResult = { id: msg.id, ...run };
    self.postMessage(result, [run.dist.buffer, run.predNode.buffer, run.predEdge.buffer, run.times.buffer]);
  } catch (error) {
    // Only a run waits for an answer; the page rejects it instead of waiting forever
    if (msg.type !== 'run') return console.error(error);
    const failure: WorkerFailure = { id: msg.id, error: String(error) };
    self.postMessage(failure);
  }
};
