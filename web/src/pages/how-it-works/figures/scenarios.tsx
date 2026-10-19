/** Figures of the scenarios: closed sections, the trip panel, the modes compared */
import type { ReactElement } from 'react';
import { details as d } from '@/locales/howItWorksDetails';
import { rampCss } from '@/shared/colors';
import { Table, Formula, Note, ArrowHead } from '@/pages/how-it-works/figures/kit';

/** A metro line closed between its second and third stations; the bus around takes longer */
const STATIONS = [
  { name: 'S1', open: 2, cut: 2 },
  { name: 'S2', open: 4, cut: 4 },
  { name: 'S3', open: 6, cut: 14 },
  { name: 'S4', open: 8, cut: 16 },
];

export const Cuts = (): ReactElement => {
  const t = d.cuts;
  const x = (i: number): number => 40 + i * 90;

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 120" aria-hidden>
        <line x1={x(0)} y1={50} x2={x(3)} y2={50} className="fig-metro" />
        <path d={`M${x(1)},50 C${x(1) + 20},105 ${x(2) - 20},105 ${x(2)},50`} className="fig-line dashed" />
        <text x={(x(1) + x(2)) / 2} y={100} textAnchor="middle" className="fig-text">
          bus
        </text>
        <g transform={`translate(${(x(1) + x(2)) / 2},50)`}>
          <line x1={-7} y1={-7} x2={7} y2={7} className="fig-cut" />
          <line x1={-7} y1={7} x2={7} y2={-7} className="fig-cut" />
        </g>
        <text x={(x(1) + x(2)) / 2} y={36} textAnchor="middle" className="fig-text warn">
          {t.closed}
        </text>
        {STATIONS.map((st, i) => (
          <g key={st.name}>
            <circle cx={x(i)} cy={50} r={6} className="fig-vertex plain" />
            <text x={x(i)} y={20} textAnchor="middle" className="fig-text strong">
              {st.name}
            </text>
          </g>
        ))}
      </svg>
      <Table
        head={t.head}
        rows={STATIONS.map((st) => [st.name, `${st.open} min`, `${st.cut} min`, st.cut > st.open ? `+${st.cut - st.open} min` : '—'])}
      />
      <Formula formula={t.formula} />
      <Note>{t.note}</Note>
    </>
  );
};

/** The edges of a path, in travel order: kind, width on the strip, the leg they end up in */
const PATH_EDGES = [
  { kind: 'walk', w: 50, leg: 0 },
  { kind: 'walk', w: 34, leg: 0 },
  { kind: 'link', w: 14, leg: 0 },
  { kind: 'wait', w: 48, leg: 1 },
  { kind: 'ride', w: 44, leg: 2 },
  { kind: 'ride', w: 44, leg: 2 },
  { kind: 'alight', w: 30, leg: 2 },
] as const;

export const Panel = (): ReactElement => {
  const t = d.panel;
  const starts = PATH_EDGES.map((_, i) => 20 + PATH_EDGES.slice(0, i).reduce((a, e) => a + e.w, 0));
  const end = (starts.at(-1) ?? 0) + (PATH_EDGES.at(-1)?.w ?? 0);
  const legs = [0, 1, 2].map((leg) => {
    const ids = PATH_EDGES.flatMap((e, i) => (e.leg === leg ? [i] : []));
    const [first = 0, last = 0] = [ids[0], ids.at(-1)];
    return { x0: starts[first] ?? 0, x1: (starts[last] ?? 0) + (PATH_EDGES[last]?.w ?? 0) };
  });

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 110" aria-hidden>
        <ArrowHead />
        <line x1={end} y1={22} x2={20} y2={22} className="fig-flow" markerEnd="url(#tip)" />
        <text x={(end + 20) / 2} y={14} textAnchor="middle" className="fig-text">
          {t.back}
        </text>
        {PATH_EDGES.map((e, i) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed path
          <rect key={i} x={starts[i]} y={38} width={e.w - 2} height={16} rx={3} className={`fig-leg ${e.kind}`} />
        ))}
        <circle cx={20} cy={46} r={5} className="fig-vertex plain" />
        <circle cx={end} cy={46} r={5} className="fig-pointer-dot" />
        {legs.map((l, i) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed legs
          <g key={i}>
            <path d={`M${l.x0 + 2},64 L${l.x0 + 2},70 L${l.x1 - 4},70 L${l.x1 - 4},64`} className="fig-bracket" />
            <text x={(l.x0 + l.x1) / 2} y={86} textAnchor="middle" className="fig-text strong">
              {t.legs[i]}
            </text>
          </g>
        ))}
      </svg>
      <Table head={t.head} rows={t.rows.map(([a, b]) => [a, b])} />
      <Note>{t.note}</Note>
    </>
  );
};

/** The same trip in the four modes, minutes */
const TRIP = [
  { mode: 'pedestrian', minutes: 32 },
  { mode: 'bike', minutes: 11 },
  { mode: 'car', minutes: 9 },
  { mode: 'transit', minutes: 17 },
] as const;

export const Compare = (): ReactElement => {
  const t = d.compare;
  const max = Math.max(...TRIP.map((r) => r.minutes));

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 120" aria-hidden>
        {TRIP.map((r, i) => (
          <g key={r.mode}>
            <text x={60} y={22 + i * 26} textAnchor="end" className="fig-text strong">
              {t.modes[r.mode]}
            </text>
            <rect x={68} y={10 + i * 26} width={(r.minutes / max) * 240} height={16} rx={4} fill={rampCss(r.minutes / 40)} />
            <text x={74 + (r.minutes / max) * 240} y={22 + i * 26} className="fig-text">
              {`${r.minutes} min`}
            </text>
          </g>
        ))}
      </svg>
      <Note>{t.note}</Note>
    </>
  );
};
