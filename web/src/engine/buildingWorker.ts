/// <reference lib="webworker" />
/**
 * Downloads the BD TOPO tiles and extrudes their buildings off the main thread (tens of milliseconds a tile), then
 * hands the meshes over without copying them.
 */
import { type BuildingMesh, buildingMesh, type TileId, type ZoneOrigin } from '@/engine/buildingMesh';

export type BuildingRequest = { type: 'tile'; key: string; url: string; tile: TileId; zone: ZoneOrigin } | { type: 'cancel'; key: string };

export type BuildingResult = { key: string } & ({ ok: true; mesh: BuildingMesh } | { ok: false });

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

    const mesh = buildingMesh(await res.arrayBuffer(), msg.tile, msg.zone);
    const result: BuildingResult = { key: msg.key, ok: true, mesh };
    self.postMessage(result, [mesh.vertices.buffer, mesh.indices.buffer, mesh.centers.buffer]);
  } catch {
    const result: BuildingResult = { key: msg.key, ok: false };
    self.postMessage(result);
  } finally {
    running.delete(msg.key);
  }
};
