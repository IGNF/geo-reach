/// <reference lib="webworker" />
/**
 * Traces the isochrone lines off the main thread: on a long run (a car over half the region) the grid and the marching
 * squares take hundreds of milliseconds, which would freeze the map. The page sends the grid once, then the node times
 * of a result; the worker answers with the GeoJSON features (lines and their labels), in longitude and latitude.
 */
import type * as GeoJSON from 'geojson';
import { fromMercator } from '../lib/mercator';
import { type ContourGrid, isochroneLines, joinSegments } from './contours';

export type ContourRequest =
  | { type: 'grid'; grid: ContourGrid; origin: [number, number] }
  | { type: 'lines'; id: number; dist: Float32Array; limits: number[]; walkSpeed: number };

export interface ContourResult {
  id: number;
  features: GeoJSON.Feature[];
}

let grid: ContourGrid | undefined;
let origin: [number, number] = [0, 0];

const toLngLat = ([x, y]: [number, number]) => fromMercator([x + origin[0], y + origin[1]]);

self.onmessage = (event: MessageEvent<ContourRequest>) => {
  const msg = event.data;
  if (msg.type === 'grid') {
    grid = msg.grid;
    origin = msg.origin;

    return;
  }
  if (!grid) return;
  const features: GeoJSON.Feature[] = [];
  isochroneLines(grid, msg.dist, msg.limits, msg.walkSpeed).forEach((segments, i) => {
    const lines = joinSegments(segments);
    const minutes = Math.round(msg.limits[i] / 60);
    features.push({
      type: 'Feature',
      properties: { minutes },
      geometry: { type: 'MultiLineString', coordinates: lines.map((l) => l.map(toLngLat)) },
    });
    // One label per isochrone, as in the reference dataviz: at the top of its longest line
    const longest = lines.reduce<[number, number][]>((a, l) => (l.length > a.length ? l : a), []);
    const top = longest.reduce<[number, number] | undefined>((a, p) => (!a || p[1] > a[1] ? p : a), undefined);
    if (top) features.push({ type: 'Feature', properties: { minutes }, geometry: { type: 'Point', coordinates: toLngLat(top) } });
  });
  const result: ContourResult = { id: msg.id, features };
  self.postMessage(result);
};
