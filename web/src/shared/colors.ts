import type { Direction } from '@/shared/config';

/**
 * Travel time ramp, near (green) to far: yellow, orange, red as in the reference dataviz, then crimson and violet for
 * the last minutes, so that the far end reads apart from the middle reds
 */
const STOPS: [number, [number, number, number]][] = [
  [0, [26, 152, 80]],
  [0.18, [102, 189, 99]],
  [0.36, [254, 224, 139]],
  [0.52, [253, 174, 97]],
  [0.68, [215, 48, 39]],
  [0.84, [165, 0, 80]],
  [1, [106, 27, 154]],
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const rampAt = (t: number): [number, number, number] => {
  const x = Math.min(1, Math.max(0, t));
  const i = STOPS.findIndex(([s]) => s >= x);
  if (i <= 0) return STOPS[0][1];
  const [s0, c0] = STOPS[i - 1];
  const [s1, c1] = STOPS[i];
  const k = (x - s0) / (s1 - s0);

  return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
};

/** 256 RGB entries, read in the per pixel loop */
export const RAMP_LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) lut.set(rampAt(i / 255).map(Math.round), i * 3);

  return lut;
})();

/** Arrival maps run the ramp the other way round, so that the two directions never read alike */
const oriented = (t: number, direction: Direction): number => (direction === 'arrival' ? 1 - t : t);

export const rampCss = (t: number, direction: Direction = 'departure'): string => {
  const [r, g, b] = rampAt(oriented(t, direction)).map(Math.round);

  return `rgb(${r}, ${g}, ${b})`;
};

/** The ramp as stops for the map layers: fraction of the max time, CSS color */
export const rampStops = (direction: Direction = 'departure'): [number, string][] => {
  const stops: [number, string][] = STOPS.map(([s, [r, g, b]]) => [oriented(s, direction), `rgb(${r}, ${g}, ${b})`]);

  return direction === 'arrival' ? stops.reverse() : stops;
};

export const rampGradientCss = (direction: Direction = 'departure'): string =>
  `linear-gradient(90deg, ${rampStops(direction)
    .map(([s, c]) => `${c} ${s * 100}%`)
    .join(', ')})`;
