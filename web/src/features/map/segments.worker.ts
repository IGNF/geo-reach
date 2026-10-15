/// <reference lib="webworker" />
/**
 * Builds the segments of the network layer for each new profile, off the main thread: millions of segments for a
 * region, which would freeze the map for a second at every change of mode. Gets the geometry of the network once.
 */

import type { Profile } from '@/features/routing';
import { buildSegments, type Chunks, type SegmentSource, type Segments } from './networkSegments';

export type SegmentsRequest =
  | { type: 'network'; source: SegmentSource; chunks: Chunks }
  | ({ type: 'profile'; id: number } & Pick<Profile, 'fwd' | 'bwd' | 'direction'>);

export interface SegmentsResult {
  id: number;
  segments: Segments;
}

const state: { source?: SegmentSource; chunks?: Chunks } = {};

self.onmessage = ({ data: msg }: MessageEvent<SegmentsRequest>) => {
  if (msg.type === 'network') {
    state.source = msg.source;
    state.chunks = msg.chunks;

    return;
  }
  if (!state.source || !state.chunks) return;

  const segments = buildSegments(state.source, state.chunks, msg);
  const result: SegmentsResult = { id: msg.id, segments };
  self.postMessage(result, [segments.geom.buffer, segments.cost.buffer, segments.chunkStart.buffer]);
};
