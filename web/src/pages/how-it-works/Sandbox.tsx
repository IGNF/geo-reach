import { Box, SegmentedSwitch, Slider, Stack, Switch, Typography } from '@ign-junn/design-system';
import { type PointerEvent, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_MODEL,
  EDGE_ALIGHT,
  EDGE_BOARD,
  EDGE_LINK,
  EDGE_RIDE,
  type ModelOptions,
  type ProfileOptions,
  type Result,
  TravelEngine,
} from '@/features/routing';
import type { Mode } from '@/shared/config';
import { RAMP_GRADIENT_CSS } from '@/shared/colors';
import { howItWorks as h } from '@/locales/howItWorks';
import { bridgeEdges, buildTown, SIZE } from './town';
import { drawTown, type Scene, toTown, type View } from './townCanvas';

const MODES: Mode[] = ['pedestrian', 'bike', 'car', 'transit'];
/** Maximum time each mode opens with: the town is 3 km wide, a car crosses it in a few minutes */
const MODE_MINUTES: Record<Mode, number> = { pedestrian: 15, bike: 6, car: 4, transit: 15 };
/** Where the town opens: between the boulevard and the metro, near its middle station */
const FIRST_START = { x: 1300, y: 1000 };
/** Canvas margin, pixels */
const PAD = 14;

type LegKey = keyof typeof h.sandbox.legs;

/** What the panel shows under the town */
interface Figures {
  runMs: number;
  settled: number;
  /** Share of the crossings the mode can use that the run reaches, percent */
  reached: number;
  /** With a pinned start: the trip to the cursor, seconds, and its parts */
  trip?: { seconds: number; legs: [LegKey, number][] };
}

const minutes = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);

  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
};

/**
 * The engine of the map on a made-up town: the visitor moves the mouse and sees the times spread from the cursor,
 * then pins a start and reads the trip to the cursor. Every computation is the map's own (TravelEngine: snap, worker,
 * WebAssembly); only the town is drawn here, on a canvas.
 */
const Sandbox = (): ReactElement => {
  const s = h.sandbox;
  const net = useMemo(buildTown, []);
  const bridge = useMemo(() => bridgeEdges(net), [net]);

  const [mode, setMode] = useState<Mode>('pedestrian');
  const [maxMinutes, setMaxMinutes] = useState(15);
  const [hour, setHour] = useState(8);
  const [relief, setRelief] = useState(true);
  const [wait, setWait] = useState<ModelOptions['wait']>('half');
  const [bus, setBus] = useState(true);
  const [closed, setClosed] = useState(false);
  const [engine, setEngine] = useState<TravelEngine>();
  const [figures, setFigures] = useState<Figures>();
  const [pinned, setPinned] = useState(false);

  const options = useMemo<ProfileOptions>(
    () => ({
      mode,
      direction: 'departure',
      bus,
      hour,
      model: { ...DEFAULT_MODEL, relief, wait },
      closed: closed ? bridge : new Uint32Array(0),
    }),
    [mode, bus, hour, relief, wait, closed, bridge],
  );

  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 0.2, pad: PAD, height: 0 });
  /** The latest cursor, the run shown, the pinned start: read by the animation frame, not by React */
  const live = useRef<{
    cursor: { x: number; y: number };
    result?: Result;
    pinned?: Result;
    /** Where the pinned start was clicked */
    pinnedAt?: { x: number; y: number };
    busy: boolean;
    again: boolean;
  }>({
    cursor: FIRST_START,
    busy: false,
    again: false,
  });

  // The engine: its workers live as long as the section
  useEffect(() => {
    const state = { alive: true, engine: undefined as TravelEngine | undefined };
    void TravelEngine.create(net, options).then((e) => {
      if (state.alive) {
        state.engine = e;
        setEngine(e);
      } else e.dispose();
    });

    return () => {
      state.alive = false;
      state.engine?.dispose();
    };
    // Created once; the options go through setProfile below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  /** Draws the current state; with a pinned start, the trip to the cursor */
  const draw = useCallback(() => {
    const ctx = canvas.current?.getContext('2d');
    const l = live.current;
    const shown = l.pinned ?? l.result;
    if (!ctx || !engine || !shown) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scene: Scene = { net, profile: shown.profile, dist: shown.dist, maxSeconds: maxMinutes * 60 };
    scene.start = { ...(l.pinnedAt ?? l.cursor), sx: shown.snap.x, sy: shown.snap.y };

    const reachable = shown.profile.offsets;
    let usable = 0;
    let reached = 0;
    for (let n = 0; n < net.firstStation; n += 1) {
      if ((reachable[n + 1] ?? 0) === (reachable[n] ?? 0)) continue;
      usable += 1;
      if ((shown.dist[n] ?? Infinity) <= scene.maxSeconds) reached += 1;
    }
    const next: Figures = { runMs: shown.runMs, settled: shown.settled, reached: usable ? Math.round((100 * reached) / usable) : 0 };

    if (l.pinned) {
      const at = engine.timeAt(l.pinned, l.cursor.x, l.cursor.y);
      if (at) {
        const path = engine.path(l.pinned, at.node);
        scene.destination = { ...l.cursor, path };
        const sums = new Map<LegKey, number>([['access', l.pinned.access]]);
        const kinds: Record<number, LegKey> = { [EDGE_LINK]: 'link', [EDGE_BOARD]: 'wait', [EDGE_RIDE]: 'ride', [EDGE_ALIGHT]: 'transfer' };
        for (const step of path) {
          const key = kinds[net.edgeKind[step.edge] ?? 0] ?? 'street';
          sums.set(key, (sums.get(key) ?? 0) + step.cost);
        }
        sums.set('access', (sums.get('access') ?? 0) + at.walk);
        next.trip = { seconds: at.seconds, legs: [...sums].filter(([, v]) => v >= 1) };
      } else next.trip = { seconds: Infinity, legs: [] };
    }

    drawTown(ctx, view.current, scene);
    setFigures(next);
  }, [engine, maxMinutes, net]);

  /** Runs the engine from the cursor, one run at a time: a move during a run asks for one more, from the latest point */
  const run = useCallback(async () => {
    const l = live.current;
    if (!engine) return;
    if (l.busy) {
      l.again = true;
      return;
    }
    l.busy = true;
    const r = await engine.run(l.cursor.x, l.cursor.y, maxMinutes * 60);
    if (r) {
      if (l.result && l.result !== l.pinned) engine.recycle(l.result);
      l.result = r;
    }
    l.busy = false;
    draw();
    if (l.again) {
      l.again = false;
      void run();
    }
  }, [engine, maxMinutes, draw]);

  // A new profile (mode, hour, closure…): the pinned start is computed again with it
  useEffect(() => {
    if (!engine) return;
    engine.setProfile(options);
    const l = live.current;
    if (!l.pinned) {
      void run();
      return;
    }
    const at = l.pinnedAt ?? l.cursor;
    void engine.run(at.x, at.y, maxMinutes * 60).then((r) => {
      if (!r) return;
      if (l.pinned && l.pinned !== l.result) engine.recycle(l.pinned);
      l.pinned = r;
      draw();
    });
  }, [engine, options, maxMinutes, run, draw]);

  // The canvas follows the width of the page
  useEffect(() => {
    const el = canvas.current;
    if (!el) return undefined;
    const last = { width: 0 };
    const resize = (): void => {
      const width = el.parentElement?.clientWidth ?? 600;
      // Only the width drives the size: the height set here must not call the observer again
      if (width === last.width) return;
      last.width = width;
      const scale = (width - 2 * PAD) / SIZE.width;
      const height = SIZE.height * scale + 2 * PAD;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      el.style.height = `${height}px`;
      view.current = { scale, pad: PAD, height };
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el.parentElement ?? el);

    return () => observer.disconnect();
  }, [draw]);

  const toCursor = (e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const [x, y] = toTown(view.current, e.clientX - rect.left, e.clientY - rect.top);

    return { x: Math.min(Math.max(x, 0), SIZE.width), y: Math.min(Math.max(y, 0), SIZE.height) };
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    live.current.cursor = toCursor(e);
    if (live.current.pinned) requestAnimationFrame(draw);
    else void run();
  };

  const onClick = (e: PointerEvent<HTMLCanvasElement>): void => {
    const l = live.current;
    l.cursor = toCursor(e);
    if (l.pinned) {
      if (l.pinned !== l.result) engine?.recycle(l.pinned);
      l.pinned = undefined;
      l.pinnedAt = undefined;
      setPinned(false);
      void run();
    } else if (l.result) {
      l.pinned = l.result;
      l.pinnedAt = l.cursor;
      setPinned(true);
      draw();
    }
  };

  const noService = mode === 'transit' && hour < 5;

  return (
    <Box className="sandbox">
      <Box className="sandbox-controls">
        <SegmentedSwitch
          label={s.mode}
          fullWidth
          value={mode}
          onChange={(m) => {
            setMode(m);
            setMaxMinutes(MODE_MINUTES[m]);
          }}
          options={MODES.map((m) => ({ value: m, label: s.modes[m] }))}
        />
        <Stack gap={4}>
          <Typography variant="caption">{s.maxTime(maxMinutes)}</Typography>
          <Slider label={s.maxTime(maxMinutes)} min={2} max={30} step={1} value={maxMinutes} onChange={setMaxMinutes} />
        </Stack>
        <Stack gap={4}>
          <Typography variant="caption">{s.hour(hour)}</Typography>
          <Slider label={s.hour(hour)} min={0} max={23} step={1} value={hour} onChange={setHour} />
        </Stack>
        {mode === 'transit' && (
          <SegmentedSwitch
            label={s.wait}
            fullWidth
            value={wait}
            onChange={setWait}
            options={(['half', 'full'] as const).map((w) => ({ value: w, label: s.waits[w] }))}
          />
        )}
        {mode === 'transit' && <Switch label={s.bus} checked={bus} onChange={setBus} size="xs" />}
        <Switch label={s.relief} checked={relief} onChange={setRelief} size="xs" />
        <Switch label={s.bridge} checked={closed} onChange={setClosed} size="xs" />
      </Box>

      <Box className="sandbox-view">
        <Box className="sandbox-canvas">
          <canvas ref={canvas} onPointerMove={onMove} onPointerDown={onClick} aria-label={s.title} />
        </Box>
        <Box className="sandbox-legend">
          <span>0</span>
          <i style={{ background: RAMP_GRADIENT_CSS }} />
          <span>{`${maxMinutes} min`}</span>
        </Box>
        <Typography variant="hint">{pinned ? s.pinned : s.hint}</Typography>
        {noService && <Typography variant="hint">{s.noService}</Typography>}
        {figures && (
          <Box className="sandbox-figures">
            {figures.trip ? (
              <Stack gap={2}>
                <Typography variant="stat">
                  {Number.isFinite(figures.trip.seconds) ? s.trip(minutes(figures.trip.seconds)) : s.unreachable}
                </Typography>
                <Typography variant="caption">
                  {figures.trip.legs.map(([k, v]) => `${s.legs[k]} ${minutes(v)}`).join(' · ')}
                </Typography>
              </Stack>
            ) : (
              <Typography variant="stat">{s.reached(figures.reached, maxMinutes)}</Typography>
            )}
            <Typography variant="caption">{s.run(figures.runMs < 0.1 ? '< 0.1' : figures.runMs.toFixed(1), figures.settled)}</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default Sandbox;
