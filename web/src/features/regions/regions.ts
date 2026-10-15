import type { LngLat } from '@/shared/config';
import regionsJson from './regions.json';
import shapesJson from './shapes.json';

/** Box `[minLng, minLat, maxLng, maxLat]`, degrees */
export type LngLatBox = [number, number, number, number];

export interface Region {
  id: string;
  name: string;
  /** The region itself; its network file reaches a margin beyond it (crates/prep) */
  bbox: LngLatBox;
  /** Where the map opens in it */
  start: LngLat;
  /** It has a public transport layer (crates/prep lists its feeds) */
  transit: boolean;
}

/**
 * The 13 regions of metropolitan France, each with its network files: web/public/data/regions/<id>.bin.gz (roads) and
 * <id>.transit.bin.gz (public transport), both built by the Rust tool crates/prep. The list itself is regions.json,
 * read by that tool too: one source for the app and the data.
 */
export const REGIONS: readonly Region[] = regionsJson.map(({ id, name, bbox, start, transit }) => {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const [lng, lat] = start;

  return { id, name, bbox: [minLng, minLat, maxLng, maxLat], start: [lng, lat], transit };
});

export const DEFAULT_REGION = 'ile-de-france';

/** Served with the app (the build scripts import this file too, without Vite: no base URL there) */
const DATA = `${import.meta.env?.BASE_URL ?? '/'}data/`;

/** Road network of a region, gzipped (inflated by lib/dataCache.ts) */
export const graphUrl = (region: Region): string => `${DATA}regions/${region.id}.bin.gz`;

/** Public transport layer of a region, when it has one */
export const transitUrl = (region: Region): string | undefined =>
  region.transit ? `${DATA}regions/${region.id}.transit.bin.gz` : undefined;

export const regionById = (id: string | undefined): Region =>
  REGIONS.find((r) => r.id === id) ?? REGIONS.find((r) => r.id === DEFAULT_REGION) ?? REGIONS[0];

const inBox = ([lng, lat]: LngLat, [minLng, minLat, maxLng, maxLat]: LngLatBox): boolean =>
  lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;

/** The point is in the region's box (its network reaches a little further, its margin) */
export const regionHolds = (region: Region, point: LngLat): boolean => inBox(point, region.bbox);

/** A ring of flat `lng, lat, lng, lat…` holds the point (even-odd rule) */
const ringHolds = (ring: number[], [lng, lat]: LngLat): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }

  return inside;
};

/** Outlines of the regions (ADMIN EXPRESS, simplified to about 1 km by scripts/regionShapes.ts): polygons of rings */
const SHAPES: Record<string, number[][][]> = shapesJson;

const outlineHolds = (region: Region, point: LngLat): boolean =>
  (SHAPES[region.id] ?? []).some(([outer, ...holes]) => ringHolds(outer, point) && !holes.some((h) => ringHolds(h, point)));

/**
 * The region a point is in, if any. The boxes of neighbouring regions overlap (Serre Chevalier, in the Hautes-Alpes,
 * is in the boxes of both Auvergne-Rhône-Alpes and Provence-Alpes-Côte d'Azur): the region whose outline holds the
 * point, else (at sea, just off the coast) the first box holding it.
 */
export const regionAt = (point: LngLat): Region | undefined => {
  const boxes = REGIONS.filter((r) => inBox(point, r.bbox));

  return boxes.find((r) => outlineHolds(r, point)) ?? boxes[0];
};
