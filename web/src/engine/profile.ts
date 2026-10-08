import type { Direction, Mode } from '../lib/config';
import {
  FLAG_BIKE_BWD,
  FLAG_BIKE_FWD,
  FLAG_CYCLEWAY,
  FLAG_PATH,
  HOURS,
  EDGE_ALIGHT,
  EDGE_BOARD,
  EDGE_LINK,
  EDGE_RIDE,
  EDGE_ROAD,
  FLAG_BUS,
  FLAG_CAR_BWD,
  FLAG_CAR_FWD,
  FLAG_STAIRS,
  FLAG_WALK,
  type Network,
} from './network';

/** 4 km/h, the walking speed of the Géoplateforme route service */
export const WALK_SPEED = 4 / 3.6;
/** 15 km/h, a city bike ride */
const BIKE_SPEED = 15 / 3.6;

/**
 * Estimated traffic: share of the BD TOPO free-flow speed kept at each hour of a weekday, on major roads
 * (importance 1 to 3) and on local streets. A typical Île-de-France congestion curve (morning and evening peaks), not
 * live traffic.
 */
export const TRAFFIC: { major: number[]; local: number[] } = {
  major: [1, 1, 1, 1, 1, 0.95, 0.8, 0.55, 0.48, 0.6, 0.7, 0.7, 0.68, 0.7, 0.7, 0.66, 0.58, 0.5, 0.48, 0.6, 0.78, 0.85, 0.92, 0.96],
  local: [1, 1, 1, 1, 1, 0.95, 0.86, 0.7, 0.66, 0.74, 0.78, 0.78, 0.76, 0.78, 0.78, 0.75, 0.7, 0.66, 0.64, 0.72, 0.84, 0.9, 0.95, 0.98],
};
/** Per road section, seconds: crossings and lights on local streets, few on major roads */
const CAR_PENALTY = { major: 0.5, local: 1.5 };
/** Per road section, seconds: crossings slow bikes down too */
const BIKE_PENALTY = 1.5;
/** Getting off and out of the station */
const ALIGHT_COST = 30;

export interface ProfileOptions {
  mode: Mode;
  direction: Direction;
  /** Transit: bus lines too */
  bus: boolean;
  /** Departure hour (0–23): traffic for cars, service frequency for transit */
  hour: number;
}

/** Travel costs of one mode and direction, and the graph the engine runs on (compressed rows) */
export interface Profile extends ProfileOptions {
  /** Seconds to go along each edge from A to B, Infinity where forbidden */
  fwd: Float32Array;
  /** Seconds from B to A */
  bwd: Float32Array;
  offsets: Uint32Array;
  heads: Uint32Array;
  costs: Float32Array;
  arcEdge: Uint32Array;
}

const edgeCosts = (net: Network, { mode, bus, hour }: ProfileOptions) => {
  const h = ((hour % HOURS) + HOURS) % HOURS;
  const fwd = new Float32Array(net.edgeCount).fill(Number.POSITIVE_INFINITY);
  const bwd = new Float32Array(net.edgeCount).fill(Number.POSITIVE_INFINITY);
  for (let e = 0; e < net.edgeCount; e += 1) {
    const flags = net.edgeFlags[e];
    const length = net.edgeLength[e];
    switch (net.edgeKind[e]) {
      case EDGE_ROAD:
        if (mode === 'car') {
          const imp = net.edgeImportance[e];
          const major = imp > 0 && imp <= 3;
          const traffic = (major ? TRAFFIC.major : TRAFFIC.local)[h];
          const t = length / ((net.edgeCarSpeed[e] * traffic) / 3.6) + (major ? CAR_PENALTY.major : CAR_PENALTY.local);
          if (flags & FLAG_CAR_FWD) fwd[e] = t;
          if (flags & FLAG_CAR_BWD) bwd[e] = t;
        } else if (mode === 'bike') {
          const speed = BIKE_SPEED * (flags & FLAG_CYCLEWAY ? 1.1 : 1) * (flags & FLAG_PATH ? 0.65 : 1);
          if (flags & FLAG_BIKE_FWD) fwd[e] = length / speed + BIKE_PENALTY;
          if (flags & FLAG_BIKE_BWD) bwd[e] = length / speed + BIKE_PENALTY;
        } else if (flags & FLAG_WALK) {
          const t = (length / WALK_SPEED) * (flags & FLAG_STAIRS ? 2 : 1);
          fwd[e] = t;
          bwd[e] = t;
        }
        break;
      case EDGE_LINK:
        if (mode === 'transit' || mode === 'pedestrian') {
          fwd[e] = length / WALK_SPEED;
          bwd[e] = fwd[e];
        }
        break;
      default:
        if (mode !== 'transit' || (!bus && flags & FLAG_BUS)) break;
        if (net.edgeKind[e] === EDGE_RIDE || net.edgeKind[e] === EDGE_BOARD) {
          // The hour's wait (Infinity: no service) and ride time
          const row = net.edgeHourRow[e];
          fwd[e] = row >= 0 ? net.hourCosts[row * HOURS + h] : length;
        } else if (net.edgeKind[e] === EDGE_ALIGHT) fwd[e] = ALIGHT_COST;
    }
  }

  return { fwd, bwd };
};

/**
 * Builds the profile. From a departure, arcs follow the edges; towards an arrival the graph is reversed, so that one
 * run gives the time from every node to the point.
 */
export const buildProfile = (net: Network, options: ProfileOptions): Profile => {
  const { fwd, bwd } = edgeCosts(net, options);
  const reversed = options.direction === 'arrival';
  const degree = new Uint32Array(net.nodeCount + 1);
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (fwd[e] < Number.POSITIVE_INFINITY) degree[reversed ? net.edgeB[e] : net.edgeA[e]] += 1;
    if (bwd[e] < Number.POSITIVE_INFINITY) degree[reversed ? net.edgeA[e] : net.edgeB[e]] += 1;
  }
  const offsets = new Uint32Array(net.nodeCount + 1);
  for (let n = 0; n < net.nodeCount; n += 1) offsets[n + 1] = offsets[n] + degree[n];
  const arcs = offsets[net.nodeCount];
  const heads = new Uint32Array(arcs);
  const costs = new Float32Array(arcs);
  const arcEdge = new Uint32Array(arcs);
  const cursor = offsets.slice(0, net.nodeCount);
  const add = (tail: number, head: number, cost: number, edge: number) => {
    const i = cursor[tail];
    cursor[tail] += 1;
    heads[i] = head;
    costs[i] = cost;
    arcEdge[i] = edge;
  };
  for (let e = 0; e < net.edgeCount; e += 1) {
    const [a, b] = [net.edgeA[e], net.edgeB[e]];
    if (fwd[e] < Number.POSITIVE_INFINITY) {
      if (reversed) add(b, a, fwd[e], e);
      else add(a, b, fwd[e], e);
    }
    if (bwd[e] < Number.POSITIVE_INFINITY) {
      if (reversed) add(a, b, bwd[e], e);
      else add(b, a, bwd[e], e);
    }
  }

  return { ...options, fwd, bwd, offsets, heads, costs, arcEdge };
};
