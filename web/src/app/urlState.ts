import { type Cut, cutKey, parseCut } from '@/features/cuts';
import { DEFAULT_REGION, regionAt, regionById } from '@/features/regions';
import { DEFAULT_MODEL, type ModelOptions } from '@/features/routing';
import { type Camera, type Direction, type LngLat, MAX_SCALE, type Mode, PERSPECTIVES, type Perspective } from '@/shared/config';

export interface ViewState {
  /** Pinned origin; undefined: the origin follows the cursor */
  pinned?: LngLat;
  mode: Mode;
  direction: Direction;
  bus: boolean;
  /** Departure hour, 0–23 */
  hour: number;
  /** Minutes */
  scale: number;
  /** Assumptions of the travel time model */
  model: ModelOptions;
  /** Closed sections (what-if) */
  cuts: Cut[];
  /** Flat, or 3D buildings colored by time (the default) */
  perspective: Perspective;
  /** Region whose network is loaded (lib/regions.ts) */
  region: string;
  /** Where the map looks, kept when it stops moving: a reload opens there */
  camera?: Camera;
}

export const DEFAULT_STATE: ViewState = {
  mode: 'transit',
  direction: 'departure',
  bus: false,
  hour: 8,
  scale: 30,
  model: DEFAULT_MODEL,
  cuts: [],
  perspective: 'buildings',
  region: DEFAULT_REGION,
};

const MODES: readonly Mode[] = ['transit', 'pedestrian', 'bike', 'car'];

const isMode = (value: string | undefined): value is Mode => MODES.some((m) => m === value);

/** A number of the link within bounds, else the fallback */
const num = (v: string | null | undefined, min: number, max: number, fallback: number): number =>
  v !== null && v !== undefined && v !== '' && Number(v) >= min && Number(v) <= max ? Number(v) : fallback;

/** `lat,lng` (as on a map service), else undefined */
const readLatLng = (text: string | null | undefined): LngLat | undefined => {
  const [lat, lng] = text?.split(',').map(Number) ?? [];

  return lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : undefined;
};

const writeLatLng = ([lng, lat]: LngLat): string => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/** `zoom/lat/lng[/pitch/bearing]`, as OpenStreetMap writes its links */
const readCamera = (text: string | null): Camera | undefined => {
  const [zoom, lat, lng, pitch, bearing] = text?.split('/').map(Number) ?? [];
  if (![zoom, lat, lng].every((v) => v !== undefined && Number.isFinite(v))) return undefined;

  return { zoom: zoom ?? 0, center: [lng ?? 0, lat ?? 0], pitch: num(String(pitch), 0, 85, 0), bearing: num(String(bearing), -180, 180, 0) };
};

const writeCamera = ({ zoom, center: [lng, lat], pitch, bearing }: Camera): string => {
  const parts = [zoom.toFixed(2), lat.toFixed(5), lng.toFixed(5)];
  if (Math.round(pitch) || Math.round(bearing)) parts.push(String(Math.round(pitch)), String(Math.round(bearing)));

  return parts.join('/');
};

/**
 * `#map=15.6/48.84573/2.42457/45/-17&mode=car&max=15&cuts=s1962364`: the camera (zoom, latitude, longitude, tilt,
 * heading), then only what differs from the defaults, by name, so that a link reads and a shared one opens the same
 * view:
 *
 * | Key | Value | Default |
 * |---|---|---|
 * | `map` | zoom/lat/lng[/pitch/bearing] | the region's start |
 * | `mode` | transit, pedestrian, bike, car | transit |
 * | `max` | minutes | 30 |
 * | `hour` | departure hour, 0–23 | 8 |
 * | `to` | `1`: the map is computed towards the cursor (arrival) | departure |
 * | `bus` | `1`: buses too | metro, RER, train, tram |
 * | `pin` | lat,lng of the pinned point | none |
 * | `view` | `2d` | 3D buildings |
 * | `cuts` | closed sections, `s<edge>` or `r<line>.<station>.<station>` | none |
 * | `region` | id of the region loaded, when not the one of the map's centre | |
 * | `walk`, `bike`, `transfer` | km/h, km/h, minutes | 4, 15, 1.5 |
 * | `traffic` | `free` | estimated |
 * | `wait` | `full` (the whole headway) | half the headway |
 * | `scenario` | `disrupted`, `severe` | normal |
 * | `relief` | `off` (flat ground) | on |
 */
const readNamed = (hash: string): ViewState => {
  const q = new URLSearchParams(hash);
  const mode = q.get('mode') ?? undefined;
  const m = isMode(mode) ? mode : DEFAULT_STATE.mode;
  const camera = readCamera(q.get('map'));
  const scenario = q.get('scenario');

  return {
    mode: m,
    direction: q.get('to') === '1' ? 'arrival' : 'departure',
    scale: Math.min(num(q.get('max'), 5, 120, DEFAULT_STATE.scale), MAX_SCALE[m]),
    bus: q.get('bus') === '1',
    hour: Math.floor(num(q.get('hour'), 0, 23, DEFAULT_STATE.hour)),
    pinned: readLatLng(q.get('pin')),
    model: {
      walkKmh: num(q.get('walk'), 2, 7, DEFAULT_MODEL.walkKmh),
      bikeKmh: num(q.get('bike'), 8, 30, DEFAULT_MODEL.bikeKmh),
      traffic: q.get('traffic') === 'free' ? 'free' : 'estimated',
      wait: q.get('wait') === 'full' ? 'full' : 'half',
      transferMin: num(q.get('transfer'), 0, 10, DEFAULT_MODEL.transferMin),
      scenario: scenario === 'disrupted' || scenario === 'severe' ? scenario : 'normal',
      relief: q.get('relief') !== 'off',
    },
    cuts: (q.get('cuts') ?? '').split(',').flatMap((k) => parseCut(k) ?? []),
    perspective: q.get('view') === '2d' ? 'flat' : DEFAULT_STATE.perspective,
    // The region named, else the one of the map's centre, else of the pinned point
    region: regionById(q.get('region') ?? (camera && regionAt(camera.center)?.id) ?? (q.get('pin') && regionAt(readLatLng(q.get('pin')) ?? [0, 0])?.id) ?? undefined).id,
    camera,
  };
};

/** Links made before 2026-10-15: `#mode/direction/scale/-/bus/lng,lat/hour/walk,bike,traffic,wait,transfer,scenario,relief/cuts/view/region` */
const readPositional = (hash: string): ViewState => {
  const [mode, direction, scale, , bus, pin, hour, model, cuts, view, region] = hash.split('/');
  const m = isMode(mode) ? mode : DEFAULT_STATE.mode;
  const p = pin?.split(',').map(Number);
  const [walk, bike, traffic, wait, transfer, scenario, relief] = model?.split(',') ?? [];

  return {
    mode: m,
    direction: direction === 'arrival' ? 'arrival' : 'departure',
    scale: Number(scale) > 0 ? Math.min(Number(scale), MAX_SCALE[m]) : DEFAULT_STATE.scale,
    bus: bus === 'bus',
    hour: Math.floor(num(hour, 0, 23, DEFAULT_STATE.hour)),
    pinned: p?.length === 2 && p.every(Number.isFinite) ? [p[0] ?? 0, p[1] ?? 0] : undefined,
    model: {
      walkKmh: num(walk, 2, 7, DEFAULT_MODEL.walkKmh),
      bikeKmh: num(bike, 8, 30, DEFAULT_MODEL.bikeKmh),
      traffic: traffic === 'f' ? 'free' : 'estimated',
      wait: wait === 'f' ? 'full' : 'half',
      transferMin: num(transfer, 0, 10, DEFAULT_MODEL.transferMin),
      scenario: scenario === 'd' ? 'disrupted' : scenario === 's' ? 'severe' : 'normal',
      relief: relief !== 'f',
    },
    cuts: (cuts ?? '').split(',').flatMap((k) => parseCut(k) ?? []),
    perspective: PERSPECTIVES.find((v) => v === view) ?? DEFAULT_STATE.perspective,
    region: regionById(region).id,
  };
};

export const readUrlState = (): ViewState => {
  const hash = window.location.hash.slice(1);

  return hash.includes('=') || !hash ? readNamed(hash) : readPositional(hash);
};

export const urlHash = (v: ViewState): string => {
  const q = new URLSearchParams();
  const { model: m } = v;
  if (v.camera) q.set('map', writeCamera(v.camera));
  if (v.mode !== DEFAULT_STATE.mode) q.set('mode', v.mode);
  if (v.scale !== DEFAULT_STATE.scale) q.set('max', String(v.scale));
  if (v.hour !== DEFAULT_STATE.hour) q.set('hour', String(v.hour));
  if (v.direction === 'arrival') q.set('to', '1');
  if (v.bus) q.set('bus', '1');
  if (v.pinned) q.set('pin', writeLatLng(v.pinned));
  if (v.perspective === 'flat') q.set('view', '2d');
  if (v.cuts.length) q.set('cuts', v.cuts.map(cutKey).join(','));
  // The region, when the map's centre would not choose it (a region kept while the view crossed a border)
  if (v.region !== ((v.camera && regionAt(v.camera.center)?.id) ?? DEFAULT_STATE.region)) q.set('region', v.region);
  if (m.walkKmh !== DEFAULT_MODEL.walkKmh) q.set('walk', String(m.walkKmh));
  if (m.bikeKmh !== DEFAULT_MODEL.bikeKmh) q.set('bike', String(m.bikeKmh));
  if (m.transferMin !== DEFAULT_MODEL.transferMin) q.set('transfer', String(m.transferMin));
  if (m.traffic === 'free') q.set('traffic', 'free');
  if (m.wait === 'full') q.set('wait', 'full');
  if (m.scenario !== 'normal') q.set('scenario', m.scenario);
  if (!m.relief) q.set('relief', 'off');

  // Slashes and commas kept as they are: the link stays readable
  return `#${q.toString().replace(/%2F/g, '/').replace(/%2C/g, ',')}`;
};
