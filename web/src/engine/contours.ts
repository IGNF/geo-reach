import { EDGE_RIDE, type Network } from './network';

/** Cell of the time grid, ground metres */
const CELL_METRES = 150;

export interface ContourGrid {
  /** Mercator metres relative to the zone origin */
  minX: number;
  minY: number;
  /** Mercator metres per cell */
  cell: number;
  cols: number;
  rows: number;
  /** Column and row of each node */
  nodeCol: Int32Array;
  nodeRow: Int32Array;
  /** Points along the transit rides, about two per cell: cell, ride ends and position between them (0 to 1) */
  rideCol: Int32Array;
  rideRow: Int32Array;
  rideA: Uint32Array;
  rideB: Uint32Array;
  rideF: Float32Array;
}

/** The part of the grid a run reached: the field is computed there only */
interface Window {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

/** The grid of the zone, built once per network */
export const contourGrid = (net: Network, groundScale: number): ContourGrid => {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let n = 0; n < net.nodeCount; n += 1) {
    const [x, y] = [net.nodeXY[n * 2], net.nodeXY[n * 2 + 1]];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const cell = CELL_METRES / groundScale;
  const cols = Math.ceil((maxX - minX) / cell) + 1;
  const rows = Math.ceil((maxY - minY) / cell) + 1;
  const nodeCol = new Int32Array(net.nodeCount);
  const nodeRow = new Int32Array(net.nodeCount);
  for (let n = 0; n < net.nodeCount; n += 1) {
    nodeCol[n] = Math.floor((net.nodeXY[n * 2] - minX) / cell);
    nodeRow[n] = Math.floor((net.nodeXY[n * 2 + 1] - minY) / cell);
  }
  // Stations and line stops are not places one stands (their time leaves out the wait): streets only
  for (const n of net.stopNames.keys()) nodeCol[n] = -1;

  // The rides instead: their track, so that a line draws a tube between its stations, not islands around them
  const [rc, rr, ra, rb, rf]: number[][] = [[], [], [], [], []];
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (net.edgeKind[e] !== EDGE_RIDE) continue;
    const [s, t] = [net.coordStart[e], net.coordStart[e + 1]];
    let total = 0;
    for (let p = s + 1; p < t; p += 1)
      total += Math.hypot(net.coords[p * 2] - net.coords[p * 2 - 2], net.coords[p * 2 + 1] - net.coords[p * 2 - 1]);
    if (!(total > 0)) continue;
    let along = 0;
    for (let p = s; p < t - 1; p += 1) {
      const [x0, y0, x1, y1] = [net.coords[p * 2], net.coords[p * 2 + 1], net.coords[p * 2 + 2], net.coords[p * 2 + 3]];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(len / (cell / 2)));
      for (let k = 0; k < steps; k += 1) {
        const u = k / steps;
        rc.push(Math.floor((x0 + u * (x1 - x0) - minX) / cell));
        rr.push(Math.floor((y0 + u * (y1 - y0) - minY) / cell));
        ra.push(net.edgeA[e]);
        rb.push(net.edgeB[e]);
        rf.push((along + u * len) / total);
      }
      along += len;
    }
  }

  return {
    minX,
    minY,
    cell,
    cols,
    rows,
    nodeCol,
    nodeRow,
    rideCol: Int32Array.from(rc),
    rideRow: Int32Array.from(rr),
    rideA: Uint32Array.from(ra),
    rideB: Uint32Array.from(rb),
    rideF: Float32Array.from(rf),
  };
};

/**
 * Travel time per cell: the best node of the cell, then walking from cell to cell (two-pass chamfer distance), so
 * that the field is continuous between the streets, then a light blur that smooths the contours.
 */
const MARGIN = 3;
/** Farthest a contour goes from the streets, in cells (2 × 150 m) */
const MAX_WALK_CELLS = 2;

/** Time at a point of a ride, between the times of its two stops; Infinity when the ride is not taken */
const rideTime = (g: ContourGrid, dist: Float32Array, i: number) => {
  const [a, b] = [dist[g.rideA[i]], dist[g.rideB[i]]];

  return Number.isFinite(a) && Number.isFinite(b) ? a + g.rideF[i] * (b - a) : Infinity;
};

/** Cells around the nodes reached within `limit` */
const reachedWindow = (g: ContourGrid, dist: Float32Array, limit: number): Window | undefined => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let n = 0; n < g.nodeCol.length; n += 1) {
    if (!(dist[n] <= limit) || g.nodeCol[n] < 0) continue;
    x0 = Math.min(x0, g.nodeCol[n]);
    x1 = Math.max(x1, g.nodeCol[n]);
    y0 = Math.min(y0, g.nodeRow[n]);
    y1 = Math.max(y1, g.nodeRow[n]);
  }
  for (let i = 0; i < g.rideCol.length; i += 1) {
    if (!(rideTime(g, dist, i) <= limit)) continue;
    x0 = Math.min(x0, g.rideCol[i]);
    x1 = Math.max(x1, g.rideCol[i]);
    y0 = Math.min(y0, g.rideRow[i]);
    y1 = Math.max(y1, g.rideRow[i]);
  }
  if (x0 > x1) return undefined;
  [x0, y0] = [Math.max(0, x0 - MARGIN), Math.max(0, y0 - MARGIN)];
  [x1, y1] = [Math.min(g.cols - 1, x1 + MARGIN), Math.min(g.rows - 1, y1 + MARGIN)];

  return { x0, y0, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
};

const fillField = (g: ContourGrid, w: Window, dist: Float32Array, walkSeconds: number) => {
  const { cols, rows } = w;
  const times = new Float32Array(cols * rows).fill(Infinity);
  for (let n = 0; n < g.nodeCol.length; n += 1) {
    if (g.nodeCol[n] < 0) continue;
    const [x, y] = [g.nodeCol[n] - w.x0, g.nodeRow[n] - w.y0];
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    const i = y * cols + x;
    if (dist[n] < times[i]) times[i] = dist[n];
  }
  // Cells walked from the street that gave their time: capped, so that the lines hug the network instead of
  // drawing walking circles across woods, water and rail yards
  const walked = new Float32Array(cols * rows);
  // Rides: a narrower tube (one cell each side), one cannot get off between two stations
  for (let r = 0; r < g.rideCol.length; r += 1) {
    const [x, y] = [g.rideCol[r] - w.x0, g.rideRow[r] - w.y0];
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    const i = y * cols + x;
    const t = rideTime(g, dist, r);
    if (t < times[i]) {
      times[i] = t;
      walked[i] = MAX_WALK_CELLS - 1;
    }
  }
  const diag = walkSeconds * Math.SQRT2;
  const step = (i: number, j: number, cost: number) => {
    const cells = walked[j] + (cost === walkSeconds ? 1 : Math.SQRT2);
    if (cells <= MAX_WALK_CELLS && times[j] + cost < times[i]) {
      times[i] = times[j] + cost;
      walked[i] = cells;
    }
  };
  for (let y = 0; y < rows; y += 1)
    for (let x = 0; x < cols; x += 1) {
      const i = y * cols + x;
      if (x > 0) step(i, i - 1, walkSeconds);
      if (y > 0) {
        step(i, i - cols, walkSeconds);
        if (x > 0) step(i, i - cols - 1, diag);
        if (x < cols - 1) step(i, i - cols + 1, diag);
      }
    }
  for (let y = rows - 1; y >= 0; y -= 1)
    for (let x = cols - 1; x >= 0; x -= 1) {
      const i = y * cols + x;
      if (x < cols - 1) step(i, i + 1, walkSeconds);
      if (y < rows - 1) {
        step(i, i + cols, walkSeconds);
        if (x < cols - 1) step(i, i + cols + 1, diag);
        if (x > 0) step(i, i + cols - 1, diag);
      }
    }
  // 3 × 3 blur of the finite cells
  const out = new Float32Array(times.length);
  for (let y = 0; y < rows; y += 1)
    for (let x = 0; x < cols; x += 1) {
      let [sum, count] = [0, 0];
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const [xx, yy] = [x + dx, y + dy];
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          const v = times[yy * cols + xx];
          if (Number.isFinite(v)) {
            sum += v;
            count += 1;
          }
        }
      out[y * cols + x] = count === 9 ? sum / 9 : Infinity;
    }

  return out;
};

/**
 * Isochrone lines (marching squares) for each limit, in Mercator metres relative to the zone: one list of segments
 * per limit, drawn as a multi-line.
 */
export const isochroneLines = (g: ContourGrid, dist: Float32Array, limits: number[], walkSpeed: number) => {
  const w = reachedWindow(g, dist, Math.max(...limits));
  if (!w) return limits.map(() => [] as [number, number][][]);
  const field = fillField(g, w, dist, CELL_METRES / walkSpeed);
  const { cols, rows } = w;
  const { minX, minY, cell } = g;
  const at = (x: number, y: number): [number, number] => [
    minX + (w.x0 + x + 0.5) * cell,
    minY + (w.y0 + y + 0.5) * cell,
  ];

  return limits.map((limit) => {
    const segments: [number, number][][] = [];
    const v = (x: number, y: number) => {
      const t = field[y * cols + x];

      return Number.isFinite(t) ? t : limit * 4;
    };
    for (let y = 0; y < rows - 1; y += 1)
      for (let x = 0; x < cols - 1; x += 1) {
        // Corners: a (x, y), b (x+1, y), c (x+1, y+1), d (x, y+1)
        const [a, b, c, d] = [v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y + 1)];
        const code = (a < limit ? 8 : 0) | (b < limit ? 4 : 0) | (c < limit ? 2 : 0) | (d < limit ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const lerp = (p: number, q: number) => (limit - p) / (q - p);
        const top = (): [number, number] => {
          const [px, py] = at(x + lerp(a, b), y);

          return [px, py];
        };
        const right = (): [number, number] => at(x + 1, y + lerp(b, c));
        const bottom = (): [number, number] => at(x + lerp(d, c), y + 1);
        const left = (): [number, number] => at(x, y + lerp(a, d));
        switch (code) {
          case 1:
          case 14:
            segments.push([left(), bottom()]);
            break;
          case 2:
          case 13:
            segments.push([bottom(), right()]);
            break;
          case 3:
          case 12:
            segments.push([left(), right()]);
            break;
          case 4:
          case 11:
            segments.push([top(), right()]);
            break;
          case 6:
          case 9:
            segments.push([top(), bottom()]);
            break;
          case 7:
          case 8:
            segments.push([left(), top()]);
            break;
          case 5:
            segments.push([left(), top()], [bottom(), right()]);
            break;
          case 10:
            segments.push([top(), right()], [left(), bottom()]);
            break;
        }
      }

    return segments;
  });
};

/** Joins the marching squares segments that share an end into longer lines (fewer features, steadier labels) */
export const joinSegments = (segments: [number, number][][]) => {
  const key = ([x, y]: [number, number]) => `${Math.round(x)},${Math.round(y)}`;
  const ends = new Map<string, number[]>();
  segments.forEach((s, i) => {
    for (const p of [s[0], s[1]]) {
      const k = key(p);
      const list = ends.get(k) ?? [];
      list.push(i);
      ends.set(k, list);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines: [number, number][][] = [];
  const extend = (line: [number, number][]) => {
    for (;;) {
      const tail = line[line.length - 1];
      const next = (ends.get(key(tail)) ?? []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segments[next];
      line.push(key(a) === key(tail) ? b : a);
    }
  };
  segments.forEach((s, i) => {
    if (used[i]) return;
    used[i] = 1;
    const line: [number, number][] = [s[0], s[1]];
    extend(line);
    line.reverse();
    extend(line);
    lines.push(line);
  });

  return lines;
};
