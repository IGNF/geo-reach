import { Box, Button, Typography } from '@ign-junn/design-system';
import { IconCopy, IconX } from '@ign-junn/design-system/icons';
import { type ReactElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type Channel, perf, type Probe, type Stats } from '@/shared/perf';
import { t } from '@/locales';

/** Figures over the last seconds */
const WINDOW_MS = 3000;
/** The chart over a longer stretch, to see the hitches go by */
const CHART_MS = 6000;
const REFRESH_MS = 250;
/** One frame at 60 Hz, and a frame dropped */
const FRAME_MS = 1000 / 60;
const JANK_MS = 50;

const ROWS: Channel[] = ['frame', 'update', 'run', 'roundTrip', 'apply', 'network', 'buildings', 'anchors', 'latency', 'longTask'];

interface Snapshot {
  stats: Record<Channel, Stats>;
  probe?: Probe;
}

const take = (): Snapshot => ({
  stats: Object.fromEntries(ROWS.map((c) => [c, perf.stats(c, WINDOW_MS)])) as Record<Channel, Stats>,
  probe: perf.probe(),
});

/** Where the stutter most likely comes from, from the figures */
const diagnose = ({ stats: s, probe }: Snapshot): string => {
  const d = t.perf.diagnosis;
  if (s.frame.count < 10) return d.idle;
  if (s.longTask.count > 0 && s.longTask.max > 80) return d.mainThread;
  if (s.apply.p95 > 12 || s.anchors.max > 30) return d.mainThread;
  if (s.update.count > 5 && s.update.p95 > 3 * FRAME_MS && s.roundTrip.p95 > 2 * FRAME_MS) return d.engine;
  if (s.frame.p95 > 1.5 * FRAME_MS) return probe?.tilesLoading ? d.tiles : d.gpu;

  return d.fluid;
};

const fmt = (ms: number): string => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1));

/** Frame intervals (top) and color updates (bottom) over the last seconds; the tall bars are the hitches */
const Chart = ({ tick }: { tick: number }): ReactElement => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [canvas.clientWidth, canvas.clientHeight];
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const now = performance.now();
    const lane = h / 2;
    const lanes: [Channel, number][] = [
      ['frame', 0],
      ['update', lane],
    ];
    for (const [channel, top] of lanes) {
      // 0 to 100 ms, guides at one and two frames
      const y = (ms: number) => top + lane - 2 - (Math.min(ms, 100) / 100) * (lane - 4);
      ctx.strokeStyle = 'rgb(128 128 128 / 35%)';
      ctx.lineWidth = 1;
      for (const guide of [FRAME_MS, 2 * FRAME_MS]) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y(guide)) + 0.5);
        ctx.lineTo(w, Math.round(y(guide)) + 0.5);
        ctx.stroke();
      }
      for (const { at, ms } of perf.series(channel, CHART_MS)) {
        const x = w - ((now - at) / CHART_MS) * w;
        ctx.fillStyle = ms > JANK_MS ? '#d73027' : ms > 2 * FRAME_MS + 2 ? '#f39c12' : '#1a9850';
        ctx.fillRect(x - 1, y(ms), 2, top + lane - 2 - y(ms));
      }
    }
  }, [tick]);

  return <canvas ref={ref} className="perf-chart" aria-hidden />;
};

/** Rendering figures of the map, opened by its button: frames, engine, main thread, GPU layers */
const PerfPanel = (): ReactElement | null => {
  const open = useSyncExternalStore(
    (listener) => perf.subscribe(listener),
    () => perf.open,
  );
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS);

    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;

  const snapshot = take();
  const { stats, probe } = snapshot;
  const fps = stats.frame.count / (WINDOW_MS / 1000);
  const updates = stats.update.count / (WINDOW_MS / 1000);
  const labels = t.perf.rows;

  const copy = (): void => {
    const text = JSON.stringify({ userAgent: navigator.userAgent, windowMs: WINDOW_MS, ...snapshot }, (_, v: unknown) =>
      typeof v === 'number' ? Math.round(v * 10) / 10 : v,
    );
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <Box className="perf-panel glass" role="region" aria-label={t.perf.title}>
      <Box className="perf-head">
        <Box className="perf-title">
          <Typography variant="strong">{t.perf.title}</Typography>
          <Typography variant="hint">{t.perf.summary(Math.round(fps), Math.round(updates))}</Typography>
        </Box>
        <Button label={copied ? t.perf.copied : t.perf.copy} icon={IconCopy} variant="subtle" size="xs" onClick={copy} />
        <Button label={t.perf.close} icon={IconX} iconOnly variant="subtle" onClick={() => perf.setOpen(false)} />
      </Box>

      <Chart tick={tick} />
      <Box className="perf-legend">
        <span>{t.perf.chartFrames}</span>
        <span>{t.perf.chartUpdates}</span>
      </Box>

      <table className="perf-table">
        <thead>
          <tr>
            <th />
            <th>p50</th>
            <th>p95</th>
            <th>max</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((channel) => {
            const s = stats[channel];
            const unsupported = channel === 'longTask' && !perf.longTasksSupported;

            return (
              <tr key={channel} title={labels[channel].hint}>
                <td>{labels[channel].label}</td>
                {unsupported ? (
                  <td colSpan={4}>{t.perf.unsupported}</td>
                ) : (
                  <>
                    <td>{s.count ? fmt(s.p50) : '–'}</td>
                    <td className={s.count && s.p95 > 2 * FRAME_MS ? 'perf-slow' : undefined}>{s.count ? fmt(s.p95) : '–'}</td>
                    <td className={s.max > JANK_MS ? 'perf-slow' : undefined}>{s.count ? fmt(s.max) : '–'}</td>
                    <td>{s.count}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <Box className="perf-diagnosis">
        <Typography variant="body2">{diagnose(snapshot)}</Typography>
      </Box>
      {probe && <Typography variant="hint">{t.perf.probe(probe)}</Typography>}
    </Box>
  );
};

export default PerfPanel;
