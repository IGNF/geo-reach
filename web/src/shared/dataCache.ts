/**
 * The prepared data (the network files of the regions) is computed on in the browser, so every visitor downloads it once. It is
 * then kept in the Cache Storage of the browser: later visits read it locally, even offline. Bump DATA_VERSION when
 * the files change, so that browsers drop their copy.
 */
export const DATA_VERSION = '2026-10-13-tracks';
const CACHE = `geo-reach-data-${DATA_VERSION}`;

/** Bytes received so far, and the size of the file when the server tells it (not when it compresses the transfer) */
export type Progress = (bytes: number, total: number | undefined) => void;

const openCache = async () => {
  try {
    if (typeof caches === 'undefined') return undefined;
    // Older versions of the data go
    for (const key of await caches.keys()) if (key.startsWith('geo-reach-data-') && key !== CACHE) await caches.delete(key);

    return await caches.open(CACHE);
  } catch {
    return undefined;
  }
};

/** Gzip files start with these two bytes */
const isGzip = (bytes: Uint8Array): boolean => bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * The region files are stored gzipped (`.bin.gz`, under the 100 MB a file of GitHub): the browser inflates them
 * itself. A server may already have inflated them on the way (Content-Encoding): the first bytes tell.
 */
const inflate = async (bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> =>
  isGzip(bytes) ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : bytes.buffer;

/** The file, from the browser cache when there, else downloaded (with its progress) and cached */
export const loadData = async (url: string, onProgress?: Progress): Promise<ArrayBuffer> => {
  const cache = await openCache();
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    onProgress?.(bytes.byteLength, bytes.byteLength);

    return inflate(bytes);
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);

  // With a compressed transfer, Content-Length counts the compressed bytes, not the ones read
  const length = Number(res.headers.get('content-length'));
  const total = !res.headers.get('content-encoding') && length > 0 ? length : undefined;

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, total);
  }

  // Kept as downloaded (compressed for the regions): half the room in the browser cache
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  await cache?.put(url, new Response(bytes.slice())).catch(() => undefined);

  return inflate(bytes);
};
