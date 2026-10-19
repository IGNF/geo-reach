import { Box } from '@ign-junn/design-system';
import {
  type CircleLayer,
  type Control,
  type Feature,
  GeoMap,
  type LineLayer,
  Marker,
  NavigationControl,
  type NetworkLayer,
} from 'isard';
// The engine and its workers, served by Vite as files (the package's own `new URL` lookups break in a bundle); `?url`
// imports have a default export, which the linter cannot see in the JavaScript files
// oxlint-disable-next-line import/default
import basemapWorkerUrl from 'isard/basemap.worker.js?url';
// oxlint-disable-next-line import/default
import decoderWorkerUrl from 'isard/decoder.worker.js?url';
import coreWasmUrl from 'isard/isard_core_bg.wasm?url';
import wasmUrl from 'isard/isard_bg.wasm?url';
import { useEffect, useRef, type ReactElement } from 'react';
import { type Cut, CutLayer } from '@/features/cuts';
import { type Leg, toLegs } from '@/features/trip';
import { type CutImpact, EDGE_BOARD, EDGE_RIDE, FLAG_BUS, MAX_SNAP_METRES, type Result, TravelEngine } from '@/features/routing';
import { type Camera, HILLSHADE_TILES, LANDMARKS, type LngLat, type Perspective } from '@/shared/config';
import { RAMP_STOPS, rampCss } from '@/shared/colors';
import { formatMinutes } from '@/shared/format';
import { fromMercator, toMercator } from '@/shared/mercator';
import { perf } from '@/shared/perf';
import { t } from '@/locales';
import { Buildings } from '@/features/buildings';
import { BUILDINGS_ZOOM, minZoomFor, TILT, TILT_PITCH } from './camera';
import { networkCosts, networkGeometry } from './network';

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
  /** The map could not be created (no WebGL2, its engine not loaded) */
  onMapError: () => void;
  /** Flat, or tilted with the buildings colored by time */
  perspective: Perspective;
}

const PANEL_THROTTLE_MS = 60;
/**
 * Runs that last took less than this are made on the main thread, in the hover handler, so that the frame of the move
 * draws their times; longer ones go to the worker
 */
const MAIN_THREAD_MS = 4;
const SETTLE_MS = 350;

type RailProps = { color: string; order: number; edge: number };

/** Metro, RER, train and tram rides in their line colors (the lines drawn last on top), and the stations they serve */
const railFeatures = (engine: TravelEngine): { lines: Feature<RailProps>[]; stations: Feature<{ color: string }>[] } => {
  const { net } = engine;
  const [ox, oy] = net.origin;
  const at = (x: number, y: number) => fromMercator([x + ox, y + oy]);
  // A station takes the color of the first rail line boarded there: one pass over the edges
  const stationColor = new Map<number, string>();
  for (let e = 0; e < net.edgeCount; e += 1) {
    const station = net.edgeA[e];
    if (net.edgeKind[e] !== EDGE_BOARD || net.edgeFlags[e] & FLAG_BUS || stationColor.has(station)) continue;

    stationColor.set(station, net.lines[net.edgeName[e]].color);
  }

  const lines: Feature<RailProps>[] = [];
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (net.edgeKind[e] !== EDGE_RIDE || net.edgeFlags[e] & FLAG_BUS) continue;
    const line = net.lines[net.edgeName[e]];
    const coordinates: LngLat[] = [];
    for (let p = net.coordStart[e]; p < net.coordStart[e + 1]; p += 1) coordinates.push(at(net.coords[p * 2], net.coords[p * 2 + 1]));
    lines.push({
      type: 'Feature',
      properties: { color: line.color, order: line.type === 1 ? 2 : 1, edge: e },
      geometry: { type: 'LineString', coordinates },
    });
  }
  // The drawing order is the data's: the lines drawn last are on top
  lines.sort((a, b) => a.properties.order - b.properties.order);

  const stations = [...net.railStations].map(
    (s): Feature<{ color: string }> => ({
      type: 'Feature',
      properties: { color: stationColor.get(s) ?? '#555' },
      geometry: { type: 'Point', coordinates: at(net.nodeXY[s * 2], net.nodeXY[s * 2 + 1]) },
    }),
  );

  return { lines, stations };
};

/** The trip on the map: an indigo no travel time has */
const ROUTE_COLOR = '#3b3fb6';

/** The world, for the veil and the mask around the region */
const WORLD: LngLat[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

const LOCATE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M20 12h2M2 12h2"/></svg>';

/** A button of its own in the map controls: "my location", "close a section" */
class ButtonControl implements Control {
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
    container.className = 'isard-ctrl-group';
    container.append(this.button);
    this.container = container;

    return container;
  }

  onRemove(): void {
    this.container?.remove();
  }
}

const PERF_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>';

/** The graphics card the map draws with */
const gpuName = (canvas: HTMLCanvasElement): string => {
  const gl = canvas.getContext('webgl2');
  if (!gl) return '?';
  const info = gl.getExtension('WEBGL_debug_renderer_info');

  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
};

const markerElement = (className: string) => {
  const el = document.createElement('div');
  el.className = className;

  return el;
};

/**
 * Widths of the network, as the zoom changes (CSS pixels, zooms of 512 px tiles): lines from 1.2 px to 5 px; a wide glow under
 * them that fills the blocks between streets, narrowing as the streets spread apart on screen
 */
const LINE_WIDTH: [number, number][] = [
  [12.1, 1.2],
  [15.5, 5],
];
const GLOW_WIDTH: [number, number][] = [
  [9.5, 8],
  [11, 16],
  [12, 46],
  [16, 10],
];

const MapView = ({
  engine,
  camera,
  onCamera,
  profileVersion,
  scale,
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
  onMapError,
  perspective,
}: MapViewProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);
  const props = {
    engine,
    camera,
    onCamera,
    scale,
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
    onMapError,
    perspective,
  };
  const live = useRef(props);
  live.current = props;
  // Imperative state of the map, shared by the effects below
  const ctl = useRef<{
    map?: GeoMap;
    layer?: NetworkLayer;
    buildings?: Buildings;
    rail?: { lines: LineLayer<RailProps>; stations: CircleLayer<{ color: string }> };
    ready: boolean;
    /** Latest cursor position, Mercator metres relative to the zone */
    cursor?: [number, number];
    /** When the cursor was there, for the latency measure */
    cursorAt?: number;
    /** Engine time of the last run, to choose where the next one runs (unknown after a change of profile) */
    lastRunMs: number;
    /** The last run was made on the main thread */
    runOnMain: boolean;
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
    /** New profile: new costs on the network, the rail lines shown or not */
    setProfile: () => void;
  }>({
    ready: false,
    frame: 0,
    lastPanel: 0,
    lastRunMs: Infinity,
    runOnMain: false,
    refresh: () => undefined,
    drawCuts: () => undefined,
    clearHover: () => undefined,
    freeze: () => undefined,
    setProfile: () => undefined,
  });

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
    const cleanup: (() => void)[] = [];
    let disposed = false;

    GeoMap.create(container, {
      center: live.current.camera.center,
      zoom: live.current.camera.zoom,
      pitch: live.current.camera.pitch,
      bearing: live.current.camera.bearing,
      minZoom: minZoomFor(container.clientWidth, live.current.camera.center[1]),
      projection: 'mercator',
      // The basemap's areas and roads at the bottom, its labels above everything added later
      basemap: 'ign-plan-grey-vector',
      hillshade: 0,
      sky: false,
      attributionControl: {
        compact: true,
        customAttribution: [t.attribution, `<a href="${import.meta.env.BASE_URL}legal.html">${t.legalNotice}</a>`],
      },
      coreWasmUrl,
      wasmUrl,
      workerUrl: decoderWorkerUrl,
      basemapWorkerUrl,
    })
      .then((map) => {
        if (disposed) {
          map.destroy();

          return;
        }
        setup(map);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!disposed) live.current.onMapError();
      });

    const setup = (map: GeoMap) => {
      c.map = map;
      // Bottom corners stack upwards: the locate button, added first, sits under the zoom buttons
      map.addControl(new ButtonControl(LOCATE_ICON, t.locate, () => live.current.onLocate()), 'bottom-right');
      // The compass resets the heading and the tilt of the 3D views
      map.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
      // Tilted at 45° or flat, without dragging with the mouse; pressed while the map is tilted
      const tilt = new ButtonControl('<span class="tilt-label">45°</span>', t.tilt, () =>
        map.easeTo({ pitch: map.getCamera().pitch > 1 ? 0 : TILT_PITCH }, 600),
      );
      map.addControl(tilt, 'bottom-right');
      const showTilt = (): void => {
        const tilted = map.getCamera().pitch > 1;
        tilt.button.classList.toggle('active', tilted);
        tilt.button.setAttribute('aria-pressed', String(tilted));
      };
      showTilt();
      cleanup.push(map.on('moveend', showTilt));
      // Rendering measures, for a stutter: frames, engine, main thread, GPU layers
      const perfButton = new ButtonControl(PERF_ICON, t.perf.button, () => perf.setOpen(!perf.open));
      map.addControl(perfButton, 'bottom-right');
      const showPerf = (): void => {
        perfButton.button.classList.toggle('active', perf.open);
        perfButton.button.setAttribute('aria-pressed', String(perf.open));
      };
      showPerf();
      cleanup.push(perf.subscribe(showPerf));
      cleanup.push(
        map.on('render', ({ ms }) => {
          perf.frame();
          // The whole frame of the map: basemap, network, buildings, labels
          perf.record('network', ms);
        }),
      );

      // A light veil over the basemap, so that the network of the chosen mode stands out
      map.addFills({ data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD] } }, color: '#fff', opacity: 0.5 });
      // The relief, over the veil so that it is not washed out, under the network
      map.addRaster({ url: HILLSHADE_TILES, minZoom: 6, maxZoom: 17, opacity: 0.55 });
      const geometry = networkGeometry(net);
      const layer = map.addNetwork({
        ...geometry,
        costs: networkCosts(net, engine.profile),
        max: live.current.scale,
        width: LINE_WIDTH,
        opacity: 0.75,
        halo: GLOW_WIDTH,
        haloOpacity: 0.11,
        ramp: RAMP_STOPS,
        unreachedColor: 'rgba(140, 140, 140, 0.4)',
        fade: 0.1,
      });
      c.layer = layer;
      // Under the network: the colored streets stay visible across the buildings
      const buildings = new Buildings(map, engine, layer, layer);
      buildings.setVisible(live.current.perspective === 'buildings');
      c.buildings = buildings;
      if (net.lines.length) {
        const { lines, stations } = railFeatures(engine);
        c.rail = {
          lines: map.addLines<RailProps>({
            data: lines,
            color: (p) => p.color,
            width: [
              [11, 1.5],
              [15, 4],
            ],
          }),
          stations: map.addCircles<{ color: string }>({
            data: stations,
            color: '#fff',
            radius: [
              [10, 1.5],
              [12, 2.6],
              [15, 5],
            ],
            strokeColor: (p) => p.color,
            strokeWidth: [
              [12, 1.2],
              [15, 2],
            ],
          }),
        };
      }
      // Around the region, over everything but the trip: the world with the region as a hole
      const zoneMask = map.addFills({
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              WORLD,
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
        color: '#000',
        opacity: 0.12,
      });
      zoneMask.moveBefore(undefined);

      const cutLayer = new CutLayer(map, engine);
      cutLayer.rail = c.rail?.lines;
      cutLayer.addLayers();
      // The trip: a casing and the line, on top; hidden while there is none
      const routeCasing = map.addLines({ data: [], color: '#fff', width: 9, visible: false });
      routeCasing.moveBefore(undefined);
      // A color the time ramp never takes: the route stands out over green and red streets alike
      const route = map.addLines({ data: [], color: ROUTE_COLOR, width: 5, visible: false });
      route.moveBefore(undefined);

      c.setProfile = () => {
        layer.setCosts(networkCosts(net, engine.profile));
        // The rail lines drawn on the ground show in transit mode only
        const transit = engine.profile.mode === 'transit';
        c.rail?.lines.setVisible(transit);
        c.rail?.stations.setVisible(transit);
      };
      c.setProfile();

      const originMarker = new Marker({ element: markerElement('origin-marker'), draggable: true });
      // Pinned where the drag ends: each step of the drag would otherwise ask for an address, a route and a comparison
      originMarker.on('dragend', ({ lonLat }) => live.current.onPin(lonLat));
      const labelEl = markerElement('time-label');
      const label = new Marker({ element: labelEl, anchor: 'bottom', offset: [0, -14] });

      const setRoute = (coords: LngLat[] | undefined) => {
        const shown = !!coords && coords.length > 1;
        if (shown) {
          const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords } };
          routeCasing.setData(data);
          route.setData(data);
        }
        routeCasing.setVisible(shown);
        route.setVisible(shown);
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

      // One run at a time: moves made meanwhile collapse into one run from the latest position, and the map keeps
      // showing the last result until the next one is ready. A short run is made on the main thread, right in the hover
      // handler, which the map calls in the frame it draws: the times of a move are drawn by that very frame. A long one
      // goes to the worker (the map stays fluid, the times come a frame later).
      const runs: { busy: boolean; dirty: boolean; shown?: Result } = { busy: false, dirty: false };
      const show = (r: Result | undefined, cursor: [number, number], cursorAt: number | undefined) => {
        // A run that ends after the map is gone (another region): its engine's buffers are not this map's
        if (disposed) return;
        if (r) {
          perf.record('run', r.runMs);
          c.lastRunMs = r.runMs;
          c.runOnMain = !!r.inline;
        }
        perf.time('apply', () => apply(r, cursor));
        perf.update(cursorAt);
        // The times are on the graphics card: the buffers can go back to the engine
        if (runs.shown && runs.shown !== r) engine.recycle(runs.shown);
        runs.shown = r;
      };
      const process = () => {
        c.frame = 0;
        if (disposed) return;
        if (runs.busy) {
          runs.dirty = true;

          return;
        }

        const pin = live.current.pinned;
        const cursor: [number, number] = c.cursor ?? toRel(pin ?? live.current.camera.center);
        const cursorAt = c.cursorAt;
        const sent = performance.now();
        // The predecessors only with a pinned point: the trip to it is traced
        const options = { paths: !!pin };
        if (engine.canRunNow && c.lastRunMs < MAIN_THREAD_MS) {
          const r = engine.runNow(cursor[0], cursor[1], live.current.scale, options);
          perf.record('roundTrip', performance.now() - sent);
          show(r, cursor, cursorAt);

          return;
        }

        runs.busy = true;
        engine
          .run(cursor[0], cursor[1], live.current.scale, options)
          .then((r) => {
            perf.record('roundTrip', performance.now() - sent);
            show(r, cursor, cursorAt);
          })
          .catch((error: unknown) => {
            // The worker failed: the map keeps its last colors, and the next runs go to the main thread if they can
            console.error(error);
            c.lastRunMs = 0;
          })
          .finally(() => {
            runs.busy = false;
            // A move came meanwhile: its run starts right away, without waiting for a frame
            if (runs.dirty) {
              runs.dirty = false;
              runNow();
            }
          });
      };

      /** Shows a result: network colors, figures, and the trip to the anchored point */
      const firstFrame = { done: false };
      const unreached = new Float32Array(net.nodeCount).fill(1e30);
      /** The max time the network and the buildings are styled for: restyling every building costs, once per change */
      let styledScale: number | undefined;
      const apply = (r: Result | undefined, cursor: [number, number]) => {
        const { scale: s, pinned: pin } = live.current;
        if (s !== styledScale) {
          styledScale = s;
          layer.setStyle({ max: s });
          buildings.setScale(s);
        }
        // The colors always follow the cursor: from it (departure) or towards it (arrival); the buildings read the
        // same times on the graphics card. Off the network, all of it unreached (grey)
        layer.setValues(r?.times.length ? r.times : unreached);

        // The first result drawn (even an empty one, a point off the network): the startup screen can go
        if (!firstFrame.done) {
          firstFrame.done = true;
          const off = map.on('render', () => {
            off();
            live.current.onFirstFrame();
          });
        }

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
        label.setLonLat(pin);
        if (!label.getElement().isConnected) label.addTo(map);
        if (!r || !at || at.seconds > s) {
          labelEl.textContent = at ? `> ${formatMinutes(s / 60)}` : t.outsideZone(MAX_SNAP_METRES);
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
      /** The run for the latest cursor position, now rather than at the next frame: its times can make that frame */
      function runNow() {
        cancelAnimationFrame(c.frame);
        process();
      }
      c.refresh = () => {
        const pin = live.current.pinned;
        if (pin) {
          originMarker.setLonLat(pin);
          // The anchored point is the end the map is not computed from
          originMarker.getElement().setAttribute('data-label', engine.profile.direction === 'departure' ? t.arrival : t.departure);
          if (!originMarker.getElement().isConnected) originMarker.addTo(map);
          if (c.cursor && !label.getElement().isConnected) label.setLonLat(toLngLat(c.cursor)).addTo(map);
        } else {
          originMarker.remove();
          label.remove();
          setRoute(undefined);
        }
        schedule();
      };

      c.drawCuts = () => cutLayer.draw(live.current.cuts);
      c.clearHover = () => cutLayer.clearHover();

      c.freeze = () => {
        const pin = live.current.pinned;
        if (pin) c.cursor = toRel(pin);
        schedule();
      };

      cleanup.push(
        map.on('hover', ({ point, lonLat }) => {
          if (!lonLat) return;
          // Cut mode: the cursor picks sections, the origin of the map stays where it was
          if (live.current.cutMode) return cutLayer.hoverAt(point, lonLat);

          c.cursor = toRel(lonLat);
          c.cursorAt = performance.now();
          runNow();
          clearTimeout(c.settleTimer);
          c.settleTimer = setTimeout(() => live.current.onSettle(live.current.pinned ? lonLat : undefined), SETTLE_MS);
        }),
        map.on('leave', () => clearTimeout(c.settleTimer)),
        // The widest view stays the same distance across, whatever the width of the window
        map.on('resize', ({ width }) => map.setMinZoom(minZoomFor(width, map.getCamera().center[1]))),
        map.on('moveend', (camera) => live.current.onCamera({ ...camera })),
        map.on('click', ({ lonLat }) => {
          if (!live.current.cutMode) return lonLat && live.current.onPin(lonLat);
          const { hovered } = cutLayer;
          if (!hovered) return;

          live.current.onCutToggle(hovered.cut);
          cutLayer.clearHover();
        }),
      );

      live.current.onMapLoad();
      c.drawCuts();
      c.ready = true;
      c.refresh();
      const gpu = gpuName(map.getCanvas());
      let loading = true;
      cleanup.push(
        map.on('idle', () => {
          loading = false;
        }),
        map.on('movestart', () => {
          loading = true;
        }),
      );
      perf.setProbe(() => {
        const canvas = map.getCanvas();
        const stats = layer.stats();

        return {
          gpu,
          canvas: [canvas.width, canvas.height],
          dpr: window.devicePixelRatio || 1,
          zoom: map.getCamera().zoom,
          tilesLoading: loading,
          segments: stats?.pieces ?? 0,
          drawnSegments: stats?.drawn ?? 0,
          engineOnMain: c.runOnMain,
          buildingTiles: buildings.tileCount,
        };
      });
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(c.frame);
      // The next map schedules its own frames: a stale id would keep it from asking one
      c.frame = 0;
      clearTimeout(c.settleTimer);
      clearTimeout(c.panelTimer);
      for (const off of cleanup) off();
      perf.setProbe(undefined);
      // Its tile worker and its GPU objects go with the map (another region, another engine)
      c.buildings?.destroy();
      c.map?.destroy();
      c.map = undefined;
      c.layer = undefined;
      c.buildings = undefined;
      c.rail = undefined;
      c.ready = false;
    };
    // The map is created once per engine; later props go through `live` and the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Profile (mode, direction, bus, hour, model) or bound changed: new costs, new run
  useEffect(() => {
    const c = ctl.current;
    // The first run of the new settings goes to the worker: it tells how long they take
    c.lastRunMs = Infinity;
    if (c.ready) {
      c.setProfile();
      c.refresh();
    }
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
    const { zoom } = map.getCamera();
    // The buildings exist from zoom 15 only: the building view zooms in to them
    map.easeTo({ ...(tilted ? TILT : { pitch: 0, bearing: 0 }), zoom: perspective === 'buildings' ? Math.max(zoom, BUILDINGS_ZOOM) : zoom }, 900);
  }, [engine, perspective]);

  useEffect(() => {
    const c = ctl.current;
    if (c.ready) c.refresh();
  }, [pinned]);

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
    positionMarker.current.setLonLat(focus.point).addTo(map);
    map.flyTo({ center: focus.point, zoom: Math.max(map.getCamera().zoom, 14) }, { duration: 1200 });
  }, [focus]);

  return <Box ref={containerRef} className={cutMode ? 'map cutting' : 'map'} />;
};

export default MapView;
