/** Box `[minX, minY, maxX, maxY]` */
export type Bounds = [number, number, number, number];

/** A box that contains nothing yet: any point extends it */
export const emptyBounds = (): Bounds => [Infinity, Infinity, -Infinity, -Infinity];

export const extendBounds = (b: Bounds, x: number, y: number): void => {
  b[0] = Math.min(b[0], x);
  b[1] = Math.min(b[1], y);
  b[2] = Math.max(b[2], x);
  b[3] = Math.max(b[3], y);
};

/** Box of interleaved points `x0, y0, x1, y1…` */
export const pointsBounds = (xy: ArrayLike<number>): Bounds => {
  const b = emptyBounds();
  for (let i = 0; i < xy.length; i += 2) extendBounds(b, xy[i], xy[i + 1]);

  return b;
};
