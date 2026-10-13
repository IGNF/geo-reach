/** Exports of crates/engine (raw C exports, no wasm-bindgen): pointers into its memory, and two calls */
export interface EngineExports {
  memory: WebAssembly.Memory;
  /** Sizes the buffers for a graph */
  reserve: (nodes: number, arcs: number, sources: number) => void;
  /** Bounded Dijkstra from the sources written beforehand; returns the settled node count */
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

const FUNCTIONS = [
  'reserve',
  'run',
  'offsets_ptr',
  'heads_ptr',
  'costs_ptr',
  'arc_edge_ptr',
  'src_nodes_ptr',
  'src_costs_ptr',
  'dist_ptr',
  'pred_node_ptr',
  'pred_edge_ptr',
] as const satisfies readonly Exclude<keyof EngineExports, 'memory'>[];

/** Checks the exports of an instance, so that a stale or foreign engine.wasm fails loudly instead of later */
export const isEngine = (exports: WebAssembly.Exports): exports is WebAssembly.Exports & EngineExports =>
  exports.memory instanceof WebAssembly.Memory && FUNCTIONS.every((name) => typeof exports[name] === 'function');
