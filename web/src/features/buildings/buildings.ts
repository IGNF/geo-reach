import type { ExtrusionLayer, GeoMap, Layer, NetworkLayer } from 'isard';
import type { TravelEngine } from '@/features/routing';
import { GPF_BASE } from '@/shared/config';
import { RAMP_STOPS } from '@/shared/colors';
import { perf } from '@/shared/perf';
import type { BuildingRequest, BuildingResult } from './building.worker';
import type { TileId } from './buildingMesh';

/** The BD TOPO vector tiles carry the buildings from zoom 15 */
export const BUILDINGS_MIN_ZOOM = 15;
const TILE_ZOOM = 15;
/** Below this map zoom the buildings are not drawn (too small, too many tiles) */
const DRAW_ZOOM = 14.5;
/** Tiles loaded around the centre of the view at most, and kept in memory */
const MAX_TILES_IN_VIEW = 24;
const MAX_TILES_KEPT = 48;
/** Milliseconds between two tile updates while the map moves */
const MOVE_THROTTLE_MS = 250;
/** A building with no street nearby: never reached */
const FAR = 1e9;
/** Not reached within the max time */
const NEUTRAL = 'rgb(217, 214, 204)';

/** Tiles that failed after the worker's retries are asked again after this long */
const RETRY_LATER_MS = 4000;

const tileUrl = ({ z, x, y }: TileId): string => `${GPF_BASE}/tms/1.0.0/BDTOPO/${z}/${x}/${y}.pbf`;

interface Tile {
  key: string;
  id: TileId;
  /** Last time it was in view, to drop the oldest */
  usedAt: number;
  /** Middles of its buildings (zone metres), once loaded */
  centers?: Float32Array;
}

/**
 * BD TOPO buildings, colored like the streets at every move: each building is joined once to the ends of its nearest
 * street (its anchor), and the map colors it from the network layer's node times, on the graphics card. Tiles are
 * downloaded and read by a worker; anchors are computed again when the profile changes.
 */
export class Buildings {
  readonly layer: ExtrusionLayer<{ h: number }>;
  private readonly tiles = new Map<string, Tile>();
  private readonly worker = new Worker(new URL('./building.worker.ts', import.meta.url), { type: 'module' });
  private visible = false;
  private lastUpdate = 0;
  private readonly cleanup: (() => void)[] = [];
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly map: GeoMap;
  private readonly engine: TravelEngine;
  private readonly network: NetworkLayer;

  constructor(map: GeoMap, engine: TravelEngine, network: NetworkLayer, before?: Layer) {
    this.map = map;
    this.engine = engine;
    this.network = network;
    this.layer = map.addExtrusions<{ h: number }>({
      height: (p) => p.h,
      color: NEUTRAL,
      minZoom: DRAW_ZOOM,
      visible: false,
      ...(before ? { before } : {}),
    });
    this.setScale(2700);
    this.worker.onmessage = (event: MessageEvent<BuildingResult>) => this.onTile(event.data);
    this.cleanup.push(
      map.on('move', () => {
        if (performance.now() - this.lastUpdate >= MOVE_THROTTLE_MS) this.updateTiles();
      }),
      map.on('moveend', () => this.updateTiles()),
    );
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.layer.setVisible(visible);
    this.updateTiles();
  }

  /** Longest time shown, seconds: the ramp of the streets over it, neutral beyond */
  setScale(scale: number): void {
    this.layer.linkNetwork(this.network, scale);
    this.layer.setStyle({ ramp: RAMP_STOPS.map(([t, c]) => [t * scale, c]) });
  }

  /** The profile changed (mode, cuts…): every building joins its street again */
  setProfile(): void {
    for (const tile of this.tiles.values()) if (tile.centers) this.layer.setAnchors(this.anchors(tile.centers), tile.key);
  }

  /** Tiles of buildings held */
  get tileCount(): number {
    return this.layer.tileKeys.length;
  }

  destroy(): void {
    clearTimeout(this.retry);
    for (const off of this.cleanup) off();
    this.worker.terminate();
    this.layer.remove();
  }

  /** Loads the tiles around the centre of the view, cancels those gone out of it, drops the oldest */
  private updateTiles(): void {
    this.lastUpdate = performance.now();
    const { zoom } = this.map.getCamera();
    if (!this.visible || zoom < DRAW_ZOOM) return;

    const wanted = this.tilesInView();
    const keys = new Set(wanted.map((t) => this.key(t)));
    const now = performance.now();
    for (const id of wanted) {
      const key = this.key(id);
      const tile = this.tiles.get(key);
      if (tile) {
        tile.usedAt = now;
        continue;
      }
      this.tiles.set(key, { key, id, usedAt: now });
      const request: BuildingRequest = { type: 'tile', key, url: tileUrl(id), tile: id, origin: this.engine.net.origin };
      this.worker.postMessage(request);
    }
    // Downloads no longer in view are cancelled
    for (const tile of this.tiles.values())
      if (!tile.centers && !keys.has(tile.key)) {
        this.worker.postMessage({ type: 'cancel', key: tile.key } satisfies BuildingRequest);
        this.tiles.delete(tile.key);
      }
    // The oldest tiles out of view leave the graphics card
    const loaded = [...this.tiles.values()].filter((t) => t.centers).sort((a, b) => b.usedAt - a.usedAt);
    for (const tile of loaded.slice(MAX_TILES_KEPT)) {
      this.layer.removeTile(tile.key);
      this.tiles.delete(tile.key);
    }
  }

  /** Tiles of the view at the tile zoom, nearest to the centre first */
  private tilesInView(): TileId[] {
    const n = 2 ** TILE_ZOOM;
    const col = (lng: number): number => Math.floor(((lng + 180) / 360) * n);
    const row = (lat: number): number => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    const [west, south, east, north] = this.map.getBounds();
    const [x0, x1] = [col(west), col(east)];
    const [y0, y1] = [row(north), row(south)];
    const [lng, lat] = this.map.getCamera().center;
    const [cx, cy] = [col(lng), row(lat)];
    const tiles: TileId[] = [];
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) tiles.push({ z: TILE_ZOOM, x, y });

    return tiles.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, MAX_TILES_IN_VIEW);
  }

  private key({ z, x, y }: TileId): string {
    return `${z}/${x}/${y}`;
  }

  private onTile(result: BuildingResult): void {
    const tile = this.tiles.get(result.key);
    if (!tile) return;
    if (!result.ok) {
      // Failed after its retries: asked again a little later, even if the map does not move
      this.tiles.delete(result.key);
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.updateTiles(), RETRY_LATER_MS);

      return;
    }
    const { polygons } = result;
    tile.centers = polygons.centers;
    if (!polygons.buildings) return;
    perf.time('buildings', () => {
      const properties = Array.from(polygons.heights, (h) => ({ h }));
      this.layer.setTile(tile.key, { arrays: polygons, properties });
      this.layer.setAnchors(this.anchors(polygons.centers), tile.key);
    });
  }

  /** For each building, the ends of its nearest street and the seconds from each, in the current profile */
  private anchors(centers: Float32Array): Float32Array {
    const t0 = performance.now();
    const n = centers.length / 2;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) {
      const at = this.engine.anchor(centers[i * 2], centers[i * 2 + 1]);
      data.set(at ? [at.a, at.b, at.toA, at.toB] : [0, 0, FAR, FAR], i * 4);
    }
    perf.record('anchors', performance.now() - t0);

    return data;
  }
}
