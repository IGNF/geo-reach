import { Box, Button, Stack, Typography } from '@ign-junn/design-system';
import { IconRoad, IconScissors, IconX } from '@ign-junn/design-system/icons';
import { type Cut, cutKey, cutLabel } from './cuts';
import type { CutImpact, Network } from '@/features/routing';
import { formatMinutes, formatStreet } from '@/shared/format';
import { t } from '@/locales';
import type { ReactElement } from 'react';
import LineBadge from '@/shared/ui/LineBadge';

interface CutsPanelProps {
  net: Network;
  cuts: Cut[];
  cutMode: boolean;
  onCutModeChange: (on: boolean) => void;
  onToggle: (cut: Cut) => void;
  onClear: () => void;
  /** Stations delayed by the cuts, from the origin of the map */
  impact?: CutImpact;
  /** Minutes: the max time of the map */
  scale: number;
}

/** A station counts as delayed beyond this many minutes */
const DELAY_MIN = 5;

/** Delayed stations listed by name */
const WORST = 3;

/** One closed section: its line (or a road icon), where, and a button to reopen it */
const CutRow = ({ net, cut, onReopen }: { net: Network; cut: Cut; onReopen: () => void }): ReactElement => {
  const { line, text } = cutLabel(net, cut);
  const name = line ? text : text ? formatStreet(text) : t.unnamedRoad;

  return (
    <Box component="li">
      {line ? (
        <LineBadge name={line.name} color={line.color} textColor={line.textColor} />
      ) : (
        <IconRoad size={15} />
      )}
      <Box component="span" className="trip-step-name">{name}</Box>
      <Button label={t.cuts.reopen} icon={IconX} iconOnly variant="subtle" onClick={onReopen} />
    </Box>
  );
};

/** "3 stations of 84 lose more than 5 min", and the worst of them */
const Impact = ({ impact, scale }: { impact: CutImpact; scale: number }): ReactElement => {
  const delayed = impact.delays.filter((d) => d.seconds >= DELAY_MIN * 60);

  return (
    <Box className="cut-impact">
      <Box component="p">
        <strong>{delayed.length}</strong> {t.cuts.impact(delayed.length, impact.reached, DELAY_MIN)}
      </Box>

      {delayed.length > 0 && (
        <Box component="ol" className="trip-steps">
          {delayed.slice(0, WORST).map((d) => (
            <Box component="li" key={d.name} className="cut-delay">
              <Box component="span" className="trip-step-name">{d.name}</Box>
              <Box component="span" className="trip-step-meta">
                {Number.isFinite(d.seconds) ? `+${formatMinutes(d.seconds / 60)}` : t.cuts.beyond(scale)}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

/** The closed sections and what they cost: shown while cutting, or as long as a section is closed */
const CutsPanel = ({ net, cuts, cutMode, onCutModeChange, onToggle, onClear, impact, scale }: CutsPanelProps): ReactElement | null => {
  if (!cutMode && !cuts.length) return null;

  return (
    <Box component="section" className="glass card cuts-panel">
      <Stack direction="row" justify="space-between" align="center" wrap="nowrap">
        <Stack direction="row" gap={8} align="center" wrap="nowrap">
          <IconScissors size={16} className="cuts-icon" />
          <Typography variant="subtitle2">{t.cuts.title}</Typography>
        </Stack>

        <Button
          label={cutMode ? t.cuts.done : t.cuts.add}
          variant={cutMode ? 'filled' : 'light'}
          size="xs"
          onClick={() => onCutModeChange(!cutMode)}
        />
      </Stack>

      {cutMode && <Typography variant="hint">{t.cuts.hint}</Typography>}

      {cuts.length > 0 && (
        <Box component="ol" className="trip-steps">
          {cuts.map((cut) => (
            <CutRow key={cutKey(cut)} net={net} cut={cut} onReopen={() => onToggle(cut)} />
          ))}
        </Box>
      )}

      {cuts.length > 0 && impact && impact.reached > 0 && <Impact impact={impact} scale={scale} />}

      {cuts.length > 1 && <Button label={t.cuts.reopenAll} variant="subtle" size="xs" onClick={onClear} />}
    </Box>
  );
};

export default CutsPanel;
