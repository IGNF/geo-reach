import { closedEdges, type Cut, edgesOfCut } from '@/engine/cuts';
import { type Network, readRoadNetwork } from '@/engine/network';
import type { ProfileOptions } from '@/engine/profile';
import { readTransit } from '@/engine/transit';
import { TravelEngine } from '@/engine/travelEngine';
import { GRAPH_URL, TRANSIT_URL } from '@/lib/config';
import { loadData } from '@/lib/dataCache';

/** Steps of the start, in order; the map and the first computation happen once the engine is handed over */
export type StartupStep = 'download' | 'roads' | 'transit' | 'engine' | 'map' | 'firstRun';

export interface StartupProgress {
  step: StartupStep;
  /** 0–100 */
  percent: number;
  /** Megabytes downloaded, during the download */
  mb?: number;
}

/** Where each step starts on the bar, in percent: the download takes most of a first visit */
export const STEP_START: Record<StartupStep, number> = {
  download: 0,
  roads: 55,
  transit: 63,
  engine: 76,
  map: 88,
  firstRun: 95,
};

/**
 * Size of both files when the server does not tell it (compressed transfer), only to move the bar: a little off
 * after a data update, the bar then jumps at the end of the download
 */
const EXPECTED_BYTES = 36_600_000;

/** Lets the browser paint the bar before a long synchronous step */
const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export interface Started {
  engine: TravelEngine;
  /** The transit layer could be loaded */
  transit: boolean;
  /** The cuts of the link that exist in this network */
  cuts: Cut[];
}

/**
 * Downloads the two data files, decodes them and builds the engine, reporting the progress. The transit layer is
 * optional: without it the app runs on the roads alone.
 */
export const startEngine = async (
  options: Omit<ProfileOptions, 'closed'>,
  cuts: Cut[],
  onProgress: (p: StartupProgress) => void,
): Promise<Started> => {
  // Both downloads at once, one bar
  const files = { graph: { bytes: 0, total: 0 }, transit: { bytes: 0, total: 0 } };
  const report = (): void => {
    const bytes = files.graph.bytes + files.transit.bytes;
    const known = files.graph.total > 0 && files.transit.total > 0;
    const total = known ? files.graph.total + files.transit.total : Math.max(EXPECTED_BYTES, bytes);
    onProgress({ step: 'download', percent: (STEP_START.roads * bytes) / total, mb: bytes / 1e6 });
  };
  const track =
    (file: keyof typeof files) =>
    (bytes: number, total: number | undefined): void => {
      files[file] = { bytes, total: total ?? 0 };
      report();
    };

  const [graphBuffer, transitBuffer] = await Promise.all([
    loadData(GRAPH_URL, track('graph')),
    loadData(TRANSIT_URL, track('transit')).catch(() => undefined),
  ]);

  onProgress({ step: 'roads', percent: STEP_START.roads });
  await nextPaint();
  const roads = readRoadNetwork(graphBuffer);

  onProgress({ step: 'transit', percent: STEP_START.transit });
  await nextPaint();
  const net: Network = transitBuffer ? readTransit(transitBuffer)(roads) : roads;

  onProgress({ step: 'engine', percent: STEP_START.engine });
  await nextPaint();
  // Cuts of a link made on other data are dropped
  const valid = cuts.filter((c) => edgesOfCut(net, c).length);
  const mode = !transitBuffer && options.mode === 'transit' ? 'pedestrian' : options.mode;
  const engine = await TravelEngine.create(net, { ...options, mode, closed: closedEdges(net, valid) });

  onProgress({ step: 'map', percent: STEP_START.map });

  return { engine, transit: !!transitBuffer, cuts: valid };
};
