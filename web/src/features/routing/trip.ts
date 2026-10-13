import type { Network } from './network';
import type { Profile } from './profile';
import type { Snap, SnapIndex } from './snap';

/** Beyond this, a point is off the network */
export const MAX_SNAP_METRES = 600;

/**
 * Seconds of a share of an edge: none at all when the share is zero, even along a forbidden way (0 × ∞ would give
 * NaN, which the engine refuses: a point at the very end of a one-way street must still start from that end)
 */
export const part = (share: number, seconds: number): number => (share > 0 ? share * seconds : 0);

/** Ground metres per Mercator metre in the zone */
export const groundScaleOf = (net: Network): number =>
  Math.cos(2 * Math.atan(Math.exp(net.origin[1] / 6378137)) - Math.PI / 2);

/** Zone Mercator metres, x east, y north */
export type ZoneXY = [number, number];

interface Ends {
  a: number;
  b: number;
  /** Seconds between the point and A, B (walk to the street included) */
  toA: number;
  toB: number;
}

/** A point on its nearest usable street of a profile (departure profile: arcs run forwards) */
const snapped = (
  index: SnapIndex,
  [x, y]: ZoneXY,
  groundScale: number,
): Snap | undefined => {
  const s = index.nearest(x, y);

  return s && s.distance * groundScale <= MAX_SNAP_METRES ? s : undefined;
};

/** Seconds from the point to each end of its street: back to A, on to B */
const leaving = (net: Network, { fwd, bwd }: Profile, s: Snap, walk: number): Ends => ({
  a: net.edgeA[s.edge],
  b: net.edgeB[s.edge],
  toA: walk + part(s.f, bwd[s.edge]),
  toB: walk + part(1 - s.f, fwd[s.edge]),
});

/** Seconds from each end of its street to the point */
const arriving = (net: Network, { fwd, bwd }: Profile, s: Snap, walk: number): Ends => ({
  a: net.edgeA[s.edge],
  b: net.edgeB[s.edge],
  toA: walk + part(s.f, fwd[s.edge]),
  toB: walk + part(1 - s.f, bwd[s.edge]),
});

/** A binary heap of (seconds, node), smallest first */
class Heap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, node: number): void {
    const { items } = this;
    items.push([cost, node]);
    for (let i = items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const { items } = this;
    const top = items[0];
    const last = items.pop();
    if (!top || !last || !items.length) return top;

    items[0] = last;
    for (let i = 0; ; ) {
      const [l, r] = [2 * i + 1, 2 * i + 2];
      const smallest = [l, r].reduce((m, c) => (c < items.length && items[c][0] < items[m][0] ? c : m), i);
      if (smallest === i) break;
      [items[smallest], items[i]] = [items[i], items[smallest]];
      i = smallest;
    }

    return top;
  }
}

/**
 * Seconds of the trip between two points on a departure profile: a Dijkstra from the first point that stops as soon
 * as nothing can beat the best arrival found (a trip, not a whole map), or at `maxSeconds`. Undefined when a point
 * is off the network or the trip is longer.
 */
export const tripSeconds = (
  net: Network,
  profile: Profile,
  index: SnapIndex,
  from: ZoneXY,
  to: ZoneXY,
  maxSeconds: number,
): number | undefined => {
  const groundScale = groundScaleOf(net);
  const walkSpeed = profile.model.walkKmh / 3.6;
  const [start, end] = [snapped(index, from, groundScale), snapped(index, to, groundScale)];
  if (!start || !end) return undefined;

  const source = leaving(net, profile, start, (start.distance * groundScale) / walkSpeed);
  const target = arriving(net, profile, end, (end.distance * groundScale) / walkSpeed);

  // Float64: a float32 distance compared with a float64 cost would skip nodes
  const dist = new Float64Array(net.nodeCount).fill(Number.POSITIVE_INFINITY);
  const heap = new Heap();
  const reach = (node: number, cost: number): void => {
    if (!(cost < dist[node])) return;
    dist[node] = cost;
    heap.push(cost, node);
  };
  reach(source.a, source.toA);
  reach(source.b, source.toB);

  let best = Number.POSITIVE_INFINITY;
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [cost, node] = item;
    if (cost > dist[node]) continue;
    if (cost >= best || cost > maxSeconds) break;

    if (node === target.a) best = Math.min(best, cost + target.toA);
    if (node === target.b) best = Math.min(best, cost + target.toB);

    for (let arc = profile.offsets[node]; arc < profile.offsets[node + 1]; arc += 1)
      reach(profile.heads[arc], cost + profile.costs[arc]);
  }

  return best <= maxSeconds ? best : undefined;
};
