import { BinaryReader } from '@/shared/binaryReader';

/**
 * The network the engine runs on: the BD TOPO road sections of a region (GRF4 file, crates/prep), and its
 * public transport layer when it has one (TRN3 file, crates/prep). Positions are Web Mercator metres
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
  /** Metres climbed and descended from A to B (roads; 0 for the other edges) */
  edgeClimb: Float32Array;
  edgeDescent: Float32Array;
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
  /** First station node: stations are numbered from it in the transit file's order (the road node count) */
  firstStation: number;
  /** Station node of each line stop node */
  stopStation: Map<number, number>;
}

const MAGIC = 0x34465247;

/**
 * Full geometries of the edges: node A, the interior points, node B. Interior points are stored as 16-bit deltas from
 * the rounded previous point, so they are summed up along the edge.
 */
const rebuildGeometries = (
  nodeXY: Float32Array,
  edgeA: Uint32Array,
  edgeB: Uint32Array,
  pointStart: Uint32Array,
  deltas: Int16Array,
): { coordStart: Uint32Array; coords: Float32Array } => {
  const E = edgeA.length;

  const coordStart = new Uint32Array(E + 1);
  for (let e = 0; e < E; e += 1) coordStart[e + 1] = coordStart[e] + 2 + (pointStart[e + 1] - pointStart[e]);

  const coords = new Float32Array(coordStart[E] * 2);
  for (let e = 0; e < E; e += 1) {
    const [a, b] = [edgeA[e], edgeB[e]];
    // Running position and write index along the edge (hot loop over 700 k edges)
    let o = coordStart[e] * 2;
    let [x, y] = [Math.round(nodeXY[a * 2]), Math.round(nodeXY[a * 2 + 1])];

    coords[o++] = nodeXY[a * 2];
    coords[o++] = nodeXY[a * 2 + 1];
    for (let p = pointStart[e]; p < pointStart[e + 1]; p += 1) {
      x += deltas[p * 2];
      y += deltas[p * 2 + 1];
      coords[o++] = x;
      coords[o++] = y;
    }
    coords[o++] = nodeXY[b * 2];
    coords[o] = nodeXY[b * 2 + 1];
  }

  return { coordStart, coords };
};

/** Decodes a road network file, GRF4 (crates/prep) */
export const readRoadNetwork = (buffer: ArrayBuffer): Network => {
  const header = new Uint32Array(buffer, 0, 5);
  const [magic, nodeCount, E, pointCount, namesBytes] = header;
  if (magic !== MAGIC) throw new Error('road network file: not GRF4');

  const file = new BinaryReader(buffer, 24);
  const origin: [number, number] = [file.float64(), file.float64()];
  const bbox: [number, number, number, number] = [file.float64(), file.float64(), file.float64(), file.float64()];

  const nodeXY = file.array(Float32Array, nodeCount * 2);
  const edgeA = file.array(Uint32Array, E);
  const edgeB = file.array(Uint32Array, E);
  const edgeName = file.array(Uint32Array, E);
  const pointStart = file.array(Uint32Array, E + 1);
  const edgeLength = Float32Array.from(file.array(Uint16Array, E));
  // Decimetres in the file
  const edgeClimb = Float32Array.from(file.array(Uint16Array, E), (dm) => dm / 10);
  const edgeDescent = Float32Array.from(file.array(Uint16Array, E), (dm) => dm / 10);
  const edgeCarSpeed = file.array(Uint8Array, E);
  const edgeFlags = file.array(Uint8Array, E);
  const edgeImportance = file.array(Uint8Array, E);
  file.align();
  const deltas = file.array(Int16Array, pointCount * 2);
  file.align();
  const names = file.json<string[]>(namesBytes);

  const { coordStart, coords } = rebuildGeometries(nodeXY, edgeA, edgeB, pointStart, deltas);

  return {
    origin,
    bbox,
    nodeCount,
    nodeXY,
    edgeCount: E,
    edgeA,
    edgeB,
    edgeLength,
    edgeClimb,
    edgeDescent,
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
    firstStation: nodeCount,
    stopStation: new Map(),
  };
};
