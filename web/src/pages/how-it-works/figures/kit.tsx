/** The pieces of the figures: tables, formulas, notes, sources, boxes and arrows of the sketches */
import { Link } from '@ign-junn/design-system';
import type { ReactElement, ReactNode } from 'react';
import { details as d, type FormulaText, REFERENCES, type ReferenceKey } from '@/locales/howItWorksDetails';
import { symbols, indexed } from '@/pages/how-it-works/figures/text';

export const Table = ({ head, rows }: { head: readonly string[]; rows: ReactNode[][] }): ReactElement => (
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

/** A formula, one equation per line, then what its symbols stand for */
export const Formula = ({ formula }: { formula: FormulaText }): ReactElement => (
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

export const Note = ({ children }: { children: ReactNode }): ReactElement => <p className="detail-note">{children}</p>;

export const References = ({ keys }: { keys: ReferenceKey[] }): ReactElement => (
  <div className="detail-references">
    {keys.map((k) => (
      <Link key={k} href={REFERENCES[k]} size="xs">
        {`${d.source} ${d.references[k]}`}
      </Link>
    ))}
  </div>
);

/** An arrow head for the box sketches, its tip on the end of the line */
export const ArrowHead = (): ReactElement => (
  <defs>
    <marker id="tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" className="fig-arrow" />
    </marker>
  </defs>
);

/** A labelled box of a sketch */
export const SketchBox = ({ x, y, w, hgt, title, tone = '' }: { x: number; y: number; w: number; hgt: number; title: string; tone?: string }): ReactElement => (
  <g>
    <rect x={x} y={y} width={w} height={hgt} rx={6} className={`fig-box ${tone}`} />
    <text x={x + w / 2} y={y + 14} textAnchor="middle" className="fig-text strong">
      {title}
    </text>
  </g>
);
