/** Numbers and symbols written as in an article, and the scales of the small charts */
import type { ReactNode } from 'react';

/** A number the way the reader writes it */
export const n = (x: number, digits = 2): string =>
  x.toLocaleString(navigator.language, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Symbols as in an article: `c_AB` is c with the index AB, single letters in italics */
export const symbols = (text: string): ReactNode[] =>
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
export const indexed = (text: string): ReactNode[] =>
  text.split(/(\b[A-Za-z]_[A-Za-z0-9]+)/u).map((part, i) => (i % 2 === 0 ? part : symbols(part)));

/** Scales of a small chart, from values to SVG coordinates */
export interface Frame {
  x: (v: number) => number;
  y: (v: number) => number;
}
