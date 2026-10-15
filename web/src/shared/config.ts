export type LngLat = [number, number];
export type Mode = 'transit' | 'pedestrian' | 'bike' | 'car';
export type Direction = 'departure' | 'arrival';
/** How the map is seen: flat, or tilted with the buildings standing up */
export type Perspective = 'flat' | 'buildings';
export const PERSPECTIVES: readonly Perspective[] = ['flat', 'buildings'];

/** Where the map looks: kept when another region replaces the network */
export interface Camera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

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

/** GPF routing resource, to check a local route against the Géoplateforme */
export const GPF_RESOURCE = 'bdtopo-valhalla';
export const GPF_BASE = 'https://data.geopf.fr';
export const BASEMAP_STYLE = `${GPF_BASE}/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json`;
/** Hillshade of the IGN terrain model (WMTS, grey on transparent), zoom 6 to 17 */
export const HILLSHADE_TILES =
  `${GPF_BASE}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=IGNF_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` +
  '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png';
