/**
 * The prepared data (graph.bin, transit.bin) is computed on in the browser, so every visitor downloads it once. It is
 * then kept in the Cache Storage of the browser: later visits read it locally, even offline. Bump DATA_VERSION when
 * the files change, so that browsers drop their copy.
 */
export const DATA_VERSION = '2026-10-08-idf';
const CACHE = `geo-reach-data-${DATA_VERSION}`;

/** Bytes received so far, for a progress text */
export type Progress = (bytes: number) => void;

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

/** The file, from the browser cache when there, else downloaded (with its progress) and cached */
export const loadData = async (url: string, onProgress?: Progress): Promise<ArrayBuffer> => {
  const cache = await openCache();
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    const buffer = await hit.arrayBuffer();
    onProgress?.(buffer.byteLength);

    return buffer;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await cache?.put(url, new Response(bytes.slice())).catch(() => undefined);

  return bytes.buffer;
};
