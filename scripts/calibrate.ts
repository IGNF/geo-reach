/**
 * Checks that the travel times look realistic: draws random trips on the real graph and prints the effective speed
 * (path length / travel time) per mode and hour, in Paris and in the inner suburbs. Optionally compares night driving
 * with the Géoplateforme route service (free flow), and lists transit times from the IGN head office to the
 * landmarks. Run: `bun scripts/calibrate.ts [--gpf] [--transit]`.
 *
 * Reference speeds for Paris (orders of magnitude): car 13–15 km/h at peak hours, 17–20 km/h during the day,
 * 25–30 km/h at night, faster in the suburbs; bike 12–14 km/h door to door; walk 4 km/h.
 */
import { EDGE_ROAD, loadRoadNetwork, type Network } from '../web/src/engine/network';
import { loadTransit } from '../web/src/engine/transit';
import { LANDMARKS } from '../web/src/lib/config';
import { buildProfile, DEFAULT_MODEL, type Profile, type ProfileOptions } from '../web/src/engine/profile';

const net = await loadRoadNetwork(new URL('../web/public/data/graph.bin', import.meta.url).href);
const R = 6378137;
const [ox, oy] = net.origin;
const lngLat = (n: number): [number, number] => [
  ((net.nodeXY[n * 2] + ox) / R) * (180 / Math.PI),
  ((2 * Math.atan(Math.exp((net.nodeXY[n * 2 + 1] + oy) / R)) - Math.PI / 2) * 180) / Math.PI,
];
const inParis = ([lng, lat]: [number, number]) => lng > 2.26 && lng < 2.41 && lat > 48.825 && lat < 48.895;

/** Plain Dijkstra (calibration only: the app runs the WebAssembly engine) */
const shortestOn = (g: Network, p: Profile, source: number) => {
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const length = new Float64Array(g.nodeCount);
  const heap: [number, number][] = [[0, source]];
  dist[source] = 0;
  while (heap.length) {
    let best = 0;
    for (let i = 1; i < heap.length; i += 1) if (heap[i][0] < heap[best][0]) best = i;
    const [d, n] = heap[best];
    heap[best] = heap[heap.length - 1];
    heap.pop();
    if (d > dist[n]) continue;
    for (let a = p.offsets[n]; a < p.offsets[n + 1]; a += 1) {
      const next = d + p.costs[a];
      const head = p.heads[a];
      if (next < dist[head]) {
        dist[head] = next;
        length[head] = length[n] + g.edgeLength[p.arcEdge[a]];
        heap.push([next, head]);
      }
    }
  }

  return { dist, length };
};
const shortest = (p: Profile, source: number) => shortestOn(net, p, source);

// Sources: nodes of usable roads, seeded random
let seed = 7;
const random = () => {
  seed = (seed * 16807) % 2147483647;

  return seed / 2147483647;
};
const roadNodes = (filter: (n: number) => boolean) => {
  const nodes = new Set<number>();
  for (let e = 0; e < net.edgeCount; e += 1)
    if (net.edgeKind[e] === EDGE_ROAD && net.edgeFlags[e] & 3) for (const n of [net.edgeA[e], net.edgeB[e]]) if (filter(n)) nodes.add(n);

  return [...nodes];
};
const paris = roadNodes((n) => inParis(lngLat(n)));
const suburbs = roadNodes((n) => !inParis(lngLat(n)));

/** Mean effective speed (km/h) of trips from a few sources to targets 2–6 km away */
const effectiveSpeed = (options: ProfileOptions, pool: number[], sources = 6) => {
  const p = buildProfile(net as Network, options);
  let km = 0;
  let hours = 0;
  for (let s = 0; s < sources; s += 1) {
    const source = pool[Math.floor(random() * pool.length)];
    const { dist, length } = shortest(p, source);
    for (let k = 0; k < 40; k += 1) {
      const target = pool[Math.floor(random() * pool.length)];
      if (!Number.isFinite(dist[target]) || length[target] < 2000 || length[target] > 6000) continue;
      km += length[target] / 1000;
      hours += dist[target] / 3600;
    }
  }

  return hours ? km / hours : NaN;
};

const base = { direction: 'departure', bus: false, model: DEFAULT_MODEL } as const;
for (const [zone, pool] of [
  ['Paris', paris],
  ['Inner suburbs', suburbs],
] as const) {
  const row = (label: string, options: ProfileOptions) =>
    console.log(`${zone.padEnd(14)} ${label.padEnd(10)} ${effectiveSpeed(options, pool).toFixed(1)} km/h`);
  for (const hour of [3, 8, 14, 18]) row(`car ${hour}h`, { ...base, mode: 'car', hour });
  row('bike', { ...base, mode: 'bike', hour: 8 });
  row('walk', { ...base, mode: 'pedestrian', hour: 8 });
}

if (process.argv.includes('--gpf')) {
  // Free flow: the night profile against the Géoplateforme route service (no traffic)
  const p = buildProfile(net as Network, { ...base, mode: 'car', hour: 3 });
  for (let i = 0; i < 6; i += 1) {
    const a = paris[Math.floor(random() * paris.length)];
    const b = paris[Math.floor(random() * paris.length)];
    const ours = shortest(p, a).dist[b] / 60;
    const params = new URLSearchParams({
      resource: 'bdtopo-valhalla',
      profile: 'car',
      optimization: 'fastest',
      start: lngLat(a).join(','),
      end: lngLat(b).join(','),
      timeUnit: 'minute',
    });
    const gpf = (await (await fetch(`https://data.geopf.fr/navigation/itineraire?${params}`)).json()) as {
      duration: number;
      distance: number;
    };
    console.log(`night trip ${i}: local ${ours.toFixed(1)} min, GPF ${gpf.duration.toFixed(1)} min (${(gpf.distance / 1000).toFixed(1)} km)`);
  }
}

if (process.argv.includes('--transit')) {
  // Transit from the IGN head office at 8 am, to compare with a journey planner
  const full = (await loadTransit(new URL('../web/public/data/transit.bin', import.meta.url).href))(net);
  const p = buildProfile(full, { ...base, mode: 'transit', hour: 8 });
  const nearest = (lng: number, lat: number) => {
    let best = 0;
    let bestD = Infinity;
    for (const n of paris.concat(suburbs)) {
      const [x, y] = lngLat(n);
      const d = (x - lng) ** 2 + (y - lat) ** 2;
      if (d < bestD) [best, bestD] = [n, d];
    }

    return best;
  };
  const ign = LANDMARKS.find((l) => l.name.startsWith('IGN'));
  if (ign) {
    const { dist } = shortestOn(full, p, nearest(...ign.at));
    for (const l of LANDMARKS) console.log(`IGN → ${l.name.padEnd(14)} ${(dist[nearest(...l.at)] / 60).toFixed(0)} min`);
  }
}
