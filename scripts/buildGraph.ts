/**
 * Builds the routing graph of Île-de-France from the BD TOPO road sections of the Géoplateforme (WFS), once, into a
 * compact binary file served with the app (web/public/data/graph.bin). Run: `bun scripts/buildGraph.ts`.
 *
 * The region is downloaded tile by tile (short WFS requests: deep paging over a million objects is slow), cached
 * gzipped in .cache/bdtopo/ (delete it to download again); sections crossing tiles are kept once. To stay light at
 * the scale of the region:
 * - density: every section in Paris and the inner suburbs; beyond, no footpaths, stairs, tracks nor service roads;
 * - merging: consecutive sections with the same attributes become one edge (BD TOPO cuts a street at every change);
 * - simplification: geometries simplified to 3 m (Douglas-Peucker);
 * - encoding: interior points as 16 bit deltas in metres, lengths as 16 bit metres.
 *
 * Layout (little endian, every section 4-byte aligned), read by web/src/engine/network.ts:
 *   u32 magic 'GRF3', u32 nodeCount, u32 edgeCount, u32 pointCount, u32 namesBytes, u32 pad
 *   f64 originX, originY (Web Mercator metres of the zone centre), f64 minLng, minLat, maxLng, maxLat
 *   f32 nodes[nodeCount * 2]          node positions, Mercator metres relative to the origin
 *   u32 edgeA[E], edgeB[E]            end nodes (geometry runs from A to B)
 *   u32 edgeName[E]                   index in `names`, 0xffffffff without a name
 *   u32 edgePointStart[E + 1]         first interior point of each edge in `points`
 *   u16 edgeLength[E]                 ground metres
 *   u8  edgeCarSpeed[E]               km/h, 0 where cars cannot go
 *   u8  edgeFlags[E]                  1 car A→B, 2 car B→A, 4 pedestrian, 8 stairs (slow walk),
 *                                     16 bike A→B, 32 bike B→A, 64 cycle lane or greenway, 128 path (slow ride)
 *   u8  edgeImportance[E]             BD TOPO importance, 1 (major) to 6, 0 unknown
 *   i16 points[pointCount * 2]        interior points: Mercator metres from the previous point (node A first)
 *   utf8 names                        JSON array of street names
 */
import { existsSync, mkdirSync } from 'node:fs';

/** Île-de-France */
const BBOX = { minLng: 1.44, minLat: 48.12, maxLng: 3.56, maxLat: 49.24 };
/** Paris and the inner suburbs: the full network */
const INNER = { minLng: 2.15, minLat: 48.72, maxLng: 2.6, maxLat: 48.96 };
const PAGE = 5000;
const CONCURRENCY = 6;
/** Tile size, degrees */
const TILE = { lng: 0.1, lat: 0.08 };
const SIMPLIFY_METRES = 3;
const CACHE = new URL('../.cache/bdtopo/', import.meta.url);
const OUT = new URL('../web/public/data/graph.bin', import.meta.url);
const R = 6378137;
const D2R = Math.PI / 180;

interface Section {
  id?: string;
  geometry: { coordinates: number[][] } | null;
  properties: {
    nature: string;
    sens_de_circulation: string | null;
    acces_vehicule_leger: string | null;
    acces_pieton: string | null;
    vitesse_moyenne_vl: number | null;
    nom_voie_ban_droite: string | null;
    nom_collaboratif_droite: string | null;
    importance: string | null;
    amenagement_cyclable_gauche: string | null;
    amenagement_cyclable_droit: string | null;
    sens_amenagement_cyclable_gauche: string | null;
    sens_amenagement_cyclable_droit: string | null;
    itineraire_vert: boolean | null;
  };
}

type Box = typeof BBOX;
const wfs = (box: Box, extra: Record<string, string>) =>
  `https://data.geopf.fr/wfs/ows?${new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'BDTOPO_V3:troncon_de_route',
    BBOX: `${box.minLat},${box.minLng},${box.maxLat},${box.maxLng},urn:ogc:def:crs:EPSG::4326`,
    ...extra,
  })}`;

/** One page of one tile, from the cache when there */
const fetchPage = async (tile: string, box: Box, start: number): Promise<Section[]> => {
  const file = new URL(`${tile}-${start}.json.gz`, CACHE);
  if (existsSync(file)) return JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(file).bytes())));
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(
      wfs(box, {
        OUTPUTFORMAT: 'application/json',
        COUNT: String(PAGE),
        STARTINDEX: String(start),
        SORTBY: 'cleabs',
        PROPERTYNAME:
          'nature,sens_de_circulation,acces_vehicule_leger,acces_pieton,vitesse_moyenne_vl,nom_voie_ban_droite,nom_collaboratif_droite,importance,amenagement_cyclable_gauche,amenagement_cyclable_droit,sens_amenagement_cyclable_gauche,sens_amenagement_cyclable_droit,itineraire_vert,geometrie',
      }),
    ).catch(() => undefined);
    if (res?.ok) {
      const features = ((await res.json()) as { features: Section[] }).features.map((f) => ({
        id: f.id,
        geometry: f.geometry && { coordinates: f.geometry.coordinates.map(([lng, lat]) => [lng, lat]) },
        properties: f.properties,
      }));
      await Bun.write(file, Bun.gzipSync(new TextEncoder().encode(JSON.stringify(features))));

      return features;
    }
    if (attempt >= 6) throw new Error(`WFS page ${start}: HTTP ${res?.status ?? 'network error'}`);
    await Bun.sleep(2000 * attempt);
  }
};

mkdirSync(CACHE, { recursive: true });

const origin = [
  R * ((BBOX.minLng + BBOX.maxLng) / 2) * D2R,
  R * Math.log(Math.tan(Math.PI / 4 + (((BBOX.minLat + BBOX.maxLat) / 2) * D2R) / 2)),
];
const project = (lng: number, lat: number): [number, number] => [
  R * lng * D2R - origin[0],
  R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)) - origin[1],
];
const groundLength = (coords: number[][]) =>
  coords.slice(1).reduce((sum, [lng, lat], i) => {
    const [lng0, lat0] = coords[i];
    const x = (lng - lng0) * D2R * Math.cos(((lat + lat0) / 2) * D2R);
    const y = (lat - lat0) * D2R;

    return sum + Math.hypot(x, y) * R;
  }, 0);
const inside = ([lng, lat]: number[], b: typeof INNER) =>
  lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;

const NO_PEDESTRIAN = new Set(['Type autoroutier', 'Bretelle']);
const NO_BIKE = new Set(['Type autoroutier', 'Bretelle', 'Escalier']);
const PATHS = new Set(['Sentier', 'Chemin', 'Route empierrée']);
const CAR_ACCESS = new Set(['Libre', 'A péage']);
/** Dropped outside the inner zone: of little use at the scale of the region */
const OUTER_DROPPED = new Set(['Sentier', 'Chemin', 'Escalier', 'Route empierrée']);

// Sections as compact records, page after page
const nodeIds = new Map<string, number>();
const nodeXY: number[] = [];
const nodeOf = ([lng, lat]: number[]) => {
  const key = `${lng.toFixed(7)},${lat.toFixed(7)}`;
  let id = nodeIds.get(key);
  if (id === undefined) {
    id = nodeIds.size;
    nodeIds.set(key, id);
    nodeXY.push(...project(lng, lat));
  }

  return id;
};
const names: string[] = [];
const nameIds = new Map<string, number>();
const nameOf = (name: string | null) => {
  if (!name) return 0xffffffff;
  let id = nameIds.get(name);
  if (id === undefined) {
    id = names.length;
    nameIds.set(name, id);
    names.push(name);
  }

  return id;
};

interface Edge {
  a: number;
  b: number;
  /** Relative Mercator metres, A to B */
  pts: number[];
  length: number;
  name: number;
  speed: number;
  flags: number;
  importance: number;
}
const edges: Edge[] = [];
const stats = { kept: 0, dropped: 0 };

const addSection = (s: Section) => {
  const line = s.geometry?.coordinates;
  if (!line || line.length < 2) return;
  const p = s.properties;
  const importance = Number(p.importance) || 0;
  const innerZone = inside(line[0], INNER) || inside(line[line.length - 1], INNER);
  if (!innerZone && (OUTER_DROPPED.has(p.nature) || importance >= 6)) {
    stats.dropped += 1;

    return;
  }
  const pedestrian = !NO_PEDESTRIAN.has(p.nature) && p.acces_pieton !== 'Interdit';
  const speed = Math.min(255, Math.round(p.vitesse_moyenne_vl ?? 0));
  const car = CAR_ACCESS.has(p.acces_vehicule_leger ?? '') && speed > 0;
  const forward = car && p.sens_de_circulation !== 'Sens inverse';
  const backward = car && p.sens_de_circulation !== 'Sens direct';
  // Bikes: no motorway nor stairs; one-way streets apply, unless a cycle lane runs that way (contraflow lanes)
  const bike = !NO_BIKE.has(p.nature) && (pedestrian || car);
  const laneSenses = [p.sens_amenagement_cyclable_gauche, p.sens_amenagement_cyclable_droit];
  const oneWay = car && (p.sens_de_circulation === 'Sens direct' || p.sens_de_circulation === 'Sens inverse');
  const bikeForward = bike && (!oneWay || forward || laneSenses.some((v) => v === 'Sens direct' || v === 'Double sens'));
  const bikeBackward =
    bike && (!oneWay || backward || laneSenses.some((v) => v === 'Sens inverse' || v === 'Double sens'));
  const cycleway = !!(p.amenagement_cyclable_gauche || p.amenagement_cyclable_droit || p.itineraire_vert);
  const flags =
    (forward ? 1 : 0) |
    (backward ? 2 : 0) |
    (pedestrian ? 4 : 0) |
    (p.nature === 'Escalier' ? 8 : 0) |
    (bikeForward ? 16 : 0) |
    (bikeBackward ? 32 : 0) |
    (cycleway ? 64 : 0) |
    (PATHS.has(p.nature) && !cycleway ? 128 : 0);
  if (!(flags & (1 | 2 | 4 | 16 | 32))) return;
  stats.kept += 1;
  edges.push({
    a: nodeOf(line[0]),
    b: nodeOf(line[line.length - 1]),
    pts: line.flatMap(([lng, lat]) => project(lng, lat)),
    length: groundLength(line),
    name: nameOf(p.nom_voie_ban_droite || p.nom_collaboratif_droite),
    speed: car ? speed : 0,
    flags,
    importance,
  });
};

const tiles: { id: string; box: Box }[] = [];
for (let lng = BBOX.minLng; lng < BBOX.maxLng; lng += TILE.lng)
  for (let lat = BBOX.minLat; lat < BBOX.maxLat; lat += TILE.lat)
    tiles.push({
      id: `${lng.toFixed(2)}_${lat.toFixed(2)}`,
      box: { minLng: lng, minLat: lat, maxLng: Math.min(lng + TILE.lng, BBOX.maxLng), maxLat: Math.min(lat + TILE.lat, BBOX.maxLat) },
    });
/** A section crossing tiles comes in each: kept once */
const seen = new Set<string>();
let done = 0;
const pageWorker = async () => {
  for (let tile = tiles.shift(); tile; tile = tiles.shift()) {
    for (let start = 0; ; start += PAGE) {
      const page = await fetchPage(tile.id, tile.box, start);
      for (const s of page) {
        if (s.id && seen.has(s.id)) continue;
        if (s.id) seen.add(s.id);
        addSection(s);
      }
      if (page.length < PAGE) break;
    }
    done += 1;
    if (done % 25 === 0) console.log(`  ${done} tiles, ${stats.kept} sections kept, ${stats.dropped} dropped`);
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, pageWorker));
console.log(`Sections: ${stats.kept} kept, ${stats.dropped} dropped (outside the inner zone)`);

// Merging: a node shared by exactly two edges with the same attributes disappears
/** Flags as seen when the edge is walked from B to A */
const reversedFlags = (f: number) =>
  (f & ~(1 | 2 | 16 | 32)) | (f & 1 ? 2 : 0) | (f & 2 ? 1 : 0) | (f & 16 ? 32 : 0) | (f & 32 ? 16 : 0);
const incident: number[][] = Array.from({ length: nodeIds.size }, () => []);
edges.forEach((e, i) => {
  incident[e.a].push(i);
  if (e.b !== e.a) incident[e.b].push(i);
});

/** An edge walked from one of its ends */
interface Link {
  i: number;
  from: number;
  to: number;
  flags: number;
  reversed: boolean;
}
const walk = (i: number, from: number): Link => {
  const e = edges[i];
  const reversed = e.a !== from;

  return { i, from, to: reversed ? e.a : e.b, flags: reversed ? reversedFlags(e.flags) : e.flags, reversed };
};
const sameKind = (x: Link, y: Link) => {
  const [a, b] = [edges[x.i], edges[y.i]];

  return x.flags === y.flags && a.speed === b.speed && a.importance === b.importance && a.name === b.name;
};
/** The other edge at a node of degree 2 (not a loop), if any */
const otherEdge = (node: number, i: number) => {
  const list = incident[node];
  if (list.length !== 2) return undefined;
  const j = list[0] === i ? list[1] : list[0];

  return j === i || edges[j].a === edges[j].b ? undefined : j;
};
/** The link that continues `link` through its end node, when that node can go */
const after = (link: Link) => {
  const j = otherEdge(link.to, link.i);
  if (j === undefined) return undefined;
  const next = walk(j, link.to);

  return sameKind(link, next) ? next : undefined;
};
/** The link that leads into `link` through its start node, when that node can go */
const before = (link: Link) => {
  const j = otherEdge(link.from, link.i);
  if (j === undefined) return undefined;
  const e = edges[j];
  const prev = walk(j, e.a === link.from ? e.b : e.a);

  return sameKind(prev, link) ? prev : undefined;
};
const reversePoints = (p: number[]) => {
  const out: number[] = [];
  for (let k = p.length - 2; k >= 0; k -= 2) out.push(p[k], p[k + 1]);

  return out;
};
const used = new Uint8Array(edges.length);
const merged: Edge[] = [];
for (let i = 0; i < edges.length; i += 1) {
  if (used[i] || edges[i].a === edges[i].b) {
    if (!used[i]) {
      used[i] = 1;
      merged.push(edges[i]);
    }
    continue;
  }
  // Back to the start of the chain (a closed ring stops where it began)
  let first = walk(i, edges[i].a);
  for (let prev = before(first); prev && !used[prev.i] && prev.i !== i; prev = before(first)) first = prev;
  const chain = [first];
  used[first.i] = 1;
  for (let next = after(first); next && !used[next.i]; next = after(next)) {
    chain.push(next);
    used[next.i] = 1;
  }
  const pts: number[] = [];
  let length = 0;
  for (const link of chain) {
    const e = edges[link.i];
    const p = link.reversed ? reversePoints(e.pts) : e.pts;
    pts.push(...(pts.length ? p.slice(2) : p));
    length += e.length;
  }
  const head = edges[first.i];
  merged.push({
    a: first.from,
    b: chain[chain.length - 1].to,
    pts,
    length,
    name: head.name,
    speed: head.speed,
    flags: first.flags,
    importance: head.importance,
  });
}
console.log(`Merging: ${edges.length} sections → ${merged.length} edges`);

// Only the nodes still used, renumbered
const keep = new Int32Array(nodeIds.size).fill(-1);
const nodes: number[] = [];
const nodeIndex = (n: number) => {
  if (keep[n] < 0) {
    keep[n] = nodes.length / 2;
    nodes.push(nodeXY[n * 2], nodeXY[n * 2 + 1]);
  }

  return keep[n];
};

/** Douglas-Peucker on a flat list of points, keeps the ends */
const simplify = (p: number[], tolerance: number) => {
  const n = p.length / 2;
  if (n <= 2) return p;
  const keepPoint = new Uint8Array(n);
  keepPoint[0] = 1;
  keepPoint[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    const [x0, y0, x1, y1] = [p[s * 2], p[s * 2 + 1], p[e * 2], p[e * 2 + 1]];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    let [best, bestD] = [-1, tolerance];
    for (let k = s + 1; k < e; k += 1) {
      const d = Math.abs((x1 - x0) * (y0 - p[k * 2 + 1]) - (x0 - p[k * 2]) * (y1 - y0)) / len;
      if (d > bestD) [best, bestD] = [k, d];
    }
    if (best > 0) {
      keepPoint[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }

  return p.filter((_, k) => keepPoint[k >> 1]);
};

const tolerance = SIMPLIFY_METRES / Math.cos(((BBOX.minLat + BBOX.maxLat) / 2) * D2R);
const E = merged.length;
const edgeA = new Uint32Array(E);
const edgeB = new Uint32Array(E);
const edgeName = new Uint32Array(E);
const edgePointStart = new Uint32Array(E + 1);
const edgeLength = new Uint16Array(E);
const edgeCarSpeed = new Uint8Array(E);
const edgeFlags = new Uint8Array(E);
const edgeImportance = new Uint8Array(E);
const points: number[] = [];
merged.forEach((e, i) => {
  edgeA[i] = nodeIndex(e.a);
  edgeB[i] = nodeIndex(e.b);
  edgeName[i] = e.name;
  edgeLength[i] = Math.min(65535, Math.round(e.length));
  edgeCarSpeed[i] = e.speed;
  edgeFlags[i] = e.flags;
  edgeImportance[i] = e.importance;
  edgePointStart[i] = points.length / 2;
  const p = simplify(e.pts, tolerance);
  // Interior points, each from the previous one in whole metres (rounded positions: no drift)
  let [px, py] = [Math.round(p[0]), Math.round(p[1])];
  for (let k = 2; k < p.length - 2; k += 2) {
    const [x, y] = [Math.round(p[k]), Math.round(p[k + 1])];
    points.push(Math.max(-32768, Math.min(32767, x - px)), Math.max(-32768, Math.min(32767, y - py)));
    [px, py] = [x, y];
  }
});
edgePointStart[E] = points.length / 2;

const namesBytes = new TextEncoder().encode(JSON.stringify(names));
const align4 = (n: number) => (n + 3) & ~3;
const size =
  24 + 48 + nodes.length * 4 + E * 12 + (E + 1) * 4 + align4(E * 5) + align4(points.length * 2) + namesBytes.length;
const buffer = new ArrayBuffer(size);
const view = new DataView(buffer);
let offset = 0;
type TypedCtor =
  | Float32ArrayConstructor
  | Uint32ArrayConstructor
  | Uint16ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor;
const put = (array: ArrayLike<number>, Ctor: TypedCtor) => {
  new Ctor(buffer, offset, array.length).set(array);
  offset += array.length * Ctor.BYTES_PER_ELEMENT;
};
for (const v of [0x33465247, nodes.length / 2, E, points.length / 2, namesBytes.length, 0]) {
  view.setUint32(offset, v, true);
  offset += 4;
}
for (const v of [origin[0], origin[1], BBOX.minLng, BBOX.minLat, BBOX.maxLng, BBOX.maxLat]) {
  view.setFloat64(offset, v, true);
  offset += 8;
}
put(nodes, Float32Array);
put(edgeA, Uint32Array);
put(edgeB, Uint32Array);
put(edgeName, Uint32Array);
put(edgePointStart, Uint32Array);
put(edgeLength, Uint16Array);
put(edgeCarSpeed, Uint8Array);
put(edgeFlags, Uint8Array);
put(edgeImportance, Uint8Array);
offset = align4(offset);
put(points, Int16Array);
offset = align4(offset);
new Uint8Array(buffer, offset, namesBytes.length).set(namesBytes);

await Bun.write(OUT, buffer);
console.log(
  `graph.bin: ${nodes.length / 2} nodes, ${E} edges, ${points.length / 2} interior points, ${names.length} names, ${(size / 1e6).toFixed(1)} MB`,
);
