/** The rail lines of transit mode on the map: metro, RER, train and tram rides in their colors, and their stations */
import type { Feature } from 'isard';
import { EDGE_BOARD, EDGE_RIDE, FLAG_BUS, type TravelEngine } from '@/features/routing';
import type { LngLat } from '@/shared/config';
import { fromMercator } from '@/shared/mercator';

export type RailProps = { color: string; order: number; edge: number };

/** Metro, RER, train and tram rides in their line colors (the lines drawn last on top), and the stations they serve */
export const railFeatures = (engine: TravelEngine): { lines: Feature<RailProps>[]; stations: Feature<{ color: string }>[] } => {
  const { net } = engine;
  const [ox, oy] = net.origin;
  const at = (x: number, y: number) => fromMercator([x + ox, y + oy]);
  // A station takes the color of the first rail line boarded there: one pass over the edges
  const stationColor = new Map<number, string>();
  for (let e = 0; e < net.edgeCount; e += 1) {
    const station = net.edgeA[e];
    if (net.edgeKind[e] !== EDGE_BOARD || net.edgeFlags[e] & FLAG_BUS || stationColor.has(station)) continue;

    stationColor.set(station, net.lines[net.edgeName[e]].color);
  }

  const lines: Feature<RailProps>[] = [];
  for (let e = 0; e < net.edgeCount; e += 1) {
    if (net.edgeKind[e] !== EDGE_RIDE || net.edgeFlags[e] & FLAG_BUS) continue;
    const line = net.lines[net.edgeName[e]];
    const coordinates: LngLat[] = [];
    for (let p = net.coordStart[e]; p < net.coordStart[e + 1]; p += 1) coordinates.push(at(net.coords[p * 2], net.coords[p * 2 + 1]));
    lines.push({
      type: 'Feature',
      properties: { color: line.color, order: line.type === 1 ? 2 : 1, edge: e },
      geometry: { type: 'LineString', coordinates },
    });
  }
  // The drawing order is the data's: the lines drawn last are on top
  lines.sort((a, b) => a.properties.order - b.properties.order);

  const stations = [...net.railStations].map(
    (s): Feature<{ color: string }> => ({
      type: 'Feature',
      properties: { color: stationColor.get(s) ?? '#555' },
      geometry: { type: 'Point', coordinates: at(net.nodeXY[s * 2], net.nodeXY[s * 2 + 1]) },
    }),
  );

  return { lines, stations };
};
