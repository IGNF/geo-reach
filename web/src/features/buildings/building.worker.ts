/// <reference lib="webworker" />
/**
 * Downloads the BD TOPO tiles and reads their buildings off the main thread, then hands the polygons over without
 * copying them.
 */
import { type BuildingPolygons, buildingPolygons, type TileId } from './buildingMesh';

export type BuildingRequest =
  | { type: 'tile'; key: string; url: string; tile: TileId; origin: [number, number] }
  | { type: 'cancel'; key: string };

export type BuildingResult = { key: string } & ({ ok: true; polygons: BuildingPolygons } | { ok: false });

/** Downloads still running, by tile key: a tile gone out of view is cancelled */
const running = new Map<string, AbortController>();

self.onmessage = async (event: MessageEvent<BuildingRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    running.get(msg.key)?.abort();
    running.delete(msg.key);

    return;
  }

  const controller = new AbortController();
  running.set(msg.key, controller);
  try {
    const res = await fetch(msg.url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const polygons = buildingPolygons(await res.arrayBuffer(), msg.tile, msg.origin);
    const result: BuildingResult = { key: msg.key, ok: true, polygons };
    const { points, ringStart, polygonStart, feature, heights, centers } = polygons;
    self.postMessage(result, [points, ringStart, polygonStart, feature, heights, centers].map((a) => a.buffer));
  } catch {
    const result: BuildingResult = { key: msg.key, ok: false };
    self.postMessage(result);
  } finally {
    running.delete(msg.key);
  }
};
