import { Link } from '@ign-junn/design-system';
import type { ReactElement, ReactNode } from 'react';
import { averageWait, bikeDownhill, bikeUphill, tobler } from '@/features/routing';
import { details as d, type FormulaText, REFERENCES, type ReferenceKey } from '@/locales/howItWorksDetails';
import type { StepId } from '@/locales/howItWorks';
import { rampCss } from '@/shared/colors';

/** A number the way the reader writes it */
const n = (x: number, digits = 2): string =>
  x.toLocaleString(navigator.language, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const Table = ({ head, rows }: { head: readonly string[]; rows: ReactNode[][] }): ReactElement => (
  <table className="detail-table">
    <thead>
      <tr>
        {head.map((h) => (
          <th key={h}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row, i) => (
        // eslint-disable-next-line react/no-array-index-key -- fixed rows
        <tr key={i}>
          {row.map((cell, j) => (
            // eslint-disable-next-line react/no-array-index-key -- fixed columns
            <td key={j}>{cell}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** Symbols as in an article: `c_AB` is c with the index AB, single letters in italics */
const symbols = (text: string): ReactNode[] =>
  text.split(/(\b[A-Za-z]_[A-Za-zé0-9]+|\b[A-Za-z]\b)/u).map((part, i) => {
    if (i % 2 === 0) return part;
    const [base, index] = part.split('_');
    return (
      // eslint-disable-next-line react/no-array-index-key -- fixed text
      <var key={i}>
        {base}
        {index !== undefined && <sub>{index}</sub>}
      </var>
    );
  });

/** Only the indexed symbols (`c_AB`) of a sentence, its other letters being words */
const indexed = (text: string): ReactNode[] =>
  text.split(/(\b[A-Za-z]_[A-Za-z0-9]+)/u).map((part, i) => (i % 2 === 0 ? part : symbols(part)));

/** A formula, one equation per line, then what its symbols stand for */
const Formula = ({ formula }: { formula: FormulaText }): ReactElement => (
  <div className="detail-formula">
    {formula.lines.map((line) => (
      <p key={line}>{symbols(line)}</p>
    ))}
    <span>{d.where}</span>
    <dl>
      {formula.terms.map(([symbol, meaning]) => (
        <div key={symbol}>
          <dt>{symbols(symbol)}</dt>
          <dd>{indexed(meaning)}</dd>
        </div>
      ))}
    </dl>
  </div>
);

const Note = ({ children }: { children: ReactNode }): ReactElement => <p className="detail-note">{children}</p>;

const References = ({ keys }: { keys: ReferenceKey[] }): ReactElement => (
  <div className="detail-references">
    {keys.map((k) => (
      <Link key={k} href={REFERENCES[k]} size="xs">
        {`${d.source} ${d.references[k]}`}
      </Link>
    ))}
  </div>
);

/** Scales of a small chart, from values to SVG coordinates */
interface Frame {
  x: (v: number) => number;
  y: (v: number) => number;
}

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

const BuildGraph = (): ReactElement => {
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

const GtfsPrep = (): ReactElement => {
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

/** Time factors of a signed grade (negative downhill), as profile.ts applies them */
const walkAt = (g: number): number => tobler(g);
const bikeAt = (g: number): number => (g >= 0 ? bikeUphill(g) : bikeDownhill(-g));

const Profile = (): ReactElement => {
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

const Snap = (): ReactElement => {
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

const Dijkstra = (): ReactElement => {
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

/** Times of a few cells of the grid, minutes, and the duration whose line is traced */
const GRID = [
  [6, 8, 12, 15],
  [7, 9, 11, 14],
  [9, 11, 13, 16],
];
const LEVEL = 10;

/** Marching squares on one cell: where the level crosses its sides, as fractions along them */
const crossings = (r: number, c: number): [number, number][] => {
  const at = (rr: number, cc: number): number => GRID[rr]?.[cc] ?? Infinity;
  const corners: [number, number, number][] = [
    [c, r, at(r, c)],
    [c + 1, r, at(r, c + 1)],
    [c + 1, r + 1, at(r + 1, c + 1)],
    [c, r + 1, at(r + 1, c)],
  ];
  const points: [number, number][] = [];
  corners.forEach(([x0, y0, t0], i) => {
    const [x1, y1, t1] = corners[(i + 1) % 4] ?? corners[0] ?? [0, 0, 0];
    if ((t0 - LEVEL) * (t1 - LEVEL) < 0) {
      const k = (LEVEL - t0) / (t1 - t0);
      points.push([x0 + k * (x1 - x0), y0 + k * (y1 - y0)]);
    }
  });

  return points;
};

const Contours = (): ReactElement => {
  const size = 52;
  const [ox, oy] = [24, 14];
  const px = (x: number): number => ox + x * size;
  const py = (y: number): number => oy + y * size;
  const segments = GRID.slice(1)
    .flatMap((row, r) => row.slice(1).map((_, c) => crossings(r, c)))
    .filter((s) => s.length > 0);

  return (
    <>
      <svg className="detail-figure" viewBox="0 0 360 140" aria-hidden>
        {GRID.slice(1).map((row, r) =>
          row.slice(1).map((_, c) => (
            // eslint-disable-next-line react/no-array-index-key -- fixed grid
            <rect key={`${r}-${c}`} x={px(c)} y={py(r)} width={size} height={size} className="fig-cell" />
          )),
        )}
        {segments.map((s) => (
          <polyline key={s.join()} points={s.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} className="fig-isoline" />
        ))}
        {GRID.map((row, r) =>
          row.map((time, c) => (
            // eslint-disable-next-line react/no-array-index-key -- fixed grid
            <g key={`${r}-${c}`}>
              <circle cx={px(c)} cy={py(r)} r={9} fill={rampCss(time / 20)} className="fig-vertex" />
              <text x={px(c)} y={py(r) + 3.5} textAnchor="middle" className="fig-text on-color">
                {time}
              </text>
            </g>
          )),
        )}
        <text x={px(3) + 20} y={py(1)} className="fig-text strong">
          {d.contours.level(String(LEVEL))}
        </text>
        <line x1={px(3) + 20} y1={py(1) + 8} x2={px(3) + 60} y2={py(1) + 8} className="fig-isoline" />
      </svg>
      <p className="detail-calc">{`x = (${LEVEL} − 9) / (11 − 9) = ${n(0.5, 1)}`}</p>
      <Formula formula={d.contours.formula} />
      <Note>{d.contours.note}</Note>
      <References keys={['borgefors', 'lorensen']} />
    </>
  );
};

/** One street reached from both ends: the times of A and B, its cost each way, minutes */
const EDGE = { tA: 4, tB: 5, cost: 3, scale: 10 };

const Layer = (): ReactElement => {
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

/** An arrow head for the box sketches, its tip on the end of the line */
const ArrowHead = (): ReactElement => (
  <defs>
    <marker id="tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" className="fig-arrow" />
    </marker>
  </defs>
);

/** A labelled box of a sketch */
const SketchBox = ({ x, y, w, hgt, title, tone = '' }: { x: number; y: number; w: number; hgt: number; title: string; tone?: string }): ReactElement => (
  <g>
    <rect x={x} y={y} width={w} height={hgt} rx={6} className={`fig-box ${tone}`} />
    <text x={x + w / 2} y={y + 14} textAnchor="middle" className="fig-text strong">
      {title}
    </text>
  </g>
);

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

const EngineCrate = (): ReactElement => {
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

const Wasm = (): ReactElement => {
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

const Loaders = (): ReactElement => {
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

/** A metro line closed between its second and third stations; the bus around takes longer */
const STATIONS = [
  { name: 'S1', open: 2, cut: 2 },
  { name: 'S2', open: 4, cut: 4 },
  { name: 'S3', open: 6, cut: 14 },
  { name: 'S4', open: 8, cut: 16 },
];

const Cuts = (): ReactElement => {
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

const Panel = (): ReactElement => {
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

const Compare = (): ReactElement => {
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

/** Buildings along one street: the times of its ends, its cost, minutes; each building at a share of it */
const STREET_TIMES = { tA: 4, tB: 6, cost: 3, walk: 0.5 };
const HOUSES = [
  { f: 0.15, side: -1 },
  { f: 0.5, side: 1 },
  { f: 0.85, side: -1 },
];

const Buildings = (): ReactElement => {
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

const FIGURES: Partial<Record<StepId, () => ReactElement>> = {
  buildGraph: BuildGraph,
  gtfsPrep: GtfsPrep,
  profile: Profile,
  snap: Snap,
  dijkstra: Dijkstra,
  contours: Contours,
  layer: Layer,
  engineCrate: EngineCrate,
  wasm: Wasm,
  loaders: Loaders,
  cuts: Cuts,
  panel: Panel,
  compare: Compare,
  buildings: Buildings,
};

/** The detailed figure of a step of the diagram: a sketch, the formula, the numbers of one example, the sources */
const StepDetail = ({ step }: { step: StepId }): ReactElement | null => {
  const Figure = FIGURES[step];

  return Figure ? (
    <div className="step-detail">
      <p className="detail-example">{d.example}</p>
      <Figure />
    </div>
  ) : null;
};

export default StepDetail;
