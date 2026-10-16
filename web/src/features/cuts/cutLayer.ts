import type { CircleLayer, Feature, GeoMap, Layer, LineLayer, Point, SymbolLayer } from 'isard';
import { Marker } from 'isard';
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

/** Pixels around the cursor where a section is picked */
const PICK_PX = 8;

type Props = { key: string; closed?: boolean };
const line = (lines: LngLat[][], properties: Props): Feature<Props> => ({
  type: 'Feature',
  properties,
  geometry: { type: 'MultiLineString', coordinates: lines },
});

/**
 * The closed sections on the map (red dashes, a cross halfway) and, in cut mode, the section under the cursor with a
 * tip saying what a click does.
 */
export class CutLayer {
  /** The section a click would close or reopen */
  hovered?: HoveredSection;

  private readonly map: GeoMap;
  private readonly engine: TravelEngine;
  private readonly net: Network;
  private readonly tipEl: HTMLDivElement;
  private readonly tip: Marker;
  private hover?: LineLayer<Props>;
  private casing?: LineLayer<Props>;
  private lineLayer?: LineLayer<Props>;
  private mark?: CircleLayer<Props>;
  private cross?: SymbolLayer<Props>;
  /** The rail lines of transit mode (each feature with its `edge`): a section of them is picked there */
  rail?: Layer;

  constructor(map: GeoMap, engine: TravelEngine) {
    this.map = map;
    this.engine = engine;
    this.net = engine.net;

    this.tipEl = document.createElement('div');
    this.tipEl.className = 'cut-tip';
    this.tip = new Marker({ element: this.tipEl, anchor: 'left', offset: [16, 0] });
  }

  /** The layers, on top of the map (over the basemap's labels) */
  addLayers(): void {
    const { map } = this;
    const top = (layer: Layer) => layer.moveBefore(undefined);
    this.hover = map.addLines<Props>({
      data: [],
      color: (p) => (p.closed ? GREEN : RED),
      width: [
        [11, 7],
        [15, 12],
      ],
      opacity: 0.4,
      visible: false,
    });
    top(this.hover);
    this.casing = map.addLines<Props>({
      data: [],
      color: '#fff',
      width: [
        [11, 4],
        [15, 8],
      ],
    });
    top(this.casing);
    this.lineLayer = map.addLines<Props>({
      data: [],
      color: RED,
      width: [
        [11, 2.5],
        [15, 5],
      ],
      dash: [1.5, 1],
    });
    top(this.lineLayer);
    this.mark = map.addCircles<Props>({
      data: [],
      color: RED,
      radius: [
        [11, 6],
        [15, 10],
      ],
      strokeColor: '#fff',
      strokeWidth: 2,
    });
    top(this.mark);
    this.cross = map.addSymbols<Props>({
      data: [],
      text: '×',
      size: [
        [11, 13],
        [15, 20],
      ],
      color: '#fff',
      offset: [0, -0.05],
      overlap: true,
    });
    top(this.cross);
  }

  /** Draws the closed sections */
  draw(cuts: Cut[]): void {
    const lines: Feature<Props>[] = [];
    const marks: Feature<Props>[] = [];
    for (const cut of cuts) {
      const parts = this.lines(cut);
      const first = parts[0];
      if (!first) continue;
      const properties = { key: cutKey(cut) };
      lines.push(line(parts, properties));
      marks.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: this.middle(first) } });
    }
    this.casing?.setData(lines);
    this.lineLayer?.setData(lines);
    this.mark?.setData(marks);
    this.cross?.setData(marks);
  }

  /** Highlights the section under the cursor, or clears the highlight when there is none */
  hoverAt(px: Point, lngLat: LngLat): void {
    const found = this.sectionAt(px, this.toRel(lngLat));
    if (!found) {
      this.clearHover();

      return;
    }

    this.tip.setLonLat(lngLat);
    if (!this.tipEl.isConnected) this.tip.addTo(this.map);
    this.map.getCanvas().style.cursor = 'pointer';

    // Same section as before: only the tip follows the cursor
    if (this.hovered && cutKey(this.hovered.cut) === cutKey(found.cut)) return;

    this.hovered = found;
    const what = this.describe(found.cut);
    this.tipEl.textContent = found.closed ? t.cuts.hoverCut(what) : t.cuts.hover(what);
    this.tipEl.classList.toggle('reopen', found.closed);
    this.hover?.setData([line(this.lines(found.cut), { key: cutKey(found.cut), closed: found.closed })]);
    this.hover?.setVisible(true);
  }

  clearHover(): void {
    this.hovered = undefined;
    this.hover?.setVisible(false);
    this.map.getCanvas().style.cursor = '';
    this.tip.remove();
  }

  /**
   * The section under the cursor: a closed one first (to reopen it), then a metro, RER or tram section (transit mode),
   * then the nearest street.
   */
  private sectionAt(px: Point, rel: Rel): HoveredSection | undefined {
    const closedHit = this.lineLayer && this.map.pickFeature(px, { radius: PICK_PX, layers: [this.lineLayer] });
    const closedCut = closedHit?.feature && parseCut(String((closedHit.feature.properties as Props).key));
    if (closedCut) return { cut: closedCut, closed: true };

    if (this.engine.profile.mode === 'transit' && this.rail) {
      const railHit = this.map.pickFeature(px, { radius: PICK_PX, layers: [this.rail] });
      const edge = railHit?.feature && (railHit.feature.properties as { edge: number }).edge;
      const railCut = edge !== undefined && cutOfEdge(this.net, edge);
      if (railCut) return { cut: railCut, closed: false };
    }

    const snap = this.engine.snap(rel[0], rel[1]);
    if (!snap) return undefined;

    // Near enough on screen, whatever the zoom
    const at = this.map.project(this.toLngLat([snap.x, snap.y]));
    if (!at || Math.hypot(at[0] - px[0], at[1] - px[1]) > PICK_PX * 1.5) return undefined;

    const roadCut = cutOfEdge(this.net, snap.edge);

    return roadCut && { cut: roadCut, closed: false };
  }

  /** "1 · Château de Vincennes ↔ Bérault", or a street name */
  private describe(cut: Cut): string {
    const { line: l, text } = cutLabel(this.net, cut);
    if (l) return `${l.name} · ${text}`;

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
