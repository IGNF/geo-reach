/**
 * Times the work the page does after each engine run (contours, figures), for a mode and a max time, from the IGN
 * head office: finds what makes the map lag on long runs. Run: `bun scripts/benchFrame.ts [mode] [minutes]`.
 */
import { contourGrid, isochroneLines, joinSegments } from '../web/src/engine/contours';
import { loadRoadNetwork } from '../web/src/engine/network';
import { buildProfile, DEFAULT_MODEL } from '../web/src/engine/profile';
import { SnapIndex } from '../web/src/engine/snap';
import { loadTransit } from '../web/src/engine/transit';
import type { Mode } from '../web/src/lib/config';
import { contourMinutes } from '../web/src/lib/config';

const mode = (process.argv[2] ?? 'car') as Mode;
const minutes = Number(process.argv[3] ?? 30);
const data = (file: string) => new URL(`../web/public/data/${file}`, import.meta.url).href;

const roads = await loadRoadNetwork(data('graph.bin'));
const net = (await loadTransit(data('transit.bin')))(roads);
const profile = buildProfile(net, { mode, direction: 'departure', bus: false, hour: Number(process.argv[4] ?? 8), model: DEFAULT_MODEL });

// The engine, as the worker runs it
const { instance } = await WebAssembly.instantiate(
  await Bun.file(new URL('../web/src/engine/engine.wasm', import.meta.url)).arrayBuffer(),
  {},
);
const w = instance.exports as unknown as Record<string, CallableFunction> & { memory: WebAssembly.Memory };
w.reserve(net.nodeCount, profile.heads.length, 2);
const view = <T>(Ctor: new (b: ArrayBuffer, o: number, n: number) => T, ptr: string, n: number) =>
  new Ctor(w.memory.buffer, w[ptr]() as number, n);
(view(Uint32Array, 'offsets_ptr', profile.offsets.length) as Uint32Array).set(profile.offsets);
(view(Uint32Array, 'heads_ptr', profile.heads.length) as Uint32Array).set(profile.heads);
(view(Float32Array, 'costs_ptr', profile.costs.length) as Float32Array).set(profile.costs);
(view(Uint32Array, 'arc_edge_ptr', profile.arcEdge.length) as Uint32Array).set(profile.arcEdge);

const groundScale = Math.cos(2 * Math.atan(Math.exp(net.origin[1] / 6378137)) - Math.PI / 2);
const R = 6378137;
const hq = [((2.424573 * Math.PI) / 180) * R - net.origin[0], R * Math.log(Math.tan(Math.PI / 4 + ((48.845726 * Math.PI) / 180) / 2)) - net.origin[1]];
const snap = new SnapIndex(net, profile).nearest(hq[0], hq[1]);
if (!snap) throw new Error('no snap');
(view(Uint32Array, 'src_nodes_ptr', 2) as Uint32Array).set([net.edgeA[snap.edge], net.edgeB[snap.edge]]);
(view(Float32Array, 'src_costs_ptr', 2) as Float32Array).set([0, 0]);

const time = <T>(label: string, fn: () => T) => {
  const t0 = performance.now();
  const out = fn();
  console.log(`${label.padEnd(28)} ${(performance.now() - t0).toFixed(1).padStart(8)} ms`);

  return out;
};

const max = minutes * 60;
const settled = time('engine run (worker)', () => w.run(2, max) as number);
const dist = Float32Array.from(view(Float32Array, 'dist_ptr', net.nodeCount) as Float32Array);
console.log(`settled nodes: ${settled} of ${net.nodeCount}`);
const limits = contourMinutes(minutes).map((c) => c * 60);
console.log(`contour limits: ${limits.map((l) => l / 60).join(', ')} min`);
const grid = time('contourGrid (once)', () => contourGrid(net, groundScale));
const lines = time('isochroneLines', () => isochroneLines(grid, dist, limits, DEFAULT_MODEL.walkKmh / 3.6));
console.log(`segments: ${lines.map((l) => l.length).join(', ')}`);
const joined = time('joinSegments', () => lines.map((s) => joinSegments(s)));
console.log(`lines: ${joined.map((l) => l.length).join(', ')}`);
time('second isochroneLines', () => isochroneLines(grid, dist, limits, DEFAULT_MODEL.walkKmh / 3.6));
