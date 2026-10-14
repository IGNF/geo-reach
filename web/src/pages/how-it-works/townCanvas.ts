import { EDGE_RIDE, EDGE_ROAD, type Network, type PathStep, type Profile } from '@/features/routing';
import { rampCss } from '@/shared/colors';
import { howItWorks as h } from '@/locales/howItWorks';
import { HILL, LINES, OLD_TOWN, PARK, RIVER, SIZE } from './town';

/** What the canvas shows: the town, the times of the last run, the cursor and the trip */
export interface Scene {
  net: Network;
  profile: Profile;
  /** Seconds per node of the last run */
  dist?: Float32Array;
  maxSeconds: number;
  /** The start, pinned or under the cursor, and where it joins its street */
  start?: { x: number; y: number; sx: number; sy: number };
  /** The destination under the cursor while the start is pinned, and the trip to it */
  destination?: { x: number; y: number; path: PathStep[] };
}

/** From town metres to canvas pixels, and back */
export interface View {
  scale: number;
  pad: number;
  height: number;
}

export const toCanvas = (v: View, x: number, y: number): [number, number] => [v.pad + x * v.scale, v.height - v.pad - y * v.scale];
export const toTown = (v: View, px: number, py: number): [number, number] => [(px - v.pad) / v.scale, (v.height - v.pad - py) / v.scale];

/** Pieces of each street colored apart, as the graphics card blends them along a street of the map */
const PIECES = 4;

const box = (ctx: CanvasRenderingContext2D, v: View, b: { x0: number; y0: number; x1: number; y1: number }): void => {
  const [x0, y0] = toCanvas(v, b.x0, b.y1);
  const [x1, y1] = toCanvas(v, b.x1, b.y0);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
};

const label = (ctx: CanvasRenderingContext2D, v: View, text: string, x: number, y: number, color = '#5b6670'): void => {
  const [px, py] = toCanvas(v, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, px, py);
};

/** River, park, old town, contour lines of the hill, labels */
const drawGround = (ctx: CanvasRenderingContext2D, v: View): void => {
  ctx.fillStyle = '#f6f4ef';
  box(ctx, v, { x0: -50, y0: -50, x1: SIZE.width + 50, y1: SIZE.height + 50 });
  ctx.fillStyle = '#cfe4f5';
  box(ctx, v, { x0: -50, y0: RIVER.south, x1: SIZE.width + 50, y1: RIVER.north });
  ctx.fillStyle = '#d8ecd0';
  box(ctx, v, PARK);
  ctx.fillStyle = '#efe3d0';
  box(ctx, v, OLD_TOWN);

  // Contour lines every 10 m: where the hill rises z over the plain
  ctx.strokeStyle = '#c9b79c';
  ctx.lineWidth = 1;
  for (let z = 10; z < HILL.height; z += 10) {
    const r = HILL.spread * Math.sqrt(2 * Math.log(HILL.height / z));
    const [cx, cy] = toCanvas(v, HILL.x, HILL.y);
    ctx.beginPath();
    ctx.arc(cx, cy, r * v.scale, 0, 2 * Math.PI);
    ctx.stroke();
  }

  const l = h.sandbox.labels;
  ctx.font = `600 ${Math.max(9, 11 * Math.min(1, v.scale * 4))}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  label(ctx, v, l.river, 30, RIVER.south + 12, '#3a78a8');
  label(ctx, v, l.park, PARK.x0 + 30, PARK.y1 - 40, '#4f7d3f');
  label(ctx, v, l.oldTown, OLD_TOWN.x0 + 10, OLD_TOWN.y1 - 40, '#8a6a3c');
  label(ctx, v, l.hill, HILL.x - 120, HILL.y + 20, '#8a6a3c');
  label(ctx, v, l.expressway, 30, 30);
  label(ctx, v, l.boulevard, 30, 1230);
};

/** Time at a share of an edge, from the times of its two ends (Infinity where it is not reached) */
const timeAlong = (s: Scene, e: number, x: number): number => {
  const dist = s.dist;
  if (!dist) return Infinity;
  const { fwd, bwd } = s.profile;

  return Math.min((dist[s.net.edgeA[e]] ?? Infinity) + x * (fwd[e] ?? Infinity), (dist[s.net.edgeB[e]] ?? Infinity) + (1 - x) * (bwd[e] ?? Infinity));
};

/** Streets: grey where the mode cannot go or beyond the maximum time, colored by time elsewhere */
const drawStreets = (ctx: CanvasRenderingContext2D, v: View, s: Scene): void => {
  const { net, profile } = s;
  ctx.lineCap = 'round';
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (net.edgeKind[e] !== EDGE_ROAD) continue;
    const i = (net.coordStart[e] ?? 0) * 2;
    const [ax, ay] = toCanvas(v, net.coords[i] ?? 0, net.coords[i + 1] ?? 0);
    const [bx, by] = toCanvas(v, net.coords[i + 2] ?? 0, net.coords[i + 3] ?? 0);
    const usable = Number.isFinite(profile.fwd[e]) || Number.isFinite(profile.bwd[e]);
    const major = (net.edgeImportance[e] ?? 6) <= 2;
    ctx.lineWidth = (major ? 4 : 2.5) * Math.min(1.4, v.scale * 4);

    for (let k = 0; k < PIECES; k += 1) {
      const t = timeAlong(s, e, (k + 0.5) / PIECES);
      ctx.strokeStyle = !usable ? '#e2e0db' : t <= s.maxSeconds ? rampCss(t / s.maxSeconds) : '#b9bdc2';
      ctx.beginPath();
      ctx.moveTo(ax + ((bx - ax) * k) / PIECES, ay + ((by - ay) * k) / PIECES);
      ctx.lineTo(ax + ((bx - ax) * (k + 1)) / PIECES, ay + ((by - ay) * (k + 1)) / PIECES);
      ctx.stroke();
    }
  }
};

/** Metro and bus: their line in their color, the stations as dots colored by their time */
const drawTransit = (ctx: CanvasRenderingContext2D, v: View, s: Scene): void => {
  const { net } = s;
  ctx.setLineDash([]);
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (net.edgeKind[e] !== EDGE_RIDE) continue;
    const line = net.lines[net.edgeName[e] ?? 0];
    const i = (net.coordStart[e] ?? 0) * 2;
    const [ax, ay] = toCanvas(v, net.coords[i] ?? 0, net.coords[i + 1] ?? 0);
    const [bx, by] = toCanvas(v, net.coords[i + 2] ?? 0, net.coords[i + 3] ?? 0);
    ctx.strokeStyle = line?.color ?? '#333';
    ctx.globalAlpha = s.profile.mode === 'transit' && (line?.type !== 3 || s.profile.bus) ? 0.9 : 0.25;
    ctx.lineWidth = line?.type === 3 ? 3 : 5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (let n = net.firstStation; n < net.firstStation + LINES.reduce((c, l) => c + l.stations.length, 0); n += 1) {
    const [x, y] = toCanvas(v, net.nodeXY[n * 2] ?? 0, net.nodeXY[n * 2 + 1] ?? 0);
    const t = s.dist?.[n] ?? Infinity;
    ctx.fillStyle = t <= s.maxSeconds ? rampCss(t / s.maxSeconds) : '#ffffff';
    ctx.strokeStyle = '#1d3557';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
};

/** The trip to the destination, over the streets */
const drawTrip = (ctx: CanvasRenderingContext2D, v: View, s: Scene): void => {
  const { net } = s;
  const d = s.destination;
  if (!d) return;
  ctx.strokeStyle = '#1d3557';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const step of d.path) {
    const [i0, i1] = [net.coordStart[step.edge] ?? 0, net.coordStart[step.edge + 1] ?? 0];
    if (i1 - i0 < 2) continue;
    const forwards = step.from === net.edgeA[step.edge];
    const points = Array.from({ length: i1 - i0 }, (_, k) => (forwards ? i0 + k : i1 - 1 - k));
    points.forEach((p, k) => {
      const [x, y] = toCanvas(v, net.coords[p * 2] ?? 0, net.coords[p * 2 + 1] ?? 0);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
  ctx.stroke();
};

/** A point: the start (white ring) or the destination (dark), with the dashed walk to its street */
const drawPoint = (ctx: CanvasRenderingContext2D, v: View, p: { x: number; y: number; sx?: number; sy?: number }, start: boolean): void => {
  const [x, y] = toCanvas(v, p.x, p.y);
  if (p.sx !== undefined && p.sy !== undefined) {
    const [sx, sy] = toCanvas(v, p.sx, p.sy);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#1d3557';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = start ? '#ffffff' : '#1d3557';
  ctx.strokeStyle = start ? '#1d3557' : '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
};

/** Draws the whole scene: cheap enough (about 1,500 streets) to redraw at each move */
export const drawTown = (ctx: CanvasRenderingContext2D, v: View, s: Scene): void => {
  drawGround(ctx, v);
  drawStreets(ctx, v, s);
  drawTransit(ctx, v, s);
  drawTrip(ctx, v, s);
  if (s.start) drawPoint(ctx, v, s.start, true);
  if (s.destination) drawPoint(ctx, v, s.destination, false);
};
