import { loadData, type Progress } from '../lib/dataCache';
import {
  HOURS,
  EDGE_ALIGHT,
  EDGE_BOARD,
  EDGE_LINK,
  EDGE_RIDE,
  EDGE_ROAD,
  FLAG_BUS,
  FLAG_WALK,
  type Line,
  type Network,
} from './network';

/** A station joins the streets through its nearest walkable nodes */
const LINKS_PER_STATION = 3;
const MAX_LINK_METRES = 400;
const GTFS_BUS = 3;
/** No departure in the hour (u16) */
const NO_SERVICE = 0xffff;

const css = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/**
 * Loads transit.bin (crates/gtfs-prep) and returns how to graft it on the road network: stations and line stops
 * become nodes; boarding (the wait), rides, alighting and walking links become edges.
 */
export const loadTransit = async (url: string, onProgress?: Progress) => {
  const buffer = await loadData(url, onProgress);
  const u32 = new Uint32Array(buffer, 0, 8);
  if (u32[0] !== 0x334e5254) throw new Error('transit.bin: unknown format');
  const [, stationCount, lineCount, lineStopCount, rideCount, coordCount, stringsBytes] = u32;
  let offset = 32;
  const words = (n: number) => {
    const view = new DataView(buffer, offset, n * 4);
    offset += n * 4;

    return view;
  };
  const stations = words(stationCount * 3);
  const lines = words(lineCount * 4);
  // Line stop: u32 line, u32 station, u16 hourly waits. Ride: u32 from, u32 to, u16 hourly durations.
  const ROW = 8 + HOURS * 2;
  const rows = (n: number) => {
    const view = new DataView(buffer, offset, n * ROW);
    offset += n * ROW;

    return view;
  };
  const lineStops = rows(lineStopCount);
  const rides = rows(rideCount);
  const rideCoordStart = new Uint32Array(buffer, offset, rideCount + 1);
  offset += (rideCount + 1) * 4;
  const rideCoords = new Float32Array(buffer, offset, coordCount * 2);
  offset += coordCount * 8;
  const strings = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, stringsBytes))) as string[];

  return (roads: Network): Network => {
    const N = roads.nodeCount;
    const stationNode = (s: number) => N + s;
    const lineStopNode = (l: number) => N + stationCount + l;
    const nodeCount = N + stationCount + lineStopCount;
    const nodeXY = new Float32Array(nodeCount * 2);
    nodeXY.set(roads.nodeXY);
    const stopNames = new Map<number, string>();
    for (let s = 0; s < stationCount; s += 1) {
      nodeXY[stationNode(s) * 2] = stations.getFloat32(s * 12, true);
      nodeXY[stationNode(s) * 2 + 1] = stations.getFloat32(s * 12 + 4, true);
      stopNames.set(stationNode(s), strings[stations.getUint32(s * 12 + 8, true)]);
    }
    const lineList: Line[] = [];
    for (let l = 0; l < lineCount; l += 1) {
      const type = lines.getUint32(l * 16 + 12, true);
      lineList.push({
        name: strings[lines.getUint32(l * 16, true)],
        color: css(lines.getUint32(l * 16 + 4, true)),
        textColor: css(lines.getUint32(l * 16 + 8, true)),
        type,
      });
    }
    const lineStopLine = (i: number) => lineStops.getUint32(i * ROW, true);
    const lineStopStation = (i: number) => lineStops.getUint32(i * ROW + 4, true);
    const hourly = (view: DataView, i: number) =>
      Array.from({ length: HOURS }, (_, h) => {
        const v = view.getUint16(i * ROW + 8 + h * 2, true);

        return v === NO_SERVICE ? Number.POSITIVE_INFINITY : v;
      });
    for (let i = 0; i < lineStopCount; i += 1) {
      const s = lineStopStation(i);
      nodeXY[lineStopNode(i) * 2] = nodeXY[stationNode(s) * 2];
      nodeXY[lineStopNode(i) * 2 + 1] = nodeXY[stationNode(s) * 2 + 1];
      stopNames.set(lineStopNode(i), stopNames.get(stationNode(s)) ?? '');
    }

    // Walkable road nodes, bucketed, to link the stations
    const CELL = 100;
    const buckets = new Map<string, number[]>();
    const walkable = new Uint8Array(N);
    for (let e = 0; e < roads.edgeCount; e += 1)
      if (roads.edgeFlags[e] & FLAG_WALK) {
        walkable[roads.edgeA[e]] = 1;
        walkable[roads.edgeB[e]] = 1;
      }
    for (let n = 0; n < N; n += 1) {
      if (!walkable[n]) continue;
      const key = `${Math.floor(roads.nodeXY[n * 2] / CELL)},${Math.floor(roads.nodeXY[n * 2 + 1] / CELL)}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(n);
      buckets.set(key, bucket);
    }
    const nearestNodes = (x: number, y: number) => {
      const [cx, cy] = [Math.floor(x / CELL), Math.floor(y / CELL)];
      const found: [number, number][] = [];
      for (let i = cx - 4; i <= cx + 4; i += 1)
        for (let j = cy - 4; j <= cy + 4; j += 1)
          for (const n of buckets.get(`${i},${j}`) ?? [])
            found.push([n, Math.hypot(roads.nodeXY[n * 2] - x, roads.nodeXY[n * 2 + 1] - y)]);

      return found.sort((a, b) => a[1] - b[1]).slice(0, LINKS_PER_STATION);
    };

    // New edges, after the roads
    const a: number[] = [];
    const b: number[] = [];
    const length: number[] = [];
    const kind: number[] = [];
    const flags: number[] = [];
    const name: number[] = [];
    const geomCounts: number[] = [];
    const geom: number[] = [];
    const hourRow: number[] = [];
    const hourCosts: number[] = [];
    const scale = Math.cos(2 * Math.atan(Math.exp(roads.origin[1] / 6378137)) - Math.PI / 2);
    const push = (
      ea: number,
      eb: number,
      len: number,
      k: number,
      f: number,
      nm: number,
      pts: number[] = [],
      hours?: number[],
    ) => {
      hourRow.push(hours ? hourCosts.length / HOURS : -1);
      if (hours) hourCosts.push(...hours);
      a.push(ea);
      b.push(eb);
      length.push(len);
      kind.push(k);
      flags.push(f);
      name.push(nm);
      geomCounts.push(pts.length / 2);
      geom.push(...pts);
    };
    for (let s = 0; s < stationCount; s += 1) {
      const [x, y] = [nodeXY[stationNode(s) * 2], nodeXY[stationNode(s) * 2 + 1]];
      for (const [n, d] of nearestNodes(x, y)) {
        if (d * scale > MAX_LINK_METRES) continue;
        push(stationNode(s), n, Math.max(20, d * scale), EDGE_LINK, FLAG_WALK, 0xffffffff);
      }
    }
    const rail = new Set<number>();
    for (let i = 0; i < lineStopCount; i += 1) {
      const l = lineStopLine(i);
      if (lineList[l].type !== GTFS_BUS) rail.add(stationNode(lineStopStation(i)));
      const bus = lineList[l].type === GTFS_BUS ? FLAG_BUS : 0;
      const station = stationNode(lineStopStation(i));
      const waits = hourly(lineStops, i);
      push(station, lineStopNode(i), Math.min(...waits), EDGE_BOARD, bus, l, [], waits);
      push(lineStopNode(i), station, 0, EDGE_ALIGHT, bus, l);
    }
    for (let r = 0; r < rideCount; r += 1) {
      const [from, to] = [rides.getUint32(r * ROW, true), rides.getUint32(r * ROW + 4, true)];
      const durations = hourly(rides, r);
      const l = lineStopLine(from);
      const bus = lineList[l].type === GTFS_BUS ? FLAG_BUS : 0;
      const pts = Array.from(rideCoords.subarray(rideCoordStart[r] * 2, rideCoordStart[r + 1] * 2));
      push(lineStopNode(from), lineStopNode(to), durations[8], EDGE_RIDE, bus, l, pts, durations);
    }

    const E0 = roads.edgeCount;
    const E = E0 + a.length;
    const grow = <T extends Uint8Array | Uint32Array | Int32Array | Float32Array>(src: T, extra: number[], Ctor: new (n: number) => T) => {
      const out = new Ctor(E);
      out.set(src);
      out.set(extra, E0);

      return out;
    };
    const coordStart = new Uint32Array(E + 1);
    coordStart.set(roads.coordStart);
    const roadPoints = roads.coords.length / 2;
    for (let i = 0; i < a.length; i += 1) coordStart[E0 + i + 1] = coordStart[E0 + i] + geomCounts[i];
    const coords = new Float32Array(roads.coords.length + geom.length);
    coords.set(roads.coords);
    coords.set(geom, roadPoints * 2);
    const edgeKind = new Uint8Array(E);
    edgeKind.fill(EDGE_ROAD, 0, E0);
    edgeKind.set(kind, E0);

    return {
      ...roads,
      nodeCount,
      nodeXY,
      edgeCount: E,
      edgeA: grow(roads.edgeA, a, Uint32Array),
      edgeB: grow(roads.edgeB, b, Uint32Array),
      edgeLength: grow(roads.edgeLength, length, Float32Array),
      edgeKind,
      edgeFlags: grow(roads.edgeFlags, flags, Uint8Array),
      edgeCarSpeed: grow(roads.edgeCarSpeed, [], Uint8Array),
      edgeImportance: grow(roads.edgeImportance, [], Uint8Array),
      edgeHourRow: grow(roads.edgeHourRow, hourRow, Int32Array),
      hourCosts: Float32Array.from(hourCosts),
      edgeName: grow(roads.edgeName, name, Uint32Array),
      coordStart,
      coords,
      lines: lineList,
      stopNames,
      railStations: Uint32Array.from(rail).sort(),
    };
  };
};
