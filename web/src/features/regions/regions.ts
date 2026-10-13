import type { LngLat } from '@/shared/config';
import regionsJson from './regions.json';

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

/** The region a point is in (the first whose box holds it), if any */
export const regionAt = (point: LngLat): Region | undefined => REGIONS.find((r) => inBox(point, r.bbox));
