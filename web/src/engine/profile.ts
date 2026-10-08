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

/** Assumptions of the travel time model, set from the interface */
export interface ModelOptions {
  /** Walking speed, km/h (4: the Géoplateforme route service) */
  walkKmh: number;
  /** Cycling speed on a street, km/h */
  bikeKmh: number;
  /** Car: estimated traffic of the hour, or free flow */
  traffic: 'estimated' | 'free';
  /** Transit wait: half the interval (average, arriving at random) or the whole interval (worst case: the previous
   * departure just left) */
  wait: 'half' | 'full';
  /** Minutes to get off and out of a station, or to change lines */
  transferMin: number;
  /** What-if: transit disrupted (fewer departures, slower rides), roads congested */
  scenario: Scenario;
}

export type Scenario = 'normal' | 'disrupted' | 'severe';

/** Demonstration coefficients of the scenarios, not measured data */
export const SCENARIOS: Record<Scenario, { headway: number; ride: number; carSpeed: number }> = {
  normal: { headway: 1, ride: 1, carSpeed: 1 },
  disrupted: { headway: 2, ride: 1.15, carSpeed: 0.75 },
  severe: { headway: 4, ride: 1.3, carSpeed: 0.55 },
};

export const DEFAULT_MODEL: ModelOptions = {
  walkKmh: 4,
  bikeKmh: 15,
  traffic: 'estimated',
  wait: 'half',
  transferMin: 1.5,
  scenario: 'normal',
};

/** Boarding penalty already counted in the waits of transit.bin (crates/gtfs-prep) */
const BOARD_PENALTY = 60;

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

export interface ProfileOptions {
  mode: Mode;
  direction: Direction;
  /** Transit: bus lines too */
  bus: boolean;
  /** Departure hour (0–23): traffic for cars, service frequency for transit */
  hour: number;
  model: ModelOptions;
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

const edgeCosts = (net: Network, { mode, bus, hour, model }: ProfileOptions) => {
  const walkSpeed = model.walkKmh / 3.6;
  const scenario = SCENARIOS[model.scenario];
  const bikeSpeed = model.bikeKmh / 3.6;
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
          const traffic = (model.traffic === 'free' ? 1 : (major ? TRAFFIC.major : TRAFFIC.local)[h]) * scenario.carSpeed;
          const t = length / ((net.edgeCarSpeed[e] * traffic) / 3.6) + (major ? CAR_PENALTY.major : CAR_PENALTY.local);
          if (flags & FLAG_CAR_FWD) fwd[e] = t;
          if (flags & FLAG_CAR_BWD) bwd[e] = t;
        } else if (mode === 'bike') {
          const speed = bikeSpeed * (flags & FLAG_CYCLEWAY ? 1.1 : 1) * (flags & FLAG_PATH ? 0.65 : 1);
          if (flags & FLAG_BIKE_FWD) fwd[e] = length / speed + BIKE_PENALTY;
          if (flags & FLAG_BIKE_BWD) bwd[e] = length / speed + BIKE_PENALTY;
        } else if (flags & FLAG_WALK) {
          const t = (length / walkSpeed) * (flags & FLAG_STAIRS ? 2 : 1);
          fwd[e] = t;
          bwd[e] = t;
        }
        break;
      case EDGE_LINK:
        if (mode === 'transit' || mode === 'pedestrian') {
          fwd[e] = length / walkSpeed;
          bwd[e] = fwd[e];
        }
        break;
      default:
        if (mode !== 'transit' || (!bus && flags & FLAG_BUS)) break;
        if (net.edgeKind[e] === EDGE_RIDE || net.edgeKind[e] === EDGE_BOARD) {
          // The hour's wait (Infinity: no service) and ride time
          const row = net.edgeHourRow[e];
          const cost = row >= 0 ? net.hourCosts[row * HOURS + h] : length;
          if (net.edgeKind[e] === EDGE_RIDE) fwd[e] = cost * scenario.ride;
          else {
            // A boarding costs half the interval plus the penalty: the whole interval (worst case) doubles the wait,
            // a disruption stretches the interval
            const wait = (cost - BOARD_PENALTY) * (model.wait === 'full' ? 2 : 1) * scenario.headway;
            fwd[e] = wait + BOARD_PENALTY;
          }
        } else if (net.edgeKind[e] === EDGE_ALIGHT) fwd[e] = model.transferMin * 60;
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
