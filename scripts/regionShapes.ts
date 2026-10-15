/**
 * Outlines of the 13 regions of metropolitan France, for the app to tell which region a point is in (their boxes
 * overlap): ADMIN EXPRESS from the Géoplateforme WFS (12 MB), simplified to about 1 km (each region file reaches 20 km
 * beyond its region), written to web/src/features/regions/shapes.json. Run: `bun scripts/regionShapes.ts` (the IGN
 * proxy is read from `https_proxy`).
 */
import regions from '../web/src/features/regions/regions.json';

const URL_WFS =
  'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ADMINEXPRESS-COG-CARTO.LATEST:region' +
  '&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=30';
/** Douglas-Peucker tolerance, degrees (about 1 km) */
const TOLERANCE = 0.01;
/** Rings smaller than this after simplification (square degrees, about 2 km²) are left out: islets */
const MIN_AREA = 0.0002;

type Ring = [number, number][];
interface Feature {
  properties: { nom_officiel: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] };
}

/** Distance from p to the segment a–b, degrees */
const segmentDistance = ([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]): number => {
  const [dx, dy] = [bx - ax, by - ay];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;

  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
};

const simplify = (ring: Ring): Ring => {
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop() ?? [0, 0];
    let [far, at] = [0, -1];
    for (let k = i + 1; k < j; k += 1) {
      const d = segmentDistance(ring[k], ring[i], ring[j]);
      if (d > far) [far, at] = [d, k];
    }
    if (at < 0 || far <= TOLERANCE) continue;
    keep[at] = 1;
    stack.push([i, at], [at, j]);
  }

  return ring.filter((_, k) => keep[k]);
};

const area = (ring: Ring): number =>
  Math.abs(ring.reduce((s, [x, y], k) => s + x * (ring[(k + 1) % ring.length]?.[1] ?? y) - (ring[(k + 1) % ring.length]?.[0] ?? x) * y, 0)) / 2;

const plain = (name: string): string => name.replace(/[’']/g, "'").toLowerCase();

const res = await fetch(URL_WFS, { proxy: process.env.https_proxy });
if (!res.ok) throw new Error(`WFS: HTTP ${res.status}`);
const { features } = (await res.json()) as { features: Feature[] };

const shapes: Record<string, number[][][]> = {};
for (const region of regions) {
  const feature = features.find((f) => plain(f.properties.nom_officiel) === plain(region.name));
  if (!feature) throw new Error(`no outline for ${region.name}`);
  const polygons = (feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates) as Ring[][];
  // Polygons (outer ring, then holes) of flat [lng, lat, lng, lat…] rings, to the metre
  shapes[region.id] = polygons
    .map((rings) => rings.map(simplify).filter((r) => r.length >= 4 && area(r) >= MIN_AREA))
    .filter((rings) => rings.length > 0)
    .map((rings) => rings.map((r) => r.flatMap(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])));
}

const out = new URL('../web/src/features/regions/shapes.json', import.meta.url);
await Bun.write(out, `${JSON.stringify(shapes)}\n`);
console.log(`shapes.json: ${(Bun.file(out).size / 1024).toFixed(0)} KB`);
