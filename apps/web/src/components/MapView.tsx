import 'maplibre-gl/dist/maplibre-gl.css';
import type * as GeoJSON from 'geojson';
import {
  type ExpressionSpecification,
  type GeoJSONSource,
  Map as MlMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
// MapLibre's worker, bundled by Vite with its shared chunk (the library's own `new URL` lookup breaks in a bundle)
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { type Leg, toLegs } from '../engine/legs';
import { EDGE_BOARD, EDGE_RIDE, FLAG_BUS } from '../engine/network';
import { WALK_SPEED } from '../engine/profile';
import { type Result, TravelEngine } from '../engine/travelEngine';
import { BASEMAP_STYLE, type LngLat } from '../lib/config';
import { rampCss } from '../lib/colors';
import { formatMinutes } from '../lib/format';
import { fromMercator, toMercator } from '../lib/mercator';
import { t } from '../locales';
import { NetworkLayer } from '../map/networkLayer';

setWorkerUrl(maplibreWorkerUrl);

/** What the cursor explores, sent to the panel (throttled) */
export interface LiveInfo {
  point: LngLat;
  /** Kilometres of streets reached, per chosen duration */
  reachedKm: number[];
  /** Share of the metro, RER and tram stations reached, per chosen duration */
  stationShare: number[];
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
}

const PANEL_THROTTLE_MS = 60;
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
}: MapViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const live = useRef({ engine, scale, contours, pinned, onPin, onLive, onTarget, onSettle });
  live.current = { engine, scale, contours, pinned, onPin, onLive, onTarget, onSettle };
  // Imperative state of the map, shared by the effects below
  const ctl = useRef<{
    map?: MlMap;
    layer?: NetworkLayer;
    ready: boolean;
    /** Result of the pinned origin */
    pinnedResult?: Result;
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
    const c = ctl.current;
    const map = new MlMap({
      container,
      style: BASEMAP_STYLE,
      center: live.current.pinned ?? toLngLat([0, 0]),
      zoom: 13.4,
      attributionControl: {
        compact: true,
        customAttribution: t.attribution,
      },
      fadeDuration: 0,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    c.map = map;
    const layer = new NetworkLayer(net);
    layer.setProfile(engine.profile);
    c.layer = layer;

    const originMarker = new Marker({ element: markerElement('origin-marker'), draggable: true });
    originMarker.on('drag', () => {
      const p = originMarker.getLngLat().toArray() as LngLat;
      c.pinnedResult = undefined;
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

    const summary = (r: Result, point: LngLat, limits: number[]): LiveInfo => ({
      point,
      reachedKm: engine.reachedKm(r.dist, limits),
      stationShare: engine.stationShare(r.dist, limits),
      runMs: r.runMs,
      settled: r.settled,
    });

    /** One frame of work for the latest cursor position */
    const process = () => {
      c.frame = 0;
      const { scale: s, contours: cs, pinned: pin } = live.current;
      layer.setStyle({ scale: s, contours: cs });
      if (pin) {
        if (!c.pinnedResult) {
          const [x, y] = toRel(pin);
          const r = engine.run(x, y, s);
          c.pinnedResult = r && TravelEngine.pin(r);
          layer.setTimes(c.pinnedResult?.dist);
          live.current.onLive(r && summary(r, pin, cs));
        }
        const r = c.pinnedResult;
        const cursor = c.cursor;
        if (!r || !cursor) return;
        const at = engine.timeAt(r, cursor[0], cursor[1]);
        const point = toLngLat(cursor);
        if (!at || at.seconds > s) {
          labelEl.textContent = at ? `> ${formatMinutes(s / 60)}` : t.outsideZone;
          labelEl.style.setProperty('--label-color', '#777');
          label.setLngLat(point);
          setRoute(undefined);
          if (panelDue()) live.current.onTarget(undefined);

          return;
        }
        labelEl.textContent = formatMinutes(at.seconds / 60);
        labelEl.style.setProperty('--label-color', rampCss(at.seconds / s));
        label.setLngLat(point);
        const { coords, steps } = routeCoords(r, at.node, cursor, [at.snap.x, at.snap.y]);
        setRoute(coords, at.seconds);
        if (panelDue()) {
          const legs = toLegs(net, steps, engine.profile.mode === 'car');
          if (at.walk > 20) legs.push({ kind: 'walk', label: '', seconds: at.walk, metres: at.walk * WALK_SPEED });
          live.current.onTarget({ point, seconds: at.seconds, legs });
        }

        return;
      }
      const cursor = c.cursor ?? [0, 0];
      const r = engine.run(cursor[0], cursor[1], s);
      layer.setTimes(r?.dist);
      if (panelDue()) live.current.onLive(r && summary(r, toLngLat(cursor), cs));
    };
    function schedule() {
      if (!c.frame) c.frame = requestAnimationFrame(process);
    }
    c.refresh = () => {
      const pin = live.current.pinned;
      if (pin) {
        originMarker.setLngLat(pin);
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
      if (live.current.pinned && !label.getElement().isConnected) label.setLngLat(e.lngLat).addTo(map);
      schedule();
      clearTimeout(c.settleTimer);
      const point = e.lngLat.toArray() as LngLat;
      c.settleTimer = setTimeout(() => live.current.onSettle(live.current.pinned ? point : undefined), SETTLE_MS);
    });
    map.getCanvas().addEventListener('mouseleave', () => {
      label.remove();
      clearTimeout(c.settleTimer);
    });
    map.on('click', (e) => {
      c.pinnedResult = undefined;
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
            minzoom: 12,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 15, 4.5],
              'circle-color': '#fff',
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 2],
            },
          },
          firstSymbol,
        );
      }
      if (net.lines.length && engine.profile.mode !== 'transit') {
        map.setPaintProperty('rail-lines', 'line-opacity', 0.3);
        map.setPaintProperty('rail-stations', 'circle-opacity', 0);
        map.setPaintProperty('rail-stations', 'circle-stroke-opacity', 0);
      }
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

  // Profile (mode, direction, bus) or bound changed: new geometry, new pinned run
  useEffect(() => {
    const c = ctl.current;
    c.layer?.setProfile(engine.profile);
    const transit = engine.profile.mode === 'transit';
    if (c.ready && c.map?.getLayer('rail-lines')) {
      c.map.setPaintProperty('rail-lines', 'line-opacity', transit ? 1 : 0.3);
      c.map.setPaintProperty('rail-stations', 'circle-opacity', transit ? 1 : 0);
      c.map.setPaintProperty('rail-stations', 'circle-stroke-opacity', transit ? 1 : 0);
    }
    c.pinnedResult = undefined;
    if (c.ready) c.refresh();
  }, [engine, profileVersion, scale]);

  useEffect(() => {
    const c = ctl.current;
    c.pinnedResult = undefined;
    if (c.ready) c.refresh();
  }, [pinned]);

  useEffect(() => {
    const c = ctl.current;
    if (c.ready) c.refresh();
  }, [contours]);

  return <div ref={containerRef} className="map" />;
};

export default MapView;
