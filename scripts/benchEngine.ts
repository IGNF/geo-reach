/**
 * Times the engine alone (bounded Dijkstra in WebAssembly) from many start points, for each mode, on a region as the
 * app loads it: measures what a change of the engine or of the data layout gains.
 * Run: `bun scripts/benchEngine.ts [region] [--order hilbert|bfs]` (`--order` renumbers the road nodes in memory first).
 */
import { buildProfile, DEFAULT_MODEL } from '@/features/routing/profile';
import type { Network } from '@/features/routing/network';
import { SnapIndex } from '@/features/routing/snap';
import { readTransit } from '@/features/routing/transit';
import { isEngine } from '@/features/routing/wasm';
import { DEFAULT_REGION } from '@/features/regions/regions';
import { loadRoads } from './regionData';
import type { Mode } from '@/shared/config';

const args = process.argv.slice(2);
const orderArg = args.indexOf('--order');
const order = orderArg >= 0 ? args[orderArg + 1] : undefined;
const region = args.find((a, i) => !a.startsWith('--') && i !== orderArg + 1) ?? DEFAULT_REGION;

/** Runs per mode, and their maximum time: the scales the app offers by default */
const RUNS = 300;
const MODES: { mode: Mode; minutes: number }[] = [
  { mode: 'pedestrian', minutes: 30 },
  { mode: 'bike', minutes: 30 },
  { mode: 'car', minutes: 30 },
  { mode: 'transit', minutes: 60 },
];

/** Index of a point along the Hilbert curve of a 2^16 grid */
const hilbert = (x: number, y: number): number => {
  const state = { x, y, d: 0 };
  for (let s = 1 << 15; s > 0; s >>= 1) {
    const rx = (state.x & s) > 0 ? 1 : 0;
    const ry = (state.y & s) > 0 ? 1 : 0;
    state.d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) [state.x, state.y] = [s - 1 - state.x, s - 1 - state.y];
      [state.x, state.y] = [state.y, state.x];
    }
  }

  return state.d;
};

/** Road nodes along the Hilbert curve of their positions */
const hilbertOrder = (net: Network): Uint32Array => {
  const [minX, minY, maxX, maxY] = net.nodeXY.reduce<[number, number, number, number]>(
    (b, v, i) => (i % 2 ? [b[0], Math.min(b[1], v), b[2], Math.max(b[3], v)] : [Math.min(b[0], v), b[1], Math.max(b[2], v), b[3]]),
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const scale = 65535 / Math.max(maxX - minX, maxY - minY);
  const keys = new Float64Array(net.nodeCount);
  for (let n = 0; n < net.nodeCount; n += 1)
    keys[n] = hilbert(Math.round((net.nodeXY[n * 2] - minX) * scale), Math.round((net.nodeXY[n * 2 + 1] - minY) * scale));

  return Uint32Array.from({ length: net.nodeCount }, (_, i) => i).sort((a, b) => keys[a] - keys[b]);
};

/** Road nodes in breadth-first order over the undirected graph, component after component */
const bfsOrder = (net: Network): Uint32Array => {
  const degree = new Uint32Array(net.nodeCount + 1);
  for (let e = 0; e < net.edgeCount; e += 1) {
    degree[net.edgeA[e] + 1] += 1;
    degree[net.edgeB[e] + 1] += 1;
  }
  for (let n = 0; n < net.nodeCount; n += 1) degree[n + 1] += degree[n];
  const next = degree.slice(0, net.nodeCount);
  const adjacent = new Uint32Array(degree[net.nodeCount]);
  for (let e = 0; e < net.edgeCount; e += 1) {
    adjacent[next[net.edgeA[e]]++] = net.edgeB[e];
    adjacent[next[net.edgeB[e]]++] = net.edgeA[e];
  }

  const out = new Uint32Array(net.nodeCount);
  const seen = new Uint8Array(net.nodeCount);
  const queue = { head: 0, tail: 0 };
  for (const root of hilbertOrder(net)) {
    if (seen[root]) continue;
    seen[root] = 1;
    out[queue.tail++] = root;
    while (queue.head < queue.tail) {
      const n = out[queue.head++];
      for (let i = degree[n]; i < degree[n + 1]; i += 1) {
        const m = adjacent[i];
        if (!seen[m]) {
          seen[m] = 1;
          out[queue.tail++] = m;
        }
      }
    }
  }

  return out;
};

/** The same roads, nodes renumbered in this order (the edges keep theirs) */
const renumber = (net: Network, ordered: Uint32Array): Network => {
  const id = new Uint32Array(net.nodeCount);
  ordered.forEach((old, i) => {
    id[old] = i;
  });
  const nodeXY = new Float32Array(net.nodeXY.length);
  ordered.forEach((old, i) => {
    nodeXY[i * 2] = net.nodeXY[old * 2];
    nodeXY[i * 2 + 1] = net.nodeXY[old * 2 + 1];
  });

  return { ...net, nodeXY, edgeA: net.edgeA.map((n) => id[n]), edgeB: net.edgeB.map((n) => id[n]) };
};

const file = (name: string): URL => new URL(`../web/public/data/regions/${name}`, import.meta.url);
const roads = await loadRoads(region);
const ordered = order === 'hilbert' ? renumber(roads, hilbertOrder(roads)) : order === 'bfs' ? renumber(roads, bfsOrder(roads)) : roads;
const transit = file(`${region}.transit.bin.gz`);
const grafted = (await Bun.file(transit).exists())
  ? readTransit(Bun.gunzipSync(await Bun.file(transit).bytes()).buffer as ArrayBuffer)(ordered)
  : ordered;
/** `hilbert-all`: the transit nodes too (enough for the engine: the stop tables are not renumbered) */
const net = order === 'hilbert-all' ? renumber(grafted, hilbertOrder(grafted)) : grafted;

const { instance } = await WebAssembly.instantiate(
  await Bun.file(new URL('../web/src/features/routing/engine.wasm', import.meta.url)).arrayBuffer(),
  {},
);
const w = instance.exports;
if (!isEngine(w)) throw new Error('engine.wasm: unexpected exports');

/** Start points as the cursor gives them: a fixed sequence of points in a 30 km square around the IGN head office */
const R = 6378137;
const HQ = [((2.424573 * Math.PI) / 180) * R - net.origin[0], R * Math.log(Math.tan(Math.PI / 4 + (48.845726 * Math.PI) / 360)) - net.origin[1]];
const SIDE = 30_000 / Math.cos((48.845726 * Math.PI) / 180);
const halton = (i: number, base: number): number => {
  const state = { f: 1, r: 0, i };
  while (state.i > 0) {
    state.f /= base;
    state.r += state.f * (state.i % base);
    state.i = Math.floor(state.i / base);
  }

  return state.r;
};
const points = Array.from({ length: RUNS }, (_, i) => [HQ[0] + (halton(i + 1, 2) - 0.5) * SIDE, HQ[1] + (halton(i + 1, 3) - 0.5) * SIDE]);

const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

console.log(`${region}, ${net.nodeCount} nodes, order: ${order ?? 'file'}`);
for (const { mode, minutes } of MODES) {
  const profile = buildProfile(net, { mode, direction: 'departure', bus: true, hour: 8, model: DEFAULT_MODEL, closed: new Uint32Array(0) });
  w.reserve(net.nodeCount, profile.heads.length, 2);
  new Uint32Array(w.memory.buffer, w.offsets_ptr(), profile.offsets.length).set(profile.offsets);
  new Uint32Array(w.memory.buffer, w.heads_ptr(), profile.heads.length).set(profile.heads);
  new Float32Array(w.memory.buffer, w.costs_ptr(), profile.costs.length).set(profile.costs);
  new Uint32Array(w.memory.buffer, w.arc_edge_ptr(), profile.arcEdge.length).set(profile.arcEdge);

  const snap = new SnapIndex(net, profile);
  const starts = points.flatMap(([x, y]) => snap.nearest(x, y)?.edge ?? []);
  const run = (e: number): [number, number] => {
    new Uint32Array(w.memory.buffer, w.src_nodes_ptr(), 2).set([net.edgeA[e], net.edgeB[e]]);
    new Float32Array(w.memory.buffer, w.src_costs_ptr(), 2).set([0, 0]);
    const t0 = performance.now();
    const settled = w.run(2, minutes * 60);

    return [performance.now() - t0, settled];
  };
  // Warm-up, then the timed runs
  for (const e of starts.slice(0, 30)) run(e);
  const results = starts.map(run);
  const times = results.map(([t]) => t).sort((a, b) => a - b);
  const settled = results.reduce((s, [, n]) => s + n, 0) / results.length;
  const total = times.reduce((s, t) => s + t, 0);
  console.log(
    `${mode.padEnd(11)} ${minutes} min  median ${quantile(times, 0.5).toFixed(2).padStart(6)} ms  p95 ${quantile(times, 0.95).toFixed(2).padStart(6)} ms  ` +
      `${((settled / total) * 1e3 * results.length / 1e6).toFixed(1).padStart(5)} M nodes/s  (${Math.round(settled)} nodes settled on average)`,
  );
}
