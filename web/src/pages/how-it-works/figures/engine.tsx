/** Figures of the engine: its crate and compressed rows, the WebAssembly module */
import type { ReactElement } from 'react';
import { details as d } from '@/locales/howItWorksDetails';
import { Formula, Note, ArrowHead, SketchBox } from '@/pages/how-it-works/figures/kit';

/** A small graph and its compressed rows: node 1 owns the arcs offsets[1] to offsets[2] − 1 */
const CSR = {
  nodes: [
    { x: 30, y: 30 },
    { x: 110, y: 30 },
    { x: 30, y: 110 },
    { x: 110, y: 110 },
  ],
  arcs: [
    [0, 1, 60],
    [0, 2, 90],
    [1, 2, 30],
    [1, 3, 120],
    [2, 3, 45],
  ] as const,
  focus: 1,
};

export const EngineCrate = (): ReactElement => {
  const t = d.engineCrate;
  const offsets = CSR.nodes.map((_, n) => CSR.arcs.filter(([a]) => a < n).length).concat(CSR.arcs.length);
  const [from, to] = [offsets[CSR.focus] ?? 0, offsets[CSR.focus + 1] ?? 0];
  const cell = 30;
  const x0 = 200;
  const rows: [string, readonly (number | string)[], number][] = [
    ['offsets', offsets, 40],
    ['heads', CSR.arcs.map(([, b]) => b), 92],
    ['costs', CSR.arcs.map(([, , c]) => c), 122],
  ];

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 150" aria-hidden>
        <defs>
          <marker id="arc" viewBox="0 0 10 10" refX="17" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className="fig-arrow" />
          </marker>
        </defs>
        {CSR.arcs.map(([a, b, c], i) => {
          const [p, q] = [CSR.nodes[a] ?? { x: 0, y: 0 }, CSR.nodes[b] ?? { x: 0, y: 0 }];
          return (
            <g key={`${a}-${b}`}>
              <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={i >= from && i < to ? 'fig-arc focus' : 'fig-arc'} markerEnd="url(#arc)" />
              <text x={p.x + (q.x - p.x) * 0.35 + (p.y === q.y ? 0 : 7)} y={p.y + (q.y - p.y) * 0.35 - (p.y === q.y ? 5 : 0)} className="fig-text">
                {c}
              </text>
            </g>
          );
        })}
        {CSR.nodes.map((p, n) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed graph
          <g key={n}>
            <circle cx={p.x} cy={p.y} r={9} className={n === CSR.focus ? 'fig-vertex focus' : 'fig-vertex plain'} />
            <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="fig-text strong">
              {n}
            </text>
          </g>
        ))}
        <text x={70} y={142} textAnchor="middle" className="fig-text">
          {t.graph}
        </text>
        {rows.map(([name, values, y]) => (
          <g key={name}>
            <text x={x0 - 6} y={y + 4} textAnchor="end" className="fig-text strong">
              {name}
            </text>
            {values.map((v, i) => {
              const focus = name === 'offsets' ? i === CSR.focus || i === CSR.focus + 1 : i >= from && i < to;
              return (
                // eslint-disable-next-line react/no-array-index-key -- fixed arrays
                <g key={i}>
                  <rect x={x0 + i * cell} y={y - 10} width={cell} height={20} className={focus ? 'fig-cell-box focus' : 'fig-cell-box'} />
                  <text x={x0 + i * cell + cell / 2} y={y + 4} textAnchor="middle" className="fig-text strong">
                    {v}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
        <path d={`M${x0 + CSR.focus * cell + cell / 2},50 L${x0 + from * cell + 4},82`} className="fig-pointer" />
        <path d={`M${x0 + (CSR.focus + 1) * cell + cell / 2},50 L${x0 + to * cell - 4},82`} className="fig-pointer" />
        <text x={x0} y={142} className="fig-text">
          {`${t.arrays} · ${t.arcsOf(CSR.focus)}`}
        </text>
      </svg>
      <Formula formula={t.formula} />
      <Note>{t.note}</Note>
    </>
  );
};

export const Wasm = (): ReactElement => {
  const t = d.wasm;
  const buffers = ['offsets', 'heads', 'costs', 'dist', 'pred'];

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 170" aria-hidden>
        <ArrowHead />
        <SketchBox x={4} y={30} w={92} hgt={110} title={t.page} />
        <SketchBox x={130} y={30} w={92} hgt={110} title={t.worker} />
        <SketchBox x={256} y={30} w={100} hgt={136} title={t.memory} tone="memory" />
        {buffers.map((b, i) => (
          <g key={b}>
            <rect x={266} y={46 + i * 23} width={80} height={18} rx={3} className={b === 'dist' ? 'fig-cell-box focus' : 'fig-cell-box'} />
            <text x={306} y={59 + i * 23} textAnchor="middle" className="fig-text">
              {b}
            </text>
          </g>
        ))}
        <line x1={96} y1={64} x2={130} y2={64} className="fig-flow" markerEnd="url(#tip)" />
        <line x1={222} y1={64} x2={266} y2={64} className="fig-flow" markerEnd="url(#tip)" />
        <line x1={222} y1={100} x2={266} y2={100} className="fig-flow" markerEnd="url(#tip)" />
        <line x1={266} y1={123} x2={222} y2={123} className="fig-flow" markerEnd="url(#tip)" />
        <line x1={130} y1={123} x2={96} y2={123} className="fig-flow" markerEnd="url(#tip)" />
        <text x={176} y={22} textAnchor="middle" className="fig-text">
          {t.write}
        </text>
        <text x={50} y={58} textAnchor="middle" className="fig-text">
          {t.run}
        </text>
        <text x={4} y={158} className="fig-text">
          {t.back}
        </text>
      </svg>
      <Note>{t.note}</Note>
    </>
  );
};
