import type { LngLat } from '@/shared/config';

/** Box `[minLng, minLat, maxLng, maxLat]`, degrees */
export type LngLatBox = [number, number, number, number];

export interface Region {
  id: string;
  name: string;
  /** The region itself; its network file reaches a margin beyond it (scripts/buildGraph.ts) */
  bbox: LngLatBox;
  /** Where the map opens in it */
  start: LngLat;
  /** It has a public transport layer (scripts/transitFeeds.ts lists its feeds) */
  transit: boolean;
}

/**
 * The 13 regions of metropolitan France, each with its network files: web/public/data/regions/<id>.bin.gz (roads,
 * scripts/buildGraph.ts) and <id>.transit.bin.gz (public transport, scripts/buildTransit.ts).
 */
export const REGIONS: readonly Region[] = [
  { id: 'ile-de-france', name: 'Île-de-France', bbox: [1.44, 48.12, 3.56, 49.24], start: [2.424573, 48.845726], transit: true },
  { id: 'hauts-de-france', name: 'Hauts-de-France', bbox: [1.38, 48.83, 4.26, 51.09], start: [3.0573, 50.6292], transit: true },
  { id: 'normandie', name: 'Normandie', bbox: [-1.95, 48.18, 1.8, 50.07], start: [1.0993, 49.4431], transit: true },
  { id: 'grand-est', name: 'Grand Est', bbox: [3.38, 47.42, 8.23, 50.17], start: [7.7521, 48.5734], transit: true },
  { id: 'bretagne', name: 'Bretagne', bbox: [-5.14, 47.28, -1.01, 48.9], start: [-1.6778, 48.1173], transit: true },
  { id: 'pays-de-la-loire', name: 'Pays de la Loire', bbox: [-2.56, 46.27, 0.92, 48.57], start: [-1.5536, 47.2184], transit: true },
  { id: 'centre-val-de-loire', name: 'Centre-Val de Loire', bbox: [0.05, 46.35, 3.13, 48.94], start: [1.9093, 47.9029], transit: true },
  { id: 'bourgogne-franche-comte', name: 'Bourgogne-Franche-Comté', bbox: [2.85, 46.15, 7.14, 48.4], start: [5.0415, 47.322], transit: true },
  { id: 'nouvelle-aquitaine', name: 'Nouvelle-Aquitaine', bbox: [-1.79, 42.78, 2.61, 47.18], start: [-0.5792, 44.8378], transit: true },
  { id: 'auvergne-rhone-alpes', name: 'Auvergne-Rhône-Alpes', bbox: [2.06, 44.12, 7.19, 46.81], start: [4.8357, 45.764], transit: true },
  { id: 'occitanie', name: 'Occitanie', bbox: [-0.33, 42.33, 4.85, 45.05], start: [1.4442, 43.6047], transit: true },
  { id: 'provence-alpes-cote-dazur', name: 'Provence-Alpes-Côte d’Azur', bbox: [4.23, 42.98, 7.72, 45.13], start: [5.3698, 43.2965], transit: true },
  { id: 'corse', name: 'Corse', bbox: [8.53, 41.33, 9.56, 43.03], start: [8.7369, 41.9192], transit: true },
];

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
