import { EDGE_ROAD, type Network } from './network';
import type { Profile } from './profile';

const CELL = 80;
const MAX_RINGS = 6;

export interface Snap {
  edge: number;
  /** Position along the edge, 0 at A, 1 at B */
  f: number;
  /** Mercator metres from the query point to the edge */
  distance: number;
  x: number;
  y: number;
}

/**
 * Grid of the road segments a profile can use, to attach any cursor position to the nearest one (the cursor can be
 * in a park, on a building: it walks to the street first).
 */
export class SnapIndex {
  private readonly cellStart: Uint32Array;
  private readonly items: Uint32Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minY: number;
  /** Fraction along its edge of each geometry point */
  private readonly pointFrac: Float32Array;

  private readonly net: Network;

  constructor(net: Network, profile: Profile) {
    this.net = net;
    const { coords, coordStart } = net;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < coords.length; i += 2) {
      minX = Math.min(minX, coords[i]);
      maxX = Math.max(maxX, coords[i]);
      minY = Math.min(minY, coords[i + 1]);
      maxY = Math.max(maxY, coords[i + 1]);
    }
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.ceil((maxX - minX) / CELL) + 1;
    this.rows = Math.ceil((maxY - minY) / CELL) + 1;

    this.pointFrac = new Float32Array(coords.length / 2);
    for (let e = 0; e < net.edgeCount; e += 1) {
      const [s, t] = [coordStart[e], coordStart[e + 1]];
      let total = 0;
      for (let p = s + 1; p < t; p += 1) {
        total += Math.hypot(coords[p * 2] - coords[p * 2 - 2], coords[p * 2 + 1] - coords[p * 2 - 1]);
        this.pointFrac[p] = total;
      }
      for (let p = s; p < t; p += 1) this.pointFrac[p] = total > 0 ? this.pointFrac[p] / total : 0;
    }

    // Segments of usable roads, bucketed by the cell of their middle (cells are larger than most segments)
    const usable = (e: number) =>
      net.edgeKind[e] === EDGE_ROAD && (profile.fwd[e] < Infinity || profile.bwd[e] < Infinity);
    const cellOf = (p: number) => {
      const x = (coords[p * 2] + coords[p * 2 + 2]) / 2;
      const y = (coords[p * 2 + 1] + coords[p * 2 + 3]) / 2;

      return Math.floor((y - minY) / CELL) * this.cols + Math.floor((x - minX) / CELL);
    };
    const counts = new Uint32Array(this.cols * this.rows + 1);
    const forEachSegment = (fn: (p: number) => void) => {
      for (let e = 0; e < net.edgeCount; e += 1) {
        if (!usable(e)) continue;
        for (let p = coordStart[e]; p < coordStart[e + 1] - 1; p += 1) fn(p);
      }
    };
    forEachSegment((p) => {
      counts[cellOf(p) + 1] += 1;
    });
    for (let c = 0; c < this.cols * this.rows; c += 1) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.items = new Uint32Array(counts[this.cols * this.rows]);
    const fill = counts.slice();
    forEachSegment((p) => {
      const c = cellOf(p);
      this.items[fill[c]] = p;
      fill[c] += 1;
    });
  }

  /** Edge of a geometry point (binary search on the edge starts) */
  private edgeOfPoint(p: number) {
    const starts = this.net.coordStart;
    let [lo, hi] = [0, this.net.edgeCount - 1];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= p) lo = mid;
      else hi = mid - 1;
    }

    return lo;
  }

  nearest(x: number, y: number): Snap | undefined {
    const { coords } = this.net;
    const cx = Math.floor((x - this.minX) / CELL);
    const cy = Math.floor((y - this.minY) / CELL);
    let best: { p: number; d2: number; t: number } | undefined;
    for (let ring = 0; ring <= MAX_RINGS; ring += 1) {
      for (let j = cy - ring; j <= cy + ring; j += 1) {
        for (let i = cx - ring; i <= cx + ring; i += 1) {
          // Only the border of the ring: the inside was searched before
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== ring) continue;
          if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
          const c = j * this.cols + i;
          for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k += 1) {
            const p = this.items[k];
            const [x0, y0, x1, y1] = [coords[p * 2], coords[p * 2 + 1], coords[p * 2 + 2], coords[p * 2 + 3]];
            const [dx, dy] = [x1 - x0, y1 - y0];
            const len2 = dx * dx + dy * dy;
            const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
            const [qx, qy] = [x0 + t * dx - x, y0 + t * dy - y];
            const d2 = qx * qx + qy * qy;
            if (!best || d2 < best.d2) best = { p, d2, t };
          }
        }
      }
      // A segment found in this ring can still be beaten by one of the next ring (mid-point bucketing): one more
      if (best && Math.sqrt(best.d2) < ring * CELL) break;
    }
    if (!best) return undefined;
    const { p, t } = best;
    const edge = this.edgeOfPoint(p);
    const f = this.pointFrac[p] + t * (this.pointFrac[p + 1] - this.pointFrac[p]);

    return {
      edge,
      f,
      distance: Math.sqrt(best.d2),
      x: coords[p * 2] + t * (coords[p * 2 + 2] - coords[p * 2]),
      y: coords[p * 2 + 1] + t * (coords[p * 2 + 3] - coords[p * 2 + 1]),
    };
  }

  /** Fraction along its edge of a geometry point */
  fraction(p: number) {
    return this.pointFrac[p];
  }
}
