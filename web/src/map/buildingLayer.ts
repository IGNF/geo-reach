import type { ExpressionSpecification, Map as MlMap } from 'maplibre-gl';
import type { Result, TravelEngine } from '@/engine/travelEngine';
import { GPF_BASE } from '@/lib/config';
import { RAMP_STOPS } from '@/lib/colors';
import { toMercator } from '@/lib/mercator';

const SOURCE = 'bdtopo';
const SOURCE_LAYER = 'batiment';
const LAYER = 'buildings-3d';

/** The BD TOPO vector tiles carry the buildings from zoom 15, with their height */
export const BUILDINGS_MIN_ZOOM = 15;
const MIN_ZOOM = BUILDINGS_MIN_ZOOM;
/** Buildings with no height in the BD TOPO: a low house */
const DEFAULT_HEIGHT = 6;
/** Not reached within the max time, or not colored yet */
const NEUTRAL = '#d9d5cd';
/** Milliseconds of calm after the last result before the buildings are colored */
const SETTLE_MS = 120;
/** A building takes a new time only when it moves by this many seconds: below, its color does not change */
const STEP_SECONDS = 10;
/** Buildings indexed at most: beyond, the index restarts from the tiles in memory */
const MAX_INDEXED = 60_000;

type BuildingId = string | number;

/** Height-colored on the network ramp, from the travel time (feature state `t`, seconds) over the max time */
const colorByTime = (scale: number): ExpressionSpecification => [
  'case',
  ['all', ['!=', ['feature-state', 't'], null], ['<=', ['feature-state', 't'], scale]],
  ['interpolate', ['linear'], ['/', ['feature-state', 't'], scale], ...RAMP_STOPS.flatMap(([at, css]) => [at, css])],
  NEUTRAL,
];

/**
 * BD TOPO buildings, extruded to their height, colored by the travel time of their nearest street once the cursor
 * stops (a few thousand buildings in view: never at every move).
 *
 * The middle of each building is indexed once, when its tile loads; a coloring then only reads the times at those
 * points, and updates the buildings whose time changed: no geometry query, no clearing, no flicker.
 */
export class BuildingLayer {
  private readonly map: MlMap;
  private readonly engine: TravelEngine;
  private visible = false;
  private timer?: ReturnType<typeof setTimeout>;
  private indexTimer?: ReturnType<typeof setTimeout>;
  /** Middle of each building of the loaded tiles, zone Mercator metres */
  private readonly centers = new Map<BuildingId, [number, number]>();
  /** Time each building is colored with, seconds */
  private readonly shown = new Map<BuildingId, number>();

  constructor(map: MlMap, engine: TravelEngine) {
    this.map = map;
    this.engine = engine;
  }

  /** Source and layer, shown in the building view only: the tiles load only then */
  addLayer(beforeId: string | undefined, scale: number): void {
    this.map.addSource(SOURCE, {
      type: 'vector',
      tiles: [`${GPF_BASE}/tms/1.0.0/BDTOPO/{z}/{x}/{y}.pbf`],
      minzoom: MIN_ZOOM,
      maxzoom: 19,
      // Feature states need an id: the BD TOPO key of the building
      promoteId: { [SOURCE_LAYER]: 'cleabs' },
      attribution: '© IGN BD TOPO',
    });

    this.map.addLayer(
      {
        id: LAYER,
        type: 'fill-extrusion',
        source: SOURCE,
        'source-layer': SOURCE_LAYER,
        minzoom: MIN_ZOOM,
        layout: { visibility: this.visible ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': colorByTime(scale),
          'fill-extrusion-height': ['coalesce', ['get', 'hauteur'], DEFAULT_HEIGHT],
          'fill-extrusion-opacity': 0.85,
        },
      },
      beforeId,
    );
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
    if (!visible) clearTimeout(this.timer);
  }

  /** The max time changed: the ramp follows it */
  setScale(scale: number): void {
    if (this.map.getLayer(LAYER)) this.map.setPaintProperty(LAYER, 'fill-extrusion-color', colorByTime(scale));
  }

  /** A new result is shown: the buildings in view are colored from it once the results stop coming */
  colorFrom(result: () => Result | undefined): void {
    if (!this.visible || this.map.getZoom() < MIN_ZOOM) return;

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const r = result();
      if (r) this.color(r);
    }, SETTLE_MS);
  }

  /** New tiles loaded: their buildings are indexed, once the tiles stop coming */
  indexTiles(): void {
    clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => this.index(), SETTLE_MS);
  }

  private index(): void {
    const [ox, oy] = this.engine.net.origin;
    if (this.centers.size > MAX_INDEXED) this.centers.clear();

    for (const building of this.map.querySourceFeatures(SOURCE, { sourceLayer: SOURCE_LAYER })) {
      const { id, geometry } = building;
      if (id === undefined || this.centers.has(id)) continue;

      const ring =
        geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.type === 'MultiPolygon'
            ? geometry.coordinates[0]?.[0]
            : undefined;
      if (!ring?.length) continue;

      // Middle of the outline
      const [lng, lat] = ring.reduce(([x, y], [px, py]) => [x + px / ring.length, y + py / ring.length], [0, 0]);
      const [mx, my] = toMercator([lng, lat]);
      this.centers.set(id, [mx - ox, my - oy]);
    }
  }

  private color(r: Result): void {
    const { map, engine, shown } = this;
    const [ox, oy] = engine.net.origin;

    // Only the buildings in view (the tiles kept in memory go beyond the screen)
    const bounds = map.getBounds();
    const [minX, minY] = toMercator(bounds.getSouthWest().toArray());
    const [maxX, maxY] = toMercator(bounds.getNorthEast().toArray());
    const inView = (x: number, y: number): boolean =>
      x >= minX - ox && x <= maxX - ox && y >= minY - oy && y <= maxY - oy;

    for (const [id, [x, y]] of this.centers) {
      if (!inView(x, y)) continue;

      const seconds = engine.timeAt(r, x, y)?.seconds;
      const before = shown.get(id);
      const feature = { source: SOURCE, sourceLayer: SOURCE_LAYER, id };

      if (seconds === undefined) {
        // Off the network now: back to neutral
        if (before !== undefined) {
          map.removeFeatureState(feature, 't');
          shown.delete(id);
        }
        continue;
      }

      // Same color as before: nothing to send
      if (before !== undefined && Math.abs(seconds - before) < STEP_SECONDS) continue;

      map.setFeatureState(feature, { t: seconds });
      shown.set(id, seconds);
    }
  }
}
