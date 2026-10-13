import { Box } from '@ign-junn/design-system';
import 'maplibre-gl/dist/maplibre-gl.css';
import type * as GeoJSON from 'geojson';
import {
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
import { useEffect, useRef, type ReactElement } from 'react';
import { type Cut, CutLayer } from '@/features/cuts';
import { type Leg, toLegs } from '@/features/trip';
import { type CutImpact, EDGE_BOARD, EDGE_RIDE, FLAG_BUS, type Result, TravelEngine } from '@/features/routing';
import { BASEMAP_STYLE, type Camera, HILLSHADE_TILES, LANDMARKS, type LngLat, type Perspective, type Mode } from '@/shared/config';
import { rampCss } from '@/shared/colors';
import { formatMinutes } from '@/shared/format';
import { fromMercator, toMercator } from '@/shared/mercator';
import { t } from '@/locales';
import { BuildingGlLayer } from '@/features/buildings';
import { BUILDINGS_ZOOM, MIN_ZOOM, TILT, TILT_PITCH } from './camera';
import { ContourLines } from './contourLines';
import { NetworkLayer } from './networkLayer';

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
  /** With closed sections: the rail stations they delay */
  cutImpact?: CutImpact;
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
  /** Where the map opens and the first run starts (read once per engine) */
  camera: Camera;
  /** The map stopped moving: where it looks now */
  onCamera: (camera: Camera) => void;
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
  /** Closed sections, drawn over the network */
  cuts: Cut[];
  /** Cut mode: a click closes (or reopens) the section under the cursor instead of pinning a point */
  cutMode: boolean;
  onCutModeChange: (on: boolean) => void;
  onCutToggle: (cut: Cut) => void;
  /** The basemap style is loaded: the first computation starts */
  onMapLoad: () => void;
  /** The first computed map is on screen: the app is ready */
  onFirstFrame: () => void;
  /** Flat, or tilted with the buildings colored by time */
  perspective: Perspective;
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
  // A station takes the color of the first rail line boarded there: one pass over the edges
  const stationColor = new Map<number, string>();
  for (let e = 0; e < net.edgeCount; e += 1) {
    const station = net.edgeA[e];
    if (net.edgeKind[e] !== EDGE_BOARD || net.edgeFlags[e] & FLAG_BUS || stationColor.has(station)) continue;

    stationColor.set(station, net.lines[net.edgeName[e]].color);
  }

  for (let e = 0; e < net.edgeCount; e += 1) {
    if (net.edgeKind[e] !== EDGE_RIDE || net.edgeFlags[e] & FLAG_BUS) continue;
    const line = net.lines[net.edgeName[e]];
    const coordinates: LngLat[] = [];
    for (let p = net.coordStart[e]; p < net.coordStart[e + 1]; p += 1)
      coordinates.push(at(net.coords[p * 2], net.coords[p * 2 + 1]));
    features.push({
      type: 'Feature',
      properties: { color: line.color, order: line.type === 1 ? 2 : 1, edge: e },
      geometry: { type: 'LineString', coordinates },
    });
  }

  for (const s of net.railStations)
    features.push({
      type: 'Feature',
      properties: { color: stationColor.get(s) ?? '#555' },
      geometry: { type: 'Point', coordinates: at(net.nodeXY[s * 2], net.nodeXY[s * 2 + 1]) },
    });

  return { type: 'FeatureCollection', features };
};

/** The trip on the map: an indigo no travel time has */
const ROUTE_COLOR = '#3b3fb6';


/** The rail lines drawn on the ground show in transit mode only */
const styleGroundLayers = (map: MlMap, mode: Mode): void => {
  if (!map.getLayer('rail-lines')) return;

  const rail = mode === 'transit' ? 1 : 0;
  map.setPaintProperty('rail-lines', 'line-opacity', rail);
  map.setPaintProperty('rail-stations', 'circle-opacity', rail);
  map.setPaintProperty('rail-stations', 'circle-stroke-opacity', rail);
};

const LOCATE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M20 12h2M2 12h2"/></svg>';

/** A button of its own in the map controls: "my location", "close a section" */
class ButtonControl implements IControl {
  private container?: HTMLDivElement;
  readonly button: HTMLButtonElement;

  constructor(icon: string, title: string, onClick: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon;
    button.addEventListener('click', onClick);
    this.button = button;
  }

  onAdd(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    container.append(this.button);
    this.container = container;

    return container;
  }

  onRemove(): void {
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
  camera,
  onCamera,
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
  cuts,
  cutMode,
  onCutModeChange,
  onCutToggle,
  onMapLoad,
  onFirstFrame,
  perspective,
}: MapViewProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);
  const props = {
    engine,
    camera,
    onCamera,
    scale,
    contours,
    pinned,
    onPin,
    onLive,
    onTarget,
    onSettle,
    onLocate,
    cuts,
    cutMode,
    onCutModeChange,
    onCutToggle,
    onMapLoad,
    onFirstFrame,
    perspective,
  };
  const live = useRef(props);
  live.current = props;
  // Imperative state of the map, shared by the effects below
  const ctl = useRef<{
    map?: MlMap;
    layer?: NetworkLayer;
    buildings?: BuildingGlLayer;
    ready: boolean;
    /** Latest cursor position, Mercator metres relative to the zone */
    cursor?: [number, number];
    frame: number;
    lastPanel: number;
    settleTimer?: ReturnType<typeof setTimeout>;
    /** Last update of the panel after the moves stop */
    panelTimer?: ReturnType<typeof setTimeout>;
    refresh: () => void;
    /** Draws the closed sections */
    drawCuts: () => void;
    /** Clears the section highlighted in cut mode */
    clearHover: () => void;
    /** Cut mode on: the map stays computed from the pinned point, else from the cursor's last position */
    freeze: () => void;
  }>({ ready: false, frame: 0, lastPanel: 0, refresh: () => undefined, drawCuts: () => undefined, clearHover: () => undefined, freeze: () => undefined });

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
    // The landmarks of the loaded region only (Paris places mean nothing from Lyon)
    const [minLng, minLat, maxLng, maxLat] = net.bbox;
    const landmarkXY = LANDMARKS.filter(({ at: [lng, lat] }) => lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat).map(
      ({ name, at }) => {
        const [x, y] = toRel(at);

        return { name, x, y };
      },
    );
    const c = ctl.current;
    const map = new MlMap({
      container,
      style: BASEMAP_STYLE,
      center: live.current.camera.center,
      zoom: live.current.camera.zoom,
      minZoom: MIN_ZOOM,
      pitch: live.current.camera.pitch,
      bearing: live.current.camera.bearing,
      attributionControl: {
        compact: true,
        customAttribution: [t.attribution, `<a href="${import.meta.env.BASE_URL}legal.html">${t.legalNotice}</a>`],
      },
      fadeDuration: 0,
    });
    // Bottom corners stack upwards: the locate button, added first, sits under the zoom buttons
    map.addControl(new ButtonControl(LOCATE_ICON, t.locate, () => live.current.onLocate()), 'bottom-right');
    // The compass resets the heading and the tilt of the 3D views
    map.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
    // Tilted at 45° or flat, without dragging with the mouse; pressed while the map is tilted
    const tilt = new ButtonControl('<span class="tilt-label">45°</span>', t.tilt, () =>
      map.easeTo({ pitch: map.getPitch() > 1 ? 0 : TILT_PITCH, duration: 600 }),
    );
    map.addControl(tilt, 'bottom-right');
    const showTilt = (): void => {
      tilt.button.classList.toggle('active', map.getPitch() > 1);
      tilt.button.setAttribute('aria-pressed', String(map.getPitch() > 1));
    };
    map.on('pitchend', showTilt);
    map.once('load', showTilt);
    c.map = map;
    const layer = new NetworkLayer(net);
    const buildings = new BuildingGlLayer(engine, layer);
    buildings.setVisible(live.current.perspective === 'buildings');
    c.buildings = buildings;
    layer.setProfile(engine.profile);
    c.layer = layer;

    const originMarker = new Marker({ element: markerElement('origin-marker'), draggable: true });
    originMarker.on('drag', () => {
      const p = originMarker.getLngLat().toArray();
      live.current.onPin(p);
    });
    const labelEl = markerElement('time-label');
    const label = new Marker({ element: labelEl, anchor: 'bottom', offset: [0, -14] });

    const setRoute = (coords: LngLat[] | undefined) => {
      map.getSource<GeoJSONSource>('route')?.setData(
        coords && coords.length > 1
          ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
          : EMPTY,
      );
    };

    /** Path from the pinned origin to the cursor, as map coordinates */
    const routeCoords = (r: Result, node: number, target: [number, number], snapXY: [number, number]) => {
      const steps = engine.path(r, node);
      const pts: [number, number][] = [];
      const start: [number, number] = [r.snap.x, r.snap.y];
      // Departure: origin → target. Arrival: the path runs from the target to the origin.
      pts.push(engine.profile.direction === 'departure' ? start : snapXY);
      for (const { edge, from } of steps) pts.push(...engine.edgePoints(edge, from));
      pts.push(engine.profile.direction === 'departure' ? snapXY : start);
      if (engine.profile.direction === 'departure') pts.push(target);
      else pts.unshift(target);

      return { coords: pts.map(toLngLat), steps };
    };

    // The panel follows at most every PANEL_THROTTLE_MS, and once more after the last move
    const panelDue = () => {
      const now = performance.now();
      clearTimeout(c.panelTimer);
      if (now - c.lastPanel < PANEL_THROTTLE_MS) {
        c.panelTimer = setTimeout(schedule, PANEL_THROTTLE_MS);

        return false;
      }
      c.lastPanel = now;

      return true;
    };

    const contourLines = new ContourLines(map, engine);

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
        cutImpact: engine.cutImpact(r, limit),
        runMs: r.runMs,
        settled: r.settled,
      };
    };

    /** One frame of work for the latest cursor position */
    // One run at a time in the worker: moves made meanwhile collapse into one run from the latest position, and the
    // map keeps showing the last result until the next one is ready
    const runs: { busy: boolean; dirty: boolean; shown?: Result } = { busy: false, dirty: false };
    const process = () => {
      c.frame = 0;
      if (runs.busy) {
        runs.dirty = true;

        return;
      }
      runs.busy = true;

      const pin = live.current.pinned;
      const cursor: [number, number] = c.cursor ?? toRel(pin ?? live.current.camera.center);
      engine
        .run(cursor[0], cursor[1], live.current.scale)
        .then((r) => {
          apply(r, cursor);
          if (runs.shown && runs.shown !== r) engine.recycle(runs.shown);
          runs.shown = r;
        })
        .finally(() => {
          runs.busy = false;
          if (runs.dirty) {
            runs.dirty = false;
            schedule();
          }
        });
    };

    /** Shows a result: network colors, contours, figures, and the trip to the anchored point */
    const firstFrame = { done: false };
    const apply = (r: Result | undefined, cursor: [number, number]) => {
      const { scale: s, contours: cs, pinned: pin } = live.current;
      layer.setStyle({ scale: s, contours: [] });
      // The colors always follow the cursor: from it (departure) or towards it (arrival)
      // The buildings read the same times: they follow the cursor too
      layer.setTimes(r?.dist);

      // The first result drawn (even an empty one, a point off the network): the startup screen can go
      if (!firstFrame.done) {
        firstFrame.done = true;
        map.once('render', () => live.current.onFirstFrame());
        map.triggerRepaint();
      }

      contourLines.draw(r?.dist, cs);
      // One panel slot per frame, shared by the figures and the trip
      const due = panelDue();
      if (due) live.current.onLive(r && summary(r, toLngLat(cursor)));
      if (!pin) return;
      if (live.current.cutMode) {
        // Computed from the pinned point itself: no trip to show
        label.remove();
        setRoute(undefined);

        return;
      }

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
      setRoute(coords);
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

    const cutLayer = new CutLayer(map, engine);
    c.drawCuts = () => cutLayer.draw(live.current.cuts);
    c.clearHover = () => cutLayer.clearHover();

    c.freeze = () => {
      const pin = live.current.pinned;
      if (pin) c.cursor = toRel(pin);
      schedule();
    };

    map.on('mousemove', (e) => {
      // Cut mode: the cursor picks sections, the origin of the map stays where it was
      const point = e.lngLat.toArray();
      if (live.current.cutMode) return cutLayer.hover(e.point, point);

      c.cursor = toRel(point);
      schedule();
      clearTimeout(c.settleTimer);
      c.settleTimer = setTimeout(() => live.current.onSettle(live.current.pinned ? point : undefined), SETTLE_MS);
    });
    map.getCanvas().addEventListener('mouseleave', () => clearTimeout(c.settleTimer));
    map.on('moveend', () => {
      const { lng, lat } = map.getCenter();
      live.current.onCamera({ center: [lng, lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
    });
    map.on('click', (e) => {
      if (!live.current.cutMode) return live.current.onPin(e.lngLat.toArray());
      const { hovered } = cutLayer;
      if (!hovered) return;

      live.current.onCutToggle(hovered.cut);
      cutLayer.clearHover();
    });

    map.on('load', () => {
      live.current.onMapLoad();
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
      // The relief, over the veil so that it is not washed out, under the network
      map.addSource('hillshade', {
        type: 'raster',
        tiles: [HILLSHADE_TILES],
        tileSize: 256,
        minzoom: 6,
        maxzoom: 17,
        attribution: '© IGN RGE ALTI',
      });
      map.addLayer({ id: 'hillshade', type: 'raster', source: 'hillshade', paint: { 'raster-opacity': 0.55 } }, firstSymbol);
      map.addLayer(layer, firstSymbol);
      // Under the network: the colored streets stay visible across the buildings
      map.addLayer(buildings, layer.id);
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
      cutLayer.addLayers();
      c.drawCuts();
      map.addSource('route', { type: 'geojson', data: EMPTY });
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
        // A color the time ramp never takes: the route stands out over green and red streets alike
        paint: { 'line-color': ROUTE_COLOR, 'line-width': 5 },
      });
      // The attribution starts folded: its button only
      const attribution = container.querySelector('.maplibregl-ctrl-attrib');
      attribution?.classList.remove('maplibregl-compact-show');
      attribution?.removeAttribute('open');
      styleGroundLayers(map, engine.profile.mode);
      c.ready = true;
      c.refresh();
    });

    return () => {
      cancelAnimationFrame(c.frame);
      clearTimeout(c.settleTimer);
      contourLines.terminate();
      // Its tile worker and its GPU buffers go with the map (another region, another engine)
      if (map.getLayer(buildings.id)) map.removeLayer(buildings.id);
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
    if (c.ready && c.map) styleGroundLayers(c.map, engine.profile.mode);
    if (c.ready) c.refresh();
  }, [engine, profileVersion, scale]);

  // New profile (mode, cuts…): the buildings join their streets again; not when only the max time changes
  useEffect(() => ctl.current.buildings?.setProfile(), [engine, profileVersion]);

  // Flat or 3D: the map tilts and the buildings stand up. A new map (another region) keeps the camera it got.
  const shownPerspective = useRef(perspective);
  useEffect(() => {
    const { map, buildings } = ctl.current;
    if (!map) return;

    buildings?.setVisible(perspective === 'buildings');
    if (shownPerspective.current === perspective) return;
    shownPerspective.current = perspective;

    const tilted = perspective !== 'flat';
    // The buildings exist from zoom 15 only: the building view zooms in to them
    const zoom = perspective === 'buildings' ? Math.max(map.getZoom(), BUILDINGS_ZOOM) : map.getZoom();
    map.easeTo({ ...(tilted ? TILT : { pitch: 0, bearing: 0 }), zoom, duration: 900 });
  }, [engine, perspective]);

  useEffect(() => {
    const c = ctl.current;
    if (c.ready) c.refresh();
  }, [pinned]);

  useEffect(() => {
    const c = ctl.current;
    if (c.ready) c.refresh();
  }, [contours]);

  useEffect(() => {
    const c = ctl.current;
    if (c.ready) c.drawCuts();
  }, [cuts]);

  // Cut mode: Esc leaves it
  useEffect(() => {
    const c = ctl.current;
    if (!cutMode) {
      c.clearHover();

      return;
    }
    c.freeze();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') live.current.onCutModeChange(false);
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [cutMode]);

  const positionMarker = useRef<Marker>(undefined);
  useEffect(() => {
    const map = ctl.current.map;
    if (!focus || !map) return;
    positionMarker.current ??= new Marker({ element: markerElement('position-marker') });
    positionMarker.current.setLngLat(focus.point).addTo(map);
    map.flyTo({ center: focus.point, zoom: Math.max(map.getZoom(), 14), duration: 1200 });
  }, [focus]);

  return <Box ref={containerRef} className={cutMode ? 'map cutting' : 'map'} />;
};

export default MapView;
