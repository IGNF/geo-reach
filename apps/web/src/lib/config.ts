/** IGN head office, 73 avenue de Paris, Saint-Mandé (GPF geocoding) */
export const IGN_HQ: LngLat = [2.424573, 48.845726];

export type LngLat = [number, number];
export type Mode = 'transit' | 'pedestrian' | 'car';
export type Direction = 'departure' | 'arrival';

/** Longest time the scale offers, per mode, in minutes */
export const MAX_SCALE: Record<Mode, number> = { transit: 60, pedestrian: 60, car: 30 };

/** Durations the user can draw as fronts, in minutes */
export const CONTOURS = [10, 15, 20, 30, 45] as const;

/** GPF routing resource, to check a local route against the Géoplateforme */
export const GPF_RESOURCE = 'bdtopo-valhalla';
export const GPF_BASE = 'https://data.geopf.fr';
export const BASEMAP_STYLE = `${GPF_BASE}/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json`;

export const GRAPH_URL = `${import.meta.env.BASE_URL}data/graph.bin`;
export const TRANSIT_URL = `${import.meta.env.BASE_URL}data/transit.bin`;
