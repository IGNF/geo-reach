import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { contourGrid } from './contours';
import type { ContourRequest, ContourResult } from './contour.worker';
import type { TravelEngine } from '@/features/routing';

interface Job {
  dist: Float32Array;
  /** Seconds */
  limits: number[];
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Smooth isochrone lines, traced by their own worker from the node times. One request at a time: the latest job
 * waiting meanwhile replaces any older one, so a slow trace (long car runs) never piles up nor blocks the map.
 */
export class ContourLines {
  private readonly map: MlMap;
  private readonly engine: TravelEngine;
  private readonly worker = new Worker(new URL('./contour.worker.ts', import.meta.url), { type: 'module' });

  /** The grid goes to the worker once, with the first job */
  private gridSent = false;
  /** Id of the latest request: older answers are dropped */
  private lastId = 0;
  private busy = false;
  private waiting?: Job;

  constructor(map: MlMap, engine: TravelEngine) {
    this.map = map;
    this.engine = engine;
    this.worker.onmessage = (event: MessageEvent<ContourResult>) => this.onLines(event.data);
  }

  /** Traces the lines of these limits from the node times, or clears them */
  draw(dist: Float32Array | undefined, limits: number[]): void {
    if (!this.source()) return;

    if (!dist || !limits.length) {
      this.waiting = undefined;
      this.lastId += 1;
      this.source()?.setData(EMPTY);

      return;
    }

    // A copy: the result's buffers go back to the engine worker
    const job = { dist: dist.slice(), limits };
    if (this.busy) this.waiting = job;
    else this.send(job);
  }

  terminate(): void {
    this.worker.terminate();
  }

  private source(): GeoJSONSource | undefined {
    return this.map.getSource<GeoJSONSource>('contours');
  }

  private send(job: Job): void {
    const { engine } = this;

    if (!this.gridSent) {
      const grid = contourGrid(engine.net, engine.groundScale);
      this.worker.postMessage({ type: 'grid', grid, origin: engine.net.origin } satisfies ContourRequest);
      this.gridSent = true;
    }

    this.busy = true;
    this.lastId += 1;
    const request: ContourRequest = { type: 'lines', id: this.lastId, dist: job.dist, limits: job.limits, walkSpeed: engine.walkSpeed };
    this.worker.postMessage(request, [job.dist.buffer]);
  }

  private onLines({ id, features }: ContourResult): void {
    this.busy = false;

    // A newer request supersedes this answer: draw the newest only
    if (id === this.lastId) this.source()?.setData({ type: 'FeatureCollection', features });

    const next = this.waiting;
    this.waiting = undefined;
    if (next) this.send(next);
  }
}
