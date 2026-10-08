import { DEFAULT_MODEL, type ModelOptions } from '../engine/profile';
import { type Direction, type LngLat, MAX_SCALE, type Mode } from './config';

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
}

export const DEFAULT_STATE: ViewState = {
  mode: 'pedestrian',
  direction: 'departure',
  bus: false,
  hour: 8,
  scale: 30,
  contours: true,
  model: DEFAULT_MODEL,
};

/** `walk,bike,traffic,wait,transfer,scenario`, e.g. `4,15,e,h,1.5,n` */
const readModel = (text: string | undefined): ModelOptions => {
  const [walk, bike, traffic, wait, transfer, scenario] = text?.split(',') ?? [];
  const num = (v: string | undefined, min: number, max: number, fallback: number) =>
    Number(v) >= min && Number(v) <= max ? Number(v) : fallback;

  return {
    walkKmh: num(walk, 2, 7, DEFAULT_MODEL.walkKmh),
    bikeKmh: num(bike, 8, 30, DEFAULT_MODEL.bikeKmh),
    traffic: traffic === 'f' ? 'free' : 'estimated',
    wait: wait === 'f' ? 'full' : 'half',
    transferMin: num(transfer, 0, 10, DEFAULT_MODEL.transferMin),
    scenario: scenario === 'd' ? 'disrupted' : scenario === 's' ? 'severe' : 'normal',
  };
};

const writeModel = (m: ModelOptions) =>
  [m.walkKmh, m.bikeKmh, m.traffic === 'free' ? 'f' : 'e', m.wait === 'full' ? 'f' : 'h', m.transferMin, m.scenario[0]].join(',');

const MODES: Mode[] = ['transit', 'pedestrian', 'bike', 'car'];

/** `#mode/direction/scale/contours/bus/lng,lat/hour/model`, so that a shared link opens the same view */
export const readUrlState = (): ViewState => {
  const [mode, direction, scale, contours, bus, pin, hour, model] = window.location.hash.slice(1).split('/');
  const m = MODES.includes(mode as Mode) ? (mode as Mode) : DEFAULT_STATE.mode;
  const p = pin?.split(',').map(Number);

  return {
    mode: m,
    direction: direction === 'arrival' ? 'arrival' : 'departure',
    scale: Number(scale) > 0 ? Math.min(Number(scale), MAX_SCALE[m]) : DEFAULT_STATE.scale,
    contours: contours !== 'off',
    bus: bus === 'bus',
    hour: hour !== undefined && Number(hour) >= 0 && Number(hour) < 24 ? Math.floor(Number(hour)) : DEFAULT_STATE.hour,
    pinned: p?.length === 2 && p.every(Number.isFinite) ? (p as LngLat) : undefined,
    model: readModel(model),
  };
};

export const urlHash = ({ mode, direction, scale, contours, bus, pinned, hour, model }: ViewState) =>
  `#${mode}/${direction}/${scale}/${contours ? 'on' : 'off'}/${bus ? 'bus' : 'nobus'}/${
    pinned ? pinned.map((v) => v.toFixed(5)).join(',') : ''
  }/${hour}/${writeModel(model)}`;
