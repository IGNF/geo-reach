/**
 * Builds crates/engine to WebAssembly and copies it into the app. Finds cargo on the PATH or in ~/.cargo/bin (IDEs
 * often start without the shell PATH). Without Rust, the versioned engine.wasm is kept, so the app still runs.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const target = join(root, 'web/src/engine/engine.wasm');
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const cargo = Bun.which('cargo') ?? [join(cargoHome, 'bin/cargo')].find(existsSync);

if (!cargo) {
  if (!existsSync(target)) {
    console.error('cargo not found (PATH, ~/.cargo/bin) and no engine.wasm: install Rust, see the README');
    process.exit(1);
  }
  console.warn('cargo not found: using the versioned web/src/engine/engine.wasm');
  process.exit(0);
}

const build = Bun.spawnSync(
  [cargo, 'build', '-p', 'engine', '--target', 'wasm32-unknown-unknown', '--release'],
  { cwd: root, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, PATH: `${join(cargoHome, 'bin')}:${process.env.PATH ?? ''}` } },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
await Bun.write(target, Bun.file(join(root, 'target/wasm32-unknown-unknown/release/engine.wasm')));
console.log('engine.wasm updated');
