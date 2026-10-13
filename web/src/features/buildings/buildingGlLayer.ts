import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { type BuildingMesh, type TileId, VERTEX_FLOATS } from './buildingMesh';
import type { BuildingRequest, BuildingResult } from './building.worker';
import type { TravelEngine } from '@/features/routing';
import { GPF_BASE } from '@/shared/config';
import type { NetworkLayer } from '@/features/map';
import { linkProgram, rampTexture, TIMES_WIDTH, zoneMatrix, zoneOrigin } from '@/shared/gl';

/** The BD TOPO vector tiles carry the buildings from zoom 15 */
export const BUILDINGS_MIN_ZOOM = 15;
const TILE_ZOOM = 15;
/** Below this map zoom the buildings are not drawn (too small, too many tiles) */
const DRAW_ZOOM = 14.5;
/** Tiles loaded around the centre of the view at most, and kept in memory */
const MAX_TILES_IN_VIEW = 24;
const MAX_TILES_KEPT = 48;
/** Milliseconds between two tile updates while the map moves */
const MOVE_THROTTLE_MS = 250;
/** Width of a tile's anchor texture: building i is at (i % ANCHOR_WIDTH, i / ANCHOR_WIDTH) */
const ANCHOR_WIDTH = 1024;
/** A building with no street nearby: never reached */
const FAR = 1e9;
/** Not reached within the max time */
const NEUTRAL: [number, number, number] = [0.85, 0.84, 0.8];

const tileUrl = ({ z, x, y }: TileId): string => `${GPF_BASE}/tms/1.0.0/BDTOPO/${z}/${x}/${y}.pbf`;

const VERTEX = `#version 300 es
in vec2 a_pos;
in float a_height;
in float a_shade;
in float a_building;
uniform mat4 u_matrix;
/** Mercator units per metre of height */
uniform float u_metre;
uniform sampler2D u_times;
uniform sampler2D u_anchors;
out float v_t;
out float v_shade;

float nodeTime(float i) {
  int k = int(i);
  return texelFetch(u_times, ivec2(k % ${TIMES_WIDTH}, k / ${TIMES_WIDTH}), 0).r;
}

void main() {
  // The two ends of the building's street, and the seconds from each to the building
  int b = int(a_building);
  vec4 anchor = texelFetch(u_anchors, ivec2(b % ${ANCHOR_WIDTH}, b / ${ANCHOR_WIDTH}), 0);
  v_t = min(nodeTime(anchor.x) + anchor.z, nodeTime(anchor.y) + anchor.w);
  v_shade = a_shade;
  gl_Position = u_matrix * vec4(a_pos, a_height * u_metre, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in float v_t;
in float v_shade;
uniform float u_scale;
uniform vec3 u_neutral;
uniform sampler2D u_ramp;
out vec4 color;

void main() {
  vec3 rgb = v_t <= u_scale ? texture(u_ramp, vec2(v_t / u_scale, 0.5)).rgb : u_neutral;
  color = vec4(rgb * v_shade, 1.0);
}`;

/** A tile of buildings: downloading (no mesh yet), or loaded (on the graphics card when it has buildings) */
interface Tile {
  key: string;
  id: TileId;
  /** Last time it was in view, to drop the oldest */
  usedAt: number;
  mesh?: BuildingMesh;
  gpu?: { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; count: number; anchors: WebGLTexture };
}

/**
 * BD TOPO buildings drawn by the GPU, colored like the streets at every move: each building is joined once to the
 * ends of its nearest street (its anchor), and the shader reads their times in the network layer's texture.
 * Tiles are downloaded and extruded by a worker; anchors are computed again when the profile changes.
 */
export class BuildingGlLayer implements CustomLayerInterface {
  readonly id = 'buildings';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private readonly engine: TravelEngine;
  private readonly network: NetworkLayer;
  private readonly tiles = new Map<string, Tile>();
  private readonly worker = new Worker(new URL('./building.worker.ts', import.meta.url), { type: 'module' });
  private map?: MlMap;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private rampTex?: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private visible = false;
  private lastUpdate = 0;
  /** Mercator units per metre at the zone */
  private readonly metre: number;

  constructor(engine: TravelEngine, network: NetworkLayer) {
    this.engine = engine;
    this.network = network;
    const lat = 2 * Math.atan(Math.exp(engine.net.origin[1] / 6378137)) - Math.PI / 2;
    this.metre = 1 / (2 * Math.PI * 6378137 * Math.cos(lat));
    this.worker.onmessage = (event: MessageEvent<BuildingResult>) => this.onTile(event.data);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateTiles();
    this.map?.triggerRepaint();
  }

  /** The profile changed (mode, cuts…): every building joins its street again */
  setProfile(): void {
    for (const tile of this.tiles.values()) if (tile.gpu && tile.mesh) this.uploadAnchors(tile.gpu.anchors, tile.mesh);
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl;

    const { program, uniforms } = linkProgram(gl, VERTEX, FRAGMENT, ['u_matrix', 'u_metre', 'u_times', 'u_anchors', 'u_scale', 'u_neutral', 'u_ramp']);
    this.program = program;
    this.uniforms = uniforms;
    this.rampTex = rampTexture(gl);

    map.on('move', this.onMove);
    map.on('moveend', this.updateTiles);
    this.updateTiles();
  }

  onRemove(): void {
    this.map?.off('move', this.onMove);
    this.map?.off('moveend', this.updateTiles);
    for (const tile of this.tiles.values()) this.drop(tile);
    this.worker.terminate();
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const times = this.network.timesTexture;
    if (!this.visible || !this.program || !this.map || !times || this.map.getZoom() < DRAW_ZOOM) return;

    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.u_matrix, false, zoneMatrix(args, this.engine.net.origin));
    gl.uniform1f(u.u_metre, this.metre);
    gl.uniform1f(u.u_scale, this.network.maxTime);
    gl.uniform3f(u.u_neutral, ...NEUTRAL);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, times);
    gl.uniform1i(u.u_times, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rampTex ?? null);
    gl.uniform1i(u.u_ramp, 1);
    gl.uniform1i(u.u_anchors, 2);

    // Opaque, hidden faces behind the nearer ones
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    for (const tile of this.tiles.values()) {
      if (!tile.gpu) continue;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tile.gpu.anchors);
      gl.bindVertexArray(tile.gpu.vao);
      gl.drawElements(gl.TRIANGLES, tile.gpu.count, gl.UNSIGNED_INT, 0);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  private readonly onMove = (): void => {
    const now = performance.now();
    if (now - this.lastUpdate < MOVE_THROTTLE_MS) return;
    this.updateTiles();
  };

  /** Loads the tiles around the centre of the view, cancels those gone out of it, drops the oldest */
  private readonly updateTiles = (): void => {
    const { map } = this;
    this.lastUpdate = performance.now();
    if (!map || !this.visible || map.getZoom() < DRAW_ZOOM) return;

    const wanted = this.tilesInView(map);
    const keys = new Set(wanted.map((t) => this.key(t)));
    const now = performance.now();

    for (const id of wanted) {
      const key = this.key(id);
      const tile = this.tiles.get(key);
      if (tile) {
        tile.usedAt = now;
        continue;
      }

      this.tiles.set(key, { key, id, usedAt: now });
      const request: BuildingRequest = { type: 'tile', key, url: tileUrl(id), tile: id, zone: zoneOrigin(this.engine.net.origin) };
      this.worker.postMessage(request);
    }

    // Downloads no longer in view are cancelled
    for (const tile of this.tiles.values())
      if (!tile.mesh && !keys.has(tile.key)) {
        this.worker.postMessage({ type: 'cancel', key: tile.key } satisfies BuildingRequest);
        this.tiles.delete(tile.key);
      }

    // The oldest tiles out of view leave the graphics card
    const loaded = [...this.tiles.values()].filter((t) => t.mesh).sort((a, b) => b.usedAt - a.usedAt);
    for (const tile of loaded.slice(MAX_TILES_KEPT)) this.drop(tile);
  };

  /** Tiles of the view at the tile zoom, nearest to the centre first */
  private tilesInView(map: MlMap): TileId[] {
    const n = 2 ** TILE_ZOOM;
    const col = (lng: number): number => Math.floor(((lng + 180) / 360) * n);
    const row = (lat: number): number =>
      Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);

    const bounds = map.getBounds();
    const [x0, x1] = [col(bounds.getWest()), col(bounds.getEast())];
    const [y0, y1] = [row(bounds.getNorth()), row(bounds.getSouth())];
    const { lng, lat } = map.getCenter();
    const [cx, cy] = [col(lng), row(lat)];

    const tiles: TileId[] = [];
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) tiles.push({ z: TILE_ZOOM, x, y });

    return tiles
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
      .slice(0, MAX_TILES_IN_VIEW);
  }

  private key({ z, x, y }: TileId): string {
    return `${z}/${x}/${y}`;
  }

  private onTile(result: BuildingResult): void {
    const tile = this.tiles.get(result.key);
    if (!tile) return;
    if (!result.ok) {
      this.tiles.delete(result.key);

      return;
    }

    tile.mesh = result.mesh;
    if (result.mesh.buildings > 0) tile.gpu = this.upload(result.mesh);
    this.map?.triggerRepaint();
  }

  /** Vertices, indices and anchors of a tile to the graphics card */
  private upload(mesh: BuildingMesh): Tile['gpu'] {
    const { gl, program } = this;
    if (!gl || !program) return undefined;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    const stride = VERTEX_FLOATS * 4;
    const attributes: [string, number, number][] = [
      ['a_pos', 2, 0],
      ['a_height', 1, 8],
      ['a_shade', 1, 12],
      ['a_building', 1, 16],
    ];
    for (const [name, size, offset] of attributes) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    }

    const indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const anchors = gl.createTexture();
    this.uploadAnchors(anchors, mesh);

    return { vao, buffers: [vertices, indices], count: mesh.indices.length, anchors };
  }

  /** For each building, the ends of its nearest street and the seconds from each, in the current profile */
  private uploadAnchors(texture: WebGLTexture, mesh: BuildingMesh): void {
    const { gl } = this;
    if (!gl) return;

    const rows = Math.ceil(mesh.buildings / ANCHOR_WIDTH);
    const data = new Float32Array(ANCHOR_WIDTH * rows * 4);
    for (let i = 0; i < mesh.buildings; i += 1) {
      const at = this.engine.anchor(mesh.centers[i * 2], mesh.centers[i * 2 + 1]);
      data.set(at ? [at.a, at.b, at.toA, at.toB] : [0, 0, FAR, FAR], i * 4);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ANCHOR_WIDTH, rows, 0, gl.RGBA, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  }

  private drop(tile: Tile): void {
    const { gl } = this;
    if (gl && tile.gpu) {
      gl.deleteVertexArray(tile.gpu.vao);
      for (const buffer of tile.gpu.buffers) gl.deleteBuffer(buffer);
      gl.deleteTexture(tile.gpu.anchors);
    }
    this.tiles.delete(tile.key);
  }
}
