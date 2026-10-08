/** IGN head office, 73 avenue de Paris, Saint-Mandé (GPF geocoding) */
export const IGN_HQ: LngLat = [2.424573, 48.845726];

export type LngLat = [number, number];
export type Mode = 'transit' | 'pedestrian' | 'bike' | 'car';
export type Direction = 'departure' | 'arrival';

/** Longest time the scale offers, per mode, in minutes */
export const MAX_SCALE: Record<Mode, number> = { transit: 60, pedestrian: 60, bike: 45, car: 45 };

/** Places whose travel time the panel lists */
export const LANDMARKS: { name: string; at: LngLat }[] = [
  { name: 'Châtelet', at: [2.347, 48.8584] },
  { name: 'Gare de Lyon', at: [2.3733, 48.8443] },
  { name: 'Gare du Nord', at: [2.3553, 48.8809] },
  { name: 'Montparnasse', at: [2.3211, 48.8412] },
  { name: 'Saint-Lazare', at: [2.3253, 48.8763] },
  { name: 'République', at: [2.3637, 48.8674] },
  { name: 'Nation', at: [2.3959, 48.8482] },
  { name: 'La Défense', at: [2.2386, 48.8919] },
  { name: 'Tour Eiffel', at: [2.2945, 48.8584] },
  { name: 'IGN Saint-Mandé', at: [2.4246, 48.8457] },
];

/** Durations the user can draw as fronts, in minutes */
export const CONTOURS = [10, 15, 20, 30, 45] as const;

/** GPF routing resource, to check a local route against the Géoplateforme */
export const GPF_RESOURCE = 'bdtopo-valhalla';
export const GPF_BASE = 'https://data.geopf.fr';
export const BASEMAP_STYLE = `${GPF_BASE}/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json`;

export const GRAPH_URL = `${import.meta.env.BASE_URL}data/graph.bin`;
export const TRANSIT_URL = `${import.meta.env.BASE_URL}data/transit.bin`;
