/** Travel time ramp, near (green) to far (dark red), as in the reference dataviz */
const STOPS: [number, [number, number, number]][] = [
  [0, [26, 152, 80]],
  [0.22, [102, 189, 99]],
  [0.42, [254, 224, 139]],
  [0.62, [253, 174, 97]],
  [0.8, [215, 48, 39]],
  [1, [165, 0, 38]],
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

export const rampCss = (t: number) => {
  const [r, g, b] = rampAt(t).map(Math.round);

  return `rgb(${r}, ${g}, ${b})`;
};

export const RAMP_GRADIENT_CSS = `linear-gradient(90deg, ${STOPS.map(([s]) => `${rampCss(s)} ${s * 100}%`).join(', ')})`;
