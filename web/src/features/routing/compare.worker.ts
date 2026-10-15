/// <reference lib="webworker" />
/**
 * Compares the modes on one trip, off the main thread: the network of each mode is prepared once for the current
 * settings (hour, model, cuts), then each trip is a Dijkstra that stops at its destination.
 */
import type { Mode } from '@/shared/config';
import type { Network } from './network';
import { buildProfile, type Profile, type ProfileOptions } from './profile';
import { SnapIndex } from './snap';
import { tripSeconds, type ZoneXY } from './trip';

/** The settings shared by the modes compared */
export type CompareOptions = Omit<ProfileOptions, 'mode' | 'direction'>;

export type CompareRequest =
  | { type: 'network'; net: Network }
  | { type: 'compare'; id: number; from: ZoneXY; to: ZoneXY; options: CompareOptions; modes: Mode[] };

export interface CompareResult {
  id: number;
  /** Seconds per mode; undefined when the trip is impossible or longer than the bound */
  seconds: Partial<Record<Mode, number>>;
}

/** Longest trip compared: beyond, "more than…" */
const MAX_SECONDS = 4 * 3600;

const state: {
  net?: Network;
  /** Settings the prepared networks belong to */
  key?: string;
  prepared: Map<Mode, { profile: Profile; index: SnapIndex }>;
} = { prepared: new Map() };

const keyOf = (o: CompareOptions): string =>
  JSON.stringify([o.bus, o.hour, o.model, Array.from(o.closed)]);

/** The network of a mode for these settings: prepared once, kept while the settings stay */
const prepare = (net: Network, mode: Mode, options: CompareOptions): { profile: Profile; index: SnapIndex } => {
  const key = keyOf(options);
  if (state.key !== key) {
    state.prepared.clear();
    state.key = key;
  }

  const ready = state.prepared.get(mode);
  if (ready) return ready;

  const profile = buildProfile(net, { ...options, mode, direction: 'departure' });
  // The islands of the network with every section open (see SnapIndex.build)
  const open = options.closed.length ? buildProfile(net, { ...options, mode, direction: 'departure', closed: new Uint32Array(0) }) : profile;
  const prepared = { profile, index: new SnapIndex(net, profile, open) };
  state.prepared.set(mode, prepared);

  return prepared;
};

self.onmessage = (event: MessageEvent<CompareRequest>) => {
  const msg = event.data;
  if (msg.type === 'network') {
    state.net = msg.net;
    state.prepared.clear();
    state.key = undefined;

    return;
  }

  const { net } = state;
  if (!net) return;

  const seconds: Partial<Record<Mode, number>> = {};
  for (const mode of msg.modes) {
    const { profile, index } = prepare(net, mode, msg.options);
    seconds[mode] = tripSeconds(net, profile, index, msg.from, msg.to, MAX_SECONDS);
  }

  const result: CompareResult = { id: msg.id, seconds };
  self.postMessage(result);
};
