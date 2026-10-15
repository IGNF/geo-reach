import { linkProgram, rampTexture, TIMES_WIDTH, UNREACHED } from '@/shared/gl';
import { type Chunks, chunksOf, EARTH, type SegmentSource, type Segments } from './networkSegments';
import type { SegmentsRequest, SegmentsResult } from './segments.worker';
import type { Network, Profile } from '@/features/routing';

/**
 * The network colored by travel time, drawn by the GPU, whatever map library hosts it (MapLibre here): the host
 * gives its WebGL2 context, a matrix and a zoom, and redraws when asked. The geometry (one instanced quad per segment) is uploaded
 * when the profile changes; on every cursor move only the node times are uploaded (a float texture, ~130 KB), and
 * the shader works out the time of each segment end: min(t(A) + cost from A, t(B) + cost from B).
 *
 * Two passes: a wide, soft glow that reads as a heat map, then the crisp lines.
 */

/** Bytes per segment in the geometry and cost buffers */
const GEOM_STRIDE = 28;
const COST_STRIDE = 16;

const VERTEX = `#version 300 es
in vec2 a_corner;
in vec4 a_seg;
in vec3 a_nodes;
in vec4 a_cost;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_width;
uniform float u_scale;
uniform float u_soft;
uniform sampler2D u_times;
out float v_t;
out float v_side;
out float v_style;

float nodeTime(float i) {
  int k = int(i);
  return texelFetch(u_times, ivec2(k % ${TIMES_WIDTH}, k / ${TIMES_WIDTH}), 0).r;
}

void main() {
  float tA = nodeTime(a_nodes.x);
  float tB = nodeTime(a_nodes.y);
  float t0 = min(tA + a_cost.x, tB + a_cost.y);
  float t1 = min(tA + a_cost.z, tB + a_cost.w);

  vec4 c0 = u_matrix * vec4(a_seg.xy, 0.0, 1.0);
  vec4 c1 = u_matrix * vec4(a_seg.zw, 0.0, 1.0);
  vec2 half_vp = u_viewport * 0.5;
  vec2 s0 = c0.xy / c0.w * half_vp;
  vec2 s1 = c1.xy / c1.w * half_vp;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  bool atStart = a_corner.x < 0.5;
  float w = u_width * (a_nodes.z > 0.5 ? 1.8 : 1.0);
  vec4 c = atStart ? c0 : c1;
  vec2 s = (atStart ? s0 : s1) + normal * a_corner.y * w * 0.5 + dir * (atStart ? -0.5 : 0.5) * w;
  gl_Position = vec4(s / half_vp * c.w, c.z, c.w);
  // Glow pass: a segment beyond the max time at both ends draws nothing; moved out of the clip space, it costs no
  // pixel at all (over a million wide quads zoomed out would otherwise saturate the graphics card)
  if (u_soft > 0.5 && !(min(t0, t1) <= u_scale)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  v_t = atStart ? t0 : t1;
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
  color = vec4(rgb * a, a);
}`;

/** Inverse of a 4 × 4 matrix (column major), undefined if it has none */
const invert = (m: Float32Array): Float64Array | undefined => {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return undefined;
  const d = 1 / det;

  return Float64Array.from([
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ]);
};

export interface NetworkStyle {
  /** Longest time shown, seconds */
  scale: number;
}

export class NetworkRenderer {
  /** Called when the layer needs a new frame (new times, style or geometry) */
  onChange: () => void = () => undefined;
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
  /** Node times as the texture holds them: rows of TIMES_WIDTH, unreached nodes at UNREACHED */
  private times: Float32Array;
  /** Every node unreached: the network in grey, when the cursor is too far from any street */
  private readonly unreached: Float32Array;
  private pending?: Segments;
  /** Squares of the region (Mercator metres relative to the zone origin) the segments are sorted by */
  private readonly chunks: Chunks;
  private worker?: Worker;
  /** Id of the latest profile sent to the worker: older answers are dropped */
  private lastRequest = 0;
  /** Segments of square c: chunkStart[c] .. chunkStart[c + 1], in the buffers on the GPU */
  private chunkStart: Uint32Array = new Uint32Array(1);
  /** Segments drawn in the last frame */
  private drawnCount = 0;
  private attribs = { seg: -1, nodes: -1, cost: -1 };
  private style: NetworkStyle = { scale: 2700 };
  private hasTimes = false;
  /** Node times not yet uploaded */
  private timesDirty = false;

  private readonly net: Network;

  constructor(net: Network) {
    this.net = net;
    this.texHeight = Math.ceil(net.nodeCount / TIMES_WIDTH);
    this.unreached = new Float32Array(TIMES_WIDTH * this.texHeight).fill(UNREACHED);
    this.times = this.unreached;
    this.chunks = chunksOf(net.coords);
  }

  /** Creates the GPU resources in the host's context */
  attach(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    const { program, uniforms } = linkProgram(gl, VERTEX, FRAGMENT, ['u_matrix', 'u_viewport', 'u_width', 'u_times', 'u_scale', 'u_alpha', 'u_soft', 'u_ramp']);
    this.program = program;
    this.uniforms = uniforms;

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
    gl.vertexAttribDivisor(seg, 1);
    gl.enableVertexAttribArray(nodes);
    gl.vertexAttribDivisor(nodes, 1);

    this.costBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.costBuffer);
    const cost = gl.getAttribLocation(program, 'a_cost');
    gl.enableVertexAttribArray(cost);
    gl.vertexAttribDivisor(cost, 1);
    this.attribs = { seg, nodes, cost };
    this.pointAt(0);
    gl.bindVertexArray(null);

    this.timesTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.timesTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, TIMES_WIDTH, this.texHeight, 0, gl.RED, gl.FLOAT, this.times);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);

    this.rampTex = rampTexture(gl);
    this.flush();
  }

  /**
   * Segments of the edges the profile travels, with the cost of reaching each end from A and from B: built by a worker
   * (millions of segments for a region), the network drawn so far stays until they arrive.
   */
  setProfile(profile: Profile): void {
    const { net } = this;
    if (!this.worker) {
      this.worker = new Worker(new URL('./segments.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<SegmentsResult>) => {
        if (data.id !== this.lastRequest) return;
        this.pending = data.segments;
        this.flush();
      };
      const { coords, coordStart, edgeKind, edgeFlags, edgeA, edgeB, edgeCount } = net;
      const source: SegmentSource = { coords, coordStart, edgeKind, edgeFlags, edgeA, edgeB, edgeCount };
      this.worker.postMessage({ type: 'network', source, chunks: this.chunks } satisfies SegmentsRequest);
    }
    this.lastRequest += 1;
    const { fwd, bwd, direction } = profile;
    this.worker.postMessage({ type: 'profile', id: this.lastRequest, fwd, bwd, direction } satisfies SegmentsRequest);
  }

  /** Stops the worker building the segments */
  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }

  /**
   * Node times of the latest run, laid out for the texture (`Result.times`: the engine worker prepares them, so the
   * page uploads them as they are); undefined (no street near the cursor) shows the network in grey, unreached. Kept
   * until uploaded: the next result replaces it before this one's buffers go back to the worker.
   */
  setTimes(times: Float32Array | undefined): void {
    if (times && times.length !== this.unreached.length) throw new Error(`times: ${times.length} values, ${this.unreached.length} expected`);
    this.times = times ?? this.unreached;
    this.hasTimes = true;
    this.timesDirty = true;
    this.onChange();
  }

  /** The node times of the shown result, for the buildings drawn from them; undefined before the first result */
  get timesTexture(): WebGLTexture | undefined {
    // Read by the buildings while the map draws them, before the network: the latest times go up first
    this.sync();

    return this.hasTimes ? this.timesTex : undefined;
  }

  /** Web Mercator metres of the zone centre: the positions are relative to it */
  get origin(): readonly [number, number] {
    return this.net.origin;
  }

  /** Segments of the profile, one instanced quad each */
  get segments(): number {
    return this.instances;
  }

  /** Segments drawn in the last frame: those of the squares in view */
  get drawnSegments(): number {
    return this.drawnCount;
  }

  /** Longest time shown, seconds */
  get maxTime(): number {
    return this.style.scale;
  }

  setStyle(style: NetworkStyle): void {
    this.style = style;
    this.onChange();
  }

  private flush() {
    if (this.pending) this.onChange();
  }

  /**
   * Uploads what changed since the last frame (geometry, node times). Done while the host draws, never in between:
   * a map library caches the WebGL state (bound buffers and textures), and changes made outside its frame would go
   * unnoticed by it. The pixel unpacking settings are set for the upload and given back, for the same reason.
   */
  private sync(): void {
    const { gl, pending } = this;
    if (!gl || (!pending && !this.timesDirty)) return;
    if (pending) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, pending.geom, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.costBuffer ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, pending.cost, gl.STATIC_DRAW);
      this.instances = pending.count;
      this.chunkStart = pending.chunkStart;
      this.pending = undefined;
    }
    // Times handed back to the engine before their upload (a caller recycling too early): nothing left to send
    if (this.timesDirty && !this.times.length) this.timesDirty = false;
    if (this.timesDirty) {
      const unpack = [gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, gl.UNPACK_ALIGNMENT] as const;
      const saved = unpack.map((p) => gl.getParameter(p) as number | boolean);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.bindTexture(gl.TEXTURE_2D, this.timesTex ?? null);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TIMES_WIDTH, this.texHeight, gl.RED, gl.FLOAT, this.times);
      unpack.forEach((p, i) => gl.pixelStorei(p, Number(saved[i])));
      this.timesDirty = false;
    }
  }

  /**
   * Draws the network. `matrix` maps the positions of the layer (Mercator 0..1 relative to the zone origin, y down)
   * to clip space; `zoom` is the map zoom in MapLibre's scale (512 px tiles), for the line widths.
   */
  draw(gl: WebGL2RenderingContext, matrix: Float32Array, zoom: number): void {
    this.sync();
    if (!this.program || !this.instances || !this.hasTimes) return;

    const dpr = window.devicePixelRatio || 1;
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    // Glow, wider when zoomed out so the colors fill the blocks between streets
    // Zoomed out, the glow keeps its ground width (the streets get closer on screen): no wider than 46 px
    const glow = zoom >= 12 ? Math.max(10, 46 - (zoom - 12) * 9) : Math.max(8, 46 * 2 ** (zoom - 12));
    gl.uniform1f(u.u_width, glow * dpr);
    gl.uniform1f(u.u_alpha, 0.11);
    gl.uniform1f(u.u_soft, 1);
    const ranges = this.visibleRanges(matrix);
    this.drawRanges(ranges);
    // Lines
    gl.uniform1f(u.u_width, Math.min(5, Math.max(1.2, (zoom - 11) * 1.1)) * dpr);
    gl.uniform1f(u.u_alpha, 0.75);
    gl.uniform1f(u.u_soft, 0);
    this.drawRanges(ranges);
    this.pointAt(0);
    gl.bindVertexArray(null);
    this.drawnCount = ranges.reduce((n, [from, to]) => n + to - from, 0);
  }

  /** Points the per-segment attributes at segment `first`: WebGL 2 has no base instance, the offset does it */
  private pointAt(first: number): void {
    const { gl, attribs } = this;
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer ?? null);
    gl.vertexAttribPointer(attribs.seg, 4, gl.FLOAT, false, GEOM_STRIDE, first * GEOM_STRIDE);
    gl.vertexAttribPointer(attribs.nodes, 3, gl.FLOAT, false, GEOM_STRIDE, first * GEOM_STRIDE + 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.costBuffer ?? null);
    gl.vertexAttribPointer(attribs.cost, 4, gl.FLOAT, false, COST_STRIDE, first * COST_STRIDE);
  }

  private drawRanges(ranges: [number, number][]): void {
    const { gl } = this;
    if (!gl) return;
    for (const [from, to] of ranges) {
      this.pointAt(from);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, to - from);
    }
  }

  /**
   * Segments of the squares in view, as runs of consecutive segments. The view's footprint on the ground: the four
   * corners of the screen cast on it (on a tilted map, a corner above the horizon stops at the far plane), and one
   * square of margin, for the segments that cross into it and the wide glow.
   */
  private visibleRanges(m: Float32Array): [number, number][] {
    const { minX, minY, size, cols, rows } = this.chunks;
    const start = this.chunkStart;
    const all: [number, number][] = [[0, this.instances]];
    const inv = invert(m);
    if (!inv) return all;

    // Layer position of a point of the clip space (x, y, z in -1..1)
    const unproject = (x: number, y: number, z: number): [number, number, number] => {
      const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];

      return [(inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w, (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w, (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w];
    };
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const near = unproject(cx, cy, -1);
      const far = unproject(cx, cy, 1);
      // Where the ray of this corner meets the ground (height 0), else its far end
      const t = near[2] - far[2] !== 0 ? near[2] / (near[2] - far[2]) : -1;
      const [px, py] = t >= 0 && t <= 1 ? [near[0] + t * (far[0] - near[0]), near[1] + t * (far[1] - near[1])] : [far[0], far[1]];
      // Back to Mercator metres relative to the zone (the layer has y down)
      const [x, y] = [px * EARTH, -py * EARTH];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return all;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }

    const [i0, i1] = [Math.max(0, Math.floor((x0 - minX) / size) - 1), Math.min(cols - 1, Math.floor((x1 - minX) / size) + 1)];
    const [j0, j1] = [Math.max(0, Math.floor((y0 - minY) / size) - 1), Math.min(rows - 1, Math.floor((y1 - minY) / size) + 1)];
    const ranges: [number, number][] = [];
    for (let j = j0; j <= j1; j += 1) {
      // A row of squares is one run of segments
      const [from, to] = [start[j * cols + i0], start[j * cols + i1 + 1]];
      if (from === to) continue;
      const last = ranges.at(-1);
      if (last && last[1] === from) last[1] = to;
      else ranges.push([from, to]);
    }

    return ranges;
  }
}
