import type { LngLat } from './config';

const R = 6378137;
const D2R = Math.PI / 180;

export type XY = [number, number];

export const toMercator = ([lng, lat]: LngLat): XY => [
  R * lng * D2R,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)),
];

export const fromMercator = ([x, y]: XY): LngLat => [
  x / R / D2R,
  (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D2R,
];

/** Web Mercator stretches distances by 1 / cos(lat): ground metres to projected metres */
export const mercatorScale = ([, lat]: LngLat) => 1 / Math.cos(lat * D2R);
