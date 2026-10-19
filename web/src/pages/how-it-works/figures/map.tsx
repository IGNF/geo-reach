/** Figures of the map: the network layer and the buildings colored by the times */
import type { ReactElement } from 'react';
import { details as d } from '@/locales/howItWorksDetails';
import { rampCss } from '@/shared/colors';
import { n } from '@/pages/how-it-works/figures/text';
import { Formula, Note } from '@/pages/how-it-works/figures/kit';

/** One street reached from both ends: the times of A and B, its cost each way, minutes */
const EDGE = { tA: 4, tB: 5, cost: 3, scale: 10 };

export const Layer = (): ReactElement => {
  const along = (x: number): number => Math.min(EDGE.tA + x * EDGE.cost, EDGE.tB + (1 - x) * EDGE.cost);
  const meet = (EDGE.tB + EDGE.cost - EDGE.tA) / (2 * EDGE.cost);
  const stops = [0, meet, 1];
  const [x0, x1, y] = [40, 320, 60];

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 110" aria-hidden>
        <defs>
          <linearGradient id="street-ramp">
            {stops.map((s) => (
              <stop key={s} offset={s} stopColor={rampCss(along(s) / EDGE.scale)} />
            ))}
          </linearGradient>
        </defs>
        <rect x={x0} y={y - 6} width={x1 - x0} height={12} rx={6} fill="url(#street-ramp)" />
        {stops.map((s) => (
          <g key={s}>
            <line x1={x0 + s * (x1 - x0)} y1={y - 14} x2={x0 + s * (x1 - x0)} y2={y + 14} className="fig-guide" />
            <text x={x0 + s * (x1 - x0)} y={y + 28} textAnchor="middle" className="fig-text strong">
              {`${n(along(s), 2)} min`}
            </text>
          </g>
        ))}
        <text x={x0} y={y - 20} textAnchor="middle" className="fig-text strong">
          A
        </text>
        <text x={x1} y={y - 20} textAnchor="middle" className="fig-text strong">
          B
        </text>
        <text x={x0 + meet * (x1 - x0)} y={y - 20} textAnchor="middle" className="fig-text">
          {d.layer.meet}
        </text>
      </svg>
      <p className="detail-calc">
        {`t(x) = min(${n(EDGE.tA, 1)} + ${EDGE.cost} x, ${n(EDGE.tB, 1)} + ${EDGE.cost} (1 − x)) → x = ${n(meet, 3)}, t = ${n(along(meet))} min`}
      </p>
      <Formula formula={d.layer.formula} />
      <Note>{d.layer.note}</Note>
    </>
  );
};

/** Buildings along one street: the times of its ends, its cost, minutes; each building at a share of it */
const STREET_TIMES = { tA: 4, tB: 6, cost: 3, walk: 0.5 };
const HOUSES = [
  { f: 0.15, side: -1 },
  { f: 0.5, side: 1 },
  { f: 0.85, side: -1 },
];

export const Buildings = (): ReactElement => {
  const t = d.buildings;
  const [x0, x1, y] = [40, 320, 70];
  const time = (f: number): number =>
    Math.min(STREET_TIMES.tA + f * STREET_TIMES.cost, STREET_TIMES.tB + (1 - f) * STREET_TIMES.cost) + STREET_TIMES.walk;

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 140" aria-hidden>
        <line x1={x0} y1={y} x2={x1} y2={y} className="fig-road" />
        {HOUSES.map((b) => {
          const bx = x0 + b.f * (x1 - x0);
          const by = y + b.side * 38;
          return (
            <g key={b.f}>
              <line x1={bx} y1={by} x2={bx} y2={y} className="fig-line dashed" />
              <rect x={bx - 22} y={by - 14} width={44} height={28} rx={2} fill={rampCss(time(b.f) / 10)} className="fig-vertex" />
              <text x={bx} y={by + 4} textAnchor="middle" className="fig-text strong">
                {`${n(time(b.f), 1)} min`}
              </text>
            </g>
          );
        })}
        {[
          { x: x0, label: `A ${STREET_TIMES.tA} min` },
          { x: x1, label: `B ${STREET_TIMES.tB} min` },
        ].map((p) => (
          <g key={p.label}>
            <circle cx={p.x} cy={y} r={5} className="fig-node" />
            <text x={p.x} y={y + 20} textAnchor="middle" className="fig-text strong">
              {p.label}
            </text>
          </g>
        ))}
        <text x={180} y={136} textAnchor="middle" className="fig-text">
          {t.caption(STREET_TIMES.cost, STREET_TIMES.walk * 60)}
        </text>
      </svg>
      <Formula formula={t.formula} />
      <Note>{t.note}</Note>
    </>
  );
};
