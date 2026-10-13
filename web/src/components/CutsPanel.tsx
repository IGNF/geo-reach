import { Button, Stack, Typography } from '@ign-junn/design-system';
import { IconRoad, IconScissors, IconX } from '@ign-junn/design-system/icons';
import { type Cut, cutKey, cutLabel } from '@/engine/cuts';
import type { Network } from '@/engine/network';
import type { CutImpact } from '@/engine/travelEngine';
import { formatMinutes, formatStreet } from '@/lib/format';
import { t } from '@/locales';
import type { ReactElement } from 'react';

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
    <li>
      {line ? (
        <span className="line-badge" style={{ background: line.color, color: line.textColor }}>
          {line.name}
        </span>
      ) : (
        <IconRoad size={15} />
      )}
      <span className="trip-step-name">{name}</span>
      <Button label={t.cuts.reopen} icon={IconX} iconOnly variant="subtle" onClick={onReopen} />
    </li>
  );
};

/** "3 stations of 84 lose more than 5 min", and the worst of them */
const Impact = ({ impact, scale }: { impact: CutImpact; scale: number }): ReactElement => {
  const delayed = impact.delays.filter((d) => d.seconds >= DELAY_MIN * 60);

  return (
    <div className="cut-impact">
      <p>
        <strong>{delayed.length}</strong> {t.cuts.impact(delayed.length, impact.reached, DELAY_MIN)}
      </p>

      {delayed.length > 0 && (
        <ol className="trip-steps">
          {delayed.slice(0, WORST).map((d) => (
            <li key={d.name} className="cut-delay">
              <span className="trip-step-name">{d.name}</span>
              <span className="trip-step-meta">
                {Number.isFinite(d.seconds) ? `+${formatMinutes(d.seconds / 60)}` : t.cuts.beyond(scale)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/** The closed sections and what they cost: shown while cutting, or as long as a section is closed */
const CutsPanel = ({ net, cuts, cutMode, onCutModeChange, onToggle, onClear, impact, scale }: CutsPanelProps): ReactElement | null => {
  if (!cutMode && !cuts.length) return null;

  return (
    <section className="glass card cuts-panel">
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
        <ol className="trip-steps">
          {cuts.map((cut) => (
            <CutRow key={cutKey(cut)} net={net} cut={cut} onReopen={() => onToggle(cut)} />
          ))}
        </ol>
      )}

      {cuts.length > 0 && impact && impact.reached > 0 && <Impact impact={impact} scale={scale} />}

      {cuts.length > 1 && <Button label={t.cuts.reopenAll} variant="subtle" size="xs" onClick={onClear} />}
    </section>
  );
};

export default CutsPanel;
