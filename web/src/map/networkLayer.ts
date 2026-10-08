import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { RAMP_LUT } from '../lib/colors';
import { EDGE_RIDE, EDGE_ROAD, FLAG_BUS, type Network } from '../engine/network';
import type { Profile } from '../engine/profile';

/**
 * The network colored by travel time, drawn by the GPU. The geometry (one instanced quad per segment) is uploaded
 * when the profile changes; on every cursor move only the node times are uploaded (a float texture, ~130 KB), and
 * the shader works out the time of each segment end: min(t(A) + cost from A, t(B) + cost from B).
 *
 * Two passes: a wide, soft glow that reads as a heat map, then the crisp lines.
 */

const TEX_WIDTH = 2048;
const BIG = 1e9;
const EARTH = 2 * Math.PI * 6378137;

const VERTEX = `#version 300 es
in vec2 a_corner;
in vec4 a_seg;
in vec3 a_nodes;
in vec4 a_cost;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_width;
uniform sampler2D u_times;
out float v_t;
out float v_side;
out float v_style;

float nodeTime(float i) {
  int k = int(i);
  return texelFetch(u_times, ivec2(k % ${TEX_WIDTH}, k / ${TEX_WIDTH}), 0).r;
}

void main() {
  vec4 c0 = u_matrix * vec4(a_seg.xy, 0.0, 1.0);
  vec4 c1 = u_matrix * vec4(a_seg.zw, 0.0, 1.0);
  vec2 half_vp = u_viewport * 0.5;
  vec2 s0 = c0.xy / c0.w * half_vp;
  vec2 s1 = c1.xy / c1.w * half_vp;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float tA = nodeTime(a_nodes.x);
  float tB = nodeTime(a_nodes.y);
  bool atStart = a_corner.x < 0.5;
  float w = u_width * (a_nodes.z > 0.5 ? 1.8 : 1.0);
  vec4 c = atStart ? c0 : c1;
  vec2 s = (atStart ? s0 : s1) + normal * a_corner.y * w * 0.5 + dir * (atStart ? -0.5 : 0.5) * w;
  gl_Position = vec4(s / half_vp * c.w, c.z, c.w);
  v_t = atStart ? min(tA + a_cost.x, tB + a_cost.y) : min(tA + a_cost.z, tB + a_cost.w);
  v_side = a_corner.y;
  v_style = a_nodes.z;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in float v_t;
in float v_side;
in float v_style;
uniform float u_scale;
uniform float u_alpha;
uniform float u_soft;
uniform vec4 u_contours;
uniform sampler2D u_ramp;
out vec4 color;

void main() {
  if (!(v_t <= u_scale)) {
    // Beyond the max time: the glow stops, the lines of the mode's network stay, in grey
    if (u_soft > 0.5) discard;
    float a = 0.4 * smoothstep(0.0, 0.45, 1.0 - abs(v_side));
    color = vec4(vec3(0.55) * a, a);
    return;
  }
  vec3 rgb = texture(u_ramp, vec2(clamp(v_t / u_scale, 0.0, 1.0), 0.5)).rgb;
  float edge = 1.0 - abs(v_side);
  float a = u_soft > 0.5 ? u_alpha * edge * edge : u_alpha * smoothstep(0.0, 0.45, edge);
  a *= 1.0 - smoothstep(u_scale * 0.9, u_scale, v_t);
  if (u_soft < 0.5) {
    // Isochrone fronts: the network darkens where the time crosses a chosen duration
    vec4 gap = abs(vec4(v_t) - u_contours);
    float front = (u_contours.x > 0.0 && gap.x < 20.0) || (u_contours.y > 0.0 && gap.y < 20.0)
      || (u_contours.z > 0.0 && gap.z < 20.0) || (u_contours.w > 0.0 && gap.w < 20.0) ? 1.0 : 0.0;
    rgb = mix(rgb, vec3(0.08), front * 0.85);
  }
  color = vec4(rgb * a, a);
}`;

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');

  return shader;
};

export interface NetworkStyle {
  /** Longest time shown, seconds */
  scale: number;
  /** Up to 4 durations drawn as fronts, seconds */
  contours: number[];
}

export class NetworkLayer implements CustomLayerInterface {
  readonly id = 'network';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private map?: MlMap;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private geomBuffer?: WebGLBuffer;
  private costBuffer?: WebGLBuffer;
  private cornerBuffer?: WebGLBuffer;
  private timesTex?: WebGLTexture;
  private rampTex?: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private instances = 0;
  private readonly texHeight: number;
  private readonly times: Float32Array;
  private pending?: { geom: Float32Array; cost: Float32Array; count: number };
  private style: NetworkStyle = { scale: 2700, contours: [] };
  private hasTimes = false;

  private readonly net: Network;

  constructor(net: Network) {
    this.net = net;
    this.texHeight = Math.ceil(net.nodeCount / TEX_WIDTH);
    this.times = new Float32Array(TEX_WIDTH * this.texHeight).fill(Number.POSITIVE_INFINITY);
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    this.program = program;
    for (const name of ['u_matrix', 'u_viewport', 'u_width', 'u_times', 'u_scale', 'u_alpha', 'u_soft', 'u_contours', 'u_ramp'])
      this.uniforms[name] = gl.getUniformLocation(program, name);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    // Two triangles: (end, side)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, 'a_corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    this.geomBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer);
    const seg = gl.getAttribLocation(program, 'a_seg');
    const nodes = gl.getAttribLocation(program, 'a_nodes');
    gl.enableVertexAttribArray(seg);
    gl.vertexAttribPointer(seg, 4, gl.FLOAT, false, 28, 0);
    gl.vertexAttribDivisor(seg, 1);
    gl.enableVertexAttribArray(nodes);
    gl.vertexAttribPointer(nodes, 3, gl.FLOAT, false, 28, 16);
    gl.vertexAttribDivisor(nodes, 1);

    this.costBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.costBuffer);
    const cost = gl.getAttribLocation(program, 'a_cost');
    gl.enableVertexAttribArray(cost);
    gl.vertexAttribPointer(cost, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(cost, 1);
    gl.bindVertexArray(null);

    this.timesTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.timesTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, TEX_WIDTH, this.texHeight, 0, gl.RED, gl.FLOAT, this.times);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);

    const ramp = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i += 1) ramp.set([RAMP_LUT[i * 3], RAMP_LUT[i * 3 + 1], RAMP_LUT[i * 3 + 2], 255], i * 4);
    this.rampTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    this.flush();
  }

  /** Segments of the edges the profile travels, with the cost of reaching each end from A and from B */
  setProfile(profile: Profile) {
    const { net } = this;
    const { fwd, bwd, direction } = profile;
    const sx = 1 / EARTH;
    const drawn = (e: number) => {
      const kind = net.edgeKind[e];

      return (kind === EDGE_ROAD || kind === EDGE_RIDE) && (fwd[e] < Infinity || bwd[e] < Infinity);
    };
    // Typed arrays sized first: over a million segments for the whole region
    let count = 0;
    for (let e = 0; e < net.edgeCount; e += 1)
      if (drawn(e)) count += Math.max(0, net.coordStart[e + 1] - net.coordStart[e] - 1);
    const geom = new Float32Array(count * 7);
    const cost = new Float32Array(count * 4);
    let k = 0;
    for (let e = 0; e < net.edgeCount; e += 1) {
      if (!drawn(e)) continue;
      const [s, t] = [net.coordStart[e], net.coordStart[e + 1]];
      if (t - s < 2) continue;
      let total = 0;
      for (let p = s + 1; p < t; p += 1)
        total += Math.hypot(net.coords[p * 2] - net.coords[p * 2 - 2], net.coords[p * 2 + 1] - net.coords[p * 2 - 1]);
      const f1 = Math.min(fwd[e], BIG);
      const b1 = Math.min(bwd[e], BIG);
      // Departure: reach a point at f from A forwards, from B backwards. Arrival: leave it towards A or B.
      const [fromA, fromB] = direction === 'departure' ? [f1, b1] : [b1, f1];
      const style = net.edgeKind[e] === EDGE_RIDE ? (net.edgeFlags[e] & FLAG_BUS ? 0 : 1) : 0;
      let along = 0;
      for (let p = s; p < t - 1; p += 1, k += 1) {
        const [x0, y0, x1, y1] = [net.coords[p * 2], net.coords[p * 2 + 1], net.coords[p * 2 + 2], net.coords[p * 2 + 3]];
        const fa = total > 0 ? along / total : 0;
        along += Math.hypot(x1 - x0, y1 - y0);
        const fb = total > 0 ? along / total : 1;
        geom.set([x0 * sx, -y0 * sx, x1 * sx, -y1 * sx, net.edgeA[e], net.edgeB[e], style], k * 7);
        cost.set([fa * fromA, (1 - fa) * fromB, fb * fromA, (1 - fb) * fromB], k * 4);
      }
    }
    this.pending = { geom, cost, count: k };
    this.flush();
  }

  /** Node times of the latest run (seconds); undefined hides the layer */
  setTimes(dist: Float32Array | undefined) {
    if (dist) this.times.set(dist);
    this.hasTimes = !!dist;
    const { gl } = this;
    if (gl && dist) {
      gl.bindTexture(gl.TEXTURE_2D, this.timesTex ?? null);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_WIDTH, this.texHeight, gl.RED, gl.FLOAT, this.times);
    }
    this.map?.triggerRepaint();
  }

  setStyle(style: NetworkStyle) {
    this.style = style;
    this.map?.triggerRepaint();
  }

  private flush() {
    const { gl, pending } = this;
    if (!gl || !pending) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer ?? null);
    gl.bufferData(gl.ARRAY_BUFFER, pending.geom, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.costBuffer ?? null);
    gl.bufferData(gl.ARRAY_BUFFER, pending.cost, gl.STATIC_DRAW);
    this.instances = pending.count;
    this.pending = undefined;
    this.map?.triggerRepaint();
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.program || !this.instances || !this.hasTimes || !this.map) return;
    // Relative to the zone centre: the model matrix carries the large offset in double precision
    // Mercator 0..1 to clip space, in 64 bit floats
    const m = args.defaultProjectionData.mainMatrix;
    const [ox, oy] = this.net.origin;
    const tx = 0.5 + ox / EARTH;
    const ty = 0.5 - oy / EARTH;
    const matrix = new Float32Array(16);
    for (let i = 0; i < 16; i += 1) matrix[i] = m[i];
    for (let i = 0; i < 4; i += 1) matrix[12 + i] = m[i] * tx + m[4 + i] * ty + m[12 + i];

    const dpr = window.devicePixelRatio || 1;
    const zoom = this.map.getZoom();
    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao ?? null);
    gl.uniformMatrix4fv(u.u_matrix, false, matrix);
    gl.uniform2f(u.u_viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.timesTex ?? null);
    gl.uniform1i(u.u_times, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rampTex ?? null);
    gl.uniform1i(u.u_ramp, 1);
    gl.uniform1f(u.u_scale, this.style.scale);
    const c = [...this.style.contours, 0, 0, 0, 0].slice(0, 4);
    gl.uniform4f(u.u_contours, c[0], c[1], c[2], c[3]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    // Glow, wider when zoomed out so the colors fill the blocks between streets
    gl.uniform1f(u.u_width, Math.max(10, 46 - (zoom - 12) * 9) * dpr);
    gl.uniform1f(u.u_alpha, 0.11);
    gl.uniform1f(u.u_soft, 1);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instances);
    // Lines
    gl.uniform1f(u.u_width, Math.min(5, Math.max(1.2, (zoom - 11) * 1.1)) * dpr);
    gl.uniform1f(u.u_alpha, 0.75);
    gl.uniform1f(u.u_soft, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instances);
    gl.bindVertexArray(null);
  }
}
