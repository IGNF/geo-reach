import type { NetworkMessage, NetworkRequest } from './network.worker';
import type { Network } from './network';
import type { Profile } from './profile';
import type { SnapParts } from './snap';

/** A region decoded by its worker, with its first profile and snap index */
export interface LoadedNetwork {
  net: Network;
  /** The transit layer could be loaded */
  transit: boolean;
  first: { profile: Profile; snap: SnapParts };
}

export interface LoadProgress {
  /** Bytes received and announced (0 if unknown), per file */
  onDownload: (file: 'graph' | 'transit', bytes: number, total: number | undefined) => void;
  onStep: (step: 'roads' | 'transit' | 'engine') => void;
}

/**
 * Loads a region in a worker of its own (download, decoding, transit, first profile, snap index): the page only
 * receives the result, and the map in view keeps moving meanwhile.
 */
export const loadNetwork = (request: NetworkRequest, progress: LoadProgress): Promise<LoadedNetwork> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./network.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: msg }: MessageEvent<NetworkMessage>) => {
      if (msg.type === 'progress') return progress.onDownload(msg.file, msg.bytes, msg.total);
      if (msg.type === 'step') return progress.onStep(msg.step);

      worker.terminate();
      if (msg.type === 'error') return reject(new Error(msg.message));
      resolve({ net: msg.net, transit: msg.transit, first: { profile: msg.profile, snap: msg.snap } });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(request);
  });
