import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import earcut from 'earcut';
import { PbfReader } from 'pbf';

/** A tile of the BD TOPO vector tiles: zoom and column, row */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/**
 * Where the zone sits in the 0..1 Mercator world (x to the east, y to the south): the network layer draws relative to
 * this point, so that 32-bit floats keep centimetres
 */
export interface ZoneOrigin {
  tx: number;
  ty: number;
}

/** The buildings of one tile, ready for the graphics card */
export interface BuildingMesh {
  /** Per vertex: x, y (Mercator units relative to the zone), height (metres), shade (0–1), building index */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Per building: its middle, zone Mercator metres (x east, y north), to find its street */
  centers: Float32Array;
  buildings: number;
}

export const VERTEX_FLOATS = 5;

const EARTH = 2 * Math.PI * 6378137;
/** Buildings with no height in the BD TOPO: a low house */
const DEFAULT_HEIGHT = 6;
/** Light from the north-west, as on the IGN hillshade: walls facing it are brighter */
const LIGHT: [number, number] = [-Math.SQRT1_2, -Math.SQRT1_2];

/** Grows a typed array list without copying it at every push */
class Floats {
  private data = new Float32Array(1 << 16);
  length = 0;

  push(...values: number[]): void {
    if (this.length + values.length > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data.set(values, this.length);
    this.length += values.length;
  }

  done(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

/**
 * Extrudes the `batiment` layer of a BD TOPO tile: one wall quad per edge of each ring (holes included), shaded by
 * its orientation, and a flat roof triangulated with earcut.
 */
export const buildingMesh = (pbf: ArrayBuffer, tile: TileId, zone: ZoneOrigin): BuildingMesh => {
  const layer = new VectorTile(new PbfReader(pbf)).layers.batiment;
  const vertices = new Floats();
  const indices: number[] = [];
  const centers: number[] = [];
  if (!layer) return { vertices: new Float32Array(0), indices: new Uint32Array(0), centers: new Float32Array(0), buildings: 0 };

  const size = 2 ** tile.z;
  const scale = 1 / (layer.extent * size);
  // Tile coordinates to Mercator units relative to the zone
  const toX = (px: number): number => tile.x / size + px * scale - zone.tx;
  const toY = (py: number): number => tile.y / size + py * scale - zone.ty;
  const vertex = (x: number, y: number, h: number, shade: number, building: number): number => {
    vertices.push(x, y, h, shade, building);

    return vertices.length / VERTEX_FLOATS - 1;
  };

  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    if (feature.type !== 3) continue;

    const building = centers.length / 2;
    const raw = feature.properties.hauteur;
    const height = typeof raw === 'number' && raw > 0 ? raw : DEFAULT_HEIGHT;
    const rings = feature.loadGeometry();

    // Middle of the first outline, for the street search
    const outline = rings[0] ?? [];
    const mx = outline.reduce((s, p) => s + toX(p.x), 0) / Math.max(1, outline.length);
    const my = outline.reduce((s, p) => s + toY(p.y), 0) / Math.max(1, outline.length);
    centers.push(mx * EARTH, -my * EARTH);

    for (const polygon of classifyRings(rings)) {
      // Walls: a quad per edge, its shade from the direction it faces
      for (const ring of polygon)
        for (let k = 0; k + 1 < ring.length; k += 1) {
          const [a, b] = [ring[k], ring[k + 1]];
          const [x0, y0, x1, y1] = [toX(a.x), toY(a.y), toX(b.x), toY(b.y)];
          const len = Math.hypot(x1 - x0, y1 - y0);
          if (len === 0) continue;

          // Outward normal of the edge (rings are clockwise in tile coordinates, y down)
          const [nx, ny] = [(y1 - y0) / len, -(x1 - x0) / len];
          const shade = 0.72 + 0.2 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1]);
          const base = vertex(x0, y0, 0, shade, building);
          vertex(x1, y1, 0, shade, building);
          vertex(x1, y1, height, shade, building);
          vertex(x0, y0, height, shade, building);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }

      // Roof: the rings at the top, triangulated (holes cut out)
      const flat: number[] = [];
      const holes: number[] = [];
      for (const [r, ring] of polygon.entries()) {
        if (r > 0) holes.push(flat.length / 2);
        for (const p of ring) flat.push(toX(p.x), toY(p.y));
      }
      const first = vertices.length / VERTEX_FLOATS;
      for (let k = 0; k < flat.length; k += 2) vertex(flat[k], flat[k + 1], height, 1, building);
      // Earcut works in any unit: Mercator units are tiny, so it gets the tile coordinates' proportions back
      const triangles = earcut(flat.map((v) => v / scale), holes);
      for (const t of triangles) indices.push(first + t);
    }
  }

  return {
    vertices: vertices.done(),
    indices: Uint32Array.from(indices),
    centers: Float32Array.from(centers),
    buildings: centers.length / 2,
  };
};
