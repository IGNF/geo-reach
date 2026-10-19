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

/** Fractions along their edge of the geometry points, per network: they do not depend on the profile */
const fractions = new WeakMap<object, Float32Array>();

/** Fraction along its edge (0 at A, 1 at B, by length) of each geometry point of the network, computed once */
export const pointFractions = (net: Pick<Network, 'coords' | 'coordStart' | 'edgeCount'>): Float32Array => {
  const known = fractions.get(net);
  if (known) return known;

  const { coords, coordStart } = net;
  const frac = new Float32Array(coords.length / 2);
  for (let e = 0; e < net.edgeCount; e += 1) {
    const [s, t] = [coordStart[e], coordStart[e + 1]];
    let total = 0;
    for (let p = s + 1; p < t; p += 1) {
      const dx = coords[p * 2] - coords[p * 2 - 2];
      const dy = coords[p * 2 + 1] - coords[p * 2 - 1];
      total += Math.sqrt(dx * dx + dy * dy);
      frac[p] = total;
    }
    const scale = total > 0 ? 1 / total : 0;
    for (let p = s; p < t; p += 1) frac[p] *= scale;
  }
  fractions.set(net, frac);

  return frac;
};

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

/** A built snap index, as it travels between threads */
export interface SnapParts {
  cellStart: Uint32Array;
  items: Uint32Array;
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  pointFrac: Float32Array;
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
  private readonly parts: SnapParts;
  /** Geometry points of the closed roads (1): their segments are passed over */
  private closedPoints?: Uint8Array;

  private readonly net: Network;

  /**
   * An index built elsewhere (the worker loading the region), or built here for this profile. `islandsOf`: the profile
   * whose islands are left out, the same one without closed sections (see `build`).
   */
  constructor(net: Network, from: Profile | SnapParts, islandsOf?: Profile) {
    this.net = net;
    const parts = 'cellStart' in from ? from : SnapIndex.build(net, from, islandsOf);
    this.parts = parts;
    if (!fractions.has(net)) fractions.set(net, parts.pointFrac);
    this.cellStart = parts.cellStart;
    this.items = parts.items;
    this.cols = parts.cols;
    this.rows = parts.rows;
    this.minX = parts.minX;
    this.minY = parts.minY;
    this.pointFrac = parts.pointFrac;
  }

  /**
   * The islands are found on `islandsOf` (default: the profile itself). With closed sections, it is the same profile
   * with every section open: a village a closed bridge cuts off stays where a point near it snaps to, and is shown
   * unreached, rather than leaving the index (its points would snap across the river, to streets the cut does not
   * concern).
   */
  static build(net: Network, profile: Profile, islandsOf: Profile = profile): SnapParts {
    const { coords, coordStart } = net;
    const [minX, minY, maxX, maxY] = pointsBounds(coords);
    const cols = Math.ceil((maxX - minX) / CELL) + 1;
    const rows = Math.ceil((maxY - minY) / CELL) + 1;

    // Segments of usable roads, bucketed by the cell of their middle (cells are larger than most segments). A road
    // outside the main network of the mode (a one-way street into a dead end, a car street inside a pedestrian zone)
    // is left out: a point snapped there could not leave it, or reach it.
    const { component, size } = strongComponents(islandsOf, net.nodeCount);
    // The cell of each segment of a usable road, computed once for the two passes (NONE: not indexed)
    const NONE = 0xffffffff;
    const segmentCell = new Uint32Array(coords.length / 2).fill(NONE);
    const counts = new Uint32Array(cols * rows + 1);
    for (let e = 0; e < net.edgeCount; e += 1) {
      if (net.edgeKind[e] !== EDGE_ROAD || !(profile.fwd[e] < Infinity || profile.bwd[e] < Infinity)) continue;
      const ca = component[net.edgeA[e]];
      if (ca !== component[net.edgeB[e]] || size[ca] < MIN_COMPONENT_NODES) continue;
      for (let p = coordStart[e]; p < coordStart[e + 1] - 1; p += 1) {
        const x = (coords[p * 2] + coords[p * 2 + 2]) / 2;
        const y = (coords[p * 2 + 1] + coords[p * 2 + 3]) / 2;
        const c = Math.floor((y - minY) / CELL) * cols + Math.floor((x - minX) / CELL);
        segmentCell[p] = c;
        counts[c + 1] += 1;
      }
    }
    for (let c = 0; c < cols * rows; c += 1) counts[c + 1] += counts[c];
    const items = new Uint32Array(counts[cols * rows]);
    const fill = counts.slice();
    for (let p = 0; p < segmentCell.length; p += 1) {
      const c = segmentCell[p];
      if (c === NONE) continue;
      items[fill[c]] = p;
      fill[c] += 1;
    }

    return { cellStart: counts, items, cols, rows, minX, minY, pointFrac: pointFractions(net) };
  }

  /**
   * The same index without the closed edges: what `build` makes of the profile with its cuts, the islands being those
   * of the profile without them, at the cost of marking their points (no grid nor islands built again)
   */
  without(closed: ArrayLike<number>): SnapIndex {
    const { coordStart } = this.net;
    const mask = new Uint8Array(this.pointFrac.length);
    for (let i = 0; i < closed.length; i += 1) mask.fill(1, coordStart[closed[i]], coordStart[closed[i] + 1]);
    const index = new SnapIndex(this.net, this.parts);
    index.closedPoints = mask;

    return index;
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
            if (this.closedPoints?.[p]) continue;
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
}
