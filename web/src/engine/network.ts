import { loadData, type Progress } from '../lib/dataCache';

/**
 * The network the engine runs on: the BD TOPO road sections (graph.bin, built by scripts/buildGraph.ts), and the
 * public transport layer when it is loaded (transit.bin, scripts/buildTransit.ts). Positions are Web Mercator metres
 * relative to the zone origin, so that they fit in 32 bit floats.
 */

export const EDGE_ROAD = 0;
/** A ride between two stops of a line */
export const EDGE_RIDE = 1;
/** Boarding (from a stop to a line at that stop): costs the wait */
export const EDGE_BOARD = 2;
/** Alighting (from a line to its stop) */
export const EDGE_ALIGHT = 3;
/** Walk between a stop and the street */
export const EDGE_LINK = 4;

export const FLAG_CAR_FWD = 1;
export const FLAG_CAR_BWD = 2;
export const FLAG_WALK = 4;
export const FLAG_STAIRS = 8;
export const FLAG_BIKE_FWD = 16;
export const FLAG_BIKE_BWD = 32;
/** Cycle lane, cycle track or greenway */
export const FLAG_CYCLEWAY = 64;
/** Unpaved path: slow ride */
export const FLAG_PATH = 128;
/** Transit edges only (flags are read by edge kind): a bus line (the others are metro, RER, train and tram) */
export const FLAG_BUS = 16;

export const HOURS = 24;

export interface Line {
  name: string;
  /** CSS color */
  color: string;
  textColor: string;
  /** GTFS route type: 0 tram, 1 metro, 2 rail, 3 bus… */
  type: number;
}

export interface Network {
  /** Web Mercator metres of the zone centre */
  origin: [number, number];
  bbox: [number, number, number, number];
  nodeCount: number;
  nodeXY: Float32Array;
  edgeCount: number;
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  /** Ground metres for roads and links; seconds of the ride for rides; seconds of the wait for boardings */
  edgeLength: Float32Array;
  edgeKind: Uint8Array;
  edgeFlags: Uint8Array;
  edgeCarSpeed: Uint8Array;
  /** BD TOPO importance of roads, 1 (major) to 6, 0 unknown */
  edgeImportance: Uint8Array;
  /** Row of hourly costs of each transit boarding and ride in `hourCosts`, -1 for the other edges */
  edgeHourRow: Int32Array;
  /** Seconds per hour of the day (24 per row): the wait of a boarding, the duration of a ride */
  hourCosts: Float32Array;
  /** Street name (roads), line (rides, boardings), 0xffffffff for none */
  edgeName: Uint32Array;
  /** Points of edge e: coordStart[e] .. coordStart[e + 1], none for boardings and alightings */
  coordStart: Uint32Array;
  coords: Float32Array;
  names: string[];
  lines: Line[];
  /** Name of the stop of each transit node, by node */
  stopNames: Map<number, string>;
  /** Station nodes served by a metro, RER, train or tram line */
  railStations: Uint32Array;
}

const MAGIC = 0x33465247;

/** Reads graph.bin (scripts/buildGraph.ts): interior points are 16 bit deltas, rebuilt here into full geometries */
export const loadRoadNetwork = async (url: string, onProgress?: Progress): Promise<Network> => {
  const buffer = await loadData(url, onProgress);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('graph.bin: unknown format');
  const nodeCount = view.getUint32(4, true);
  const E = view.getUint32(8, true);
  const pointCount = view.getUint32(12, true);
  const namesBytes = view.getUint32(16, true);
  let offset = 24;
  const f64 = () => {
    const v = view.getFloat64(offset, true);
    offset += 8;

    return v;
  };
  const origin: [number, number] = [f64(), f64()];
  const bbox: [number, number, number, number] = [f64(), f64(), f64(), f64()];
  const take = <T>(Ctor: { new (b: ArrayBuffer, o: number, n: number): T; BYTES_PER_ELEMENT: number }, n: number) => {
    const array = new Ctor(buffer, offset, n);
    offset += n * Ctor.BYTES_PER_ELEMENT;

    return array;
  };
  const align = () => {
    offset = (offset + 3) & ~3;
  };
  const nodeXY = take(Float32Array, nodeCount * 2);
  const edgeA = take(Uint32Array, E);
  const edgeB = take(Uint32Array, E);
  const edgeName = take(Uint32Array, E);
  const pointStart = take(Uint32Array, E + 1);
  const edgeLength = Float32Array.from(take(Uint16Array, E));
  const edgeCarSpeed = take(Uint8Array, E);
  const edgeFlags = take(Uint8Array, E);
  const edgeImportance = take(Uint8Array, E);
  align();
  const points = take(Int16Array, pointCount * 2);
  align();
  const names = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, namesBytes))) as string[];

  // Full geometries: node A, the interior points (deltas from the rounded previous point), node B
  const coordStart = new Uint32Array(E + 1);
  for (let e = 0; e < E; e += 1) coordStart[e + 1] = coordStart[e] + 2 + (pointStart[e + 1] - pointStart[e]);
  const coords = new Float32Array(coordStart[E] * 2);
  for (let e = 0; e < E; e += 1) {
    let o = coordStart[e] * 2;
    const [a, b] = [edgeA[e], edgeB[e]];
    coords[o++] = nodeXY[a * 2];
    coords[o++] = nodeXY[a * 2 + 1];
    let [x, y] = [Math.round(nodeXY[a * 2]), Math.round(nodeXY[a * 2 + 1])];
    for (let p = pointStart[e]; p < pointStart[e + 1]; p += 1) {
      x += points[p * 2];
      y += points[p * 2 + 1];
      coords[o++] = x;
      coords[o++] = y;
    }
    coords[o++] = nodeXY[b * 2];
    coords[o] = nodeXY[b * 2 + 1];
  }

  return {
    origin,
    bbox,
    nodeCount,
    nodeXY,
    edgeCount: E,
    edgeA,
    edgeB,
    edgeLength,
    edgeKind: new Uint8Array(E),
    edgeFlags,
    edgeCarSpeed,
    edgeImportance,
    edgeHourRow: new Int32Array(E).fill(-1),
    hourCosts: new Float32Array(0),
    edgeName,
    coordStart,
    coords,
    names,
    lines: [],
    stopNames: new Map(),
    railStations: new Uint32Array(0),
  };
};
