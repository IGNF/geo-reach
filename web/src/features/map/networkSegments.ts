import { EDGE_RIDE, EDGE_ROAD, FLAG_BUS, type Network, pointFractions, type Profile } from '@/features/routing';
import { pointsBounds } from '@/shared/bounds';

/**
 * The segments the network layer draws, one instanced quad each: built from the network and a profile, sorted by
 * square of the region so that only the squares in view are drawn. Pure data: the segments worker runs it.
 */

export const EARTH = 2 * Math.PI * 6378137;
/** A cost the shader treats as unreachable (Infinity does not fit the float attributes) */
const BIG = 1e9;
/** Squares of the region along its longer side (about 2 km for the largest) */
const CHUNKS_ACROSS = 256;
/** Smallest square, Mercator metres */
const MIN_CHUNK = 500;

/** The squares of a region, Mercator metres relative to the zone origin */
export interface Chunks {
  minX: number;
  minY: number;
  size: number;
  cols: number;
  rows: number;
}

/** What the segments are built from: the geometry of the network */
export type SegmentSource = Pick<Network, 'coords' | 'coordStart' | 'edgeKind' | 'edgeFlags' | 'edgeA' | 'edgeB' | 'edgeCount'>;

export interface Segments {
  /** Per segment: start x, y, end x, y (Mercator 0..1 relative to the origin, y down), node A, node B, style */
  geom: Float32Array;
  /** Per segment: cost to reach its start from A and from B, then its end from A and from B */
  cost: Float32Array;
  count: number;
  /** Segments of square c: chunkStart[c] .. chunkStart[c + 1] */
  chunkStart: Uint32Array;
}

export const chunksOf = (coords: Float32Array): Chunks => {
  const [minX, minY, maxX, maxY] = pointsBounds(coords);
  const size = Math.max(Math.max(maxX - minX, maxY - minY) / CHUNKS_ACROSS, MIN_CHUNK);

  return { minX, minY, size, cols: Math.floor((maxX - minX) / size) + 1, rows: Math.floor((maxY - minY) / size) + 1 };
};

/** Segments of the edges the profile travels, with the cost of reaching each end from A and from B */
export const buildSegments = (net: SegmentSource, chunks: Chunks, { fwd, bwd, direction }: Pick<Profile, 'fwd' | 'bwd' | 'direction'>): Segments => {
  const { coords, coordStart, edgeKind } = net;
  const frac = pointFractions(net);
  const sx = 1 / EARTH;
  const drawn = (e: number) => {
    const kind = edgeKind[e];

    return (kind === EDGE_ROAD || kind === EDGE_RIDE) && (fwd[e] < Infinity || bwd[e] < Infinity);
  };
  // The square of a segment, by its middle
  const { minX, minY, size, cols, rows } = chunks;
  const chunkOf = (p: number): number => {
    const i = Math.floor(((coords[p * 2] + coords[p * 2 + 2]) / 2 - minX) / size);
    const j = Math.floor(((coords[p * 2 + 1] + coords[p * 2 + 3]) / 2 - minY) / size);

    return Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i));
  };
  // Typed arrays sized first: millions of segments for a region, written in place (no array per segment), square
  // after square
  const chunkStart = new Uint32Array(cols * rows + 1);
  for (let e = 0; e < net.edgeCount; e += 1)
    if (drawn(e)) for (let p = coordStart[e]; p < coordStart[e + 1] - 1; p += 1) chunkStart[chunkOf(p) + 1] += 1;
  for (let c = 0; c < cols * rows; c += 1) chunkStart[c + 1] += chunkStart[c];
  const count = chunkStart[cols * rows];
  const geom = new Float32Array(count * 7);
  const cost = new Float32Array(count * 4);
  const fill = chunkStart.slice(0, cols * rows);
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (!drawn(e)) continue;
    const [s, t] = [coordStart[e], coordStart[e + 1]];
    const f1 = Math.min(fwd[e], BIG);
    const b1 = Math.min(bwd[e], BIG);
    // Departure: reach a point at f from A forwards, from B backwards. Arrival: leave it towards A or B.
    const [fromA, fromB] = direction === 'departure' ? [f1, b1] : [b1, f1];
    const style = edgeKind[e] === EDGE_RIDE ? (net.edgeFlags[e] & FLAG_BUS ? 0 : 1) : 0;
    const [a, b] = [net.edgeA[e], net.edgeB[e]];
    for (let p = s; p < t - 1; p += 1) {
      const chunk = chunkOf(p);
      const k = fill[chunk];
      fill[chunk] += 1;
      const g = k * 7;
      geom[g] = coords[p * 2] * sx;
      geom[g + 1] = -coords[p * 2 + 1] * sx;
      geom[g + 2] = coords[p * 2 + 2] * sx;
      geom[g + 3] = -coords[p * 2 + 3] * sx;
      geom[g + 4] = a;
      geom[g + 5] = b;
      geom[g + 6] = style;
      const [fa, fb] = [frac[p], frac[p + 1]];
      const c = k * 4;
      cost[c] = fa * fromA;
      cost[c + 1] = (1 - fa) * fromB;
      cost[c + 2] = fb * fromA;
      cost[c + 3] = (1 - fb) * fromB;
    }
  }

  return { geom, cost, count, chunkStart };
};
