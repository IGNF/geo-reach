/** Figures of the search: the costs of a profile, the snapping of the cursor, the bounded Dijkstra */
import type { ReactElement, ReactNode } from 'react';
import { bikeDownhill, bikeUphill, tobler } from '@/features/routing';
import { details as d } from '@/locales/howItWorksDetails';
import { rampCss } from '@/shared/colors';
import { n, type Frame } from '@/pages/how-it-works/figures/text';
import { Table, Formula, Note, References } from '@/pages/how-it-works/figures/kit';

/** Time factors of a signed grade (negative downhill), as profile.ts applies them */
const walkAt = (g: number): number => tobler(g);
const bikeAt = (g: number): number => (g >= 0 ? bikeUphill(g) : bikeDownhill(-g));

export const Profile = (): ReactElement => {
  const t = d.profile;
  const f: Frame = { x: (g) => 180 + g * 1500, y: (k) => 120 - (k - 0.5) * 40 };
  const grades = Array.from({ length: 41 }, (_, i) => -0.1 + i * 0.005);
  const curve = (k: (g: number) => number): string => grades.map((g) => `${f.x(g)},${f.y(k(g))}`).join(' ');

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 150" aria-hidden>
        <line x1={f.x(-0.1)} y1={f.y(0.5)} x2={f.x(0.1)} y2={f.y(0.5)} className="fig-axis" />
        <line x1={f.x(0)} y1={f.y(0.5)} x2={f.x(0)} y2={f.y(3.1)} className="fig-guide" />
        <line x1={f.x(-0.1)} y1={f.y(1)} x2={f.x(0.1)} y2={f.y(1)} className="fig-guide" />
        {[-0.1, -0.05, 0, 0.05, 0.1].map((g) => (
          <text key={g} x={f.x(g)} y={f.y(0.5) + 12} textAnchor="middle" className="fig-text">
            {`${Math.round(g * 100)} %`}
          </text>
        ))}
        {[1, 2, 3].map((k) => (
          <text key={k} x={f.x(-0.1) - 4} y={f.y(k) + 3} textAnchor="end" className="fig-text">
            {`×${k}`}
          </text>
        ))}
        <polyline points={curve(walkAt)} className="fig-line" />
        <polyline points={curve(bikeAt)} className="fig-line bike" />
        <text x={f.x(0.1)} y={f.y(walkAt(0.1)) + 12} textAnchor="end" className="fig-text strong">
          {t.walk}
        </text>
        <text x={f.x(0.1) - 4} y={f.y(bikeAt(0.1)) - 2} textAnchor="end" className="fig-text strong">
          {t.bike}
        </text>
        <text x={180} y={146} textAnchor="middle" className="fig-text">
          {t.gradeAxis}
        </text>
      </svg>
      <Table
        head={t.head}
        rows={[-0.1, -0.05, 0, 0.05, 0.1].map((g) => [`${Math.round(g * 100)} %`, `×${n(walkAt(g))}`, `×${n(bikeAt(g))}`])}
      />
      <Formula formula={t.formula} />
      <p className="detail-calc">{t.calc(n(walkAt(0.05)), n(bikeAt(0.05)))}</p>
      <Note>{t.note}</Note>
      <References keys={['tobler', 'parkin']} />
    </>
  );
};

/** A 100 m street walked in 90 s each way, the cursor 20 m away from it, its projection at 30 % from A */
const STREET = { cost: 90, f: 0.3, walk: 18 };

export const Snap = (): ReactElement => {
  const t = d.snap;
  const [ax, bx, y] = [40, 320, 100];
  const qx = ax + STREET.f * (bx - ax);
  const costA = STREET.walk + STREET.f * STREET.cost;
  const costB = STREET.walk + (1 - STREET.f) * STREET.cost;

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 130" aria-hidden>
        <line x1={ax} y1={y} x2={bx} y2={y} className="fig-road" />
        <line x1={qx} y1={40} x2={qx} y2={y} className="fig-line dashed" />
        <circle cx={qx} cy={40} r={5} className="fig-cursor" />
        <circle cx={qx} cy={y} r={3} className="fig-node muted" />
        {[
          { x: ax, label: 'A' },
          { x: bx, label: 'B' },
        ].map((p) => (
          <g key={p.label}>
            <circle cx={p.x} cy={y} r={5} className="fig-node" />
            <text x={p.x} y={y + 20} textAnchor="middle" className="fig-text strong">
              {p.label}
            </text>
          </g>
        ))}
        <text x={qx + 9} y={44} className="fig-text strong">
          {`P, ${t.cursor}`}
        </text>
        <text x={qx + 6} y={74} className="fig-text">
          {`d = 20 m, ${t.walk} ${STREET.walk} s`}
        </text>
        <text x={(ax + qx) / 2} y={y - 6} textAnchor="middle" className="fig-text">
          {`f = ${n(STREET.f, 1)}`}
        </text>
        <text x={(qx + bx) / 2} y={y - 6} textAnchor="middle" className="fig-text">
          {`${t.edge}, 100 m, ${STREET.cost} s`}
        </text>
      </svg>
      <Table
        head={t.head}
        rows={[
          ['A', `${STREET.walk} + ${n(STREET.f, 1)} × ${STREET.cost} = ${costA} s`],
          ['B', `${STREET.walk} + ${n(1 - STREET.f, 1)} × ${STREET.cost} = ${costB} s`],
        ]}
      />
      <Formula formula={t.formula} />
      <Note>{t.note}</Note>
      <References keys={['sharir']} />
    </>
  );
};

/** A small graph: the two start points A and B of the snap example, three crossings, a 3 min bound */
const BOUND = 180;
const NODES = {
  A: { x: 40, y: 40 },
  B: { x: 40, y: 120 },
  C: { x: 170, y: 30 },
  D: { x: 170, y: 120 },
  E: { x: 310, y: 75 },
} as const;
type NodeName = keyof typeof NODES;
const ARCS: [NodeName, NodeName, number][] = [
  ['A', 'C', 60],
  ['A', 'D', 120],
  ['B', 'D', 30],
  ['C', 'E', 90],
  ['D', 'E', 40],
];
const SOURCES: [NodeName, number][] = [
  ['A', 45],
  ['B', 81],
];

/** The run of the engine on the small graph, step by step, as crates/engine does it */
const runDijkstra = (): { dist: Map<NodeName, number>; rows: ReactNode[][] } => {
  const dist = new Map<NodeName, number>();
  const heap: [number, NodeName][] = [];
  const relax = (v: NodeName, time: number, notes: string[]): void => {
    if (time > BOUND) {
      notes.push(d.dijkstra.beyond(v, `${time} s`));
      return;
    }
    if (time >= (dist.get(v) ?? Infinity)) return;
    dist.set(v, time);
    heap.push([time, v]);
    notes.push(`${v} = ${time} s`);
  };
  for (const [v, time] of SOURCES) relax(v, time, []);

  const rows: ReactNode[][] = [];
  while (heap.length > 0) {
    heap.sort((a, b) => a[0] - b[0]);
    const [time, u] = heap.shift() ?? [0, 'A'];
    if (time > (dist.get(u) ?? Infinity)) {
      rows.push([rows.length + 1, u, time, d.dijkstra.stale]);
      continue;
    }
    const notes: string[] = [];
    for (const [from, to, cost] of ARCS) if (from === u) relax(to, time + cost, notes);
    rows.push([rows.length + 1, u, time, notes.join(' · ')]);
  }

  return { dist, rows };
};

export const Dijkstra = (): ReactElement => {
  const { dist, rows } = runDijkstra();

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 160" aria-hidden>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className="fig-arrow" />
          </marker>
        </defs>
        {ARCS.map(([from, to, cost]) => {
          const [a, b] = [NODES[from], NODES[to]];
          return (
            <g key={`${from}${to}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="fig-arc" markerEnd="url(#arrow)" />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} textAnchor="middle" className="fig-text">
                {`${cost} s`}
              </text>
            </g>
          );
        })}
        {(Object.keys(NODES) as NodeName[]).map((k) => {
          const time = dist.get(k) ?? Infinity;
          return (
            <g key={k}>
              <circle cx={NODES[k].x} cy={NODES[k].y} r={7} fill={rampCss(time / BOUND)} className="fig-vertex" />
              <text x={NODES[k].x} y={NODES[k].y + 22} textAnchor="middle" className="fig-text strong">
                {`${k} ${time} s`}
              </text>
            </g>
          );
        })}
      </svg>
      <Table head={d.dijkstra.head} rows={rows} />
      <Formula formula={d.dijkstra.formula} />
      <Note>{d.dijkstra.note}</Note>
      <References keys={['dijkstra', 'chen']} />
    </>
  );
};
