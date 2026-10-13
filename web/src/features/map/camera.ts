import type { Camera, LngLat, Perspective } from '@/shared/config';
import { BUILDINGS_MIN_ZOOM } from '@/features/buildings';

/** Tilt of the tilt button and of the 3D views, degrees */
export const TILT_PITCH = 45;
/** Tilt and heading of the 3D views */
export const TILT = { pitch: TILT_PITCH, bearing: -17 };
/** Widest view, metres across the map: a city and its suburbs; beyond, the network blurs into a solid patch of color */
export const WIDEST_VIEW_METRES = 55_000;
/** Earth circumference at the equator, metres, spread over 512 px at zoom 0 (MapLibre tiles) */
const EQUATOR_METRES = 40_075_016.7;
const WORLD_PX = 512;

/** The widest zoom that still keeps the map within `WIDEST_VIEW_METRES` across, for its width and latitude */
export const minZoomFor = (widthPx: number, lat: number): number =>
  Math.log2((EQUATOR_METRES * Math.cos((lat * Math.PI) / 180) * widthPx) / (WORLD_PX * WIDEST_VIEW_METRES));
/** Zoom of the building view: where the buildings exist */
export const BUILDINGS_ZOOM = BUILDINGS_MIN_ZOOM + 0.6;

/** The camera of a first opening on a point: tilted and close in 3D, flat and wider in 2D */
export const cameraFor = (center: LngLat, perspective: Perspective): Camera =>
  perspective === 'flat' ? { center, zoom: 13.4, pitch: 0, bearing: 0 } : { center, zoom: BUILDINGS_ZOOM, ...TILT };
