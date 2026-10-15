/// <reference lib="webworker" />
/**
 * Loads a region off the main thread, so that the map in view stays fluid while another region comes: downloads (or
 * reads from the browser cache) its files, decodes the roads, grafts the transit layer, then builds the first profile
 * and its snap index. Everything goes back to the page in buffers handed over (no copy).
 */

import { loadData } from '@/shared/dataCache';
import { type Network, readRoadNetwork } from './network';
import { buildProfile, type Profile, type ProfileOptions } from './profile';
import { SnapIndex, type SnapParts } from './snap';
import { readTransit } from './transit';

export interface NetworkRequest {
  graphUrl: string;
  transitUrl?: string;
  /** The first profile, without cuts (the page applies them: they are checked against the network) */
  options: ProfileOptions;
}

export type NetworkMessage =
  | { type: 'progress'; file: 'graph' | 'transit'; bytes: number; total?: number }
  | { type: 'step'; step: 'roads' | 'transit' | 'engine' }
  | { type: 'done'; net: Network; transit: boolean; profile: Profile; snap: SnapParts }
  | { type: 'error'; message: string };

const post = (msg: NetworkMessage, transfer: Transferable[] = []): void => self.postMessage(msg, transfer);

/** Every buffer under the typed arrays of these objects, once each (several arrays can share one) */
const buffers = (...values: unknown[]): ArrayBuffer[] => {
  const found = new Set<ArrayBuffer>();
  for (const value of values)
    for (const field of Object.values(value as Record<string, unknown>))
      if (ArrayBuffer.isView(field) && field.buffer instanceof ArrayBuffer) found.add(field.buffer);

  return [...found];
};

self.onmessage = async ({ data: { graphUrl, transitUrl, options } }: MessageEvent<NetworkRequest>) => {
  try {
    const [graph, transit] = await Promise.all([
      loadData(graphUrl, (bytes, total) => post({ type: 'progress', file: 'graph', bytes, total })),
      transitUrl ? loadData(transitUrl, (bytes, total) => post({ type: 'progress', file: 'transit', bytes, total })).catch(() => undefined) : undefined,
    ]);

    post({ type: 'step', step: 'roads' });
    const roads = readRoadNetwork(graph);
    post({ type: 'step', step: 'transit' });
    const net = transit ? readTransit(transit)(roads) : roads;

    post({ type: 'step', step: 'engine' });
    const profile = buildProfile(net, { ...options, mode: !transit && options.mode === 'transit' ? 'pedestrian' : options.mode });
    const snap = SnapIndex.build(net, profile);

    post({ type: 'done', net, transit: !!transit, profile, snap }, buffers(net, profile, snap));
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
