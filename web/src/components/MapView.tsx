import 'maplibre-gl/dist/maplibre-gl.css';
import type * as GeoJSON from 'geojson';
import {
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type IControl,
  Map as MlMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
// MapLibre's worker, bundled by Vite with its shared chunk (the library's own `new URL` lookup breaks in a bundle)
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { type ContourGrid, contourGrid, isochroneLines, joinSegments } from '../engine/contours';
import { type Leg, toLegs } from '../engine/legs';
import { EDGE_BOARD, EDGE_RIDE, FLAG_BUS } from '../engine/network';
import { type Result, TravelEngine } from '../engine/travelEngine';
import { BASEMAP_STYLE, LANDMARKS, type LngLat, START } from '../lib/config';
import { rampCss } from '../lib/colors';
import { formatMinutes } from '../lib/format';
import { fromMercator, toMercator } from '../lib/mercator';
import { t } from '../locales';
import { NetworkLayer } from '../map/networkLayer';

setWorkerUrl(maplibreWorkerUrl);

/** What the explored point reaches, sent to the panels (throttled) */
export interface LiveInfo {
  point: LngLat;
  /** Seconds: the longest chosen isochrone, else the max time */
  limit: number;
  /** Travel time to the landmarks, shortest first, and their distance as the crow flies */
  landmarks: { name: string; seconds: number; km: number }[];
  /** Transit: stations and lines one can board within the limit */
  transit?: { stations: number; lines: number };
  /** Walk: the metro, RER or tram station reached first */
  nearestStation?: { name: string; seconds: number };
  /** Bike: kilometres of cycle lanes and greenways within the limit */
  cyclewayKm?: number;
  runMs: number;
  settled: number;
}

export interface TargetInfo {
  point: LngLat;
  seconds: number;
  legs: Leg[];
}

interface MapViewProps {
  engine: TravelEngine;
  /** Bumped by the parent after `engine.setProfile` */
  profileVersion: number;
  /** Seconds */
  scale: number;
  /** Seconds */
  contours: number[];
  /** Pinned origin; undefined: the origin follows the cursor */
  pinned?: LngLat;
  onPin: (point: LngLat | undefined) => void;
  onLive: (info: LiveInfo | undefined) => void;
  onTarget: (info: TargetInfo | undefined) => void;
  /** The cursor stopped on a point (pinned mode), to ask the Géoplateforme for its route */
  onSettle: (point: LngLat | undefined) => void;
  /** The user's position: the map centers on it and marks it (a new object each time) */
  focus?: { point: LngLat };
  /** The locate button of the map controls */
  onLocate: () => void;
}

const PANEL_THROTTLE_MS = 60;
const CONTOUR_THROTTLE_MS = 100;
const SETTLE_MS = 350;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Metro, RER, train and tram rides in their line colors, and the stations they serve */
const railFeatures = (engine: TravelEngine): GeoJSON.FeatureCollection => {
  const { net } = engine;
  const [ox, oy] = net.origin;
  const at = (x: number, y: number) => fromMercator([x + ox, y + oy]);
  const features: GeoJSON.Feature[] = [];
  const stationColor = new Map<number, string>();
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (net.edgeKind[e] !== EDGE_RIDE || net.edgeFlags[e] & FLAG_BUS) continue;
    const line = net.lines[net.edgeName[e]];
    const coordinates: LngLat[] = [];
    for (let p = net.coordStart[e]; p < net.coordStart[e + 1]; p += 1)
      coordinates.push(at(net.coords[p * 2], net.coords[p * 2 + 1]));
    features.push({
      type: 'Feature',
      properties: { color: line.color, order: line.type === 1 ? 2 : 1 },
      geometry: { type: 'LineString', coordinates },
    });
  }
  for (const s of net.railStations) {
    // A station takes the color of a line serving it
    for (let e = 0; e < net.edgeCount && !stationColor.has(s); e += 1)
      if (net.edgeKind[e] === EDGE_BOARD && net.edgeA[e] === s && !(net.edgeFlags[e] & FLAG_BUS))
        stationColor.set(s, net.lines[net.edgeName[e]].color);
    features.push({
      type: 'Feature',
      properties: { color: stationColor.get(s) ?? '#555' },
      geometry: { type: 'Point', coordinates: at(net.nodeXY[s * 2], net.nodeXY[s * 2 + 1]) },
    });
  }

  return { type: 'FeatureCollection', features };
};

const LOCATE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M20 12h2M2 12h2"/></svg>';

/** "My location" button, in the group of the map controls */
class LocateControl implements IControl {
  private container?: HTMLDivElement;
  private readonly onClick: () => void;

  constructor(onClick: () => void) {
    this.onClick = onClick;
  }

  onAdd() {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'locate-button';
    button.title = t.locate;
    button.setAttribute('aria-label', t.locate);
    button.innerHTML = LOCATE_ICON;
    button.addEventListener('click', this.onClick);
    container.append(button);
    this.container = container;

    return container;
  }

  onRemove() {
    this.container?.remove();
  }
}

const markerElement = (className: string) => {
  const el = document.createElement('div');
  el.className = className;

  return el;
};

const MapView = ({
  engine,
  profileVersion,
  scale,
  contours,
  pinned,
  onPin,
  onLive,
  onTarget,
  onSettle,
  focus,
  onLocate,
}: MapViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const live = useRef({ engine, scale, contours, pinned, onPin, onLive, onTarget, onSettle, onLocate });
  live.current = { engine, scale, contours, pinned, onPin, onLive, onTarget, onSettle, onLocate };
  // Imperative state of the map, shared by the effects below
  const ctl = useRef<{
    map?: MlMap;
    layer?: NetworkLayer;
    ready: boolean;
    /** Latest cursor position, Mercator metres relative to the zone */
    cursor?: [number, number];
    frame: number;
    lastPanel: number;
    settleTimer?: ReturnType<typeof setTimeout>;
    refresh: () => void;
  }>({ ready: false, frame: 0, lastPanel: 0, refresh: () => undefined });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const net = engine.net;
    const [ox, oy] = net.origin;
    const toRel = (p: LngLat): [number, number] => {
      const [x, y] = toMercator(p);

      return [x - ox, y - oy];
    };
    const toLngLat = ([x, y]: [number, number]) => fromMercator([x + ox, y + oy]);
    const landmarkXY = LANDMARKS.map(({ name, at }) => {
      const [x, y] = toRel(at);

      return { name, x, y };
    });
    const c = ctl.current;
    const map = new MlMap({
      container,
      style: BASEMAP_STYLE,
      center: live.current.pinned ?? START,
      zoom: 13.4,
      attributionControl: {
        compact: true,
        customAttribution: t.attribution,
      },
      fadeDuration: 0,
    });
    // Bottom corners stack upwards: the locate button, added first, sits under the zoom buttons
    map.addControl(new LocateControl(() => live.current.onLocate()), 'bottom-right');
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    c.map = map;
    const layer = new NetworkLayer(net);
    layer.setProfile(engine.profile);
    c.layer = layer;

    const originMarker = new Marker({ element: markerElement('origin-marker'), draggable: true });
    originMarker.on('drag', () => {
      const p = originMarker.getLngLat().toArray() as LngLat;
      live.current.onPin(p);
    });
    const labelEl = markerElement('time-label');
    const label = new Marker({ element: labelEl, anchor: 'bottom', offset: [0, -14] });

    const setRoute = (coords: LngLat[] | undefined, seconds = 0) => {
      const source = map.getSource<GeoJSONSource>('route');
      if (!source) return;
      source.setData(
        coords && coords.length > 1
          ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
          : EMPTY,
      );
      if (coords) {
        const { scale: s } = live.current;
        const pinnedDir = engine.profile.direction;
        const stops = [0, 0.25, 0.5, 0.75, 1].flatMap((p) => [
          p,
          rampCss(((pinnedDir === 'departure' ? p : 1 - p) * seconds) / s),
        ]);
        map.setPaintProperty('route', 'line-gradient', [
          'interpolate',
          ['linear'],
          ['line-progress'],
          ...stops,
        ] as ExpressionSpecification);
      }
    };

    /** Path from the pinned origin to the cursor, as map coordinates */
    const routeCoords = (r: Result, node: number, target: [number, number], snapXY: [number, number]) => {
      const steps = engine.path(r, node);
      const pts: [number, number][] = [];
      const start: [number, number] = [r.snap.x, r.snap.y];
      // Departure: origin → target. Arrival: the path runs from the target to the origin.
      pts.push(engine.profile.direction === 'departure' ? start : snapXY);
      for (const { edge } of steps) {
        const a = net.edgeA[edge];
        const b = net.edgeB[edge];
        const last = pts[pts.length - 1];
        const da = Math.hypot(net.nodeXY[a * 2] - last[0], net.nodeXY[a * 2 + 1] - last[1]);
        const db = Math.hypot(net.nodeXY[b * 2] - last[0], net.nodeXY[b * 2 + 1] - last[1]);
        pts.push(...engine.edgePoints(edge, da <= db ? a : b));
      }
      pts.push(engine.profile.direction === 'departure' ? snapXY : start);
      if (engine.profile.direction === 'departure') pts.push(target);
      else pts.unshift(target);

      return { coords: pts.map(toLngLat), steps };
    };

    // The panel follows at most every PANEL_THROTTLE_MS, and once more after the last move
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const panelDue = () => {
      const now = performance.now();
      clearTimeout(trailing);
      if (now - c.lastPanel < PANEL_THROTTLE_MS) {
        trailing = setTimeout(schedule, PANEL_THROTTLE_MS);

        return false;
      }
      c.lastPanel = now;

      return true;
    };

    // Smooth isochrone lines, from the node times (at most every CONTOUR_THROTTLE_MS)
    let grid: ContourGrid | undefined;
    let lastContours = 0;
    let contourTrailing: ReturnType<typeof setTimeout> | undefined;
    const drawContours = (dist: Float32Array | undefined, limits: number[], force = false) => {
      const source = map.getSource<GeoJSONSource>('contours');
      if (!source) return;
      const now = performance.now();
      clearTimeout(contourTrailing);
      if (!force && now - lastContours < CONTOUR_THROTTLE_MS) {
        // Once more after the last move, so that the lines match where the cursor stopped
        contourTrailing = setTimeout(schedule, CONTOUR_THROTTLE_MS);

        return;
      }
      lastContours = now;
      if (!dist || !limits.length) {
        source.setData(EMPTY);

        return;
      }
      grid ??= contourGrid(net, engine.groundScale);
      const features: GeoJSON.Feature[] = [];
      isochroneLines(grid, dist, limits, engine.walkSpeed).forEach((segments, i) => {
        const lines = joinSegments(segments);
        const minutes = Math.round(limits[i] / 60);
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
      source.setData({ type: 'FeatureCollection', features });
    };

    const summary = (r: Result, point: LngLat): LiveInfo => {
      const limit = live.current.scale;
      const mode = engine.profile.mode;
      const landmarks = landmarkXY
        .map(({ name, x, y }) => {
          const [px, py] = toRel(point);

          return {
            name,
            seconds: engine.timeAt(r, x, y)?.seconds ?? Number.POSITIVE_INFINITY,
            km: (Math.hypot(x - px, y - py) * engine.groundScale) / 1000,
          };
        })
        .sort((a, b) => a.seconds - b.seconds);

      return {
        point,
        limit,
        landmarks,
        transit: mode === 'transit' ? engine.reachedTransit(r.dist, limit) : undefined,
        nearestStation: mode === 'pedestrian' ? engine.nearestStation(r.dist) : undefined,
        cyclewayKm: mode === 'bike' ? engine.cyclewayKm(r.dist, limit) : undefined,
        runMs: r.runMs,
        settled: r.settled,
      };
    };

    /** One frame of work for the latest cursor position */
    // One run at a time in the worker: moves made meanwhile collapse into one run from the latest position, and the
    // map keeps showing the last result until the next one is ready
    let busy = false;
    let dirty = false;
    let shown: Result | undefined;
    const process = () => {
      c.frame = 0;
      if (busy) {
        dirty = true;

        return;
      }
      busy = true;
      const pin = live.current.pinned;
      const cursor: [number, number] = c.cursor ?? toRel(pin ?? START);
      engine
        .run(cursor[0], cursor[1], live.current.scale)
        .then((r) => {
          apply(r, cursor);
          if (shown && shown !== r) engine.recycle(shown);
          shown = r;
        })
        .finally(() => {
          busy = false;
          if (dirty) {
            dirty = false;
            schedule();
          }
        });
    };

    /** Shows a result: network colors, contours, figures, and the trip to the anchored point */
    const apply = (r: Result | undefined, cursor: [number, number]) => {
      const { scale: s, contours: cs, pinned: pin } = live.current;
      layer.setStyle({ scale: s, contours: [] });
      // The colors always follow the cursor: from it (departure) or towards it (arrival)
      layer.setTimes(r?.dist);
      drawContours(r?.dist, cs);
      // One panel slot per frame, shared by the figures and the trip
      const due = panelDue();
      if (due) live.current.onLive(r && summary(r, toLngLat(cursor)));
      if (!pin) return;

      // The anchored point is the other end of the trip: its time and path are read in the same result
      const anchored = toRel(pin);
      const at = r && engine.timeAt(r, anchored[0], anchored[1]);
      label.setLngLat(pin);
      if (!label.getElement().isConnected) label.addTo(map);
      if (!r || !at || at.seconds > s) {
        labelEl.textContent = at ? `> ${formatMinutes(s / 60)}` : t.outsideZone;
        labelEl.style.setProperty('--label-color', '#777');
        setRoute(undefined);
        if (due) live.current.onTarget(undefined);

        return;
      }
      labelEl.textContent = formatMinutes(at.seconds / 60);
      labelEl.style.setProperty('--label-color', rampCss(at.seconds / s));
      const { coords, steps } = routeCoords(r, at.node, anchored, [at.snap.x, at.snap.y]);
      setRoute(coords, at.seconds);
      if (due) {
        const legs = toLegs(net, steps, engine.profile.mode);
        if (at.walk > 20) legs.push({ kind: 'walk', label: '', seconds: at.walk, metres: at.walk * engine.walkSpeed });
        live.current.onTarget({ point: toLngLat(cursor), seconds: at.seconds, legs });
      }
    };
    function schedule() {
      if (!c.frame) c.frame = requestAnimationFrame(process);
    }
    c.refresh = () => {
      const pin = live.current.pinned;
      if (pin) {
        originMarker.setLngLat(pin);
        // The anchored point is the end the map is not computed from
        originMarker.getElement().setAttribute('data-label', engine.profile.direction === 'departure' ? t.arrival : t.departure);
        if (!originMarker.getElement().isConnected) originMarker.addTo(map);
        if (c.cursor && !label.getElement().isConnected) label.setLngLat(toLngLat(c.cursor)).addTo(map);
      } else {
        originMarker.remove();
        label.remove();
        setRoute(undefined);
      }
      schedule();
    };

    map.on('mousemove', (e) => {
      c.cursor = toRel(e.lngLat.toArray() as LngLat);
      schedule();
      clearTimeout(c.settleTimer);
      const point = e.lngLat.toArray() as LngLat;
      c.settleTimer = setTimeout(() => live.current.onSettle(live.current.pinned ? point : undefined), SETTLE_MS);
    });
    map.getCanvas().addEventListener('mouseleave', () => clearTimeout(c.settleTimer));
    map.on('click', (e) => {
      live.current.onPin(e.lngLat.toArray() as LngLat);
    });

    map.on('load', () => {
      // Above every road and area of the basemap, under its labels (Plan IGN puts a few labels early in its stack)
      const layers = map.getStyle().layers;
      const lastShape = layers.findLastIndex((l) => l.type === 'line' || l.type === 'fill');
      const firstSymbol = layers.slice(lastShape + 1).find((l) => l.type === 'symbol')?.id;
      const [minLng, minLat, maxLng, maxLat] = net.bbox;
      map.addSource('zone', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-180, -85],
                [180, -85],
                [180, 85],
                [-180, 85],
                [-180, -85],
              ],
              [
                [minLng, minLat],
                [minLng, maxLat],
                [maxLng, maxLat],
                [maxLng, minLat],
                [minLng, minLat],
              ],
            ],
          },
        },
      });
      map.addLayer({ id: 'zone-mask', type: 'fill', source: 'zone', paint: { 'fill-color': '#000', 'fill-opacity': 0.12 } });
      // A light veil over the basemap, so that the network of the chosen mode stands out
      map.addSource('veil', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
        },
      });
      map.addLayer({ id: 'veil', type: 'fill', source: 'veil', paint: { 'fill-color': '#fff', 'fill-opacity': 0.5 } }, firstSymbol);
      map.addLayer(layer, firstSymbol);
      if (net.lines.length) {
        map.addSource('rail', { type: 'geojson', data: railFeatures(engine) });
        map.addLayer(
          {
            id: 'rail-lines',
            type: 'line',
            source: 'rail',
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'] },
            paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 15, 4] },
          },
          firstSymbol,
        );
        map.addLayer(
          {
            id: 'rail-stations',
            type: 'circle',
            source: 'rail',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 12, 2.6, 15, 5],
              'circle-color': '#fff',
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 2],
            },
          },
          firstSymbol,
        );
      }
      if (net.lines.length && engine.profile.mode !== 'transit') {
        map.setPaintProperty('rail-lines', 'line-opacity', 0);
        map.setPaintProperty('rail-stations', 'circle-opacity', 0);
        map.setPaintProperty('rail-stations', 'circle-stroke-opacity', 0);
      }
      map.addSource('contours', { type: 'geojson', data: EMPTY });
      // A multi-line cut into tiles can come back as a LineString: everything but the label points
      const contourLines: FilterSpecification = ['!=', ['geometry-type'], 'Point'];
      // White casing under a dark line, so that the isochrone stands out over the colored network
      map.addLayer(
        {
          id: 'contours-casing',
          type: 'line',
          source: 'contours',
          filter: contourLines,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 3.5], 'line-opacity': 0.9 },
        },
        firstSymbol,
      );
      map.addLayer(
        {
          id: 'contours',
          type: 'line',
          source: 'contours',
          filter: contourLines,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#1d1d1f', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 1.5] },
        },
        firstSymbol,
      );
      map.addLayer({
        id: 'contours-label',
        type: 'symbol',
        source: 'contours',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': ['concat', ['to-string', ['get', 'minutes']], ' min'],
          'text-font': ['Source Sans Pro Regular'],
          'text-size': 14,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.2],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 2.5 },
      });
      map.addSource('route', { type: 'geojson', data: EMPTY, lineMetrics: true });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fff', 'line-width': 9 },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1a9850', 'line-width': 5 },
      });
      // The attribution starts folded: its button only
      const attribution = container.querySelector('.maplibregl-ctrl-attrib');
      attribution?.classList.remove('maplibregl-compact-show');
      attribution?.removeAttribute('open');
      c.ready = true;
      c.refresh();
    });

    return () => {
      cancelAnimationFrame(c.frame);
      clearTimeout(c.settleTimer);
      map.remove();
      c.ready = false;
    };
    // The map is created once per engine; later props go through `live` and the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Profile (mode, direction, bus, hour, model) or bound changed: new geometry, new run
  useEffect(() => {
    const c = ctl.current;
    c.layer?.setProfile(engine.profile);
    const transit = engine.profile.mode === 'transit';
    if (c.ready && c.map?.getLayer('rail-lines')) {
      c.map.setPaintProperty('rail-lines', 'line-opacity', transit ? 1 : 0);
      c.map.setPaintProperty('rail-stations', 'circle-opacity', transit ? 1 : 0);
      c.map.setPaintProperty('rail-stations', 'circle-stroke-opacity', transit ? 1 : 0);
    }
    if (c.ready) c.refresh();
  }, [engine, profileVersion, scale]);

  useEffect(() => {
    const c = ctl.current;
    if (c.ready) c.refresh();
  }, [pinned]);

  useEffect(() => {
    const c = ctl.current;
    if (c.ready) c.refresh();
  }, [contours]);

  const positionMarker = useRef<Marker>(undefined);
  useEffect(() => {
    const map = ctl.current.map;
    if (!focus || !map) return;
    positionMarker.current ??= new Marker({ element: markerElement('position-marker') });
    positionMarker.current.setLngLat(focus.point).addTo(map);
    map.flyTo({ center: focus.point, zoom: Math.max(map.getZoom(), 14), duration: 1200 });
  }, [focus]);

  return <div ref={containerRef} className="map" />;
};

export default MapView;
