/**
 * The region files (data/regions/*.bin.gz) live outside Git, as the assets of a GitHub release per DATA_VERSION;
 * data/manifest.json, versioned, names that release and the size and SHA-256 of each file.
 *
 * - `bun run regions pull`: downloads the files missing or different from the manifest (nothing when up to date);
 * - `bun run regions push`: after `prep`, publishes the files as the release `data-<DATA_VERSION>` and writes the
 *   manifest. A version is published once: new files take a new DATA_VERSION (browsers drop their copy too).
 *
 * The downloads go through HTTPS_PROXY when it is set (IGN network); publishing needs `gh`, logged in.
 */
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_VERSION } from '@/shared/dataCache';

const REPO = 'IGNF/geo-reach';
const root = join(import.meta.dir, '..');
const dir = join(root, 'data/regions');
const manifestPath = join(root, 'data/manifest.json');
/** The manifest of the last complete pull: when it matches, the files are not read again */
const stampPath = join(dir, '.pulled.json');
/** Files downloaded at once */
const CONCURRENCY = 4;

interface Manifest {
  release: string;
  files: Record<string, { size: number; sha256: string }>;
}

const sha256 = async (path: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);

  return hasher.digest('hex');
};

const readJson = async <T>(path: string): Promise<T | undefined> => {
  const file = Bun.file(path);

  return (await file.exists()) ? ((await file.json()) as T) : undefined;
};

/** Whether a local file is the one of the manifest */
const isCurrent = async (name: string, expected: { size: number; sha256: string }): Promise<boolean> => {
  const file = Bun.file(join(dir, name));
  if (!(await file.exists()) || file.size !== expected.size) return false;

  return (await sha256(join(dir, name))) === expected.sha256;
};

const download = async (release: string, name: string, expected: { size: number; sha256: string }): Promise<void> => {
  const url = `https://github.com/${REPO}/releases/download/${release}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} (${url})`);
  // Written beside, then renamed: an interrupted download never stands for the file
  const partial = join(dir, `${name}.part`);
  await Bun.write(partial, res);
  const got = await sha256(partial);
  if (got !== expected.sha256) throw new Error(`${name}: SHA-256 ${got}, ${expected.sha256} expected`);
  renameSync(partial, join(dir, name));
  console.log(`  ${name}, ${(expected.size / 1e6).toFixed(1)} MB`);
};

const pull = async (): Promise<void> => {
  const manifest = await readJson<Manifest>(manifestPath);
  if (!manifest) throw new Error('data/manifest.json missing: nothing published yet (bun run regions push)');

  const stamp = await readJson<Manifest>(stampPath);
  const names = Object.keys(manifest.files);
  const present = names.every((n) => Bun.file(join(dir, n)).size === manifest.files[n].size);
  if (present && JSON.stringify(stamp) === JSON.stringify(manifest)) return console.log(`Region files up to date (${manifest.release})`);

  const missing: string[] = [];
  for (const name of names) if (!(await isCurrent(name, manifest.files[name]))) missing.push(name);
  if (missing.length) console.log(`Downloading ${missing.length} region files of ${manifest.release}`);
  const queue = [...missing];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let name = queue.shift(); name; name = queue.shift()) await download(manifest.release, name, manifest.files[name]);
    }),
  );
  await Bun.write(stampPath, JSON.stringify(manifest));
  console.log(`Region files up to date (${manifest.release})`);
};

const gh = (args: string[]): { ok: boolean; out: string } => {
  const run = Bun.spawnSync(['gh', ...args], { cwd: root, stderr: 'pipe' });

  return { ok: run.exitCode === 0, out: `${run.stdout.toString()}${run.stderr.toString()}` };
};

const push = async (): Promise<void> => {
  const release = `data-${DATA_VERSION}`;
  const names = readdirSync(dir)
    .filter((n) => n.endsWith('.bin.gz'))
    .sort();
  const files: Manifest['files'] = {};
  for (const name of names) files[name] = { size: Bun.file(join(dir, name)).size, sha256: await sha256(join(dir, name)) };
  const manifest: Manifest = { release, files };

  if (gh(['release', 'view', release, '-R', REPO]).ok) {
    const published = await readJson<Manifest>(manifestPath);
    if (JSON.stringify(published) === JSON.stringify(manifest)) return console.log(`${release} already published, the same files`);
    throw new Error(`${release} is published with other files: bump DATA_VERSION in web/src/shared/dataCache.ts`);
  }

  console.log(`Publishing ${names.length} region files as ${release}…`);
  const notes = `Region files of geo-reach for DATA_VERSION ${DATA_VERSION} (roads GRF4, public transport TRN3), fetched by \`bun run regions pull\`. Sources and licences: data/README.md.`;
  const created = gh(['release', 'create', release, '-R', REPO, '--title', `Region data ${DATA_VERSION}`, '--notes', notes, '--latest=false', ...names.map((n) => join(dir, n))]);
  if (!created.ok) throw new Error(created.out);
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(stampPath, JSON.stringify(manifest));
  console.log(`${release} published; data/manifest.json written (commit it)`);
};

const command = process.argv[2];
if (command === 'pull') await pull();
else if (command === 'push') await push();
else {
  console.error('usage: bun run regions pull | push');
  process.exit(1);
}
