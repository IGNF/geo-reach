import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

/** A tile of the BD TOPO vector tiles: zoom and column, row */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/**
 * The buildings of one tile as the map's extrusion layer takes them: polygons in Mercator 0..1 (y to the south), the
 * first point of each ring and the first ring of each polygon, the building of each polygon (a building may be
 * several polygons)
 */
export interface BuildingPolygons {
  points: Float64Array;
  ringStart: Uint32Array;
  polygonStart: Uint32Array;
  feature: Uint32Array;
  /** Per building: its height, metres */
  heights: Float32Array;
  /** Per building: its middle, zone Mercator metres (x east, y north), to find its street */
  centers: Float32Array;
  buildings: number;
}

const EARTH = 2 * Math.PI * 6378137;
/** Buildings with no height in the BD TOPO: a low house */
const DEFAULT_HEIGHT = 6;

/** The `batiment` layer of a BD TOPO tile as polygons; `origin`: the zone origin, Web Mercator metres */
export const buildingPolygons = (pbf: ArrayBuffer, tile: TileId, [ox, oy]: readonly [number, number]): BuildingPolygons => {
  const layer = new VectorTile(new PbfReader(pbf)).layers.batiment;
  const points: number[] = [];
  const ringStart: number[] = [];
  const polygonStart: number[] = [];
  const feature: number[] = [];
  const heights: number[] = [];
  const centers: number[] = [];
  if (layer) {
    const size = 2 ** tile.z;
    const scale = 1 / (layer.extent * size);
    for (let i = 0; i < layer.length; i += 1) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;

      const building = heights.length;
      const raw = f.properties.hauteur;
      heights.push(typeof raw === 'number' && raw > 0 ? raw : DEFAULT_HEIGHT);
      const rings = f.loadGeometry();
      // Middle of the first outline, for the street search
      const outline = rings[0] ?? [];
      const n = Math.max(1, outline.length);
      const mx = outline.reduce((s, p) => s + tile.x / size + p.x * scale, 0) / n;
      const my = outline.reduce((s, p) => s + tile.y / size + p.y * scale, 0) / n;
      centers.push((mx - 0.5) * EARTH - ox, (0.5 - my) * EARTH - oy);
      for (const polygon of classifyRings(rings)) {
        polygonStart.push(ringStart.length);
        feature.push(building);
        for (const ring of polygon) {
          ringStart.push(points.length / 2);
          for (const p of ring) points.push(tile.x / size + p.x * scale, tile.y / size + p.y * scale);
        }
      }
    }
  }
  ringStart.push(points.length / 2);
  polygonStart.push(ringStart.length - 1);

  return {
    points: Float64Array.from(points),
    ringStart: Uint32Array.from(ringStart),
    polygonStart: Uint32Array.from(polygonStart),
    feature: Uint32Array.from(feature),
    heights: Float32Array.from(heights),
    centers: Float32Array.from(centers),
    buildings: heights.length,
  };
};
