import type { NetworkOptions } from 'isard';
import { EDGE_RIDE, EDGE_ROAD, FLAG_BUS, type Network, type Profile } from '@/features/routing';

/**
 * The network as the map's network layer takes it: nodes, edges along their lines, and the cost of travelling each
 * edge in the current profile. The geometry is sent once per region; a new profile only sends new costs (one texture
 * upload), and every run only the node times.
 */

const R = 6378137;
const DEG = 180 / Math.PI;

/** Zone positions (Web Mercator metres relative to the origin, y north) to longitudes and latitudes, interleaved */
const lonLats = (xy: Float32Array, [ox, oy]: readonly [number, number]): Float64Array => {
  const out = new Float64Array(xy.length);
  for (let i = 0; i < xy.length; i += 2) {
    out[i] = ((xy[i] + ox) / R) * DEG;
    out[i + 1] = (2 * Math.atan(Math.exp((xy[i + 1] + oy) / R)) - Math.PI / 2) * DEG;
  }

  return out;
};

/** Rides of metro, RER, train and tram are drawn wider than streets and buses */
const RAIL_WIDTH = 1.8;

export const networkGeometry = (net: Network): Pick<NetworkOptions, 'nodes' | 'edges' | 'lines' | 'edgeWidths'> => {
  const edges = new Uint32Array(net.edgeCount * 2);
  const edgeWidths = new Float32Array(net.edgeCount).fill(1);
  for (let e = 0; e < net.edgeCount; e += 1) {
    edges[e * 2] = net.edgeA[e];
    edges[e * 2 + 1] = net.edgeB[e];
    if (net.edgeKind[e] === EDGE_RIDE && !(net.edgeFlags[e] & FLAG_BUS)) edgeWidths[e] = RAIL_WIDTH;
  }

  return {
    nodes: lonLats(net.nodeXY.subarray(0, net.nodeCount * 2), net.origin),
    edges,
    // Boardings and alightings have no points: straight, and never drawn (no cost)
    lines: { start: net.coordStart, points: lonLats(net.coords, net.origin) },
    edgeWidths,
  };
};

/**
 * Per edge, the cost of reaching a point along it from A, then from B (seconds for the whole edge): departure,
 * forwards from A and backwards from B; arrival, leaving the point towards A or B. Only roads and rides the profile
 * travels are drawn: the others are closed both ways.
 */
export const networkCosts = (net: Network, { fwd, bwd, direction }: Pick<Profile, 'fwd' | 'bwd' | 'direction'>): Float32Array => {
  const costs = new Float32Array(net.edgeCount * 2).fill(Number.POSITIVE_INFINITY);
  for (let e = 0; e < net.edgeCount; e += 1) {
    const kind = net.edgeKind[e];
    if (kind !== EDGE_ROAD && kind !== EDGE_RIDE) continue;
    const [fromA, fromB] = direction === 'departure' ? [fwd[e], bwd[e]] : [bwd[e], fwd[e]];
    costs[e * 2] = fromA;
    costs[e * 2 + 1] = fromB;
  }

  return costs;
};
