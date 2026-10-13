import type { Camera, LngLat, Perspective } from '@/lib/config';
import { BUILDINGS_MIN_ZOOM } from '@/map/buildingGlLayer';

/** Tilt of the tilt button and of the 3D views, degrees */
export const TILT_PITCH = 45;
/** Tilt and heading of the 3D views */
export const TILT = { pitch: TILT_PITCH, bearing: -17 };
/** Zoom of the building view: where the buildings exist */
export const BUILDINGS_ZOOM = BUILDINGS_MIN_ZOOM + 0.6;

/** The camera of a first opening on a point: tilted and close in 3D, flat and wider in 2D */
export const cameraFor = (center: LngLat, perspective: Perspective): Camera =>
  perspective === 'flat' ? { center, zoom: 13.4, pitch: 0, bearing: 0 } : { center, zoom: BUILDINGS_ZOOM, ...TILT };
