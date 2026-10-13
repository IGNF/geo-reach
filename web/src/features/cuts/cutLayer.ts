import type * as GeoJSON from 'geojson';
import { type FilterSpecification, type GeoJSONSource, type Map as MlMap, Marker, type PointLike } from 'maplibre-gl';
import { type Cut, cutKey, cutLabel, cutOfEdge, edgesOfCut, parseCut } from './cuts';
import type { Network, TravelEngine } from '@/features/routing';
import type { LngLat } from '@/shared/config';
import { formatStreet } from '@/shared/format';
import { fromMercator, toMercator } from '@/shared/mercator';
import { t } from '@/locales';

/** Zone coordinates: Web Mercator metres relative to the network origin */
type Rel = [number, number];

/** A section under the cursor in cut mode, and whether it is already closed */
export interface HoveredSection {
  cut: Cut;
  closed: boolean;
}

const RED = '#e03131';
const GREEN = '#2f9e44';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Pixels around the cursor where a section is picked */
const PICK_PX = 8;

const LINES: FilterSpecification = ['!=', ['geometry-type'], 'Point'];
const POINTS: FilterSpecification = ['==', ['geometry-type'], 'Point'];

/**
 * The closed sections on the map (red dashes, a cross halfway) and, in cut mode, the section under the cursor with a
 * tip saying what a click does.
 */
export class CutLayer {
  /** The section a click would close or reopen */
  hovered?: HoveredSection;

  private readonly map: MlMap;
  private readonly engine: TravelEngine;
  private readonly net: Network;
  private readonly tipEl: HTMLDivElement;
  private readonly tip: Marker;

  constructor(map: MlMap, engine: TravelEngine) {
    this.map = map;
    this.engine = engine;
    this.net = engine.net;

    this.tipEl = document.createElement('div');
    this.tipEl.className = 'cut-tip';
    this.tip = new Marker({ element: this.tipEl, anchor: 'left', offset: [16, 0] });
  }

  /** Sources and layers, once the style is loaded */
  addLayers(): void {
    const { map } = this;

    map.addSource('cut-hover', { type: 'geojson', data: EMPTY });
    map.addLayer({
      id: 'cut-hover',
      type: 'line',
      source: 'cut-hover',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['get', 'closed'], GREEN, RED],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 15, 12],
        'line-opacity': 0.4,
      },
    });

    map.addSource('cuts', { type: 'geojson', data: EMPTY });
    map.addLayer({
      id: 'cuts-casing',
      type: 'line',
      source: 'cuts',
      filter: LINES,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 8] },
    });
    map.addLayer({
      id: 'cuts-line',
      type: 'line',
      source: 'cuts',
      filter: LINES,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': RED,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5],
        'line-dasharray': [1.5, 1],
      },
    });
    map.addLayer({
      id: 'cuts-mark',
      type: 'circle',
      source: 'cuts',
      filter: POINTS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 15, 10],
        'circle-color': RED,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'cuts-cross',
      type: 'symbol',
      source: 'cuts',
      filter: POINTS,
      layout: {
        'text-field': '×',
        'text-font': ['Source Sans Pro Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 13, 15, 20],
        'text-offset': [0, -0.05],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#fff' },
    });
  }

  /** Draws the closed sections */
  draw(cuts: Cut[]): void {
    const features: GeoJSON.Feature[] = cuts.flatMap((cut): GeoJSON.Feature[] => {
      const lines = this.lines(cut);
      const first = lines[0];
      if (!first) return [];

      const properties = { key: cutKey(cut) };

      return [
        { type: 'Feature', properties, geometry: { type: 'MultiLineString', coordinates: lines } },
        { type: 'Feature', properties, geometry: { type: 'Point', coordinates: this.middle(first) } },
      ];
    });

    this.map.getSource<GeoJSONSource>('cuts')?.setData({ type: 'FeatureCollection', features });
  }

  /** Highlights the section under the cursor, or clears the highlight when there is none */
  hover(px: { x: number; y: number }, lngLat: LngLat): void {
    const found = this.sectionAt(px, this.toRel(lngLat));
    if (!found) {
      this.clearHover();

      return;
    }

    this.tip.setLngLat(lngLat);
    if (!this.tipEl.isConnected) this.tip.addTo(this.map);
    this.map.getCanvas().style.cursor = 'pointer';

    // Same section as before: only the tip follows the cursor
    if (this.hovered && cutKey(this.hovered.cut) === cutKey(found.cut)) return;

    this.hovered = found;
    const what = this.describe(found.cut);
    this.tipEl.textContent = found.closed ? t.cuts.hoverCut(what) : t.cuts.hover(what);
    this.tipEl.classList.toggle('reopen', found.closed);

    this.map.getSource<GeoJSONSource>('cut-hover')?.setData({
      type: 'Feature',
      properties: { closed: found.closed },
      geometry: { type: 'MultiLineString', coordinates: this.lines(found.cut) },
    });
  }

  clearHover(): void {
    this.hovered = undefined;
    this.map.getSource<GeoJSONSource>('cut-hover')?.setData(EMPTY);
    this.map.getCanvas().style.cursor = '';
    this.tip.remove();
  }

  /**
   * The section under the cursor: a closed one first (to reopen it), then a metro, RER or tram section (transit mode),
   * then the nearest street.
   */
  private sectionAt(px: { x: number; y: number }, rel: Rel): HoveredSection | undefined {
    const box: [PointLike, PointLike] = [
      [px.x - PICK_PX, px.y - PICK_PX],
      [px.x + PICK_PX, px.y + PICK_PX],
    ];

    const closedHit = this.map.queryRenderedFeatures(box, { layers: ['cuts-line'] })[0];
    const closedCut = closedHit && parseCut(String(closedHit.properties.key));
    if (closedCut) return { cut: closedCut, closed: true };

    if (this.engine.profile.mode === 'transit' && this.map.getLayer('rail-lines')) {
      const railHit = this.map.queryRenderedFeatures(box, { layers: ['rail-lines'] })[0];
      const railCut = railHit && cutOfEdge(this.net, Number(railHit.properties.edge));
      if (railCut) return { cut: railCut, closed: false };
    }

    const snap = this.engine.snap(rel[0], rel[1]);
    if (!snap) return undefined;

    // Near enough on screen, whatever the zoom
    const at = this.map.project(this.toLngLat([snap.x, snap.y]));
    if (Math.hypot(at.x - px.x, at.y - px.y) > PICK_PX * 1.5) return undefined;

    const roadCut = cutOfEdge(this.net, snap.edge);

    return roadCut && { cut: roadCut, closed: false };
  }

  /** "1 · Château de Vincennes ↔ Bérault", or a street name */
  private describe(cut: Cut): string {
    const { line, text } = cutLabel(this.net, cut);
    if (line) return `${line.name} · ${text}`;

    return text ? formatStreet(text) : t.unnamedRoad;
  }

  /** Lines of the edges of a cut, as map coordinates */
  private lines(cut: Cut): LngLat[][] {
    const { coordStart, coords } = this.net;

    return edgesOfCut(this.net, cut).map((e) => {
      const points: LngLat[] = [];
      for (let p = coordStart[e]; p < coordStart[e + 1]; p += 1) points.push(this.toLngLat([coords[p * 2], coords[p * 2 + 1]]));

      return points;
    });
  }

  /** Halfway along a line, where the cross goes */
  private middle(points: LngLat[]): LngLat {
    const xy = points.map((p) => this.toRel(p));

    // Distance from the start to each point
    const along = xy.map(() => 0);
    xy.forEach(([x, y], i) => {
      if (i > 0) along[i] = along[i - 1] + Math.hypot(x - xy[i - 1][0], y - xy[i - 1][1]);
    });

    const half = along[along.length - 1] / 2;
    const i = along.findIndex((d, k) => k > 0 && d >= half && d > along[k - 1]);
    if (i < 1) return points[0];

    // Within the segment that crosses the half
    const f = (half - along[i - 1]) / (along[i] - along[i - 1]);
    const [[x0, y0], [x1, y1]] = [xy[i - 1], xy[i]];

    return this.toLngLat([x0 + f * (x1 - x0), y0 + f * (y1 - y0)]);
  }

  private toRel(p: LngLat): Rel {
    const [x, y] = toMercator(p);
    const [ox, oy] = this.net.origin;

    return [x - ox, y - oy];
  }

  private toLngLat([x, y]: Rel): LngLat {
    const [ox, oy] = this.net.origin;

    return fromMercator([x + ox, y + oy]);
  }
}
