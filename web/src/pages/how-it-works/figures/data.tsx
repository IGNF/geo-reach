/** Figures of the data steps: the road graph and its relief, the GTFS summed up hour by hour, the loaders */
import type { ReactElement } from 'react';
import { averageWait } from '@/features/routing';
import { details as d } from '@/locales/howItWorksDetails';
import { n, type Frame } from '@/pages/how-it-works/figures/text';
import { Table, Formula, Note, References, ArrowHead, SketchBox } from '@/pages/how-it-works/figures/kit';

/** Heights of the points of a section, every 20 m */
const HEIGHTS = [35.0, 35.3, 36.4, 36.1, 36.3, 37.0, 36.2, 35.6];
const HYSTERESIS = 0.5;

/** Climb and descent as crates/prep counts them: follows the trend at once, turns only past the hysteresis */
const relief = (z: number[]): { up: number; down: number; counted: (number | undefined)[] } => {
  const state = { up: 0, down: 0, reference: z[0] ?? 0, trend: 0 };
  const counted = z.map((h) => {
    const dz = h - state.reference;
    const keep = (state.trend >= 0 && dz > 0) || (state.trend <= 0 && dz < 0) || Math.abs(dz) >= HYSTERESIS;
    if (!keep) return undefined;
    if (dz > 0) state.up += dz;
    else state.down -= dz;
    if (dz !== 0) state.trend = Math.sign(dz);
    state.reference = h;

    return dz;
  });

  return { up: state.up, down: state.down, counted };
};

export const BuildGraph = (): ReactElement => {
  const t = d.buildGraph;
  const { up, down, counted } = relief(HEIGHTS);
  const steps = HEIGHTS.slice(1).map((h, i) => h - (HEIGHTS[i] ?? h));
  const rawUp = steps.filter((s) => s > 0).reduce((a, s) => a + s, 0);
  const rawDown = -steps.filter((s) => s < 0).reduce((a, s) => a + s, 0);
  const f: Frame = { x: (i) => 30 + i * 44, y: (h) => 100 - (h - 34.5) * 30 };
  const line = HEIGHTS.map((h, i) => `${f.x(i)},${f.y(h)}`).join(' ');

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 130" aria-hidden>
        <polygon points={`${f.x(0)},110 ${line} ${f.x(HEIGHTS.length - 1)},110`} className="fig-ground" />
        <polyline points={line} className="fig-road" />
        {HEIGHTS.map((h, i) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed profile
          <g key={i}>
            <circle cx={f.x(i)} cy={f.y(h)} r={4} className={i > 0 && counted[i] === undefined ? 'fig-node muted' : 'fig-node'} />
            <text x={f.x(i)} y={f.y(h) - 8} textAnchor="middle" className="fig-text strong">
              {n(h, 1)}
            </text>
          </g>
        ))}
        <text x={180} y={124} textAnchor="middle" className="fig-text">
          {`${t.distance} (0 – 140 m)`}
        </text>
      </svg>
      <div className="detail-key">
        <span>
          <i className="key-node" />
          {`${t.up} / ${t.down}`}
        </span>
        <span>
          <i className="key-node muted" />
          {t.ignored}
        </span>
      </div>
      <Table
        head={t.head}
        rows={HEIGHTS.map((h, i) => {
          const dz = i === 0 ? 0 : counted[i];
          const shown = dz === undefined ? t.ignored : dz === 0 ? '' : `${dz > 0 ? '+' : '−'}${n(Math.abs(dz), 1)}`;
          return [i + 1, `${n(h, 1)} m`, shown];
        })}
      />
      <p className="detail-calc">{t.result(n(up, 1), n(down, 1), n(rawUp, 1), n(rawDown, 1))}</p>
      <Formula formula={t.formula} />
      <Note>{t.note}</Note>
    </>
  );
};

/** Three lines of the example and their departures in the hour */
const LINES = [
  { key: 'metro', departures: 20 },
  { key: 'tram', departures: 8 },
  { key: 'bus', departures: 3 },
] as const;

export const GtfsPrep = (): ReactElement => {
  const t = d.gtfsPrep;
  const f: Frame = { x: (h) => 36 + h * 10.5, y: (w) => 120 - w * 8 };
  const headways = Array.from({ length: 49 }, (_, i) => 1 + i * 0.5);
  const curve = (w: (h: number) => number): string => headways.map((h) => `${f.x(h)},${f.y(w(h))}`).join(' ');
  const wait = (h: number): number => averageWait((h * 60) / 2) / 60;

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 150" aria-hidden>
        <line x1={f.x(0)} y1={f.y(0)} x2={f.x(25)} y2={f.y(0)} className="fig-axis" />
        <line x1={f.x(0)} y1={f.y(0)} x2={f.x(0)} y2={f.y(13)} className="fig-axis" />
        {[0, 10, 20].map((h) => (
          <text key={h} x={f.x(h)} y={f.y(0) + 12} textAnchor="middle" className="fig-text">
            {h}
          </text>
        ))}
        {[5, 10].map((w) => (
          <text key={w} x={f.x(0) - 4} y={f.y(w) + 3} textAnchor="end" className="fig-text">
            {w}
          </text>
        ))}
        <line x1={f.x(10)} y1={f.y(0)} x2={f.x(10)} y2={f.y(12.5)} className="fig-guide" />
        <polyline points={curve((h) => h / 2)} className="fig-line dashed" />
        <polyline points={curve(wait)} className="fig-line" />
        {LINES.map((l) => {
          const h = 60 / l.departures;
          return (
            <g key={l.key}>
              <circle cx={f.x(h)} cy={f.y(wait(h))} r={4} className="fig-node" />
              <text x={f.x(h) + 6} y={f.y(wait(h)) + 12} className="fig-text strong">
                {t.lines[l.key]}
              </text>
            </g>
          );
        })}
        <text x={f.x(12.5)} y={146} textAnchor="middle" className="fig-text">
          {t.headwayAxis}
        </text>
        <text x={f.x(0) + 4} y={f.y(13) + 4} className="fig-text">
          {t.waitAxis}
        </text>
      </svg>
      <div className="detail-key">
        <span>
          <i className="key-line" />
          {t.model}
        </span>
        <span>
          <i className="key-line dashed" />
          {t.random}
        </span>
      </div>
      <Table
        head={t.head}
        rows={LINES.map((l) => {
          const h = 60 / l.departures;
          return [t.lines[l.key], l.departures, n(h, 1), n(h / 2, 1), n(wait(h), 1)];
        })}
      />
      <Formula formula={t.formula} />
      <Note>{t.note}</Note>
      <References keys={['gtfs', 'osuna', 'ingvardson', 'singh']} />
    </>
  );
};

export const Loaders = (): ReactElement => {
  const t = d.loaders;
  const widths = [40, 58, 44, 44, 44, 36, 26];
  const types = ['', 'Float32Array', 'Uint32Array', 'Uint32Array', 'Uint16Array', 'Uint8Array', ''];
  const starts = widths.map((_, i) => 8 + widths.slice(0, i).reduce((a, w) => a + w, 0));

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 160" aria-hidden>
        <ArrowHead />
        <SketchBox x={8} y={8} w={90} hgt={30} title={t.file} />
        <SketchBox x={248} y={8} w={104} hgt={30} title={t.cache} tone="memory" />
        <line x1={98} y1={23} x2={248} y2={23} className="fig-flow" markerEnd="url(#tip)" />
        <text x={173} y={17} textAnchor="middle" className="fig-text">
          {t.kept}
        </text>
        <text x={60} y={54} className="fig-text">
          {t.inflate}
        </text>
        <line x1={53} y1={38} x2={53} y2={62} className="fig-flow" markerEnd="url(#tip)" />
        {widths.map((w, i) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed layout
          <g key={i}>
            <rect x={starts[i]} y={64} width={w} height={22} className={i === 1 || i === 2 ? 'fig-cell-box focus' : 'fig-cell-box'} />
            <text x={(starts[i] ?? 0) + w / 2} y={79} textAnchor="middle" className="fig-text small">
              {t.blocks[i]}
            </text>
            {types[i] && (
              <>
                <line x1={(starts[i] ?? 0) + w / 2} y1={86} x2={(starts[i] ?? 0) + w / 2} y2={102 + (i % 2) * 18} className="fig-pointer" />
                <text x={(starts[i] ?? 0) + w / 2} y={112 + (i % 2) * 18} textAnchor="middle" className="fig-text strong">
                  {types[i]}
                </text>
              </>
            )}
          </g>
        ))}
        <text x={8} y={152} className="fig-text">
          {t.views}
        </text>
      </svg>
      <Note>{t.note}</Note>
    </>
  );
};
