import { type Cut, cutKey, parseCut } from '@/engine/cuts';
import { DEFAULT_MODEL, type ModelOptions } from '@/engine/profile';
import { type Direction, type LngLat, MAX_SCALE, type Mode } from '@/lib/config';

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
  /** Contour lines every 10 or 15 min */
  contours: boolean;
  /** Assumptions of the travel time model */
  model: ModelOptions;
  /** Closed sections (what-if) */
  cuts: Cut[];
}

export const DEFAULT_STATE: ViewState = {
  mode: 'transit',
  direction: 'departure',
  bus: false,
  hour: 8,
  scale: 30,
  contours: true,
  model: DEFAULT_MODEL,
  cuts: [],
};

/** `walk,bike,traffic,wait,transfer,scenario,relief`, e.g. `4,15,e,h,1.5,n,r` (`f` flat ground) */
const readModel = (text: string | undefined): ModelOptions => {
  const [walk, bike, traffic, wait, transfer, scenario, relief] = text?.split(',') ?? [];
  const num = (v: string | undefined, min: number, max: number, fallback: number) =>
    Number(v) >= min && Number(v) <= max ? Number(v) : fallback;

  return {
    walkKmh: num(walk, 2, 7, DEFAULT_MODEL.walkKmh),
    bikeKmh: num(bike, 8, 30, DEFAULT_MODEL.bikeKmh),
    traffic: traffic === 'f' ? 'free' : 'estimated',
    wait: wait === 'f' ? 'full' : 'half',
    transferMin: num(transfer, 0, 10, DEFAULT_MODEL.transferMin),
    scenario: scenario === 'd' ? 'disrupted' : scenario === 's' ? 'severe' : 'normal',
    relief: relief !== 'f',
  };
};

const writeModel = (m: ModelOptions) =>
  [m.walkKmh, m.bikeKmh, m.traffic === 'free' ? 'f' : 'e', m.wait === 'full' ? 'f' : 'h', m.transferMin, m.scenario[0], m.relief ? 'r' : 'f'].join(',');

const MODES: readonly Mode[] = ['transit', 'pedestrian', 'bike', 'car'];

const isMode = (value: string | undefined): value is Mode => MODES.some((m) => m === value);

/** `#mode/direction/scale/contours/bus/lng,lat/hour/model/cuts`, so that a shared link opens the same view */
export const readUrlState = (): ViewState => {
  const [mode, direction, scale, contours, bus, pin, hour, model, cuts] = window.location.hash.slice(1).split('/');
  const m = isMode(mode) ? mode : DEFAULT_STATE.mode;
  const p = pin?.split(',').map(Number);

  return {
    mode: m,
    direction: direction === 'arrival' ? 'arrival' : 'departure',
    scale: Number(scale) > 0 ? Math.min(Number(scale), MAX_SCALE[m]) : DEFAULT_STATE.scale,
    contours: contours !== 'off',
    bus: bus === 'bus',
    hour: hour !== undefined && Number(hour) >= 0 && Number(hour) < 24 ? Math.floor(Number(hour)) : DEFAULT_STATE.hour,
    pinned: p?.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : undefined,
    model: readModel(model),
    cuts: (cuts ?? '').split(',').flatMap((k) => parseCut(k) ?? []),
  };
};

export const urlHash = ({ mode, direction, scale, contours, bus, pinned, hour, model, cuts }: ViewState): string =>
  `#${mode}/${direction}/${scale}/${contours ? 'on' : 'off'}/${bus ? 'bus' : 'nobus'}/${
    pinned ? pinned.map((v) => v.toFixed(5)).join(',') : ''
  }/${hour}/${writeModel(model)}${cuts.length ? `/${cuts.map(cutKey).join(',')}` : ''}`;
