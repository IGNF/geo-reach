import { CONTOURS, type Direction, type LngLat, MAX_SCALE, type Mode } from './config';

export interface ViewState {
  /** Pinned origin; undefined: the origin follows the cursor */
  pinned?: LngLat;
  mode: Mode;
  direction: Direction;
  bus: boolean;
  /** Minutes */
  scale: number;
  /** Minutes */
  contours: number[];
}

export const DEFAULT_STATE: ViewState = {
  mode: 'pedestrian',
  direction: 'departure',
  bus: false,
  scale: 30,
  contours: [15],
};

const MODES: Mode[] = ['transit', 'pedestrian', 'car'];

/** `#mode/direction/scale/contours/bus/lng,lat`, so that a shared link opens the same view */
export const readUrlState = (): ViewState => {
  const [mode, direction, scale, contours, bus, pin] = window.location.hash.slice(1).split('/');
  const m = MODES.includes(mode as Mode) ? (mode as Mode) : DEFAULT_STATE.mode;
  const p = pin?.split(',').map(Number);

  return {
    mode: m,
    direction: direction === 'arrival' ? 'arrival' : 'departure',
    scale: Number(scale) > 0 ? Math.min(Number(scale), MAX_SCALE[m]) : DEFAULT_STATE.scale,
    contours: contours
      ? contours
          .split(',')
          .map(Number)
          .filter((c) => (CONTOURS as readonly number[]).includes(c))
      : DEFAULT_STATE.contours,
    bus: bus === 'bus',
    pinned: p?.length === 2 && p.every(Number.isFinite) ? (p as LngLat) : undefined,
  };
};

export const urlHash = ({ mode, direction, scale, contours, bus, pinned }: ViewState) =>
  `#${mode}/${direction}/${scale}/${contours.join(',')}/${bus ? 'bus' : 'nobus'}/${
    pinned ? pinned.map((v) => v.toFixed(5)).join(',') : ''
  }`;
