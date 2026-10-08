/**
 * Builds the routing graph of the demo zone from the BD TOPO road sections of the Géoplateforme (WFS), once, into a
 * compact binary file served with the app (apps/web/public/data/graph.bin). Run: `bun scripts/buildGraph.ts`.
 *
 * Layout (little endian, every section 4-byte aligned), read by apps/web/src/engine/graph.ts:
 *   u32 magic 'GRF1', u32 nodeCount, u32 edgeCount, u32 coordCount, u32 namesBytes, u32 pad
 *   f64 originX, originY (Web Mercator metres of the zone centre), f64 minLng, minLat, maxLng, maxLat
 *   f32 nodes[nodeCount * 2]          node positions, Mercator metres relative to the origin
 *   u32 edgeA[E], edgeB[E]            end nodes (geometry runs from A to B)
 *   f32 edgeLength[E]                 ground metres
 *   u32 edgeCoordStart[E + 1]         first point of each edge in `coords`
 *   f32 coords[coordCount * 2]        geometry points, relative Mercator metres
 *   u32 edgeName[E]                   index in `names`, 0xffffffff without a name
 *   u8  edgeCarSpeed[E]               km/h, 0 where cars cannot go
 *   u8  edgeFlags[E]                  1 car A→B, 2 car B→A, 4 pedestrian, 8 stairs (slow walk)
 *   utf8 names                        JSON array of street names
 */

const BBOX = { minLng: 2.34, minLat: 48.8, maxLng: 2.51, maxLat: 48.89 };
const PAGE = 5000;
const OUT = new URL('../apps/web/public/data/graph.bin', import.meta.url);
const R = 6378137;
const D2R = Math.PI / 180;

interface Section {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: number[][] } | null;
  properties: {
    nature: string;
    sens_de_circulation: string | null;
    acces_vehicule_leger: string | null;
    acces_pieton: string | null;
    vitesse_moyenne_vl: number | null;
    nom_voie_ban_droite: string | null;
    nom_collaboratif_droite: string | null;
  };
}

const fetchPage = async (start: number) => {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'BDTOPO_V3:troncon_de_route',
    BBOX: `${BBOX.minLat},${BBOX.minLng},${BBOX.maxLat},${BBOX.maxLng},urn:ogc:def:crs:EPSG::4326`,
    OUTPUTFORMAT: 'application/json',
    COUNT: String(PAGE),
    STARTINDEX: String(start),
    SORTBY: 'cleabs',
    PROPERTYNAME:
      'nature,sens_de_circulation,acces_vehicule_leger,acces_pieton,vitesse_moyenne_vl,nom_voie_ban_droite,nom_collaboratif_droite,geometrie',
  });
  const res = await fetch(`https://data.geopf.fr/wfs/ows?${params}`);
  if (!res.ok) throw new Error(`WFS page ${start}: HTTP ${res.status}`);

  return ((await res.json()) as { features: Section[] }).features;
};

const sections: Section[] = [];
for (let start = 0; ; start += PAGE) {
  const page = await fetchPage(start);
  sections.push(...page);
  console.log(`WFS: ${sections.length} sections`);
  if (page.length < PAGE) break;
}

const tally = (key: keyof Section['properties']) => {
  const counts = new Map<unknown, number>();
  for (const s of sections) counts.set(s.properties[key], (counts.get(s.properties[key]) ?? 0) + 1);
  console.log(key, [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12));
};
for (const key of ['nature', 'sens_de_circulation', 'acces_vehicule_leger', 'acces_pieton'] as const) tally(key);

const origin = [
  R * ((BBOX.minLng + BBOX.maxLng) / 2) * D2R,
  R * Math.log(Math.tan(Math.PI / 4 + (((BBOX.minLat + BBOX.maxLat) / 2) * D2R) / 2)),
];
const project = (lng: number, lat: number) => [
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

const NO_PEDESTRIAN = new Set(['Type autoroutier', 'Bretelle']);
const CAR_ACCESS = new Set(['Libre', 'A péage']);

const nodeIds = new Map<string, number>();
const nodes: number[] = [];
const nodeOf = ([lng, lat]: number[]) => {
  const key = `${lng.toFixed(7)},${lat.toFixed(7)}`;
  let id = nodeIds.get(key);
  if (id === undefined) {
    id = nodeIds.size;
    nodeIds.set(key, id);
    nodes.push(...project(lng, lat));
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

const edgeA: number[] = [];
const edgeB: number[] = [];
const edgeLength: number[] = [];
const edgeCoordStart: number[] = [];
const coords: number[] = [];
const edgeName: number[] = [];
const edgeCarSpeed: number[] = [];
const edgeFlags: number[] = [];

for (const s of sections) {
  const line = s.geometry?.coordinates;
  if (!line || line.length < 2) continue;
  const p = s.properties;
  const pedestrian = !NO_PEDESTRIAN.has(p.nature) && p.acces_pieton !== 'Interdit';
  const speed = Math.min(255, Math.round(p.vitesse_moyenne_vl ?? 0));
  const car = CAR_ACCESS.has(p.acces_vehicule_leger ?? '') && speed > 0;
  const forward = car && p.sens_de_circulation !== 'Sens inverse';
  const backward = car && p.sens_de_circulation !== 'Sens direct';
  const flags = (forward ? 1 : 0) | (backward ? 2 : 0) | (pedestrian ? 4 : 0) | (p.nature === 'Escalier' ? 8 : 0);
  if (!(flags & 7)) continue;
  edgeA.push(nodeOf(line[0]));
  edgeB.push(nodeOf(line[line.length - 1]));
  edgeLength.push(groundLength(line));
  edgeCoordStart.push(coords.length / 2);
  for (const [lng, lat] of line) coords.push(...project(lng, lat));
  edgeName.push(nameOf(p.nom_voie_ban_droite || p.nom_collaboratif_droite));
  edgeCarSpeed.push(car ? speed : 0);
  edgeFlags.push(flags);
}
edgeCoordStart.push(coords.length / 2);

const E = edgeA.length;
const namesBytes = new TextEncoder().encode(JSON.stringify(names));
const align4 = (n: number) => (n + 3) & ~3;
const size =
  24 + 48 + nodes.length * 4 + E * 4 * 3 + (E + 1) * 4 + coords.length * 4 + E * 4 + align4(E * 2) + namesBytes.length;
const buffer = new ArrayBuffer(size);
const view = new DataView(buffer);
let offset = 0;
const u32 = (v: number) => {
  view.setUint32(offset, v, true);
  offset += 4;
};
const f64 = (v: number) => {
  view.setFloat64(offset, v, true);
  offset += 8;
};
const f32s = (values: number[]) => {
  new Float32Array(buffer, offset, values.length).set(values);
  offset += values.length * 4;
};
const u32s = (values: number[]) => {
  new Uint32Array(buffer, offset, values.length).set(values);
  offset += values.length * 4;
};
const u8s = (values: number[]) => {
  new Uint8Array(buffer, offset, values.length).set(values);
  offset += values.length;
};

u32(0x31465247);
u32(nodes.length / 2);
u32(E);
u32(coords.length / 2);
u32(namesBytes.length);
u32(0);
f64(origin[0]);
f64(origin[1]);
f64(BBOX.minLng);
f64(BBOX.minLat);
f64(BBOX.maxLng);
f64(BBOX.maxLat);
f32s(nodes);
u32s(edgeA);
u32s(edgeB);
f32s(edgeLength);
u32s(edgeCoordStart);
f32s(coords);
u32s(edgeName);
u8s(edgeCarSpeed);
u8s(edgeFlags);
offset = align4(offset);
new Uint8Array(buffer, offset, namesBytes.length).set(namesBytes);

await Bun.write(OUT, buffer);
console.log(
  `graph.bin: ${nodes.length / 2} nodes, ${E} edges, ${coords.length / 2} points, ${names.length} names, ${(size / 1e6).toFixed(1)} MB`,
);
