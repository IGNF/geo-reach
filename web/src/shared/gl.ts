import type { CustomRenderMethodInput } from 'maplibre-gl';
import { RAMP_LUT } from '@/shared/colors';

/** The WebGL pieces the custom layers share (the network, the buildings) */

const EARTH = 2 * Math.PI * 6378137;

/** Width of the node times texture: node n is at (n % TIMES_WIDTH, n / TIMES_WIDTH) */
export const TIMES_WIDTH = 2048;

/** Where a zone sits in the 0..1 Mercator world, from its origin in Mercator metres: positions are drawn relative to it */
export const zoneOrigin = ([ox, oy]: readonly [number, number]): { tx: number; ty: number } => ({
  tx: 0.5 + ox / EARTH,
  ty: 0.5 - oy / EARTH,
});

/**
 * MapLibre's Mercator 0..1 to clip space matrix, moved to the zone origin: the large offset is applied here in 64-bit
 * floats, so that the 32-bit positions relative to the zone keep their precision
 */
export const zoneMatrix = (args: CustomRenderMethodInput, origin: readonly [number, number]): Float32Array => {
  const m = args.defaultProjectionData.mainMatrix;
  const { tx, ty } = zoneOrigin(origin);
  const matrix = new Float32Array(16);
  for (let i = 0; i < 16; i += 1) matrix[i] = m[i];
  for (let i = 0; i < 4; i += 1) matrix[12 + i] = m[i] * tx + m[4 + i] * ty + m[12 + i];

  return matrix;
};

/** Ramp texture of the travel time colors, 256 × 1 */
export const rampTexture = (gl: WebGL2RenderingContext): WebGLTexture => {
  const ramp = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) ramp.set([RAMP_LUT[i * 3], RAMP_LUT[i * 3 + 1], RAMP_LUT[i * 3 + 2], 255], i * 4);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

  return tex;
};

const compile = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');

  return shader;
};

/** A program from its two shaders, and the locations of its uniforms */
export const linkProgram = (
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
  uniforms: readonly string[],
): { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> } => {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');

  return { program, uniforms: Object.fromEntries(uniforms.map((name) => [name, gl.getUniformLocation(program, name)])) };
};
