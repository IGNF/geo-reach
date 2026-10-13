import { EDGE_ROAD, type Network } from './network';
import type { Profile } from './profile';
import { pointsBounds } from '@/shared/bounds';

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

/** A group of streets smaller than this, cut off from the rest for a mode, is an island no trip starts from */
const MIN_COMPONENT_NODES = 500;

/**
 * Strongly connected components of a profile's graph (Kosaraju, iterative: a million nodes would overflow the call
 * stack): from any node of a component one can reach any other and come back. A one-way street ending in a dead end,
 * or a car street inside a pedestrian zone, falls in a tiny component of its own.
 * Returns the component of each node and the size of each component.
 */
const strongComponents = ({ offsets, heads }: Profile, nodes: number): { component: Uint32Array; size: Uint32Array } => {
  // First pass: the nodes in the order their depth-first search finishes
  const order = new Uint32Array(nodes);
  let finished = 0;
  const visited = new Uint8Array(nodes);
  const stack = new Uint32Array(nodes);
  const nextArc = new Uint32Array(nodes);
  for (let root = 0; root < nodes; root += 1) {
    if (visited[root]) continue;
    let depth = 0;
    stack[0] = root;
    visited[root] = 1;
    nextArc[root] = offsets[root];
    while (depth >= 0) {
      const n = stack[depth];
      if (nextArc[n] < offsets[n + 1]) {
        const head = heads[nextArc[n]];
        nextArc[n] += 1;
        if (!visited[head]) {
          visited[head] = 1;
          nextArc[head] = offsets[head];
          depth += 1;
          stack[depth] = head;
        }
      } else {
        order[finished] = n;
        finished += 1;
        depth -= 1;
      }
    }
  }

  // The reversed graph, in the same compressed layout
  const rOffsets = new Uint32Array(nodes + 1);
  for (let a = 0; a < heads.length; a += 1) rOffsets[heads[a] + 1] += 1;
  for (let n = 0; n < nodes; n += 1) rOffsets[n + 1] += rOffsets[n];
  const rHeads = new Uint32Array(heads.length);
  const cursor = rOffsets.slice(0, nodes);
  for (let n = 0; n < nodes; n += 1)
    for (let a = offsets[n]; a < offsets[n + 1]; a += 1) {
      rHeads[cursor[heads[a]]] = n;
      cursor[heads[a]] += 1;
    }

  // Second pass, on the reversed graph, latest finished first: each search covers one component
  const NONE = 0xffffffff;
  const component = new Uint32Array(nodes).fill(NONE);
  const sizes: number[] = [];
  for (let i = nodes - 1; i >= 0; i -= 1) {
    const root = order[i];
    if (component[root] !== NONE) continue;
    const id = sizes.length;
    let count = 0;
    let top = 0;
    stack[0] = root;
    component[root] = id;
    while (top >= 0) {
      const n = stack[top];
      top -= 1;
      count += 1;
      for (let a = rOffsets[n]; a < rOffsets[n + 1]; a += 1)
        if (component[rHeads[a]] === NONE) {
          component[rHeads[a]] = id;
          top += 1;
          stack[top] = rHeads[a];
        }
    }
    sizes.push(count);
  }

  return { component, size: Uint32Array.from(sizes) };
};

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
    const [minX, minY, maxX, maxY] = pointsBounds(coords);
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

    // Segments of usable roads, bucketed by the cell of their middle (cells are larger than most segments). A road
    // outside the main network of the mode (a one-way street into a dead end, a car street inside a pedestrian zone)
    // is left out: a point snapped there could not leave it, or reach it.
    const open = (e: number): boolean =>
      net.edgeKind[e] === EDGE_ROAD && (profile.fwd[e] < Infinity || profile.bwd[e] < Infinity);
    const { component, size } = strongComponents(profile, net.nodeCount);
    const usable = (e: number): boolean => {
      const [ca, cb] = [component[net.edgeA[e]], component[net.edgeB[e]]];

      return open(e) && ca === cb && size[ca] >= MIN_COMPONENT_NODES;
    };
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
  fraction(p: number): number {
    return this.pointFrac[p];
  }
}
