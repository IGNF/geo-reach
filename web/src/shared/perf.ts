/**
 * Rendering measures, to see where a stutter comes from: the map frames, the engine runs, the work done on the main
 * thread at each update, the GPU layers. Recorded only while the panel is open (a few array pushes per frame).
 */

export type Channel =
  /** Milliseconds between two frames of the map */
  | 'frame'
  /** Milliseconds between two color updates (results shown) */
  | 'update'
  /** Engine run in the worker */
  | 'run'
  /** From the cursor position to its result on the page: snap, run, copies, and the worker's queue and transfer when it ran there */
  | 'roundTrip'
  /** Main thread work per result shown: upload prepared, panels, trip */
  | 'apply'
  /** CPU time of the map per frame: basemap, network, buildings and labels, uploads included */
  | 'network'
  /** A tile of buildings handed to the map (main thread) */
  | 'buildings'
  /** A tile of buildings joined to its streets (main thread) */
  | 'anchors'
  /** From a cursor move to the frame that shows its times */
  | 'latency'
  /** Main thread tasks over 50 ms (Chromium only) */
  | 'longTask';

export interface Sample {
  at: number;
  ms: number;
}

export interface Stats {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

/** What the map tells about itself when the panel asks */
export interface Probe {
  gpu: string;
  /** Drawing buffer, device pixels */
  canvas: [number, number];
  dpr: number;
  zoom: number;
  /** Basemap tiles still loading */
  tilesLoading: boolean;
  segments: number;
  /** Segments drawn in the last frame: those in view */
  drawnSegments: number;
  /** The last engine run was made on the main thread (short runs), not in the worker */
  engineOnMain: boolean;
  buildingTiles: number;
}

/** Samples kept, milliseconds */
const KEEP_MS = 10_000;
/** Two frames further apart than this: the map was idle, not stuttering */
const IDLE_MS = 1000;
const STORAGE_KEY = 'geo-reach.perf';

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

class PerfMonitor {
  private samples = new Map<Channel, Sample[]>();
  private listeners = new Set<() => void>();
  private lastFrame = 0;
  private lastUpdate = 0;
  /** Cursor time of the result applied, waiting for the frame that shows it */
  private shownCursor?: number;
  private longTasks?: PerformanceObserver;
  private probeFn?: () => Probe;
  open = false;

  constructor() {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'open') this.setOpen(true);
    } catch {
      // Storage blocked: the panel starts closed
    }
  }

  get enabled(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    for (const list of this.samples.values()) list.length = 0;
    this.lastFrame = 0;
    this.lastUpdate = 0;
    this.watchLongTasks(open);
    try {
      localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed');
    } catch {
      // Not remembered: no matter
    }
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  record(channel: Channel, ms: number, at = performance.now()): void {
    if (!this.open) return;
    const list = this.samples.get(channel) ?? [];
    list.push({ at, ms });
    const old = list.findIndex((s) => s.at >= at - KEEP_MS);
    if (old > 0) list.splice(0, old);
    this.samples.set(channel, list);
  }

  /** Runs `fn` and records its duration */
  time<T>(channel: Channel, fn: () => T): T {
    if (!this.open) return fn();
    const t0 = performance.now();
    const value = fn();
    this.record(channel, performance.now() - t0);

    return value;
  }

  /** A frame drawn by the map; it shows the latest result applied, if any */
  frame(): void {
    if (!this.open) return;
    const now = performance.now();
    if (this.lastFrame && now - this.lastFrame < IDLE_MS) this.record('frame', now - this.lastFrame, now);
    this.lastFrame = now;
    if (this.shownCursor !== undefined) {
      this.record('latency', now - this.shownCursor, now);
      this.shownCursor = undefined;
    }
  }

  /** A result applied to the map, computed for a cursor position seen at `cursorAt` */
  update(cursorAt: number | undefined): void {
    if (!this.open) return;
    const now = performance.now();
    if (this.lastUpdate && now - this.lastUpdate < IDLE_MS) this.record('update', now - this.lastUpdate, now);
    this.lastUpdate = now;
    this.shownCursor = cursorAt;
  }

  setProbe(probe: (() => Probe) | undefined): void {
    this.probeFn = probe;
  }

  probe(): Probe | undefined {
    return this.probeFn?.();
  }

  series(channel: Channel, windowMs: number): Sample[] {
    const since = performance.now() - windowMs;

    return (this.samples.get(channel) ?? []).filter((s) => s.at >= since);
  }

  stats(channel: Channel, windowMs: number): Stats {
    const values = this.series(channel, windowMs)
      .map((s) => s.ms)
      .sort((a, b) => a - b);

    return { count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.at(-1) ?? 0 };
  }

  get longTasksSupported(): boolean {
    return typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask');
  }

  private watchLongTasks(on: boolean): void {
    this.longTasks?.disconnect();
    this.longTasks = undefined;
    if (!on || !this.longTasksSupported) return;

    this.longTasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) this.record('longTask', entry.duration, entry.startTime + entry.duration);
    });
    this.longTasks.observe({ type: 'longtask' });
  }
}

/** The measures of the page */
export const perf = new PerfMonitor();
