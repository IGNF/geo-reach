/**
 * Times the work the page does after each engine run (contours, figures), for a mode and a max time, from the IGN
 * head office: finds what makes the map lag on long runs. Run: `bun scripts/benchFrame.ts [mode] [minutes]`.
 */
import { contourGrid, isochroneLines, joinSegments } from '@/features/map/contours';
import { buildProfile, DEFAULT_MODEL } from '@/features/routing/profile';
import { SnapIndex } from '@/features/routing/snap';
import { isEngine } from '@/features/routing/wasm';
import { loadRegion } from './regionData';
import type { Mode } from '@/shared/config';
import { contourMinutes } from '@/shared/config';

const MODES: readonly Mode[] = ['transit', 'pedestrian', 'bike', 'car'];
const arg = process.argv[2] ?? 'car';
const mode = MODES.find((m) => m === arg);
if (!mode) throw new Error(`mode: one of ${MODES.join(', ')}`);
const minutes = Number(process.argv[3] ?? 30);
const net = await loadRegion();
const profile = buildProfile(net, { mode, direction: 'departure', bus: false, hour: Number(process.argv[4] ?? 8), model: DEFAULT_MODEL, closed: new Uint32Array(0) });

// The engine, as the worker runs it
const { instance } = await WebAssembly.instantiate(
  await Bun.file(new URL('../web/src/features/routing/engine.wasm', import.meta.url)).arrayBuffer(),
  {},
);
const w = instance.exports;
if (!isEngine(w)) throw new Error('engine.wasm: unexpected exports');

w.reserve(net.nodeCount, profile.heads.length, 2);
type Pointer = 'offsets_ptr' | 'heads_ptr' | 'costs_ptr' | 'arc_edge_ptr' | 'src_nodes_ptr' | 'src_costs_ptr' | 'dist_ptr';
const view = <T>(Ctor: new (b: ArrayBuffer, o: number, n: number) => T, ptr: Pointer, n: number): T =>
  new Ctor(w.memory.buffer, w[ptr](), n);
view(Uint32Array, 'offsets_ptr', profile.offsets.length).set(profile.offsets);
view(Uint32Array, 'heads_ptr', profile.heads.length).set(profile.heads);
view(Float32Array, 'costs_ptr', profile.costs.length).set(profile.costs);
view(Uint32Array, 'arc_edge_ptr', profile.arcEdge.length).set(profile.arcEdge);

const groundScale = Math.cos(2 * Math.atan(Math.exp(net.origin[1] / 6378137)) - Math.PI / 2);
const R = 6378137;
const hq = [((2.424573 * Math.PI) / 180) * R - net.origin[0], R * Math.log(Math.tan(Math.PI / 4 + ((48.845726 * Math.PI) / 180) / 2)) - net.origin[1]];
const snap = new SnapIndex(net, profile).nearest(hq[0], hq[1]);
if (!snap) throw new Error('no snap');
view(Uint32Array, 'src_nodes_ptr', 2).set([net.edgeA[snap.edge], net.edgeB[snap.edge]]);
view(Float32Array, 'src_costs_ptr', 2).set([0, 0]);

const time = <T>(label: string, fn: () => T) => {
  const t0 = performance.now();
  const out = fn();
  console.log(`${label.padEnd(28)} ${(performance.now() - t0).toFixed(1).padStart(8)} ms`);

  return out;
};

const max = minutes * 60;
const settled = time('engine run (worker)', () => w.run(2, max));
const dist = Float32Array.from(view(Float32Array, 'dist_ptr', net.nodeCount));
console.log(`settled nodes: ${settled} of ${net.nodeCount}`);
const limits = contourMinutes(minutes).map((c) => c * 60);
console.log(`contour limits: ${limits.map((l) => l / 60).join(', ')} min`);
const grid = time('contourGrid (once)', () => contourGrid(net, groundScale));
const lines = time('isochroneLines', () => isochroneLines(grid, dist, limits, DEFAULT_MODEL.walkKmh / 3.6));
console.log(`segments: ${lines.map((l) => l.length).join(', ')}`);
const joined = time('joinSegments', () => lines.map((s) => joinSegments(s)));
console.log(`lines: ${joined.map((l) => l.length).join(', ')}`);
time('second isochroneLines', () => isochroneLines(grid, dist, limits, DEFAULT_MODEL.walkKmh / 3.6));
