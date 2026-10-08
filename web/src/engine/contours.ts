import type { Network } from './network';

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
  /** Cell of each node, -1 outside */
  nodeCell: Int32Array;
  /** Seconds to walk across one cell, at the profile speed */
  times: Float32Array;
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
  const nodeCell = new Int32Array(net.nodeCount);
  for (let n = 0; n < net.nodeCount; n += 1)
    nodeCell[n] =
      Math.floor((net.nodeXY[n * 2 + 1] - minY) / cell) * cols + Math.floor((net.nodeXY[n * 2] - minX) / cell);

  return { minX, minY, cell, cols, rows, nodeCell, times: new Float32Array(cols * rows) };
};

/**
 * Travel time per cell: the best node of the cell, then walking from cell to cell (two-pass chamfer distance), so
 * that the field is continuous between the streets, then a light blur that smooths the contours.
 */
const fillField = (g: ContourGrid, dist: Float32Array, walkSeconds: number) => {
  const { cols, rows, times, nodeCell } = g;
  times.fill(Infinity);
  for (let n = 0; n < nodeCell.length; n += 1) if (dist[n] < times[nodeCell[n]]) times[nodeCell[n]] = dist[n];
  const diag = walkSeconds * Math.SQRT2;
  const step = (i: number, j: number, cost: number) => {
    if (times[j] + cost < times[i]) times[i] = times[j] + cost;
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
  const field = fillField(g, dist, CELL_METRES / walkSpeed);
  const { cols, rows, minX, minY, cell } = g;
  const at = (x: number, y: number): [number, number] => [minX + (x + 0.5) * cell, minY + (y + 0.5) * cell];

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
