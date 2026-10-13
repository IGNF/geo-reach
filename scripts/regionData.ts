import { type Network, readRoadNetwork } from '@/features/routing/network';
import { readTransit } from '@/features/routing/transit';
import { DEFAULT_REGION } from '@/features/regions/regions';

const file = (name: string): URL => new URL(`../web/public/data/regions/${name}`, import.meta.url);

const inflate = async (url: URL): Promise<ArrayBuffer> => Bun.gunzipSync(await Bun.file(url).bytes()).buffer as ArrayBuffer;

/** A region's road network, read from its file as the app reads it */
export const loadRoads = async (id: string = DEFAULT_REGION): Promise<Network> => readRoadNetwork(await inflate(file(`${id}.bin.gz`)));

/** A region's roads with its public transport grafted on, when it has some */
export const loadRegion = async (id: string = DEFAULT_REGION): Promise<Network> => {
  const roads = await loadRoads(id);
  const transit = file(`${id}.transit.bin.gz`);

  return (await Bun.file(transit).exists()) ? readTransit(await inflate(transit))(roads) : roads;
};
