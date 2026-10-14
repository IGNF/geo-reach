import { FLAG_WALK, HOURS, type Network, readTransit } from '@/features/routing';

/**
 * A made-up town to try the engine on: a grid of streets every 100 m, a river with three bridges, a hill, an
 * expressway, a boulevard with a cycle lane, a pedestrian old town, one-way streets, a park, a metro line and a bus
 * line. Built as the files of a region would give it: the roads as a network, the transit as a TRN3 file read by the
 * same code as the map's (stations linked to their streets, waits and rides hour by hour).
 * Positions are ground metres (the origin on the equator: a Mercator metre is a ground metre), y to the north.
 */

export const COLS = 32;
export const ROWS = 21;
export const STEP = 100;
export const SIZE = { width: (COLS - 1) * STEP, height: (ROWS - 1) * STEP };

/** The river runs west to east between two rows of crossings; three bridges cross it */
export const RIVER = { south: 520, north: 580 };
const RIVER_ROW = 5;
export const BRIDGES = [4, 15, 26];
/** The bridge the visitor can close */
export const MIDDLE_BRIDGE = 15;

/** A park without streets, crossed by one path */
export const PARK = { x0: 2150, y0: 150, x1: 2750, y1: 450 };
/** The pedestrian old town */
export const OLD_TOWN = { x0: 400, y0: 1400, x1: 800, y1: 1800 };
/** The hill: its top and spread, metres */
export const HILL = { x: 2350, y: 1500, height: 50, spread: 350 };

const EXPRESSWAY_ROW = 0;
const BOULEVARD_ROW = 12;
const AVENUE_COL = 10;
/** One-way for cars: a row eastbound, a column northbound (both ways by bike) */
const ONE_WAY_ROW = 16;
const ONE_WAY_COL = 20;

/** Flags of the road files (crates/prep/src/roads/graph.rs) */
const CAR_FWD = 1;
const CAR_BWD = 2;
const BIKE_FWD = 16;
const BIKE_BWD = 32;
const CYCLEWAY = 64;
const PATH = 128;

const NO_NAME = 0xffffffff;
export const NAMES = ['Expressway', 'Boulevard', 'Avenue', 'Park path'];

export const node = (row: number, col: number): number => row * COLS + col;
export const height = (x: number, y: number): number =>
  35 + HILL.height * Math.exp(-((x - HILL.x) ** 2 + (y - HILL.y) ** 2) / (2 * HILL.spread ** 2));

const inside = (box: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): boolean =>
  x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;

interface Street {
  a: number;
  b: number;
  flags: number;
  speed: number;
  importance: number;
  name: number;
}

/** A street between two crossings of the grid, or undefined where there is none (river, park) */
const street = (r0: number, c0: number, r1: number, c1: number): Street | undefined => {
  const [x0, y0, x1, y1] = [c0 * STEP, r0 * STEP, c1 * STEP, r1 * STEP];
  const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const vertical = c0 === c1;
  if (vertical && r0 === RIVER_ROW && !BRIDGES.includes(c0)) return undefined;
  if (mx >= PARK.x0 && mx <= PARK.x1 && my >= PARK.y0 && my <= PARK.y1) return undefined;

  const local = { a: node(r0, c0), b: node(r1, c1), flags: CAR_FWD | CAR_BWD | FLAG_WALK | BIKE_FWD | BIKE_BWD, speed: 30, importance: 5, name: NO_NAME };
  if (!vertical && r0 === EXPRESSWAY_ROW) return { ...local, flags: CAR_FWD | CAR_BWD, speed: 90, importance: 1, name: 0 };
  if (!vertical && r0 === BOULEVARD_ROW) return { ...local, flags: local.flags | CYCLEWAY, speed: 50, importance: 2, name: 1 };
  if (vertical && c0 === AVENUE_COL) return { ...local, speed: 50, importance: 3, name: 2 };
  if (inside({ x0: OLD_TOWN.x0 - 1, y0: OLD_TOWN.y0 - 1, x1: OLD_TOWN.x1 + 1, y1: OLD_TOWN.y1 + 1 }, mx, my))
    return { ...local, flags: FLAG_WALK | BIKE_FWD | BIKE_BWD, speed: 0 };
  if (!vertical && r0 === ONE_WAY_ROW) return { ...local, flags: CAR_FWD | FLAG_WALK | BIKE_FWD | BIKE_BWD };
  if (vertical && c0 === ONE_WAY_COL) return { ...local, flags: CAR_FWD | FLAG_WALK | BIKE_FWD | BIKE_BWD };

  return local;
};

/** The streets of the town: the grid, then the park path */
const streets = (): Street[] => {
  const out: Street[] = [];
  for (let r = 0; r < ROWS; r += 1)
    for (let c = 0; c < COLS; c += 1) {
      const east = c + 1 < COLS ? street(r, c, r, c + 1) : undefined;
      const north = r + 1 < ROWS ? street(r, c, r + 1, c) : undefined;
      if (east) out.push(east);
      if (north) out.push(north);
    }
  out.push({ a: node(1, 21), b: node(5, 28), flags: FLAG_WALK | BIKE_FWD | BIKE_BWD | PATH, speed: 0, importance: 6, name: 3 });

  return out;
};

const roads = (): Network => {
  const nodeCount = ROWS * COLS;
  const nodeXY = new Float32Array(nodeCount * 2);
  for (let n = 0; n < nodeCount; n += 1) {
    nodeXY[n * 2] = (n % COLS) * STEP;
    nodeXY[n * 2 + 1] = Math.floor(n / COLS) * STEP;
  }

  const list = streets();
  const E = list.length;
  const at = (n: number): [number, number] => [nodeXY[n * 2] ?? 0, nodeXY[n * 2 + 1] ?? 0];
  const coords = new Float32Array(E * 4);
  const edgeLength = new Float32Array(E);
  const edgeClimb = new Float32Array(E);
  const edgeDescent = new Float32Array(E);
  list.forEach((s, e) => {
    const [[xa, ya], [xb, yb]] = [at(s.a), at(s.b)];
    coords.set([xa, ya, xb, yb], e * 4);
    edgeLength[e] = Math.hypot(xb - xa, yb - ya);
    const dz = height(xb, yb) - height(xa, ya);
    edgeClimb[e] = Math.max(0, dz);
    edgeDescent[e] = Math.max(0, -dz);
  });

  return {
    origin: [0, 0],
    bbox: [0, 0, 0, 0],
    nodeCount,
    nodeXY,
    edgeCount: E,
    edgeA: Uint32Array.from(list, (s) => s.a),
    edgeB: Uint32Array.from(list, (s) => s.b),
    edgeLength,
    edgeClimb,
    edgeDescent,
    edgeKind: new Uint8Array(E),
    edgeFlags: Uint8Array.from(list, (s) => s.flags),
    edgeCarSpeed: Uint8Array.from(list, (s) => s.speed),
    edgeImportance: Uint8Array.from(list, (s) => s.importance),
    edgeHourRow: new Int32Array(E).fill(-1),
    hourCosts: new Float32Array(0),
    edgeName: Uint32Array.from(list, (s) => s.name),
    coordStart: Uint32Array.from({ length: E + 1 }, (_, e) => e * 2),
    coords,
    names: NAMES,
    lines: [],
    stopNames: new Map(),
    railStations: new Uint32Array(0),
    firstStation: nodeCount,
    stopStation: new Map(),
  };
};

/** A transit line of the town: its stations, departures per hour, minutes between two stations */
interface TownLine {
  name: string;
  color: number;
  /** GTFS route type: 1 metro, 3 bus */
  type: number;
  stations: [number, number][];
  departures: number[];
  rideSeconds: number;
}

/** Departures per hour of the day: none at night, more at the peaks */
const service = (night: number, day: number, peak: number): number[] =>
  Array.from({ length: HOURS }, (_, h) => (h < 5 ? night : (h >= 7 && h <= 9) || (h >= 16 && h <= 19) ? peak : h >= 21 ? Math.round(day / 2) : day));

export const LINES: TownLine[] = [
  {
    name: 'M',
    color: 0x1a7fd4,
    type: 1,
    stations: [200, 800, 1400, 2000, 2600].map((x) => [x, 800]),
    departures: service(0, 10, 20),
    rideSeconds: 70,
  },
  {
    name: '21',
    color: 0xd7301f,
    type: 3,
    stations: [100, 500, 900, 1300, 1700, 2000].map((y) => [400, y]),
    departures: service(0, 4, 6),
    rideSeconds: 80,
  },
];

/** Station names: the line, then its stop number */
const stationName = (line: TownLine, i: number): string => `${line.name} · ${i + 1}`;

/** The wait of each hour as crates/prep stores it: half the interval, capped at 12 min, plus 60 s boarding */
const waits = (departures: number[]): number[] => departures.map((n) => (n === 0 ? 0xffff : Math.round(Math.min(3600 / n / 2, 720) + 60)));

/** The lines as a TRN3 file (crates/prep/src/transit.rs), both directions of each */
const transitFile = (): ArrayBuffer => {
  const strings: string[] = [];
  const string = (s: string): number => {
    strings.push(s);
    return strings.length - 1;
  };
  const stations: [number, number, number][] = [];
  const lines: [number, number, number, number][] = [];
  const lineStops: [number, number, number[]][] = [];
  const rides: [number, number, number[], number[]][] = [];

  LINES.forEach((line, l) => {
    lines.push([string(line.name), line.color, 0xffffff, line.type]);
    const first = stations.length;
    line.stations.forEach(([x, y], i) => stations.push([x, y, string(stationName(line, i))]));
    for (const order of [line.stations.map((_, i) => i), line.stations.map((_, i) => line.stations.length - 1 - i)]) {
      const stops = order.map((i) => {
        lineStops.push([l, first + i, waits(line.departures)]);
        return { lineStop: lineStops.length - 1, at: line.stations[i] ?? [0, 0] };
      });
      stops.slice(1).forEach((to, k) => {
        const from = stops[k] ?? to;
        const durations = line.departures.map((n) => (n === 0 ? 0xffff : line.rideSeconds));
        rides.push([from.lineStop, to.lineStop, durations, [...from.at, ...to.at]]);
      });
    }
  });

  const ROW = 8 + HOURS * 2;
  const text = new TextEncoder().encode(JSON.stringify(strings));
  const coordCount = rides.length * 2;
  const bytes = 32 + stations.length * 12 + lines.length * 16 + (lineStops.length + rides.length) * ROW + (rides.length + 1) * 4 + coordCount * 8 + text.length;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const cursor = { at: 0 };
  const u32 = (v: number): void => {
    view.setUint32(cursor.at, v, true);
    cursor.at += 4;
  };
  const u16 = (v: number): void => {
    view.setUint16(cursor.at, v, true);
    cursor.at += 2;
  };
  const f32 = (v: number): void => {
    view.setFloat32(cursor.at, v, true);
    cursor.at += 4;
  };

  [0x334e5254, stations.length, lines.length, lineStops.length, rides.length, coordCount, text.length, 0].forEach(u32);
  for (const [x, y, name] of stations) {
    f32(x);
    f32(y);
    u32(name);
  }
  for (const fields of lines) fields.forEach(u32);
  for (const [line, station, hours] of lineStops) {
    u32(line);
    u32(station);
    hours.forEach(u16);
  }
  for (const [from, to, hours] of rides) {
    u32(from);
    u32(to);
    hours.forEach(u16);
  }
  rides.forEach((_, r) => u32(r * 2));
  u32(coordCount);
  for (const [, , , points] of rides) points.forEach(f32);
  new Uint8Array(buffer, cursor.at).set(text);

  return buffer;
};

/** The town, roads and transit, as the engine gets a region */
export const buildTown = (): Network => readTransit(transitFile())(roads());

/** Road edges of the middle bridge, to close it */
export const bridgeEdges = (net: Network): Uint32Array => {
  const [a, b] = [node(RIVER_ROW, MIDDLE_BRIDGE), node(RIVER_ROW + 1, MIDDLE_BRIDGE)];
  const edges: number[] = [];
  for (let e = 0; e < net.edgeCount; e += 1)
    if ((net.edgeA[e] === a && net.edgeB[e] === b) || (net.edgeA[e] === b && net.edgeB[e] === a)) edges.push(e);

  return Uint32Array.from(edges);
};
