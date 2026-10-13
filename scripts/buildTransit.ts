/**
 * Builds the public transport layer of a region: downloads its GTFS feed once (.cache/gtfs/), runs gtfs-prep on the
 * region's network (its origin and box) and writes web/public/data/regions/<id>.transit.bin.gz.
 * Run: `bun scripts/buildTransit.ts <region id>|all` (the feeds are in scripts/transitFeeds.ts). Needs cargo.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { TRANSIT_FEEDS } from './transitFeeds';

const root = new URL('..', import.meta.url).pathname;
const cache = `${root}.cache/gtfs`;
const regions = `${root}web/public/data/regions`;
const tmp = `${root}.cache/tmp`;

/** One file per feed URL: the SNCF feed serves several regions */
const feedFile = (url: string): string => `${cache}/${new Bun.CryptoHasher('sha1').update(url).digest('hex').slice(0, 12)}.zip`;

const run = async (cmd: string[]): Promise<void> => {
  const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  if ((await proc.exited) !== 0) throw new Error(`${cmd[0]} failed`);
};

const build = async (id: string): Promise<void> => {
  const feed = TRANSIT_FEEDS[id];
  if (!feed) throw new Error(`No feed for ${id} (scripts/transitFeeds.ts)`);
  console.log(`=== ${id}: ${feed.name}`);

  const zip = feedFile(feed.url);
  if (!existsSync(zip)) {
    const res = await fetch(feed.url);
    if (!res.ok) throw new Error(`${feed.url}: HTTP ${res.status}`);
    await Bun.write(zip, res);
    console.log(`  downloaded ${(Bun.file(zip).size / 1e6).toFixed(0)} MB`);
  }

  // gtfs-prep reads the zone from the header of the plain network file
  const graph = `${tmp}/${id}.bin`;
  const out = `${tmp}/${id}.transit.bin`;
  await Bun.write(graph, Bun.gunzipSync(await Bun.file(`${regions}/${id}.bin.gz`).bytes()));
  await run(['cargo', 'run', '-q', '-p', 'gtfs-prep', '--release', '--', zip, graph, out]);

  await Bun.write(`${regions}/${id}.transit.bin.gz`, Bun.gzipSync(await Bun.file(out).bytes(), { level: 9 }));
  rmSync(graph);
  rmSync(out);
};

mkdirSync(cache, { recursive: true });
mkdirSync(tmp, { recursive: true });
const arg = process.argv[2];
if (!arg) throw new Error('usage: bun scripts/buildTransit.ts <region id>|all');
for (const id of arg === 'all' ? Object.keys(TRANSIT_FEEDS) : [arg]) await build(id);
