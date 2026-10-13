import { Box } from '@ign-junn/design-system';
import type { ReactElement } from 'react';

interface LineBadgeProps {
  /** Short name of the line: 1, A, T3… */
  name: string;
  /** CSS colors of the line, from its timetables */
  color: string;
  textColor: string;
}

/** A public transport line in its own colors (the badges of the design system only take its tones) */
const LineBadge = ({ name, color, textColor }: LineBadgeProps): ReactElement => (
  <Box component="span" className="line-badge" style={{ background: color, color: textColor }}>
    {name}
  </Box>
);

export default LineBadge;
