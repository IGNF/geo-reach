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

/** Pauses before the retries of a tile: the Géoplateforme sometimes answers a burst of requests with errors (400, 429,
 * 5xx) for tiles that exist */
const RETRY_MS = [400, 1200, 3000];

/** The tile's bytes, retried after transient errors; undefined for a tile that is not there (404, 204) */
const download = async (url: string, signal: AbortSignal): Promise<ArrayBuffer | undefined> => {
  for (let attempt = 0; ; attempt += 1) {
    // A retry skips the HTTP cache: the error answer may be cached
    const res = await fetch(url, { signal, cache: attempt ? 'reload' : 'default' });
    if (res.ok) return res.arrayBuffer();
    if (res.status === 404 || res.status === 204) return undefined;
    const pause = RETRY_MS[attempt];
    if (pause === undefined) throw new Error(`HTTP ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, pause));
    if (signal.aborted) throw new Error('aborted');
  }
};

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
    const bytes = await download(msg.url, controller.signal);
    const polygons = buildingPolygons(bytes ?? new ArrayBuffer(0), msg.tile, msg.origin);
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
